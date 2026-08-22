"""
CryptoExam Core — Exam Lifecycle API Endpoints
Cryptographic operations that tie the backend to the blockchain.

POST /api/v1/lifecycle/{exam_id}/build-merkle   — Build Merkle tree
POST /api/v1/lifecycle/{exam_id}/generate-zk    — Generate ZK proof
POST /api/v1/lifecycle/{exam_id}/lock           — Lock exam
GET  /api/v1/lifecycle/{exam_id}/audit          — Public audit report
GET  /api/v1/lifecycle/{exam_id}/verify-candidate — Verify candidate inclusion
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import UserRole
from app.services.auth import require_role, get_current_user
from app.services.exam_lifecycle import (
    ExamLifecycleService,
    PaperNotCompliant,
    ZKProofUnavailable,
)
from app.tasks.exam_lifecycle import (
    ChainAnchorUnavailable,
    build_merkle_tree_task,
    generate_zk_proof_task,
    submit_to_blockchain_task,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post(
    "/{exam_id}/build-merkle",
    summary="Build Answer Merkle Tree",
    description="Build Merkle tree from all submitted answers. ADMIN only.",
)
async def build_merkle(
    exam_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.ADMIN)),
):
    """Build the Merkle tree after exam completion."""
    try:
        service = ExamLifecycleService(db)
        result = await service.build_answer_merkle_tree(exam_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        # NO synthetic fallback. This used to swap in build_merkle_tree_task(),
        # which builds a tree over 500 invented submissions — so any failure of
        # the real build returned a Merkle root that looked genuine and
        # committed to nothing. For the guarantee "answer records are
        # immutable", the wrong root is worse than no root.
        logger.error("Merkle tree build failed for %s: %s", exam_id, e)
        raise HTTPException(
            status_code=500,
            detail={
                "reason": "MERKLE_BUILD_FAILED",
                "message": (
                    "Could not build the answer Merkle tree from submitted sessions. "
                    "Refusing to return a synthetic root in its place."
                ),
                "error": str(e),
            },
        )


@router.post(
    "/{exam_id}/generate-zk",
    summary="Generate ZK Difficulty Proof",
    description="Generate a ZK-SNARK proof that the paper meets IRT constraints. SETTER only.",
)
async def generate_zk(
    exam_id: UUID,
    set_label: str = "A",
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.SETTER, UserRole.ADMIN)),
):
    """Generate the ZK difficulty proof for one paper set (the paper a candidate sits)."""
    try:
        service = ExamLifecycleService(db)
        result = await service.generate_and_store_zk_proof(exam_id, set_label=set_label)
        return result
    except PaperNotCompliant as e:
        # 409, not 500: the pipeline works, the paper doesn't. Name the offending
        # questions so the setter can fix them instead of guessing.
        logger.info("Set %s of %s is off-spec: %s", e.set_label, exam_id, e.violations)
        raise HTTPException(
            status_code=409,
            detail={
                "reason": "PAPER_NOT_COMPLIANT",
                "message": (
                    f"Set {e.set_label} does not meet this exam's own IRT constraints, "
                    f"so there is no true statement to prove. Fix the paper or the "
                    f"constraints — a proof cannot be produced for either as they stand."
                ),
                "set": e.set_label,
                "constraints": e.targets,
                "violations": e.violations,
            },
        )
    except ZKProofUnavailable as e:
        # 503, not 500: nothing is broken — this host simply cannot produce a
        # proof, and the caller needs to know WHICH capability is missing so it
        # can render "no proof available" rather than a generic error.
        logger.warning("ZK proof unavailable for %s: %s", exam_id, e.reason)
        raise HTTPException(
            status_code=503,
            detail={"reason": e.reason, "message": e.message, **e.context},
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"ZK proof generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/{exam_id}/lock",
    summary="Lock Exam",
    description="Lock exam — encrypt paper and commit to blockchain. SETTER only.",
)
async def lock_exam(
    exam_id: UUID,
    drand_round: int = 12345678,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.SETTER, UserRole.ADMIN)),
):
    """Lock the exam paper and transition to LOCKED status."""
    try:
        service = ExamLifecycleService(db)
        result = await service.lock_exam(exam_id, drand_round)

        # Anchor on chain. The lock itself has already succeeded and been
        # persisted, so a missing chain must NOT fail the request — it is
        # reported in the response instead. What it must never do is come back
        # with a transaction hash for a transaction that was never submitted.
        try:
            result["blockchain"] = submit_to_blockchain_task(
                action="lock_exam",
                exam_id=str(exam_id),
                data={
                    "question_hash": result.get("question_hash", ""),
                    "drand_round": drand_round,
                },
            )
        except ChainAnchorUnavailable as e:
            logger.warning("Exam %s locked but not anchored: %s", exam_id, e.reason)
            result["blockchain"] = {
                "status": "NOT_ANCHORED",
                "reason": e.reason,
                "message": e.message,
                "tx_hash": None,
            }
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/{exam_id}/audit",
    summary="Public Audit Report",
    description="Generate a comprehensive audit report. NO AUTH REQUIRED.",
)
async def audit_report(
    exam_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Public audit — callable by ANYONE.
    Journalists, RTI officers, courts, candidates — no login needed.
    """
    try:
        service = ExamLifecycleService(db)
        return await service.generate_audit_report(exam_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get(
    "/{exam_id}/verify-candidate/{session_id}",
    summary="Verify Candidate Inclusion",
    description="Verify a candidate's answers are in the Merkle tree. NO AUTH REQUIRED.",
)
async def verify_candidate(
    exam_id: UUID,
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Verify Merkle inclusion — callable by ANYONE.
    Court-admissible mathematical proof.
    """
    try:
        service = ExamLifecycleService(db)
        return await service.verify_candidate_inclusion(exam_id, session_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
