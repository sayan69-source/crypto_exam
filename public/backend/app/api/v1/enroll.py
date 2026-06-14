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
from app.models import User, UserRole, Center, Exam, Enrollment, EnrollmentStatus
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
    """Public exam directory for the enrolment form (no sealed content)."""
    rows = (await db.execute(select(Exam).order_by(Exam.scheduled_at))).scalars().all()
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

    seq = (await db.execute(
        select(func.count()).select_from(Enrollment).where(Enrollment.exam_id == exam.id)
    )).scalar() or 0
    body_code = exam.exam_body.value if exam.exam_body else "EXM"
    state_code = (centre.state or "IND")[:3].upper()
    roll = f"{body_code}-2026-{state_code}-{seq + 1:07d}"

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
