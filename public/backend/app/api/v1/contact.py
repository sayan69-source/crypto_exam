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

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.services.email import send_email

logger = logging.getLogger(__name__)
router = APIRouter()


class ContactSubmission(BaseModel):
    firstName: str = Field(min_length=1, max_length=100)
    lastName: str = Field(min_length=1, max_length=100)
    email: str = Field(min_length=3, max_length=255)
    organisation: str = Field(min_length=1, max_length=255)
    role: str = Field(min_length=1, max_length=100)
    scale: str = Field(min_length=1, max_length=50)
    message: str = Field(min_length=10, max_length=5000)


@router.post("/")
async def submit_contact(body: ContactSubmission):
    """
    Problem 2: Real backend for the public contact form.
    Sends a notification email to the CryptoExam team (dev-mode preview if SMTP not configured).
    Mirrors the dev-mode pattern from the SMS OTP flow.
    """
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
