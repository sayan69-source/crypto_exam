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
from app.models import (
    Center,
    Exam,
    NotificationKind,
    NotificationSeverity,
    StaffApprovalStatus,
    StaffRegistrationRequest,
    UserRole,
)
from app.services.notifications import notify

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

    # Tell the admin console that its queue just grew.
    #
    # This is the second crossing point in this feature, and the one with the
    # widest gap between the two sides. The caller here is a member of the
    # public with no account, no session and no token — by construction,
    # because a centre's LAN has no route to the internet and a new Centre
    # Admin therefore has to register from outside it. The reader is an
    # authenticated administrator on a console that may not be open for hours.
    #
    # Before this, the ONLY trace of an application was a row that appeared in
    # the approvals table if somebody happened to load that page, so an
    # application submitted on a Friday evening was indistinguishable from no
    # application at all until someone went looking.
    #
    # Staged, not committed: the notification rides the same transaction as the
    # registration it describes, so a registration that fails to commit cannot
    # leave behind a notification claiming somebody applied.
    notify(
        db,
        kind=NotificationKind.STAFF_REGISTRATION_SUBMITTED,
        severity=NotificationSeverity.INFO,
        # Addressed to whoever actually holds this approval, which is NOT one
        # fixed role: a Centre Admin applicant is tier-0's decision, an
        # Invigilator is their own centre's. Addressing both to ADMIN would put
        # Centre Admin applications in front of a tier-1 operator who is
        # forbidden from approving them (403 SYSTEM_ADMIN_REQUIRED) while the
        # tier-0 console that must act never hears about them — a notification
        # sent to someone who cannot act on it is worse than none, because it
        # looks handled.
        recipient_role=req.approver_role,
        title=f"{req.full_name} applied as {'Centre Admin' if req.role == 'CENTER_ADMIN' else 'Invigilator'}",
        body=(
            f"Registered on the public site for {centre.name}. "
            f"Approval is held by {req.approver_role.replace('_', ' ').title()}. "
            "Approving issues a one-time code handed over in person — a web "
            "registration alone can never become an active identity."
        ),
        source_feature="staff-registration",
        subject_type="staff_registration_request",
        subject_id=req.id,
        payload={
            "applicantName": req.full_name,
            "role": req.role,
            "centreName": centre.name,
            "centreId": centre.id,
            "approverRole": req.approver_role,
            # Deliberately NOT the face embedding hash: the biometric material
            # stays in the row the approver opens, never in a feed.
        },
    )

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
