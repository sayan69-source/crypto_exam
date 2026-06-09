"""
CryptoExam Core — Cryptography API Endpoints
§ 8 — Paper encryption, key management, and Merkle commitment.

POST /api/v1/crypto/encrypt/{exam_id}     — Encrypt exam paper (SETTER)
POST /api/v1/crypto/shards/{exam_id}      — Submit Shamir shard (ADMIN)
POST /api/v1/crypto/merkle/{exam_id}      — Build answer Merkle tree (ADMIN)
GET  /api/v1/crypto/merkle/{exam_id}/proof/{candidate_id} — Get inclusion proof
"""

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import (
    User, UserRole, Exam, ExamStatus,
    ShamirShard as ShamirShardModel,
)
from app.services.auth import require_role, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Request Schemas ──

class EncryptRequest(BaseModel):
    paper: dict  # Full question paper JSON


class ShardSubmitRequest(BaseModel):
    shard_index: int
    shard_value: str


# ── Endpoints ──

@router.post(
    "/encrypt/{exam_id}",
    summary="Encrypt Exam Paper",
    description="AES-GCM-256 encrypt the question paper. Generates Shamir shards.",
)
async def encrypt_paper(
    exam_id: UUID,
    request: EncryptRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.SETTER, UserRole.ADMIN)),
):
    """
    Encrypt the question paper in-memory using AES-GCM-256.

    1. Generates a 256-bit master key
    2. Derives AES key via HKDF (exam_id as context)
    3. Encrypts the paper — plaintext NEVER touches disk
    4. Splits master key into 5 Shamir shards (threshold 3)
    5. Returns shard values (ONE TIME ONLY — store securely!)
    6. Only shard HASHES are stored in the database
    """
    # Verify exam exists and is in correct state
    stmt = select(Exam).where(Exam.id == exam_id)
    result = await db.execute(stmt)
    exam = result.scalar_one_or_none()

    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    if exam.status not in (ExamStatus.GENERATING, ExamStatus.PROOF_PENDING):
        raise HTTPException(
            status_code=400,
            detail=f"Exam must be in GENERATING or PROOF_PENDING state, not {exam.status.value}",
        )

    # Encrypt using crypto engine
    import sys
    sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent.parent.parent.parent))
    from engine.crypto_engine import CryptoEngine

    engine = CryptoEngine()
    crypto_result = engine.encrypt_paper(request.paper, str(exam_id))

    # Store question hash on exam record
    exam.question_hash = crypto_result["question_hash"]
    exam.updated_at = datetime.now(timezone.utc)

    # Store shard HASHES in database (never the raw shard values)
    for shard_data in crypto_result["shards"]:
        shard_record = ShamirShardModel(
            exam_id=exam_id,
            shard_index=shard_data["index"],
            shard_hash=shard_data["hash"],
        )
        db.add(shard_record)

    logger.info(
        f"Paper encrypted: exam={str(exam_id)[:8]}..., "
        f"ct_len={len(crypto_result['ciphertext'])}, "
        f"shards=5"
    )

    return {
        "exam_id": str(exam_id),
        "question_hash": crypto_result["question_hash"].hex(),
        "master_key_hash": crypto_result["master_key_hash"],
        "ciphertext_length": len(crypto_result["ciphertext"]),
        "nonce": crypto_result["nonce"].hex(),
        "tag": crypto_result["tag"].hex(),
        "salt": crypto_result["salt"].hex(),
        "shards": [
            {"index": s["index"], "value": s["value"]}
            for s in crypto_result["shards"]
        ],
        "warning": "STORE SHARD VALUES SECURELY. They are shown ONCE and never stored in the database.",
    }


@router.post(
    "/shards/{exam_id}/submit",
    summary="Submit Shamir Shard",
    description="Submit a Shamir shard for key reconstruction.",
)
async def submit_shard(
    exam_id: UUID,
    request: ShardSubmitRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.ADMIN)),
):
    """
    Submit a Shamir shard for key reconstruction.

    When K shards (default 3) are submitted and verified,
    the master key can be reconstructed for paper decryption.
    """
    from crypto.shamir import ShamirPaperGuardian

    # Find the shard record
    stmt = select(ShamirShardModel).where(
        ShamirShardModel.exam_id == exam_id,
        ShamirShardModel.shard_index == request.shard_index,
    )
    result = await db.execute(stmt)
    shard_record = result.scalar_one_or_none()

    if not shard_record:
        raise HTTPException(status_code=404, detail=f"Shard {request.shard_index} not found for this exam")

    if shard_record.is_submitted:
        raise HTTPException(status_code=400, detail=f"Shard {request.shard_index} already submitted")

    # Verify shard against stored hash
    if not ShamirPaperGuardian.verify_shard(request.shard_value, shard_record.shard_hash):
        raise HTTPException(
            status_code=400,
            detail="Shard verification failed — value does not match stored hash",
        )

    # Mark as submitted
    shard_record.is_submitted = True
    shard_record.submitted_at = datetime.now(timezone.utc)
    shard_record.holder_id = current_user["user_id"]

    # Check if threshold met
    submitted_count_stmt = select(ShamirShardModel).where(
        ShamirShardModel.exam_id == exam_id,
        ShamirShardModel.is_submitted == True,
    )
    submitted_result = await db.execute(submitted_count_stmt)
    submitted = submitted_result.scalars().all()

    exam = (await db.execute(select(Exam).where(Exam.id == exam_id))).scalar_one()
    threshold_met = len(submitted) >= (exam.shamir_threshold or 3)

    logger.info(
        f"Shard submitted: exam={str(exam_id)[:8]}..., "
        f"index={request.shard_index}, "
        f"submitted={len(submitted)}/{exam.shamir_threshold or 3}, "
        f"threshold_met={threshold_met}"
    )

    return {
        "exam_id": str(exam_id),
        "shard_index": request.shard_index,
        "verified": True,
        "submitted_count": len(submitted),
        "threshold": exam.shamir_threshold or 3,
        "threshold_met": threshold_met,
    }


@router.post(
    "/merkle/{exam_id}",
    summary="Build Answer Merkle Tree",
    description="Build Merkle tree from all submissions and commit root.",
)
async def build_merkle_tree(
    exam_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.ADMIN)),
):
    """
    Build a SHA-256 Merkle tree from all candidate submissions.

    1. Collect all submitted session hashes
    2. Build balanced binary Merkle tree
    3. Store root hash on exam record
    4. Generate inclusion proofs for each candidate
    """
    from app.models import Session, Enrollment
    from engine.crypto_engine import CryptoEngine

    # Get all submitted sessions for this exam
    stmt = (
        select(Session, Enrollment)
        .join(Enrollment)
        .where(
            Enrollment.exam_id == exam_id,
            Session.is_submitted == True,
        )
    )
    result = await db.execute(stmt)
    rows = result.all()

    if not rows:
        raise HTTPException(status_code=400, detail="No submitted sessions found for this exam")

    # Build submissions list
    submissions = []
    for session, enrollment in rows:
        submissions.append({
            "candidate_id": str(enrollment.candidate_id),
            "exam_id": str(exam_id),
            "answers": {"hash": session.answer_hash.hex() if session.answer_hash else ""},
            "timestamp": session.ended_at.timestamp() if session.ended_at else 0,
        })

    engine = CryptoEngine()
    tree_result = engine.build_answer_merkle_tree(submissions)

    # Store on exam record
    exam = (await db.execute(select(Exam).where(Exam.id == exam_id))).scalar_one()
    exam.answer_merkle_root = tree_result["root"]
    exam.updated_at = datetime.now(timezone.utc)

    # Store proofs on session records
    for session, enrollment in rows:
        cid = str(enrollment.candidate_id)
        if cid in tree_result["proofs"]:
            session.merkle_proof_path = tree_result["proofs"][cid]

    logger.info(
        f"Merkle tree built: exam={str(exam_id)[:8]}..., "
        f"leaves={tree_result['leaf_count']}, "
        f"root={tree_result['root_hex'][:16]}..."
    )

    return {
        "exam_id": str(exam_id),
        "merkle_root": tree_result["root_hex"],
        "leaf_count": tree_result["leaf_count"],
        "status": "ready_for_blockchain_commit",
    }
