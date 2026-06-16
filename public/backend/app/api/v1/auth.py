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
from sqlalchemy import select
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
    # Find user by email or full name
    stmt = select(User).where(
        (User.email == request.identifier) | (User.full_name == request.identifier)
    )
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    # Candidate identity is their enrolment roll number — resolve it to the user.
    # Roll numbers are not guaranteed unique across enrolments, so take the first.
    if not user:
        enr = (await db.execute(
            select(Enrollment).where(Enrollment.roll_number == request.identifier).limit(1)
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

    # Password verified — now issue a REAL one-time code to the registered phone.
    # No JWT is returned here; the caller must complete /auth/verify-otp.
    settings = get_settings()
    if not user.phone:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No phone number registered on this account. An OTP cannot be sent.",
        )

    code = f"{secrets.randbelow(1_000_000):06d}"
    challenge = OtpChallenge(
        id=str(uuid4()),
        user_id=user.id,
        code_hash=hashlib.sha256(code.encode()).hexdigest(),
        phone=user.phone,
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=settings.OTP_TTL_SECONDS),
        delivery="sms" if sms_configured() else "dev",
    )
    db.add(challenge)
    await db.commit()

    delivered = "dev"
    if sms_configured():
        try:
            await send_sms(user.phone, f"Your CryptoExam login code is {code}. Valid for 5 minutes.")
            delivered = "sms"
        except Exception as exc:  # gateway hiccup — surface it, don't fake success
            logger.warning("OTP SMS delivery failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Could not deliver the OTP SMS. Please try again.",
            )

    logger.info(
        f"OTP issued: user={str(user.id)[:8]}..., role={user.role.value}, "
        f"delivery={delivered}, phone={mask_phone(user.phone)}, ip={req.client.host}"
    )

    resp: dict = {
        "otp_required": True,
        "challenge_id": challenge.id,
        "phone_masked": mask_phone(user.phone),
        "delivery": delivered,
        "ttl_seconds": settings.OTP_TTL_SECONDS,
    }
    # Dev convenience ONLY: with no SMS gateway configured AND DEBUG on, return the
    # code so the flow is testable. Never happens once Twilio creds are set.
    if delivered == "dev" and settings.DEBUG:
        resp["dev_code"] = code
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


@router.post(
    "/seed-admin",
    response_model=TokenResponse,
    summary="Seed Admin (Dev Only)",
    description="Create a seed admin account for development. Disabled in production.",
    include_in_schema=True,
)
async def seed_admin(
    req: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Create a seed admin account for development/demo.
    Returns a JWT token for immediate use.

    Email: admin@cryptoexam.dev
    Password: CryptoExam2025!
    """
    settings_obj = get_settings()
    if not settings_obj.DEBUG:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Seed admin disabled in production",
        )

    # Check if seed admin exists
    existing = await db.execute(
        select(User).where(User.email == "admin@cryptoexam.dev")
    )
    user = existing.scalar_one_or_none()

    if not user:
        user = User(
            email="admin@cryptoexam.dev",
            full_name="CryptoExam Admin",
            role=UserRole.ADMIN,
            password_hash=hash_password("CryptoExam2025!"),
            dpdp_consent=True,
            dpdp_consent_at=datetime.now(timezone.utc),
            dpdp_consent_ip=req.client.host,
            dpdp_consent_version="1.0",
            state="Delhi (NCT)",
        )
        db.add(user)
        await db.flush()
        logger.info("Seed admin created: admin@cryptoexam.dev")

    # Also create a seed setter
    existing_setter = await db.execute(
        select(User).where(User.email == "setter@cryptoexam.dev")
    )
    if not existing_setter.scalar_one_or_none():
        setter = User(
            email="setter@cryptoexam.dev",
            full_name="Dr. Priya Sharma",
            name_hi="डॉ. प्रिया शर्मा",
            role=UserRole.SETTER,
            password_hash=hash_password("CryptoExam2025!"),
            dpdp_consent=True,
            dpdp_consent_at=datetime.now(timezone.utc),
            dpdp_consent_ip=req.client.host,
            dpdp_consent_version="1.0",
            institution="Indian Institute of Technology Delhi",
            state="Delhi (NCT)",
        )
        db.add(setter)
        logger.info("Seed setter created: setter@cryptoexam.dev")

    token, expires = create_access_token(
        user_id=user.id,
        role=user.role,
        email=user.email,
    )

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_at=expires,
        role=user.role,
        user_id=user.id,
    )


# Import settings for seed endpoint
from app.config import get_settings
