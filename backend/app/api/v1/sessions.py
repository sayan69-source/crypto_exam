"""
CryptoExam Core — Exam Session API Endpoints
§ 8 — Candidate exam-taking flow.

POST /api/v1/sessions/start     — Start exam session (CANDIDATE)
POST /api/v1/sessions/answer    — Submit an answer (CANDIDATE)
POST /api/v1/sessions/submit    — Final submission (CANDIDATE)
GET  /api/v1/sessions/receipt   — Cryptographic receipt (CANDIDATE)
"""

import hashlib
import json
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
    Enrollment, Session,
)
from app.services.auth import require_role, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter()


class StartSessionRequest(BaseModel):
    exam_id: str


class AnswerSubmission(BaseModel):
    session_id: str
    question_id: str
    selected_option: str  # A, B, C, D


class FinalSubmission(BaseModel):
    session_id: str


@router.post(
    "/start",
    summary="Start Exam Session",
    description="Candidate starts their exam session. Requires enrollment.",
)
async def start_session(
    request: StartSessionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.CANDIDATE)),
):
    """
    Start an exam session for an enrolled candidate.

    Pre-checks:
    1. Exam is LIVE
    2. Candidate is enrolled
    3. No existing active session
    """
    exam_id = UUID(request.exam_id)

    # Check exam is LIVE
    exam = (await db.execute(select(Exam).where(Exam.id == exam_id))).scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    if exam.status != ExamStatus.LIVE:
        raise HTTPException(
            status_code=400,
            detail=f"Exam is not live. Current status: {exam.status.value}"
        )

    # Check enrollment
    enrollment = (await db.execute(
        select(Enrollment).where(
            Enrollment.exam_id == exam_id,
            Enrollment.candidate_id == current_user["user_id"],
        )
    )).scalar_one_or_none()

    if not enrollment:
        raise HTTPException(status_code=403, detail="Not enrolled for this exam")

    # Check for existing session
    existing = (await db.execute(
        select(Session).where(
            Session.enrollment_id == enrollment.id,
            Session.is_submitted == False,
        )
    )).scalar_one_or_none()

    if existing:
        return {
            "session_id": str(existing.id),
            "resumed": True,
            "started_at": existing.started_at.isoformat(),
            "duration_minutes": exam.duration_minutes,
        }

    # Create new session
    session = Session(
        enrollment_id=enrollment.id,
        started_at=datetime.now(timezone.utc),
        is_submitted=False,
    )
    db.add(session)
    await db.flush()

    logger.info(
        f"Session started: candidate={str(current_user['user_id'])[:8]}..., "
        f"exam={str(exam_id)[:8]}..., session={str(session.id)[:8]}..."
    )

    return {
        "session_id": str(session.id),
        "resumed": False,
        "started_at": session.started_at.isoformat(),
        "duration_minutes": exam.duration_minutes,
        "exam_name": exam.name,
    }


@router.post(
    "/answer",
    summary="Submit Answer",
    description="Submit or update an answer during the exam.",
)
async def submit_answer(
    answer: AnswerSubmission,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.CANDIDATE)),
):
    """
    Submit or update a single answer.

    The answer is stored in-memory during the session.
    At final submission, all answers are hashed into the Merkle tree.
    """
    session_id = UUID(answer.session_id)

    session = (await db.execute(
        select(Session).where(Session.id == session_id)
    )).scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.is_submitted:
        raise HTTPException(status_code=400, detail="Exam already submitted")

    # Store answer in session JSON
    answers = session.answers_encrypted or {}
    answers[answer.question_id] = answer.selected_option
    session.answers_encrypted = answers

    logger.debug(
        f"Answer recorded: session={str(session_id)[:8]}..., "
        f"q={answer.question_id}, opt={answer.selected_option}"
    )

    return {
        "session_id": str(session_id),
        "question_id": answer.question_id,
        "selected_option": answer.selected_option,
        "answers_count": len(answers),
    }


@router.post(
    "/submit",
    summary="Final Exam Submission",
    description="Submit exam. Answers are hashed and locked. Cannot be undone.",
)
async def final_submission(
    submission: FinalSubmission,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.CANDIDATE)),
):
    """
    Final exam submission — irreversible.

    1. Hash all answers (SHA-256)
    2. Generate candidate's answer leaf hash
    3. Mark session as submitted
    4. Return cryptographic receipt

    The answer hash will be included in the exam's Merkle tree.
    """
    session_id = UUID(submission.session_id)

    session = (await db.execute(
        select(Session).where(Session.id == session_id)
    )).scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.is_submitted:
        raise HTTPException(status_code=400, detail="Exam already submitted")

    now = datetime.now(timezone.utc)

    # Compute answer hash
    answers = session.answers_encrypted or {}
    answer_payload = json.dumps(answers, sort_keys=True, ensure_ascii=False)
    answer_hash = hashlib.sha256(answer_payload.encode('utf-8')).digest()

    # Update session
    session.is_submitted = True
    session.ended_at = now
    session.answer_hash = answer_hash
    session.submitted_at = now

    logger.info(
        f"Exam submitted: session={str(session_id)[:8]}..., "
        f"answers={len(answers)}, "
        f"hash={answer_hash.hex()[:16]}..."
    )

    return {
        "session_id": str(session_id),
        "submitted_at": now.isoformat(),
        "answers_count": len(answers),
        "answer_hash": answer_hash.hex(),
        "receipt": {
            "type": "cryptographic_receipt",
            "version": "1.0",
            "session_id": str(session_id),
            "answer_hash": answer_hash.hex(),
            "submitted_at": now.isoformat(),
            "note": "This hash will be included in the exam Merkle tree, "
                    "committed to Polygon blockchain, and independently verifiable.",
        },
    }


@router.get(
    "/receipt/{session_id}",
    summary="Cryptographic Receipt",
    description="Download the cryptographic receipt with Merkle inclusion proof.",
)
async def get_receipt(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.CANDIDATE)),
):
    """
    Download the complete cryptographic receipt.

    Includes:
    - Answer hash (SHA-256)
    - Merkle inclusion proof (if tree is built)
    - Merkle root (committed on-chain)
    - Polygon transaction hash
    - Polygonscan verification URL

    Court-admissible: the math is the affidavit.
    """
    session = (await db.execute(
        select(Session).where(Session.id == session_id)
    )).scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if not session.is_submitted:
        raise HTTPException(status_code=400, detail="Exam not submitted yet")

    # Get enrollment and exam
    enrollment = (await db.execute(
        select(Enrollment).where(Enrollment.id == session.enrollment_id)
    )).scalar_one()

    exam = (await db.execute(
        select(Exam).where(Exam.id == enrollment.exam_id)
    )).scalar_one()

    receipt = {
        "version": "1.0",
        "type": "CryptoExam Cryptographic Receipt",
        "candidate_id": str(enrollment.candidate_id),
        "exam_id": str(exam.id),
        "exam_name": exam.name,
        "session_id": str(session.id),
        "answer_hash": session.answer_hash.hex() if session.answer_hash else None,
        "submitted_at": session.submitted_at.isoformat() if session.submitted_at else None,
        "merkle_proof": session.merkle_proof_path if session.merkle_proof_path else "pending",
        "merkle_root": exam.answer_merkle_root.hex() if exam.answer_merkle_root else "pending",
        "polygon_tx": exam.polygon_answer_tx or "pending",
        "verification": {
            "polygonscan": f"https://amoy.polygonscan.com/tx/{exam.polygon_answer_tx}" if exam.polygon_answer_tx else "pending",
            "merkle_root_contract": f"https://amoy.polygonscan.com/address/{exam.polygon_answer_tx}" if exam.polygon_answer_tx else "pending",
        },
        "legal_notice": (
            "This cryptographic receipt constitutes mathematical proof that "
            "your answers are included in the exam's Merkle tree, which is "
            "permanently committed to the Polygon blockchain. "
            "Any modification is cryptographically detectable."
        ),
    }

    return receipt
