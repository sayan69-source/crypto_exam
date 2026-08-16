"""
CryptoExam Core — Auth API Endpoints
§ 8 — Authentication and authorization.

POST /api/v1/auth/login      — Unified login (candidate DOB / setter password)
POST /api/v1/auth/register   — Register new user (setter/admin only)
GET  /api/v1/auth/me          — Get current user profile
POST /api/v1/auth/refresh     — Refresh JWT token
"""

import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models import User, UserRole, Enrollment, OtpChallenge
from app.schemas import (
    LoginRequest, TokenResponse, UserProfile, ErrorResponse,
)
from app.services.auth import (
    create_access_token, hash_password, verify_password,
    get_current_user, require_role,
)
from app.services.sms import sms_configured, send_sms, mask_phone
from app.services.email import email_configured, send_otp_email, mask_email


class VerifyOtpRequest(BaseModel):
    challenge_id: str
    code: str

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post(
    "/login",
    responses={401: {"model": ErrorResponse}},
    summary="Step 1 — password, then issue an OTP to the registered phone",
    description=(
        "Verify credentials (candidate = roll number + password; setter/admin = "
        "email + password), then send a one-time code to the user's registered "
        "phone. Returns a challenge_id; complete the login at /auth/verify-otp."
    ),
)
async def login(
    request: LoginRequest,
    req: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Unified login supporting all three roles.

    Candidate: identifier=roll_number, dob=YYYY-MM-DD
    Setter/Admin: identifier=email, password=<password>
    """
    # Find user by email or full name.
    #
    # Email is matched case-INSENSITIVELY. Registration lowercases the address
    # before storing it, so anyone who typed a capital in the login box —
    # "Setter@x.com", or a phone keyboard auto-capitalising the first letter —
    # got 401 Invalid credentials against an account that exists and a password
    # that is correct. Names keep exact matching; they are not identifiers.
    identifier = request.identifier.strip()
    stmt = select(User).where(
        (func.lower(User.email) == identifier.lower()) | (User.full_name == identifier)
    )
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    # Candidate identity is their enrolment roll number — resolve it to the user.
    # Roll numbers are globally unique (see enroll.py), so this resolves to one
    # person; the limit is belt-and-braces against legacy rows.
    if not user:
        enr = (await db.execute(
            select(Enrollment).where(Enrollment.roll_number == identifier).limit(1)
        )).scalars().first()
        if enr and enr.candidate_id:
            user = (await db.execute(
                select(User).where(User.id == enr.candidate_id)
            )).scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated",
        )

    # DPDP consent check
    if not user.dpdp_consent:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="DPDP Act 2023 consent required before authentication. "
                   "Please provide consent through the registration flow.",
        )

    # Role-specific authentication
    if user.role == UserRole.CANDIDATE:
        # Candidates have NO online login by design. They enrol (face) on the
        # web and are verified BIOMETRICALLY at the centre OS terminal, offline.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Candidates do not log in online. You are verified by face + "
                   "fingerprint at your exam centre. Enrol at /candidate-enrolment.",
        )

    else:
        # Setter/Admin: verify password
        if not request.password or not user.password_hash:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Password required for setter/admin login",
            )

        if not verify_password(request.password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials",
            )

    # Password verified — now issue a REAL one-time code over whichever channel
    # this account actually has. No JWT is returned here; the caller must
    # complete /auth/verify-otp.
    #
    # This used to demand `user.phone` and 400 without it. Setter
    # self-registration takes an email and treats phone as optional, so every
    # self-registered setter hit that wall: approved by an admin, then
    # permanently unable to log in because the second factor had no way to
    # reach them. SMS stays preferred when both a phone and a gateway exist;
    # email is the fallback that makes email-only accounts work at all.
    settings = get_settings()
    can_sms = bool(user.phone) and sms_configured()
    can_email = bool(user.email) and email_configured()

    if not user.phone and not user.email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This account has neither a phone number nor an email address, so no one-time code can be delivered.",
        )
    # In production, refusing to authenticate beats handing out a code nobody
    # can receive — or worse, printing it in the response.
    if not can_sms and not can_email and not settings.DEBUG:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "reason": "OTP_DELIVERY_NOT_CONFIGURED",
                "message": "No SMS or email gateway is configured on this server, so a one-time code cannot be delivered. Set SMTP_HOST/SMTP_FROM (or Twilio credentials) and try again.",
            },
        )

    channel = "sms" if can_sms else "email" if can_email else "dev"
    code = f"{secrets.randbelow(1_000_000):06d}"
    challenge = OtpChallenge(
        id=str(uuid4()),
        user_id=user.id,
        code_hash=hashlib.sha256(code.encode()).hexdigest(),
        phone=user.phone,
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=settings.OTP_TTL_SECONDS),
        delivery=channel,
    )
    db.add(challenge)
    await db.commit()

    delivered = "dev"
    if channel == "sms":
        try:
            await send_sms(user.phone, f"Your CryptoExam login code is {code}. Valid for 5 minutes.")
            delivered = "sms"
        except Exception as exc:  # gateway hiccup — surface it, don't fake success
            logger.warning("OTP SMS delivery failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Could not deliver the OTP SMS. Please try again.",
            )
    elif channel == "email":
        try:
            await send_otp_email(user.email, code, settings.OTP_TTL_SECONDS)
            delivered = "email"
        except Exception as exc:
            logger.warning("OTP email delivery failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Could not deliver the one-time code by email. Please try again.",
            )

    logger.info(
        f"OTP issued: user={str(user.id)[:8]}..., role={user.role.value}, "
        f"delivery={delivered}, to={mask_phone(user.phone) if delivered == 'sms' else mask_email(user.email)}, "
        f"ip={req.client.host}"
    )

    resp: dict = {
        "otp_required": True,
        "challenge_id": challenge.id,
        "delivery": delivered,
        "sent_to": mask_phone(user.phone) if delivered == "sms" else mask_email(user.email),
        # Kept for the existing admin login UI, which reads phone_masked.
        "phone_masked": mask_phone(user.phone),
        "ttl_seconds": settings.OTP_TTL_SECONDS,
    }
    # Dev convenience ONLY, gated entirely on DEBUG (false in production).
    #
    # Returned whatever the channel, not just when no gateway exists. The
    # seeded demo accounts use unroutable addresses like admin@cryptoexam.dev,
    # so the moment real SMTP is configured their codes are posted into the
    # void — and the developer who just set up email correctly is locked out of
    # their own admin console by that success. With DEBUG off this key is never
    # present, so production is unaffected.
    if settings.DEBUG:
        resp["dev_code"] = code
        if delivered != "dev":
            logger.warning(
                "DEBUG is on, so the OTP is also being returned in the API response. "
                "Turn DEBUG off before exposing this server to anyone."
            )
    return resp


@router.post(
    "/verify-otp",
    response_model=TokenResponse,
    responses={401: {"model": ErrorResponse}},
    summary="Verify login OTP",
    description="Confirm the one-time code sent to the registered phone and receive a JWT.",
)
async def verify_otp(
    body: VerifyOtpRequest,
    req: Request,
    db: AsyncSession = Depends(get_db),
):
    settings = get_settings()
    challenge = (await db.execute(
        select(OtpChallenge).where(OtpChallenge.id == body.challenge_id)
    )).scalar_one_or_none()

    if not challenge or challenge.consumed:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or used code")

    now = datetime.now(timezone.utc)
    expires = challenge.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if now > expires:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Code expired — request a new one")

    if challenge.attempts >= settings.OTP_MAX_ATTEMPTS:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many attempts — request a new code")

    challenge.attempts += 1
    if hashlib.sha256(body.code.strip().encode()).hexdigest() != challenge.code_hash:
        await db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect code")

    challenge.consumed = True
    user = (await db.execute(select(User).where(User.id == challenge.user_id))).scalar_one_or_none()
    if not user:
        await db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account not found")

    token, token_expires = create_access_token(user_id=user.id, role=user.role, email=user.email)
    await db.commit()

    logger.info(f"OTP verified, login complete: user={str(user.id)[:8]}..., role={user.role.value}")
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_at=token_expires,
        role=user.role,
        user_id=user.id,
    )


@router.post(
    "/register",
    response_model=UserProfile,
    status_code=status.HTTP_201_CREATED,
    summary="Register User",
    description="Register a new setter or admin account. Requires ADMIN role.",
)
async def register(
    full_name: str,
    email: str,
    password: str,
    role: str = "SETTER",
    req: Request = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.ADMIN)),
):
    """Register a new setter or admin. Only admins can create accounts."""
    # Check if email already exists
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

    user_role = UserRole(role.upper())
    if user_role == UserRole.CANDIDATE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Candidates are enrolled through the exam enrollment flow, not registration",
        )

    user = User(
        email=email,
        full_name=full_name,
        role=user_role,
        password_hash=hash_password(password),
        dpdp_consent=True,
        dpdp_consent_at=datetime.now(timezone.utc),
        dpdp_consent_ip=req.client.host if req else None,
        dpdp_consent_version="1.0",
    )

    db.add(user)
    await db.flush()

    logger.info(f"User registered: {email}, role={role}, by admin={current_user['user_id']}")

    return UserProfile.model_validate(user)


class SetterSignup(BaseModel):
    full_name: str = Field(min_length=2, max_length=255)
    email: str = Field(min_length=4, max_length=255)
    password: str = Field(min_length=8, max_length=128)
    institution: str | None = None
    phone: str | None = None


@router.post(
    "/setter-signup",
    status_code=status.HTTP_201_CREATED,
    summary="Public setter self-registration (pending admin approval)",
    description="A prospective question-setter applies for access. Creates an "
                "INACTIVE setter account; an admin approves it before first login "
                "(login is gated on is_active). No web role is granted self-serve.",
)
async def setter_signup(
    body: SetterSignup,
    req: Request = None,
    db: AsyncSession = Depends(get_db),
):
    email = body.email.strip().lower()
    existing = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    user = User(
        email=email,
        full_name=body.full_name.strip(),
        role=UserRole.SETTER,
        password_hash=hash_password(body.password),
        institution=(body.institution or None),
        phone=(body.phone or None),
        is_active=False,  # pending admin approval — login refuses inactive users
        dpdp_consent=True,
        dpdp_consent_at=datetime.now(timezone.utc),
        dpdp_consent_ip=req.client.host if req else None,
        dpdp_consent_version="1.0",
    )
    db.add(user)
    await db.commit()

    logger.info(f"Setter self-registration (pending approval): {email}")
    return {
        "ok": True,
        "status": "PENDING_APPROVAL",
        "message": "Your setter account is pending admin approval. "
                   "You'll be able to sign in once an administrator approves it.",
    }


@router.get(
    "/me",
    response_model=UserProfile,
    summary="Current User Profile",
)
async def get_profile(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the authenticated user's profile."""
    stmt = select(User).where(User.id == current_user["user_id"])
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    return UserProfile.model_validate(user)


# NOTE: `POST /auth/seed-admin` used to live here. It created
# admin@cryptoexam.dev / CryptoExam2025! — a hardcoded-password ADMIN, plus a
# SETTER — and returned a signed JWT for it immediately, gated only by
# `if not DEBUG`. The deployed environment runs with DEBUG=true, so it was
# reachable in production: anyone who found the path could mint an
# administrator and be handed a token for it.
#
# It is deleted rather than re-gated. The seeder already creates an
# administrator from operator-supplied SEED_ADMIN_* values, so this was a
# second and weaker way in to the same place, and a credential factory whose
# password is written in the source is not something to keep behind a flag.
from app.config import get_settings
