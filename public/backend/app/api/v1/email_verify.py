"""
CryptoExam Core — Email Verification API
Server-side authenticity verification for invigilators and staff.
"""

import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import EmailVerificationChallenge, User
from app.config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter()

DISPOSABLE_DOMAINS = {
    "mailinator.com", "yopmail.com", "guerrillamail.com", "10minutemail.com",
    "tempmail.com", "dispostable.com", "temp-mail.org", "maildrop.cc"
}

class EmailVerifyRequest(BaseModel):
    email: EmailStr

class EmailVerifyConfirm(BaseModel):
    challenge_id: str
    code: str

@router.post("/request", summary="Request email verification OTP")
async def request_email_verification(req: EmailVerifyRequest, db: AsyncSession = Depends(get_db)):
    email = req.email.strip().lower()
    domain = email.split('@')[-1]
    
    if domain in DISPOSABLE_DOMAINS:
        raise HTTPException(status_code=400, detail="Disposable email addresses are not allowed.")
        
    code = "".join(str(secrets.randbelow(10)) for _ in range(6))
    code_hash = hashlib.sha256(code.encode()).hexdigest()
    
    challenge = EmailVerificationChallenge(
        email=email,
        challenge_hash=code_hash,
        expires_at=datetime.utcnow() + timedelta(minutes=10)
    )
    db.add(challenge)
    await db.commit()
    await db.refresh(challenge)
    
    # In a real system, send email via email.py service. For dev, we just log it.
    logger.info(f"EMAIL OTP for {email}: {code} (challenge {challenge.id})")
    
    return {
        "challenge_id": challenge.id,
        "message": "Verification code sent.",
        "dev_code": code if get_settings().DEBUG else None
    }

@router.post("/confirm", summary="Confirm email verification OTP")
async def confirm_email_verification(req: EmailVerifyConfirm, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(EmailVerificationChallenge).where(EmailVerificationChallenge.id == req.challenge_id))
    challenge = res.scalar_one_or_none()
    
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found.")
        
    if challenge.consumed_at:
        raise HTTPException(status_code=400, detail="Challenge already consumed.")
        
    if challenge.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Challenge expired.")
        
    if challenge.attempts >= 5:
        raise HTTPException(status_code=400, detail="Too many failed attempts. Request a new code.")
        
    code_hash = hashlib.sha256(req.code.strip().encode()).hexdigest()
    
    if challenge.challenge_hash != code_hash:
        challenge.attempts += 1
        await db.commit()
        raise HTTPException(status_code=400, detail="Invalid OTP code.")
        
    challenge.consumed_at = datetime.utcnow()
    
    # Update user if exists
    res_user = await db.execute(select(User).where(User.email == challenge.email))
    user = res_user.scalar_one_or_none()
    if user:
        user.email_verified = True
        user.email_verified_at = datetime.utcnow()
        
    await db.commit()
    
    return {"ok": True, "email": challenge.email}
