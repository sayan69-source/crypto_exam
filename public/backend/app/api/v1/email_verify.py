"""
CryptoExam Core — Mandatory Email OTP Verification API
Server-side authenticity verification for invigilators, staff, and contact.
"""

import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, Request
from pydantic import BaseModel, EmailStr
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import EmailOtpChallenge, EmailVerificationGrant, User
from app.config import get_settings
from app.services.email import send_email

logger = logging.getLogger(__name__)
router = APIRouter()

DISPOSABLE_DOMAINS = {
    "mailinator.com", "yopmail.com", "guerrillamail.com", "10minutemail.com",
    "tempmail.com", "dispostable.com", "temp-mail.org", "maildrop.cc"
}


class EmailOtpRequest(BaseModel):
    email: EmailStr
    purpose: str
    role: Optional[str] = None


class EmailOtpVerify(BaseModel):
    challenge_id: str
    email: EmailStr
    code: str


def normalize_email(email: str) -> str:
    return email.strip().lower()


@router.post("/request", summary="Request email verification OTP")
async def request_email_verification(req_data: EmailOtpRequest, req: Request, db: AsyncSession = Depends(get_db)):
    email = normalize_email(req_data.email)
    domain = email.split('@')[-1]

    if domain in DISPOSABLE_DOMAINS:
        raise HTTPException(status_code=400, detail="Disposable email addresses are not allowed.")

    settings = get_settings()
    now = datetime.now(timezone.utc)

    # 1. Rate limiting
    recent_stmt = select(EmailOtpChallenge).where(
        EmailOtpChallenge.email == email,
        EmailOtpChallenge.purpose == req_data.purpose,
        EmailOtpChallenge.created_at >= now - timedelta(seconds=settings.EMAIL_OTP_RESEND_COOLDOWN_SECONDS)
    )
    if (await db.execute(recent_stmt)).scalar_one_or_none():
        raise HTTPException(status_code=429, detail="Too many verification attempts. Please wait and try again.")
        
    hour_stmt = select(EmailOtpChallenge).where(
        EmailOtpChallenge.email == email,
        EmailOtpChallenge.purpose == req_data.purpose,
        EmailOtpChallenge.created_at >= now - timedelta(hours=1)
    )
    hour_count = len((await db.execute(hour_stmt)).scalars().all())
    if hour_count >= settings.EMAIL_OTP_MAX_SENDS_PER_HOUR:
        raise HTTPException(status_code=429, detail="Maximum verification requests per hour reached.")

    # 2. Invalidate previous challenges
    await db.execute(
        update(EmailOtpChallenge)
        .where(
            EmailOtpChallenge.email == email,
            EmailOtpChallenge.purpose == req_data.purpose,
            EmailOtpChallenge.consumed_at == None
        )
        .values(consumed_at=now)
    )

    # 3. Generate new challenge
    code = f"{secrets.randbelow(1_000_000):06d}"
    code_hash = hashlib.sha256(code.encode()).hexdigest()

    challenge = EmailOtpChallenge(
        email=email,
        purpose=req_data.purpose,
        role=req_data.role,
        code_hash=code_hash,
        expires_at=now + timedelta(seconds=settings.EMAIL_OTP_TTL_SECONDS),
        request_ip=req.client.host if req.client else None
    )
    db.add(challenge)
    await db.commit()
    await db.refresh(challenge)

    # 4. Send email (critical=True)
    body = f"Your CryptoExam Core verification code is:\n\n{code}\n\nThis code expires in {settings.EMAIL_OTP_TTL_SECONDS // 60} minutes.\n\nIf you did not request this code, ignore this email."
    
    try:
        res = await send_email(
            to=email,
            subject="Your CryptoExam Core verification code",
            body=body,
            critical=True
        )
    except Exception as exc:
        logger.error(f"Failed to send email OTP: {exc}")
        raise HTTPException(status_code=500, detail="We could not send the verification code right now. Please try again.")

    resp = {
        "challenge_id": challenge.id,
        "expires_in": settings.EMAIL_OTP_TTL_SECONDS,
        "resend_after": settings.EMAIL_OTP_RESEND_COOLDOWN_SECONDS
    }
    

    return resp


@router.post("/verify", summary="Verify email verification OTP")
async def verify_email_otp(req_data: EmailOtpVerify, db: AsyncSession = Depends(get_db)):
    email = normalize_email(req_data.email)
    settings = get_settings()

    res = await db.execute(select(EmailOtpChallenge).where(EmailOtpChallenge.id == req_data.challenge_id))
    challenge = res.scalar_one_or_none()

    if not challenge:
        raise HTTPException(status_code=400, detail="Challenge not found.")

    if challenge.email != email:
        raise HTTPException(status_code=400, detail="Email mismatch.")

    if challenge.consumed_at:
        raise HTTPException(status_code=400, detail="Challenge already consumed or invalidated.")

    now = datetime.now(timezone.utc)
    expires = challenge.expires_at.replace(tzinfo=timezone.utc) if not challenge.expires_at.tzinfo else challenge.expires_at

    if expires < now:
        challenge.consumed_at = now
        await db.commit()
        raise HTTPException(status_code=400, detail="This verification code has expired. Request a new code.")

    if challenge.attempts >= settings.EMAIL_OTP_MAX_ATTEMPTS:
        challenge.consumed_at = now
        await db.commit()
        raise HTTPException(status_code=400, detail="Too many verification attempts. Please wait and try again.")

    code_hash = hashlib.sha256(req_data.code.strip().encode()).hexdigest()

    if challenge.code_hash != code_hash:
        challenge.attempts += 1
        await db.commit()
        raise HTTPException(status_code=400, detail="Incorrect verification code.")

    # Success
    challenge.consumed_at = now
    
    token = secrets.token_urlsafe(48)
    grant = EmailVerificationGrant(
        token=token,
        email=email,
        purpose=challenge.purpose,
        role=challenge.role,
        expires_at=now + timedelta(minutes=15) # short-lived token
    )
    db.add(grant)
    
    # Check if user exists and mark as verified (if it's a login purpose)
    if challenge.purpose == "LOGIN":
        res_user = await db.execute(select(User).where(User.email == email))
        user = res_user.scalar_one_or_none()
        if user:
            user.email_verified = True
            user.email_verified_at = now

    await db.commit()

    return {
        "verified": True,
        "verification_token": token,
        "expires_in": 900
    }
