"""
CryptoExam Core — Blockchain API Endpoints
§ 8 — On-chain operations and public verification.

POST /api/v1/blockchain/lock/{exam_id}     — Lock exam on-chain (SETTER)
POST /api/v1/blockchain/zkproof/{exam_id}  — Submit ZK proof (SETTER)
POST /api/v1/blockchain/merkle/{exam_id}   — Commit Merkle root (ADMIN)
GET  /api/v1/blockchain/verify/{exam_id}   — Public verify (NO AUTH)
GET  /api/v1/blockchain/status             — Chain status
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Exam, ExamStatus, UserRole
from app.services.auth import require_role, get_current_user
from app.services.blockchain import BlockchainService

logger = logging.getLogger(__name__)

router = APIRouter()
blockchain = BlockchainService()


class ZKProofSubmission(BaseModel):
    proof_hash: str
    proof_ipfs: str


@router.post(
    "/lock/{exam_id}",
    summary="Lock Exam On-Chain",
    description="Register exam question hash and drand round on Polygon.",
)
async def lock_exam_onchain(
    exam_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.SETTER, UserRole.ADMIN)),
):
    """
    Lock an exam on-chain — commits question hash to Polygon.

    After this transaction, the question hash is publicly visible
    and immutable on Polygonscan.
    """
    exam = (await db.execute(select(Exam).where(Exam.id == exam_id))).scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    if not exam.question_hash:
        raise HTTPException(status_code=400, detail="Paper not encrypted yet — encrypt first")
    if exam.status != ExamStatus.PROOF_PENDING:
        raise HTTPException(status_code=400, detail=f"Exam must be in PROOF_PENDING state, not {exam.status.value}")

    try:
        tx_hash = await blockchain.lock_exam(
            exam_id=str(exam_id),
            question_hash=exam.question_hash,
            drand_round=exam.drand_round or 0,
            constraint_spec_ipfs=exam.constraint_spec_ipfs or "",
        )

        exam.polygon_exam_tx = tx_hash
        exam.status = ExamStatus.LOCKED

        logger.info(f"Exam locked on-chain: {str(exam_id)[:8]}..., tx={tx_hash[:16]}...")

        return {
            "exam_id": str(exam_id),
            "tx_hash": tx_hash,
            "polygonscan_url": BlockchainService.polygonscan_url(tx_hash),
            "status": "LOCKED",
        }

    except Exception as e:
        logger.error(f"Blockchain lock failed: {e}")
        raise HTTPException(status_code=500, detail=f"Blockchain transaction failed: {str(e)}")


@router.post(
    "/zkproof/{exam_id}",
    summary="Submit ZK Proof On-Chain",
    description="Submit the Groth16 difficulty proof hash to Polygon.",
)
async def submit_zk_proof_onchain(
    exam_id: UUID,
    submission: ZKProofSubmission,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.SETTER, UserRole.ADMIN)),
):
    """Submit ZK-SNARK difficulty proof hash to the blockchain."""
    exam = (await db.execute(select(Exam).where(Exam.id == exam_id))).scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")

    try:
        tx_hash = await blockchain.submit_zk_proof(
            exam_id=str(exam_id),
            proof_hash=submission.proof_hash,
            proof_ipfs=submission.proof_ipfs,
        )

        exam.polygon_zkproof_tx = tx_hash
        exam.zk_proof_hash = bytes.fromhex(submission.proof_hash)
        exam.zk_proof_ipfs = submission.proof_ipfs

        return {
            "exam_id": str(exam_id),
            "tx_hash": tx_hash,
            "polygonscan_url": BlockchainService.polygonscan_url(tx_hash),
            "proof_ipfs": submission.proof_ipfs,
        }

    except Exception as e:
        logger.error(f"ZK proof submission failed: {e}")
        raise HTTPException(status_code=500, detail=f"Blockchain transaction failed: {str(e)}")


@router.post(
    "/merkle/{exam_id}",
    summary="Commit Merkle Root On-Chain",
    description="Commit the answer Merkle root to Polygon. IMMUTABLE once committed.",
)
async def commit_merkle_onchain(
    exam_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.ADMIN)),
):
    """
    Commit the answer Merkle root to Polygon.

    Once committed, this root is IMMUTABLE. Any modification to any
    candidate's answers produces a different root, detectable by
    anyone with Polygonscan access.
    """
    exam = (await db.execute(select(Exam).where(Exam.id == exam_id))).scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    if not exam.answer_merkle_root:
        raise HTTPException(status_code=400, detail="Merkle tree not built yet")

    from app.models import Enrollment
    from sqlalchemy import func
    candidate_count = (await db.execute(
        select(func.count()).where(Enrollment.exam_id == exam_id)
    )).scalar() or 0

    try:
        tx_hash = await blockchain.commit_merkle_root(
            exam_id=str(exam_id),
            merkle_root=exam.answer_merkle_root,
            candidate_count=candidate_count,
        )

        exam.polygon_answer_tx = tx_hash

        return {
            "exam_id": str(exam_id),
            "merkle_root": exam.answer_merkle_root.hex(),
            "candidate_count": candidate_count,
            "tx_hash": tx_hash,
            "polygonscan_url": BlockchainService.polygonscan_url(tx_hash),
            "immutable": True,
            "note": "This commitment is PERMANENT. Any post-commit modification is cryptographically detectable.",
        }

    except Exception as e:
        logger.error(f"Merkle root commitment failed: {e}")
        raise HTTPException(status_code=500, detail=f"Blockchain transaction failed: {str(e)}")


@router.get(
    "/verify/{exam_id}",
    summary="Public Blockchain Verification",
    description="Verify exam on-chain data. NO AUTHENTICATION REQUIRED.",
)
async def verify_onchain(exam_id: UUID):
    """
    Public verification — no login, no API key, no trust required.

    Anyone can verify:
      1. Question hash committed before T₀
      2. ZK difficulty proof is valid
      3. Answer Merkle root is committed
      4. All proofs match on-chain records
    """
    try:
        data = await blockchain.verify_exam(str(exam_id))
        data["polygonscan_contract"] = f"https://amoy.polygonscan.com/address/{blockchain.contract_address}"
        data["verification_note"] = (
            "All data shown above is independently verifiable on Polygonscan. "
            "No trust in CryptoExam Core is required."
        )
        return data
    except Exception as e:
        logger.error(f"On-chain verification failed: {e}")
        raise HTTPException(status_code=500, detail=f"Blockchain query failed: {str(e)}")


@router.get(
    "/status",
    summary="Blockchain Status",
    description="Get current Polygon network status and contract info.",
)
async def chain_status(
    current_user: dict = Depends(require_role(UserRole.ADMIN)),
):
    """Get blockchain connection status and contract info."""
    try:
        info = await blockchain.get_chain_info()
        return info
    except Exception as e:
        return {
            "connected": False,
            "error": str(e),
            "chainId": blockchain.chain_id,
        }
