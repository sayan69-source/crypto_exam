"""
Who may author for an exam.

Three gates, in order, none of which can stand in for another:

  1. the exam's ADMINISTRATOR nominates a person, by name and email;
  2. the SYSTEM ADMIN approves that nomination;
  3. the nominee proves they control the nominated mailbox.

Nomination alone is not permission. An administrator types the address, so
without step 3 they could grant authoring rights to a mailbox they hold
themselves — and authoring rights are rights over the item pool an entire
examination is drawn from. Approval alone is not permission either: tier-0 is
agreeing to a *person at an address*, not to whoever later opens the link.

  POST /api/v1/exam-setters/nominate            — the exam's administrator
  GET  /api/v1/exam-setters?offeringId=…        — the queue / roster
  POST /api/v1/exam-setters/{id}/approve        — SYSTEM_ADMIN only
  POST /api/v1/exam-setters/{id}/reject         — SYSTEM_ADMIN only
  POST /api/v1/exam-setters/register            — the nominee, with their token
"""

import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import (
    ExamAdministrator, ExamOffering, ExamSetterNomination, SetterNominationStatus,
    User, UserRole,
)
from app.services.auth import hash_password, require_role
from app.services.email import email_configured, mask_email, send_setter_invitation
from app.services.exam_registration import normalise

logger = logging.getLogger(__name__)
router = APIRouter()

# Long enough that guessing is hopeless, short-lived because an authoring
# credential left claimable for a month is a credential someone else claims.
TOKEN_TTL = timedelta(days=7)


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


class NominateIn(BaseModel):
    offeringId: str
    administratorId: str
    fullName: str = Field(min_length=2, max_length=200)
    email: EmailStr
    reference: str | None = None


class RejectIn(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)


class RegisterIn(BaseModel):
    token: str = Field(min_length=16)
    password: str = Field(min_length=12, max_length=200,
                          description="the setter's own password for the authoring portal")


def _serialise(n: ExamSetterNomination) -> dict[str, Any]:
    return {
        "id": n.id,
        "offeringId": n.offering_id,
        "fullName": n.full_name,
        "email": n.email,
        "reference": n.reference,
        "status": n.status.value,
        "approvedAt": n.approved_at.isoformat() if n.approved_at else None,
        "verifiedAt": n.verified_at.isoformat() if n.verified_at else None,
        # The only field a caller should branch on. Exposed so a console cannot
        # invent its own definition of "allowed to author".
        "canAuthor": n.can_author,
    }


@router.post("/nominate", status_code=status.HTTP_201_CREATED)
async def nominate(body: NominateIn, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """The exam's administrator names someone. Grants nothing by itself."""
    admin = (await db.execute(
        select(ExamAdministrator).where(ExamAdministrator.id == body.administratorId)
    )).scalar_one_or_none()
    if not admin:
        raise HTTPException(status_code=404, detail={"reason": "UNKNOWN_ADMINISTRATOR"})

    offering = (await db.execute(
        select(ExamOffering).where(ExamOffering.id == body.offeringId)
    )).scalar_one_or_none()
    if not offering:
        raise HTTPException(status_code=404, detail={"reason": "UNKNOWN_EXAM"})

    # An administrator's authority is scoped to THEIR exam. Without this check
    # any administrator could staff any other body's examination.
    if admin.offering_id and admin.offering_id != offering.id:
        raise HTTPException(status_code=403, detail={"reason": "NOT_YOUR_EXAM"})

    email_norm = normalise(body.email)
    dup = (await db.execute(
        select(ExamSetterNomination).where(
            ExamSetterNomination.offering_id == offering.id,
            ExamSetterNomination.email_norm == email_norm,
        )
    )).scalar_one_or_none()
    if dup:
        raise HTTPException(status_code=409, detail={
            "reason": "ALREADY_NOMINATED",
            "message": f"{body.email} is already nominated for this exam ({dup.status.value}).",
        })

    nom = ExamSetterNomination(
        id=str(uuid.uuid4()), offering_id=offering.id, nominated_by=admin.id,
        full_name=body.fullName.strip(), email=str(body.email), email_norm=email_norm,
        reference=body.reference, status=SetterNominationStatus.NOMINATED,
    )
    db.add(nom)
    await db.commit()
    logger.info("setter nominated: %s for offering %s", nom.email, offering.id)
    return {"ok": True, "nomination": _serialise(nom),
            "note": "Awaiting System Admin approval; the nominee must then verify their email."}


@router.get("")
async def roster(offeringId: str | None = None, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Nominations, optionally for one exam. No tokens are ever returned."""
    q = select(ExamSetterNomination).order_by(ExamSetterNomination.created_at.desc())
    if offeringId:
        q = q.where(ExamSetterNomination.offering_id == offeringId)
    rows = (await db.execute(q)).scalars().all()
    return {"nominations": [_serialise(n) for n in rows]}


async def _load(db: AsyncSession, nomination_id: str) -> ExamSetterNomination:
    n = (await db.execute(
        select(ExamSetterNomination).where(ExamSetterNomination.id == nomination_id)
    )).scalar_one_or_none()
    if not n:
        raise HTTPException(status_code=404, detail={"reason": "UNKNOWN_NOMINATION"})
    return n


@router.post("/{nomination_id}/approve")
async def approve(
    nomination_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.SYSTEM_ADMIN)),
) -> dict[str, Any]:
    """
    Tier-0 agrees to the nomination, and the nominee is emailed a token.

    Only the token's HASH is stored. Where SMTP is configured the raw value goes
    to the nominee and is NOT returned here — handing the approver a copy would
    let them redeem it themselves, which is precisely the substitution the
    verification gate exists to prevent. Without SMTP it is returned instead, so
    the flow still works before mail is set up rather than growing a second,
    weaker way in.
    """
    n = await _load(db, nomination_id)
    if n.status in (SetterNominationStatus.REJECTED, SetterNominationStatus.REVOKED):
        raise HTTPException(status_code=409, detail={"reason": f"NOMINATION_{n.status.value}"})
    if n.status == SetterNominationStatus.VERIFIED:
        return {"ok": True, "nomination": _serialise(n), "note": "Already verified."}

    raw = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    n.status = SetterNominationStatus.APPROVED
    n.approved_at = now
    n.approved_by = current_user.get("sub") or current_user.get("id")
    n.verification_token_hash = _hash_token(raw)
    n.verification_sent_at = now
    n.verification_expires_at = now + TOKEN_TTL
    # Send BEFORE committing. If the invitation cannot be delivered, the
    # approval is rolled back rather than recorded against a token nobody
    # received — which would leave tier-0 believing they had actioned it and the
    # nominee waiting for a mail that never comes.
    expires_iso = n.verification_expires_at.isoformat()
    delivered = False
    if email_configured():
        try:
            await send_setter_invitation(n.email, n.full_name, "this examination", raw, expires_iso)
            delivered = True
        except RuntimeError as exc:
            await db.rollback()
            raise HTTPException(status_code=502, detail={
                "reason": "INVITATION_NOT_SENT",
                "message": f"Approval not recorded — the invitation could not be delivered. {exc}",
            }) from exc

    await db.commit()
    logger.info("setter nomination approved: %s (emailed=%s)", n.email, delivered)

    out: dict[str, Any] = {"ok": True, "nomination": _serialise(n), "expiresAt": expires_iso}
    if delivered:
        # Deliberately NOT returned once it has been mailed: the token is the
        # nominee's proof of holding the mailbox, and handing a copy to the
        # approver would let the approver complete the registration themselves.
        out["delivered"] = True
        out["sentTo"] = mask_email(n.email)
        out["note"] = "The nominee has been emailed. They cannot author until they redeem it."
    else:
        out["verificationToken"] = raw
        out["note"] = ("No SMTP configured, so the token is returned here instead. "
                       "Configure SMTP_HOST/SMTP_FROM so it goes to the nominee alone.")
    return out


@router.post("/{nomination_id}/reject")
async def reject(
    nomination_id: str,
    body: RejectIn,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.SYSTEM_ADMIN)),
) -> dict[str, Any]:
    n = await _load(db, nomination_id)
    n.status = SetterNominationStatus.REJECTED
    n.rejected_at = datetime.now(timezone.utc)
    n.rejection_reason = body.reason.strip()
    # A rejected nomination must not keep a redeemable token.
    n.verification_token_hash = None
    await db.commit()
    return {"ok": True, "nomination": _serialise(n)}


@router.post("/register")
async def register(body: RegisterIn, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """
    The nominee redeems their token and becomes a setter for that exam.

    Everything is resolved FROM the token: the exam, the address, the person.
    Nothing about who they are is taken from the request, because the token is
    the only part of this the nominee has actually proved.
    """
    token_hash = _hash_token(body.token)
    n = (await db.execute(
        select(ExamSetterNomination).where(
            ExamSetterNomination.verification_token_hash == token_hash
        )
    )).scalar_one_or_none()
    # One message for "no such token" and "wrong token", so this cannot be used
    # to discover which nominations exist.
    if not n:
        raise HTTPException(status_code=400, detail={"reason": "INVALID_TOKEN"})
    if n.status != SetterNominationStatus.APPROVED:
        raise HTTPException(status_code=409, detail={"reason": f"NOMINATION_{n.status.value}"})

    expires = n.verification_expires_at
    if expires is not None and expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)   # SQLite returns naive
    if expires and datetime.now(timezone.utc) > expires:
        raise HTTPException(status_code=409, detail={
            "reason": "TOKEN_EXPIRED",
            "message": "Ask the System Admin to re-issue the approval.",
        })

    # One account per address across exams: a setter authoring for two boards is
    # one person, and the per-author share cap on a form depends on that being
    # true rather than on them happening to reuse an email.
    user = (await db.execute(select(User).where(User.email == n.email))).scalar_one_or_none()
    if not user:
        user = User(
            id=str(uuid.uuid4()), email=n.email, full_name=n.full_name,
            role=UserRole.SETTER, password_hash=hash_password(body.password),
            dpdp_consent=True, dpdp_consent_at=datetime.now(timezone.utc),
            dpdp_consent_version="1.0", is_active=True,
        )
        db.add(user)
        await db.flush()

    now = datetime.now(timezone.utc)
    n.status = SetterNominationStatus.VERIFIED
    n.verified_at = now
    n.user_id = user.id
    n.verification_token_hash = None      # one-shot
    await db.commit()

    logger.info("setter verified and registered: %s for offering %s", n.email, n.offering_id)
    return {"ok": True, "nomination": _serialise(n), "userId": user.id,
            "note": "You may now author items for this exam."}
