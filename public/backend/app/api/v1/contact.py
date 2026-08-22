"""
CryptoExam Core — Contact / Lead form endpoint (Problem 2).

POST /api/v1/contact  — Store a lead + send a real email via the shared
                        EmailService built in Problem 0.5.

Previously the frontend contact/page.tsx only did `setSent(true)` with no
API call — it implied an action succeeded when nothing happened. This endpoint
gives it a real backend so the \"sent\" state is honest.

Stored in a lightweight ContactLead table (if desired in future) or simply
sent via the email service. For now: validate, send email, return ok.
"""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.services.email import send_email

logger = logging.getLogger(__name__)
router = APIRouter()


class ContactSubmission(BaseModel):
    firstName: str = Field(min_length=1, max_length=100)
    lastName: str = Field(min_length=1, max_length=100)
    email: EmailStr
    organisation: str = Field(min_length=1, max_length=255)
    role: str = Field(min_length=1, max_length=100)
    scale: str = Field(min_length=1, max_length=50)
    message: str = Field(min_length=10, max_length=5000)
    email_verification_token: str | None = None


@router.post("/")
async def submit_contact(body: ContactSubmission, db: AsyncSession = Depends(get_db)):
    """
    Problem 2: Real backend for the public contact form.
    Requires email verification grant.
    Sends a notification email to the CryptoExam team.
    """
    if not body.email_verification_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email verification token required")

    from app.models import EmailVerificationGrant
    grant = (await db.execute(
        select(EmailVerificationGrant).where(EmailVerificationGrant.token == body.email_verification_token)
    )).scalar_one_or_none()
    
    now = datetime.now(timezone.utc)
    if not grant or grant.consumed_at or grant.expires_at.replace(tzinfo=timezone.utc) < now:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired email verification token")
        
    if grant.email != body.email.strip().lower() or grant.purpose != "CONTACT":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Email verification token context mismatch")
    
    grant.consumed_at = now
    await db.commit()

    # Notify the CryptoExam team
    team_email_body = (
        f"New enquiry from {body.firstName} {body.lastName} <{body.email}>\n"
        f"Organisation: {body.organisation}\n"
        f"Role: {body.role}\n"
        f"Annual candidate volume: {body.scale}\n\n"
        f"Message:\n{body.message}\n"
    )
    team_result = await send_email(
        to="manabdelhi1@gmail.com",
        subject=f"[CryptoExam Enquiry] {body.organisation} — {body.role}",
        body=team_email_body,
    )

    # Send acknowledgement to the submitter
    ack_body = (
        f"Dear {body.firstName},\n\n"
        f"Thank you for your enquiry about CryptoExam Core.\n\n"
        f"A member of the programme team will be in touch within two working days.\n\n"
        f"CryptoExam Core"
    )
    ack_result = await send_email(
        to=body.email,
        subject="We received your enquiry — CryptoExam Core",
        body=ack_body,
    )

    logger.info(
        "contact form submitted: %s <%s> @ %s — team email: %s, ack: %s",
        f"{body.firstName} {body.lastName}", body.email, body.organisation,
        team_result.delivery, ack_result.delivery,
    )

    response: dict = {"ok": True}
    # Dev-mode: surface preview so the frontend can show it
    if team_result.delivery == "dev" and team_result.dev_preview:
        response["teamEmailDevPreview"] = team_result.dev_preview
    if ack_result.delivery == "dev" and ack_result.dev_preview:
        response["ackEmailDevPreview"] = ack_result.dev_preview
    response["emailDelivery"] = team_result.delivery
    return response
