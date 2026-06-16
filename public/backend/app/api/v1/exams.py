"""
CryptoExam Core — Exam API Endpoints
§ 8 — Exam CRUD and lifecycle management.

POST   /api/v1/exams            — Create new exam (SETTER)
GET    /api/v1/exams            — List exams (role-filtered)
GET    /api/v1/exams/{id}       — Get exam details
PATCH  /api/v1/exams/{id}/status — Update exam status (ADMIN)
GET    /api/v1/exams/{id}/verify — Public verification (NO AUTH)
"""

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, UserRole, Exam, ExamStatus, ExamBody, ExamType, Question
from app.schemas import ExamCreate, ExamResponse, ExamListResponse
from app.services.auth import get_current_user, require_role

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post(
    "/",
    response_model=ExamResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create Exam",
    description="Create a new exam. Only setters and admins can create exams.",
)
async def create_exam(
    exam_data: ExamCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.SETTER, UserRole.ADMIN)),
):
    """Create a new exam with IRT and Bloom's configuration."""
    exam = Exam(
        name=exam_data.name,
        name_hi=exam_data.name_hi,
        exam_body=ExamBody(exam_data.exam_body.value),
        exam_type=ExamType(exam_data.exam_type.value),
        duration_minutes=exam_data.duration_minutes,
        scheduled_at=exam_data.scheduled_at,
        status=ExamStatus.DRAFT,
        setter_id=current_user["user_id"],
        sets_count=exam_data.sets_count,
        negative_marking=exam_data.negative_marking,
        subject_taxonomy=exam_data.subject_taxonomy,
        irt_config=exam_data.irt_config,
        blooms_config=exam_data.blooms_config,
    )

    db.add(exam)
    await db.flush()

    logger.info(
        f"Exam created: id={str(exam.id)[:8]}..., name={exam.name}, "
        f"setter={str(current_user['user_id'])[:8]}..."
    )

    return ExamResponse.model_validate(exam)


@router.get(
    "/",
    response_model=ExamListResponse,
    summary="List Exams",
    description="List exams with pagination. Filtered by role.",
)
async def list_exams(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    exam_status: str = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    List exams with role-based filtering:
    - SETTER: only exams they created
    - ADMIN: all exams
    - CANDIDATE: only exams they're enrolled in
    """
    query = select(Exam)

    # Role-based filtering
    if current_user["role"] == UserRole.SETTER:
        query = query.where(Exam.setter_id == current_user["user_id"])
    elif current_user["role"] == UserRole.CANDIDATE:
        # Candidates see only enrolled exams (filtered via enrollment join)
        from app.models import Enrollment
        query = query.join(Enrollment).where(
            Enrollment.candidate_id == current_user["user_id"]
        )

    # Status filter
    if exam_status:
        query = query.where(Exam.status == ExamStatus(exam_status))

    # Count total
    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    # Paginate
    query = query.order_by(Exam.created_at.desc())
    query = query.offset((page - 1) * per_page).limit(per_page)

    result = await db.execute(query)
    exams = result.scalars().all()

    return ExamListResponse(
        items=[ExamResponse.model_validate(e) for e in exams],
        total=total,
        page=page,
        per_page=per_page,
    )


@router.get(
    "/{exam_id}",
    response_model=ExamResponse,
    summary="Get Exam Details",
)
async def get_exam(
    exam_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Get detailed exam information."""
    stmt = select(Exam).where(Exam.id == exam_id)
    result = await db.execute(stmt)
    exam = result.scalar_one_or_none()

    if not exam:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found")

    return ExamResponse.model_validate(exam)


@router.get(
    "/{exam_id}/questions",
    summary="List an exam's questions (setter/admin)",
    description="The question bank for one exam, with IRT parameters. Visible to "
                "the owning SETTER or an ADMIN only — never to candidates.",
)
async def list_exam_questions(
    exam_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    exam = (await db.execute(select(Exam).where(Exam.id == exam_id))).scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found")
    role = current_user["role"]
    if role == UserRole.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    if role == UserRole.SETTER and exam.setter_id != current_user["user_id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your exam")

    rows = (await db.execute(
        select(Question)
        .where(Question.exam_id == exam_id)
        .order_by(Question.set_label, Question.sequence_number)
    )).scalars().all()

    return {
        "exam_id": str(exam_id),
        "exam_name": exam.name,
        "total": len(rows),
        "questions": [
            {
                "id": q.id,
                "set_label": q.set_label,
                "sequence_number": q.sequence_number,
                "text": q.text,
                "subject": q.subject,
                "topic": q.topic,
                "blooms_level": q.blooms_level,
                "irt_a": q.irt_a,
                "irt_b": q.irt_b,
                "irt_c": q.irt_c,
                "is_accepted": q.is_accepted,
                "source": q.source,
            }
            for q in rows
        ],
    }


@router.patch(
    "/{exam_id}/status",
    response_model=ExamResponse,
    summary="Update Exam Status",
    description="Transition exam through lifecycle states. ADMIN only.",
)
async def update_exam_status(
    exam_id: UUID,
    new_status: str,
    reason: str = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.ADMIN)),
):
    """
    Update exam status through the lifecycle state machine.

    Valid transitions:
      DRAFT → GENERATING → PROOF_PENDING → LOCKED → DISTRIBUTED → LIVE
      LIVE → PAUSED → LIVE (resume)
      LIVE → COMPLETED → AUDITED
      ANY → ABORTED (emergency only)
    """
    stmt = select(Exam).where(Exam.id == exam_id)
    result = await db.execute(stmt)
    exam = result.scalar_one_or_none()

    if not exam:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found")

    target = ExamStatus(new_status)

    # Valid state transitions
    valid_transitions = {
        ExamStatus.DRAFT: [ExamStatus.GENERATING, ExamStatus.ABORTED],
        ExamStatus.GENERATING: [ExamStatus.PROOF_PENDING, ExamStatus.ABORTED],
        ExamStatus.PROOF_PENDING: [ExamStatus.LOCKED, ExamStatus.ABORTED],
        ExamStatus.LOCKED: [ExamStatus.DISTRIBUTED, ExamStatus.ABORTED],
        ExamStatus.DISTRIBUTED: [ExamStatus.LIVE, ExamStatus.ABORTED],
        ExamStatus.LIVE: [ExamStatus.PAUSED, ExamStatus.COMPLETED, ExamStatus.ABORTED],
        ExamStatus.PAUSED: [ExamStatus.LIVE, ExamStatus.ABORTED],
        ExamStatus.COMPLETED: [ExamStatus.AUDITED],
        ExamStatus.AUDITED: [],
        ExamStatus.ABORTED: [],
    }

    if target not in valid_transitions.get(exam.status, []):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid transition: {exam.status.value} → {target.value}. "
                   f"Valid targets: {[t.value for t in valid_transitions.get(exam.status, [])]}",
        )

    # Handle special transitions
    if target == ExamStatus.PAUSED:
        exam.paused_at = datetime.now(timezone.utc)
        exam.pause_reason = reason
    elif target == ExamStatus.ABORTED:
        exam.aborted_at = datetime.now(timezone.utc)
        exam.abort_reason = reason

    exam.status = target
    exam.updated_at = datetime.now(timezone.utc)

    logger.info(
        f"Exam status updated: id={str(exam_id)[:8]}..., "
        f"transition={exam.status.value}→{target.value}, "
        f"admin={str(current_user['user_id'])[:8]}..."
    )

    return ExamResponse.model_validate(exam)


@router.get(
    "/{exam_id}/verify",
    summary="Public Exam Verification",
    description="Publicly verifiable exam data. NO AUTHENTICATION REQUIRED.",
)
async def verify_exam_public(
    exam_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Public verification endpoint — callable by ANYONE.

    Returns the on-chain hashes and IPFS CIDs for independent verification.
    No login, no API key, no trust required.
    """
    stmt = select(Exam).where(Exam.id == exam_id)
    result = await db.execute(stmt)
    exam = result.scalar_one_or_none()

    if not exam:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found")

    return {
        "exam_id": str(exam.id),
        "name": exam.name,
        "status": exam.status.value,
        "question_hash": exam.question_hash.hex() if exam.question_hash else None,
        "zk_proof_hash": exam.zk_proof_hash.hex() if exam.zk_proof_hash else None,
        "zk_proof_ipfs": exam.zk_proof_ipfs,
        "answer_merkle_root": exam.answer_merkle_root.hex() if exam.answer_merkle_root else None,
        "polygon_exam_tx": exam.polygon_exam_tx,
        "polygon_zkproof_tx": exam.polygon_zkproof_tx,
        "polygon_answer_tx": exam.polygon_answer_tx,
        "drand_round": exam.drand_round,
        "lock_timestamp": exam.created_at.isoformat() if exam.created_at else None,
        "verification_instructions": {
            "step_1": "Copy polygon_exam_tx hash to https://amoy.polygonscan.com",
            "step_2": "Verify question_hash matches on-chain ExamRecord.questionHash",
            "step_3": "Download ZK proof from IPFS: ipfs://" + (exam.zk_proof_ipfs or "<pending>"),
            "step_4": "Run: snarkjs groth16 verify verification_key.json public.json proof.json",
            "step_5": "Verify answer_merkle_root matches on-chain commitment",
        },
    }
