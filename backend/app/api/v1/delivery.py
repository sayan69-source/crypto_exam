"""
CryptoExam Core — Per-Question Sealed Delivery API
§ 10.7 — TCS-iON-style pipeline: seal ─► commit ─► deliver ─► lazy decrypt.

  POST /api/v1/delivery/seal/{exam_id}      — seal every question + commit root (SETTER/ADMIN)
  GET  /api/v1/delivery/bundle/{exam_id}    — fetch the keyless sealed bundle (terminal)
  GET  /api/v1/delivery/root/{exam_id}      — fetch the on-chain questions root (public)
  POST /api/v1/delivery/verify/{exam_id}    — verify a single question against the root (public)

The candidate terminal performs the actual per-question DECRYPTION client-side
(WebCrypto) once the T₀ master seed is released — see
`public/frontend/lib/exam/question-pipeline.ts`. The server never holds a key.
"""

import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import (
    User, UserRole, Exam, ExamStatus, Question,
    ShamirShard as ShamirShardModel,
    SealedQuestionBundle,
)
from app.services.auth import require_role

# crypto/ lives at backend/crypto — make it importable like the other routers do
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))
from crypto.question_sealing import seal_exam_questions, open_question  # noqa: E402
from crypto.shamir import ShamirPaperGuardian  # noqa: E402

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Schemas ──

class SealResponse(BaseModel):
    exam_id: str
    questions_root: str
    question_count: int
    chain_tx: str | None
    shards: list[dict]          # master-seed shards — shown ONCE, never stored raw
    warning: str


class VerifyRequest(BaseModel):
    question_id: str
    iv: str
    ct: str
    tag: str
    proof: list[dict]


# ── Endpoints ──

@router.post("/seal/{exam_id}", response_model=SealResponse, summary="Seal questions & commit root")
async def seal_questions(
    exam_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.SETTER, UserRole.ADMIN)),
):
    """
    Seal every accepted question under its own key, build the Merkle root over
    the sealed set, commit that root on-chain, and persist the keyless bundle.

    The master seed is split into Shamir shards (returned ONCE). At T₀ the seed
    is reconstructed (ceremony path) or re-derived from the drand beacon (online
    path); the terminal then decrypts questions one at a time on demand.
    """
    exam = (await db.execute(select(Exam).where(Exam.id == exam_id))).scalar_one_or_none()
    if not exam:
        raise HTTPException(404, "Exam not found")
    if exam.status not in (ExamStatus.GENERATING, ExamStatus.PROOF_PENDING):
        raise HTTPException(400, f"Exam must be GENERATING or PROOF_PENDING, not {exam.status.value}")

    rows = (await db.execute(
        select(Question).where(Question.exam_id == exam_id, Question.is_accepted == True)  # noqa: E712
        .order_by(Question.sequence_number)
    )).scalars().all()
    if not rows:
        raise HTTPException(400, "No accepted questions to seal for this exam")

    questions = [{
        "id": str(q.id),
        "sequence_number": q.sequence_number,
        "set_label": q.set_label,
        "text": q.text, "text_hi": q.text_hi, "text_regional": q.text_regional,
        "options": q.options, "options_hi": q.options_hi,
        "subject": q.subject, "topic": q.topic,
        # NB: correct_option is deliberately NOT included — grading stays server-side.
    } for q in rows]

    # 1. SEAL — master seed is transient; only its shard hashes persist.
    master_seed = os.urandom(32)
    bundle = seal_exam_questions(questions, master_seed, str(exam_id))
    shards = ShamirPaperGuardian.split(master_seed, n=exam.shamir_shard_count or 5, k=exam.shamir_threshold or 3)

    # 2. COMMIT — put the questions root on-chain (reuses lockExam).
    chain_tx: str | None = None
    try:
        from app.services.blockchain import blockchain_service
        root_bytes = bytes.fromhex(bundle.questions_root[2:])
        chain_tx = await blockchain_service.lock_exam(
            str(exam_id), root_bytes, exam.drand_round or 0, exam.constraint_spec_ipfs or "",
        )
    except Exception as e:  # noqa: BLE001 — chain may be unconfigured in dev; seal still valid
        logger.warning("On-chain commit skipped/failed for %s: %s", str(exam_id)[:8], e)

    # 3. STORE — persist the keyless bundle + commitments.
    exam.question_hash = bytes.fromhex(bundle.questions_root[2:])
    exam.polygon_exam_tx = chain_tx
    exam.updated_at = datetime.now(timezone.utc)

    existing = (await db.execute(
        select(SealedQuestionBundle).where(SealedQuestionBundle.exam_id == exam_id)
    )).scalar_one_or_none()
    if existing:
        existing.questions_root = bundle.questions_root
        existing.question_count = bundle.count
        existing.bundle = bundle.to_dict()
        existing.chain_tx = chain_tx
        existing.drand_round = exam.drand_round
    else:
        db.add(SealedQuestionBundle(
            exam_id=str(exam_id),
            questions_root=bundle.questions_root,
            question_count=bundle.count,
            bundle=bundle.to_dict(),
            chain_tx=chain_tx,
            drand_round=exam.drand_round,
        ))

    for s in shards:
        db.add(ShamirShardModel(exam_id=exam_id, shard_index=s.index, shard_hash=s.hash))

    logger.info("Sealed exam=%s questions=%d root=%s tx=%s",
                str(exam_id)[:8], bundle.count, bundle.questions_root[:14],
                (chain_tx or "—")[:14])

    return SealResponse(
        exam_id=str(exam_id),
        questions_root=bundle.questions_root,
        question_count=bundle.count,
        chain_tx=chain_tx,
        shards=[{"index": s.index, "value": s.value} for s in shards],
        warning="STORE SHARD VALUES SECURELY. They are shown ONCE and never persisted.",
    )


@router.get("/bundle/{exam_id}", summary="Fetch keyless sealed bundle (pre-position on terminal)")
async def get_bundle(exam_id: UUID, db: AsyncSession = Depends(get_db)):
    """
    Return the sealed bundle for pre-positioning on a centre terminal.

    This is intentionally PUBLIC and keyless: before T₀ it is inert ciphertext.
    The terminal stores it in IndexedDB and only becomes able to read a question
    once the T₀ master seed is released.
    """
    row = (await db.execute(
        select(SealedQuestionBundle).where(SealedQuestionBundle.exam_id == exam_id)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "No sealed bundle for this exam — call /seal first")
    return row.bundle


@router.get("/root/{exam_id}", summary="On-chain questions root (public)")
async def get_root(exam_id: UUID, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(
        select(SealedQuestionBundle).where(SealedQuestionBundle.exam_id == exam_id)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "No sealed bundle for this exam")
    return {
        "examId": str(exam_id),
        "questionsRoot": row.questions_root,
        "questionCount": row.question_count,
        "chainTx": row.chain_tx,
        "drandRound": row.drand_round,
    }


@router.post("/verify/{exam_id}", summary="Verify one sealed question against the committed root (public)")
async def verify_question(exam_id: UUID, body: VerifyRequest, db: AsyncSession = Depends(get_db)):
    """
    Verify — without any key — that a single sealed question is part of the
    committed on-chain set. Anyone can call this to audit a delivered question.
    """
    from crypto.question_sealing import question_leaf
    from crypto.merkle import verify_inclusion

    row = (await db.execute(
        select(SealedQuestionBundle).where(SealedQuestionBundle.exam_id == exam_id)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "No sealed bundle for this exam")

    sealed = {"iv": body.iv, "ct": body.ct, "tag": body.tag}
    leaf = question_leaf(body.question_id, sealed)
    root_bytes = bytes.fromhex(row.questions_root[2:])
    ok = verify_inclusion(leaf, body.proof, root_bytes)
    return {
        "examId": str(exam_id),
        "questionId": body.question_id,
        "questionsRoot": row.questions_root,
        "included": ok,
        "message": "Question is part of the committed set." if ok
                   else "Question is NOT part of the committed set — reject it.",
    }
