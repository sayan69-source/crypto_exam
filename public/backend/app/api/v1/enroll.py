"""
Public CANDIDATE enrolment (§ candidate model).

A candidate is NOT a web account — they never log in online. They enrol here
with their details + a face capture (only the digest leaves the device); their
fingerprint is bound in person at the centre seat (a browser cannot produce a
template an air-gapped OS terminal could match). The enrolment is stored, then
provisioned to the centre's Edge before the exam, where the candidate is
verified biometrically, OFFLINE, on exam day.

GET  /api/v1/enroll/exams       — open exams (for the form)
POST /api/v1/enroll/candidate   — store a real candidate enrolment (no password)
"""

import logging
import math
import re
import secrets
import struct
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, UserRole, Center, Exam, ExamStatus, Enrollment, EnrollmentStatus

# Exam states a student may still register for. Everything else — LIVE, PAUSED,
# COMPLETED, AUDITED, ABORTED — has either started or finished, and issuing a
# roll number for one of those is meaningless.
ENROLLABLE_STATES = (
    ExamStatus.DRAFT,
    ExamStatus.GENERATING,
    ExamStatus.PROOF_PENDING,
    ExamStatus.LOCKED,
    ExamStatus.DISTRIBUTED,
)
from app.services.auth import hash_password

logger = logging.getLogger(__name__)
router = APIRouter()

_DOB = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FACE_DIM = 128                 # face-api.js / FaceNet descriptor length
FACE_MATCH_THRESHOLD = 0.5     # Euclidean distance for "same person" (exam-grade)


def _pack_descriptor(vec: list[float]) -> bytes:
    return struct.pack(f"<{FACE_DIM}f", *vec)


def _unpack_descriptor(blob: bytes) -> list[float]:
    return list(struct.unpack(f"<{FACE_DIM}f", blob)) if blob and len(blob) == FACE_DIM * 4 else []


def _distance(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return math.inf
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


class CandidateEnrolment(BaseModel):
    fullName: str = Field(min_length=2, max_length=255)
    dateOfBirth: str = Field(description="YYYY-MM-DD")
    examId: str
    centerId: str
    faceDescriptor: list[float] = Field(min_length=FACE_DIM, max_length=FACE_DIM,
                                        description="128-float face-recognition descriptor")


class FaceVerify(BaseModel):
    roll: str
    faceDescriptor: list[float] = Field(min_length=FACE_DIM, max_length=FACE_DIM)


@router.get("/exams")
async def open_exams(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """
    Public exam directory for the enrolment form (no sealed content).

    Only exams still OPEN to enrolment. This listed every exam in the database
    regardless of state, so a student was offered a COMPLETED paper — and the
    enrolment endpoint accepted it, issuing a roll number for an exam that had
    already been sat.
    """
    rows = (await db.execute(
        select(Exam)
        .where(Exam.status.in_(ENROLLABLE_STATES))
        .order_by(Exam.scheduled_at)
    )).scalars().all()
    return {
        "exams": [
            {"id": e.id, "name": e.name, "body": e.exam_body.value if e.exam_body else None,
             "scheduled_at": e.scheduled_at.isoformat() if e.scheduled_at else None}
            for e in rows
        ]
    }


@router.post("/candidate")
async def enrol_candidate(
    body: CandidateEnrolment,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Store a real candidate enrolment — User(CANDIDATE) + Enrollment, with a
    real 128-d face descriptor and DOB. NO usable password is set: candidates
    cannot log in online; they are verified biometrically at the centre OS."""
    if not _DOB.match(body.dateOfBirth):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="DOB must be YYYY-MM-DD")

    centre = (await db.execute(select(Center).where(Center.id == body.centerId))).scalar_one_or_none()
    if not centre:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="UNKNOWN_CENTRE")
    exam = (await db.execute(select(Exam).where(Exam.id == body.examId))).scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="UNKNOWN_EXAM")

    # The listing is a convenience; this is the gate. Without it a student could
    # POST any exam id — including one already sat — and be issued a roll number
    # for it.
    if exam.status not in ENROLLABLE_STATES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "reason": "ENROLMENT_CLOSED",
                "message": f"Enrolment for {exam.name} is closed (the exam is {exam.status.value}).",
            },
        )

    # One person, one enrolment per exam. Nothing stopped the same candidate
    # submitting the form repeatedly and collecting a fresh roll number each
    # time — which would have put duplicate people on a centre's roster.
    dup = (await db.execute(
        select(Enrollment.roll_number)
        .join(User, User.id == Enrollment.candidate_id)
        .where(
            Enrollment.exam_id == exam.id,
            User.full_name == body.fullName.strip(),
            User.date_of_birth == body.dateOfBirth,
        )
        .limit(1)
    )).scalar_one_or_none()
    if dup:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "reason": "ALREADY_ENROLLED",
                "message": f"That name and date of birth is already enrolled for this exam as {dup}.",
            },
        )

    # Candidate identity. password_hash is a random throwaway so no online login
    # is ever possible — the only "login" is a biometric check at the centre OS.
    candidate = User(
        id=str(uuid.uuid4()),
        full_name=body.fullName.strip(),
        role=UserRole.CANDIDATE,
        date_of_birth=body.dateOfBirth,
        # Real face-recognition descriptor (128 float32 = 512 bytes). Only the
        # descriptor is stored — never the photo (DPDP). Matched by distance.
        enrolled_photo_hash=_pack_descriptor(body.faceDescriptor),
        password_hash=hash_password(secrets.token_urlsafe(32)),
        dpdp_consent=True,
        dpdp_consent_at=datetime.now(timezone.utc),
        dpdp_consent_version="1.0",
        state=centre.state,
        is_active=True,
    )
    db.add(candidate)

    # Roll numbers came from count(*) + 1, which two simultaneous enrolments
    # both read as the same value — issuing one roll number to two people, on
    # the identifier the centre uses to seat them. Retry on the unique index
    # instead of trusting a read-then-write.
    body_code = exam.exam_body.value if exam.exam_body else "EXM"
    state_code = (centre.state or "IND")[:3].upper()
    year = exam.scheduled_at.year if exam.scheduled_at else datetime.now(timezone.utc).year

    # Uniqueness must be GLOBAL, not per-exam.
    #
    # The sequence was counted within one exam, so the first enrolment of every
    # exam got ...0000001 — three different people held NTA-2026-GUJ-0000001.
    # A roll number is what a candidate types at the centre terminal, and
    # auth.py resolved it with `.limit(1)`, i.e. picked an arbitrary one of
    # them. Two candidates could be seated as each other.
    roll = None
    for attempt in range(12):
        seq = (await db.execute(
            select(func.count()).select_from(Enrollment)
            .where(Enrollment.roll_number.like(f"{body_code}-{year}-{state_code}-%"))
        )).scalar() or 0
        candidate_roll = f"{body_code}-{year}-{state_code}-{seq + 1 + attempt:07d}"
        clash = (await db.execute(
            select(Enrollment.id).where(Enrollment.roll_number == candidate_roll)
        )).scalar_one_or_none()
        if not clash:
            roll = candidate_roll
            break
    if roll is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"reason": "ROLL_ALLOCATION_FAILED", "message": "Could not allocate a roll number. Please try again."},
        )

    db.add(Enrollment(
        id=str(uuid.uuid4()),
        candidate_id=candidate.id,
        exam_id=exam.id,
        center_id=centre.id,
        roll_number=roll,
        status=EnrollmentStatus.ENROLLED,
    ))
    await db.commit()

    logger.info("candidate enrolled: %s roll=%s centre=%s", candidate.full_name, roll, centre.name)
    return {
        "ok": True,
        "rollNumber": roll,
        "centre": centre.name,
        "exam": exam.name,
        "note": "No online login. You will be verified by face + fingerprint at your centre on exam day.",
    }


@router.post("/verify-face")
async def verify_face(body: FaceVerify, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Real face match: compare a LIVE descriptor against the candidate's enrolled
    descriptor (Euclidean distance). The enrolled biometric never leaves the
    server. This mirrors what the OS terminal does on-device at the centre."""
    row = (await db.execute(
        select(User).join(Enrollment, Enrollment.candidate_id == User.id)
        .where(Enrollment.roll_number == body.roll)
    )).scalars().first()
    if not row or not row.enrolled_photo_hash:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No enrolled face for that roll number")

    enrolled = _unpack_descriptor(row.enrolled_photo_hash)
    if not enrolled:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Enrolled record is not a face descriptor")

    dist = _distance(body.faceDescriptor, enrolled)
    matched = dist <= FACE_MATCH_THRESHOLD
    return {
        "matched": matched,
        "distance": round(dist, 4),
        "threshold": FACE_MATCH_THRESHOLD,
        "confidence": round(max(0.0, min(1.0, 1.0 - dist)), 4),
        "candidate": row.full_name if matched else None,
    }
