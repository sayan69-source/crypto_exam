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
    ExamAdministrator, ExamRequest, ExamRequestLocation, ExamRequestStatus,
    ExamRequestSubject, UserRole, EmailVerificationGrant
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


class AdministratorIn(BaseModel):
    """
    The person the conducting body puts in charge of THIS exam.

    `reference` is the organisation's own identifier for them — a staff number, a
    file reference. It is recorded and displayed, never treated as proof of
    anything, which is why it is free text and optional.
    """
    fullName: str = Field(min_length=2, max_length=200)
    email: str = Field(min_length=3, max_length=255)
    reference: str | None = None


class ExamRequestIn(BaseModel):
    examName: str = Field(min_length=2, max_length=500)
    organisation: str = Field(min_length=2, max_length=255)
    contactName: str = Field(min_length=2, max_length=200)
    contactEmail: str = Field(min_length=3, max_length=255)
    contactPhone: str | None = None
    proposedDate: datetime | None = None
    durationMinutes: int | None = Field(default=None, ge=1)
    notes: str | None = None
    # Required: an exam with no named administrator has nobody who can staff
    # it, and the approval chain would stall with no way to say why.
    administrator: AdministratorIn
    locations: list[LocationIn] = Field(min_length=1)
    subjects: list[SubjectIn] = Field(min_length=1)
    subjectChoiceMin: int | None = Field(default=None, ge=0)
    subjectChoiceMax: int | None = Field(default=None, ge=1)
    emailVerificationToken: str = Field(..., description="Token proving contact email ownership")


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

    if not body.emailVerificationToken or not body.emailVerificationToken.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email verification token is required.")

    # ── verify email ────────────────────────────────────────────────────────
    stmt = select(EmailVerificationGrant).where(
        EmailVerificationGrant.token == body.emailVerificationToken,
        EmailVerificationGrant.email == body.contactEmail.strip().lower(),
        EmailVerificationGrant.consumed_at.is_(None)
    )
    grant = (await db.execute(stmt)).scalar_one_or_none()
    
    if not grant:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or already consumed email verification token.")
        
    now_dt = datetime.now(timezone.utc)
    grant_expires = grant.expires_at.replace(tzinfo=timezone.utc) if not grant.expires_at.tzinfo else grant.expires_at
    if grant_expires < now_dt:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email verification token has expired.")
    
    # Consume token
    grant.consumed_at = now_dt
    # ────────────────────────────────────────────────────────────────────────

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

    db.add(ExamAdministrator(
        id=str(uuid.uuid4()), request_id=req.id,
        full_name=body.administrator.fullName.strip(),
        email=body.administrator.email.strip(),
        email_norm=normalise(body.administrator.email),
        reference=body.administrator.reference,
    ))

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
    serialised = [_serialise(r) for r in rows]
    return {"items": serialised, "total": len(serialised), "page": 1, "per_page": len(serialised)}


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
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail={"reason": "ONLY_SYSADMIN_CAN_APPROVE"})

    if both_approved(req):
        offering = await materialise(db, req)
        
        # Load the ExamAdministrator to get their email
        admin_stmt = select(ExamAdministrator).where(ExamAdministrator.request_id == req.id)
        exam_admin = (await db.execute(admin_stmt)).scalar_one_or_none()
        admin_email = exam_admin.email if exam_admin else req.contact_email
        
        await db.commit()
        logger.info("exam request %s ACTIVE — exam=%s", req.reference, req.exam_id)
        
        # Send automated approval email — fire-and-forget so a mail delivery
        # failure does not prevent the approval from being recorded.
        from app.services.email import send_email
        proposed = req.proposed_date.strftime("%d %B %Y") if req.proposed_date else "to be confirmed"
        email_body = (
            f"Dear {req.contact_name},\n\n"
            f"We are pleased to confirm that your examination request has been APPROVED.\n\n"
            f"────────────────────────────────\n"
            f"  Reference:      {req.reference}\n"
            f"  Exam Name:      {req.exam_name}\n"
            f"  Organisation:   {req.organisation}\n"
            f"  Proposed Date:  {proposed}\n"
            f"  Status:         ACTIVE — registration is now open\n"
            f"────────────────────────────────\n\n"
            f"NEXT STEPS\n\n"
            f"1. The Exam Administrator ({admin_email}) should register on the\n"
            f"   CryptoExam Core portal to manage the examination.\n\n"
            f"2. Candidates can now register at the Candidate Enrolment page.\n\n"
            f"3. Centre staff (invigilators, centre admins) can register via\n"
            f"   the Staff Registration page.\n\n"
            f"If you have questions, reply to this email or use the Contact\n"
            f"page on the platform.\n\n"
            f"CryptoExam Core — System Administration\n"
        )
        try:
            await send_email(
                to=req.contact_email,
                subject=f"✅ Exam Approved: {req.exam_name} [{req.reference}]",
                body=email_body,
            )
            # Also notify the exam administrator if their email differs
            if admin_email and admin_email.lower() != req.contact_email.lower():
                admin_body = (
                    f"Dear {exam_admin.full_name if exam_admin else 'Exam Administrator'},\n\n"
                    f"The examination '{req.exam_name}' (ref: {req.reference}) has been\n"
                    f"approved and is now ACTIVE.\n\n"
                    f"You have been designated as the Exam Administrator. Please register\n"
                    f"on the CryptoExam Core portal using this email address ({admin_email})\n"
                    f"to begin managing the examination.\n\n"
                    f"CryptoExam Core — System Administration\n"
                )
                await send_email(
                    to=admin_email,
                    subject=f"You are the Exam Administrator for: {req.exam_name}",
                    body=admin_body,
                )
        except Exception as mail_err:
            logger.warning("approval email failed for %s: %s", req.reference, mail_err)

        return {"ok": True, "status": req.status.value, "examId": req.exam_id,
                "offeringId": offering.id,
                "note": "System Admin approval recorded — exam is now LIVE."}

    req.status = ExamRequestStatus.SYSADMIN_APPROVED
    await db.commit()
    return {"ok": True, "status": req.status.value,
            "note": "Recorded."}


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

    # Send rejection email — fire-and-forget.
    from app.services.email import send_email
    proposed = req.proposed_date.strftime("%d %B %Y") if req.proposed_date else "not specified"
    reject_body = (
        f"Dear {req.contact_name},\n\n"
        f"We regret to inform you that your examination request has been REJECTED.\n\n"
        f"────────────────────────────────\n"
        f"  Reference:      {req.reference}\n"
        f"  Exam Name:      {req.exam_name}\n"
        f"  Organisation:   {req.organisation}\n"
        f"  Proposed Date:  {proposed}\n"
        f"  Status:         REJECTED\n"
        f"────────────────────────────────\n\n"
        f"REASON FOR REJECTION\n\n"
        f"  {body.reason.strip()}\n\n"
        f"If you believe this decision should be reconsidered, or if you\n"
        f"wish to submit a revised request addressing the above, please\n"
        f"use the exam request form on the platform or contact us.\n\n"
        f"CryptoExam Core — System Administration\n"
    )
    try:
        await send_email(
            to=req.contact_email,
            subject=f"❌ Exam Request Rejected: {req.exam_name} [{req.reference}]",
            body=reject_body,
        )
    except Exception as mail_err:
        logger.warning("rejection email failed for %s: %s", req.reference, mail_err)

    return {"ok": True, "status": req.status.value}
