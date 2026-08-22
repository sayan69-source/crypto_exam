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


def _publish_to_content_store(bundle_dict: dict) -> str:
    """
    Publish the opaque sealed bundle to a public, content-addressed store and
    return its content id (CID).

    If an IPFS node is configured we pin it there; otherwise we fall back to a
    deterministic content id derived from the bundle's own bytes. Either way the
    id is a pure function of the content, so the on-chain anchor pins exactly
    this bundle — a swapped bundle yields a different CID and fails the match.

    The bundle is keyless ciphertext, so publishing it publicly leaks nothing.
    """
    import hashlib
    import json as _json
    canonical = _json.dumps(bundle_dict, sort_keys=True, separators=(",", ":")).encode("utf-8")
    digest = hashlib.sha256(canonical).hexdigest()
    try:  # pragma: no cover — only when an IPFS node is wired up
        import ipfshttpclient  # type: ignore
        from app.config import get_settings
        addr = getattr(get_settings(), "IPFS_API", None)
        if addr:
            with ipfshttpclient.connect(addr) as client:
                return "ipfs://" + client.add_bytes(canonical)
    except Exception:  # noqa: BLE001 — no IPFS in dev; deterministic CID still anchors content
        pass
    return "ipfs://b" + digest  # content-addressed stand-in (sha256 of the bundle)


# ── Schemas ──

class SealResponse(BaseModel):
    exam_id: str
    questions_root: str
    bundle_cid: str             # content pointer anchored on-chain
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
    bundle_dict = bundle.to_dict()

    # 2. PUBLISH — push the opaque (keyless) bundle to a public content store.
    #    This is how the bundle reaches the private centre terminals: NOT via a
    #    private API, but via a public, content-addressed object whose id is
    #    anchored on-chain. The terminal trusts it only because the on-chain
    #    root matches — see private/exam-terminal/lib/chain-bridge.ts.
    bundle_cid = _publish_to_content_store(bundle_dict)

    # 3. COMMIT — anchor {questionsRoot, bundleCID} on-chain (reuses lockExam,
    #    carrying the CID in its IPFS field). The blockchain is the ONLY trust
    #    channel between the public side and the private terminals.
    chain_tx: str | None = None
    try:
        from app.services.blockchain import blockchain_service
        root_bytes = bytes.fromhex(bundle.questions_root[2:])
        chain_tx = await blockchain_service.lock_exam(
            str(exam_id), root_bytes, exam.drand_round or 0, bundle_cid,
        )
    except Exception as e:  # noqa: BLE001 — chain may be unconfigured in dev; seal still valid
        logger.warning("On-chain commit skipped/failed for %s: %s", str(exam_id)[:8], e)

    # 4. STORE — persist the keyless bundle + commitments.
    exam.question_hash = bytes.fromhex(bundle.questions_root[2:])
    exam.polygon_exam_tx = chain_tx
    exam.constraint_spec_ipfs = bundle_cid
    exam.updated_at = datetime.now(timezone.utc)

    existing = (await db.execute(
        select(SealedQuestionBundle).where(SealedQuestionBundle.exam_id == exam_id)
    )).scalar_one_or_none()
    if existing:
        existing.questions_root = bundle.questions_root
        existing.bundle_cid = bundle_cid
        existing.question_count = bundle.count
        existing.bundle = bundle_dict
        existing.chain_tx = chain_tx
        existing.drand_round = exam.drand_round
    else:
        db.add(SealedQuestionBundle(
            exam_id=str(exam_id),
            questions_root=bundle.questions_root,
            bundle_cid=bundle_cid,
            question_count=bundle.count,
            bundle=bundle_dict,
            chain_tx=chain_tx,
            drand_round=exam.drand_round,
        ))

    for s in shards:
        db.add(ShamirShardModel(exam_id=exam_id, shard_index=s.index, shard_hash=s.hash))

    logger.info("Sealed exam=%s questions=%d root=%s cid=%s tx=%s",
                str(exam_id)[:8], bundle.count, bundle.questions_root[:14],
                bundle_cid[:18], (chain_tx or "—")[:14])

    return SealResponse(
        exam_id=str(exam_id),
        questions_root=bundle.questions_root,
        bundle_cid=bundle_cid,
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


@router.get("/root/{exam_id}", summary="On-chain exam record (public — the bridge handshake)")
async def get_root(exam_id: UUID, db: AsyncSession = Depends(get_db)):
    """
    The on-chain record a private terminal reads to discover an exam: the
    questions Merkle root, the content id of the sealed bundle, the lockExam tx,
    and the drand round for T₀. This is the ONLY thing a terminal needs from the
    public side — everything else (the bundle itself) is fetched by CID and
    verified against `questionsRoot`.
    """
    row = (await db.execute(
        select(SealedQuestionBundle).where(SealedQuestionBundle.exam_id == exam_id)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "No sealed bundle for this exam")
    return {
        "examId": str(exam_id),
        "questionsRoot": row.questions_root,
        "bundleCid": row.bundle_cid,
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
