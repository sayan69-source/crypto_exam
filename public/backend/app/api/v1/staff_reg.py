"""
CryptoExam — Public centre-staff registration (real, DB-backed).

A centre's LAN is internet-free by design (ZUUP-OS INV-3), so a NEW Centre
Admin / Centre Invigilator registers on the PUBLIC website. This router stores
the request as a real PENDING row in the platform DB; it then lands in the §9
approval cascade:

    Centre Admin applicant  → approved by the SYSTEM ADMIN  (tier-0)
    Invigilator applicant   → approved by that centre's CENTRE ADMIN (tier-1)

Approval (in app/api/v1/admin.py) issues a real one-time, time-boxed code.
ACTIVATION is still an in-person ceremony at the centre — a web registration
alone can never become an ACTIVE identity (INV-4).

GET  /api/v1/staff/centres   — real centre directory (id/name/state) from the DB
GET  /api/v1/staff/exams     — exam directory for staff registration form (Problem 5)
POST /api/v1/staff/register  — store a real PENDING request → {requestId, status}
"""

import hashlib
import logging
import re
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Center, Exam, StaffRegistrationRequest, StaffApprovalStatus

logger = logging.getLogger(__name__)
router = APIRouter()




class StaffRegistration(BaseModel):
    role: str = Field(pattern="^(CENTER_ADMIN|CENTER_INVIGILATOR)$")
    centerId: str
    fullName: str = Field(min_length=2, max_length=255)
    faceDescriptor: list[float] = Field(min_length=128, max_length=128)
    # Problem 5: which exam this staff member is registering for (nullable for
    # Centre Admins who oversee the venue generally, required for Invigilators)
    examId: str | None = None


@router.get("/centres")
async def centres(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Real centre directory for the registration form — id/name/state only."""
    rows = (await db.execute(select(Center).order_by(Center.name))).scalars().all()
    return {
        "centres": [
            {"centerId": c.id, "name": c.name, "state": c.state}
            for c in rows
        ]
    }


@router.get("/exams")
async def staff_exams(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Problem 5: Exam directory for the staff registration form — mirrors enroll/exams."""
    rows = (await db.execute(select(Exam).order_by(Exam.scheduled_at))).scalars().all()
    return {
        "exams": [
            {
                "id": e.id,
                "name": e.name,
                "body": e.exam_body.value if e.exam_body else None,
                "scheduled_at": e.scheduled_at.isoformat() if e.scheduled_at else None,
                "year": e.year,
            }
            for e in rows
        ]
    }


@router.post("/register")
async def register(
    body: StaffRegistration,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Persist a real PENDING centre-staff registration."""
    centre = (
        await db.execute(select(Center).where(Center.id == body.centerId))
    ).scalar_one_or_none()
    if not centre:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="UNKNOWN_CENTRE")

    # Problem 5: validate exam if provided
    exam_name: str | None = None
    if body.examId:
        exam = (await db.execute(select(Exam).where(Exam.id == body.examId))).scalar_one_or_none()
        if not exam:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="UNKNOWN_EXAM")
        exam_name = exam.name

    req = StaffRegistrationRequest(
        id=str(uuid.uuid4()),
        role=body.role,
        center_id=centre.id,
        center_name=centre.name,
        full_name=body.fullName.strip(),
        face_descriptor=body.faceDescriptor,
        exam_id=body.examId,   # Problem 5
        status=StaffApprovalStatus.PENDING,
        approver_role="SYSTEM_ADMIN" if body.role == "CENTER_ADMIN" else "CENTER_ADMIN",
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)

    logger.info(
        "staff registration stored: %s (%s) at %s%s",
        req.full_name, req.role, centre.name,
        f" for exam: {exam_name}" if exam_name else "",
    )
    return {
        "ok": True,
        "requestId": req.id,
        "status": req.status.value,
        "approver": req.approver_role,
    }
