"""
Exam requests — how an examination comes to exist at all.

An organisation asks us to conduct an exam. The System Admin (tier-0) and the
administration must BOTH approve it. Only then does an `Exam` exist, with an
`ExamOffering` that candidates can register against.

Why two approvals rather than one: an exam is the thing the whole platform
exists to protect, and creating one grants the requesting body a roster of real
people's names, dates of birth and biometric enrolments. A single console
compromise should not be able to conjure that. The two are recorded separately
and neither can stand in for the other.

  POST  /api/v1/exam-requests                    — an organisation submits (public)
  GET   /api/v1/exam-requests                    — the approval queue (staff)
  POST  /api/v1/exam-requests/{id}/approve       — approve as MY authority (staff)
  POST  /api/v1/exam-requests/{id}/reject        — reject with a reason (staff)
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import (
    ExamRequest, ExamRequestLocation, ExamRequestStatus, ExamRequestSubject,
    UserRole,
)
from app.services.auth import require_role
from app.services.exam_registration import both_approved, materialise, new_reference, normalise

logger = logging.getLogger(__name__)
router = APIRouter()


class LocationIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    city: str | None = None
    state: str | None = None
    address: str | None = None
    capacity: int | None = Field(default=None, ge=1)


class SubjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    code: str | None = None
    compulsory: bool = True


class ExamRequestIn(BaseModel):
    examName: str = Field(min_length=2, max_length=500)
    organisation: str = Field(min_length=2, max_length=255)
    contactName: str = Field(min_length=2, max_length=200)
    contactEmail: str = Field(min_length=3, max_length=255)
    contactPhone: str | None = None
    proposedDate: datetime | None = None
    durationMinutes: int | None = Field(default=None, ge=1)
    notes: str | None = None
    locations: list[LocationIn] = Field(min_length=1)
    subjects: list[SubjectIn] = Field(min_length=1)
    subjectChoiceMin: int | None = Field(default=None, ge=0)
    subjectChoiceMax: int | None = Field(default=None, ge=1)


class RejectIn(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)


def _serialise(r: ExamRequest) -> dict[str, Any]:
    return {
        "id": r.id,
        "reference": r.reference,
        "examName": r.exam_name,
        "organisation": r.organisation,
        "contactName": r.contact_name,
        "contactEmail": r.contact_email,
        "proposedDate": r.proposed_date.isoformat() if r.proposed_date else None,
        "status": r.status.value,
        # Named individually so a console can show an approver whether the
        # decision still waiting is theirs.
        "sysadminApproved": r.sysadmin_approved_at is not None,
        "adminApproved": r.admin_approved_at is not None,
        "rejectionReason": r.rejection_reason,
        "examId": r.exam_id,
        "locations": [
            {"name": l.name, "city": l.city, "state": l.state, "capacity": l.capacity}
            for l in r.locations
        ],
        "subjects": [
            {"name": s.name, "code": s.code, "compulsory": s.is_compulsory} for s in r.subjects
        ],
        "subjectChoiceMin": r.subject_choice_min,
        "subjectChoiceMax": r.subject_choice_max,
        "createdAt": r.created_at.isoformat() if r.created_at else None,
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def submit(body: ExamRequestIn, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """An organisation asks for an exam. Creates nothing registerable on its own."""
    optional_count = sum(1 for s in body.subjects if not s.compulsory)
    lo, hi = body.subjectChoiceMin, body.subjectChoiceMax

    # A rule nobody can satisfy is worse than no rule: it produces an exam whose
    # registration form rejects every possible answer, and the failure surfaces
    # on a candidate rather than on the person who set it.
    if lo is not None and lo > optional_count:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"reason": "IMPOSSIBLE_SUBJECT_RULE",
                    "message": f"Minimum of {lo} optional subjects, but only {optional_count} are optional."},
        )
    if lo is not None and hi is not None and lo > hi:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"reason": "IMPOSSIBLE_SUBJECT_RULE",
                    "message": "The minimum number of subjects exceeds the maximum."},
        )

    req = ExamRequest(
        id=str(uuid.uuid4()),
        reference=new_reference(),
        exam_name=body.examName.strip(),
        exam_name_norm=normalise(body.examName),
        organisation=body.organisation.strip(),
        organisation_norm=normalise(body.organisation),
        contact_name=body.contactName.strip(),
        contact_email=body.contactEmail.strip(),
        contact_phone=body.contactPhone,
        proposed_date=body.proposedDate,
        duration_minutes=body.durationMinutes,
        notes=body.notes,
        subject_choice_min=lo,
        subject_choice_max=hi,
        status=ExamRequestStatus.SUBMITTED,
    )
    db.add(req)
    await db.flush()

    for i, loc in enumerate(body.locations):
        db.add(ExamRequestLocation(
            id=str(uuid.uuid4()), request_id=req.id, name=loc.name.strip(), city=loc.city,
            state=loc.state, address=loc.address, capacity=loc.capacity, display_order=i,
        ))
    for i, sub in enumerate(body.subjects):
        db.add(ExamRequestSubject(
            id=str(uuid.uuid4()), request_id=req.id, name=sub.name.strip(), code=sub.code,
            is_compulsory=sub.compulsory, display_order=i,
        ))
    await db.commit()

    logger.info("exam request %s submitted by %s", req.reference, req.organisation)
    return {
        "ok": True,
        "reference": req.reference,
        "status": req.status.value,
        "note": "Your request needs approval from the System Administrator and the administration before candidates can register.",
    }


async def _load(db: AsyncSession, request_id: str) -> ExamRequest:
    req = (await db.execute(
        select(ExamRequest)
        .options(selectinload(ExamRequest.locations), selectinload(ExamRequest.subjects))
        .where(ExamRequest.id == request_id)
    )).scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="UNKNOWN_REQUEST")
    return req


@router.get("")
async def queue(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.ADMIN, UserRole.SYSTEM_ADMIN)),
) -> dict[str, Any]:
    """Every request, newest first, with both approval flags."""
    rows = (await db.execute(
        select(ExamRequest)
        .options(selectinload(ExamRequest.locations), selectinload(ExamRequest.subjects))
        .order_by(ExamRequest.created_at.desc())
    )).scalars().all()
    return {"requests": [_serialise(r) for r in rows]}


@router.post("/{request_id}/approve")
async def approve(
    request_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.ADMIN, UserRole.SYSTEM_ADMIN)),
) -> dict[str, Any]:
    """
    Record MY authority's approval. The exam is materialised only once both are in.

    Which approval this records is decided by the caller's role, never by the
    request body — otherwise one console could supply the other's approval and
    the whole point of requiring two would be gone.
    """
    req = await _load(db, request_id)
    if req.status in (ExamRequestStatus.REJECTED, ExamRequestStatus.WITHDRAWN):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail={"reason": f"REQUEST_{req.status.value}"})
    if req.status == ExamRequestStatus.ACTIVE:
        return {"ok": True, "status": req.status.value, "examId": req.exam_id,
                "note": "Already active."}

    role = current_user.get("role")
    is_sysadmin = role in (UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_ADMIN.value, "SYSTEM_ADMIN")
    now = datetime.now(timezone.utc)
    actor = current_user.get("sub") or current_user.get("id")

    if is_sysadmin:
        if req.sysadmin_approved_at:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail={"reason": "ALREADY_APPROVED_BY_SYSADMIN"})
        req.sysadmin_approved_at, req.sysadmin_approved_by = now, actor
    else:
        if req.admin_approved_at:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail={"reason": "ALREADY_APPROVED_BY_ADMIN"})
        req.admin_approved_at, req.admin_approved_by = now, actor

    if both_approved(req):
        offering = await materialise(db, req)
        await db.commit()
        logger.info("exam request %s ACTIVE — exam=%s", req.reference, req.exam_id)
        return {"ok": True, "status": req.status.value, "examId": req.exam_id,
                "offeringId": offering.id,
                "note": "Both approvals recorded — candidates can now register."}

    req.status = (ExamRequestStatus.SYSADMIN_APPROVED if is_sysadmin
                  else ExamRequestStatus.ADMIN_APPROVED)
    await db.commit()
    outstanding = "the administration" if is_sysadmin else "the System Administrator"
    return {"ok": True, "status": req.status.value,
            "note": f"Recorded. Still awaiting approval from {outstanding}."}


@router.post("/{request_id}/reject")
async def reject(
    request_id: str,
    body: RejectIn,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.ADMIN, UserRole.SYSTEM_ADMIN)),
) -> dict[str, Any]:
    """Either authority may refuse, and the reason is required rather than optional."""
    req = await _load(db, request_id)
    if req.status == ExamRequestStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail={"reason": "ALREADY_ACTIVE",
                                    "message": "Deactivate the offering instead."})
    req.status = ExamRequestStatus.REJECTED
    req.rejected_at = datetime.now(timezone.utc)
    req.rejected_by = current_user.get("sub") or current_user.get("id")
    req.rejection_reason = body.reason.strip()
    await db.commit()
    return {"ok": True, "status": req.status.value}
