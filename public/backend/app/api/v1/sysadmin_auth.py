"""
Tier-0 System Admin enrolment and login.

THE RULES THIS ENFORCES
-----------------------
  1. Enrolment is possible ONLY from an operator-controlled address
     (SYSTEM_ADMIN_ALLOWED_IPS). From anywhere else the endpoint 403s and says
     which address it saw, so the operator can allowlist themselves.
  2. Enrolment stores REAL authentication material: a WebAuthn credential
     public key bound to this machine's fingerprint sensor, plus the SHA-256 of
     a face descriptor. Neither is a placeholder and neither can be replayed
     from the database — the private key never leaves the secure element.
  3. Login REQUIRES a fingerprint assertion. Password and OTP alone do not
     produce a tier-0 token. `require_user_verification=True` means the sensor
     must report that the fingerprint actually matched, not merely that a device
     was plugged in.

Enrolment is also one-shot by default: once a System Admin exists, the endpoint
closes. A second tier-0 account has to be created deliberately by an existing
one, not by whoever reaches the URL first.
"""
from __future__ import annotations

import hashlib
import ipaddress
import logging
import secrets
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models import SystemAdminCredential, User, UserRole
from app.services.auth import create_access_token, hash_password, verify_password
from app.services.webauthn import (
    WebAuthnError,
    b64url_encode,
    parse_registration_public_key,
    verify_assertion,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# Challenges are short-lived and single-use. In-process is correct here: a
# tier-0 login happens from one sealed workstation, not across a fleet.
_CHALLENGE_TTL = timedelta(minutes=5)
_challenges: dict[str, tuple[str, datetime]] = {}   # challenge -> (purpose, issued)


def _issue_challenge(purpose: str) -> str:
    now = datetime.now(timezone.utc)
    for c, (_, issued) in list(_challenges.items()):
        if now - issued > _CHALLENGE_TTL:
            _challenges.pop(c, None)
    challenge = b64url_encode(secrets.token_bytes(32))
    _challenges[challenge] = (purpose, now)
    return challenge


def _consume_challenge(challenge: str, purpose: str) -> bool:
    """One-shot: the challenge is removed whether or not it was valid."""
    rec = _challenges.pop(challenge, None)
    if not rec:
        return False
    got_purpose, issued = rec
    return got_purpose == purpose and datetime.now(timezone.utc) - issued <= _CHALLENGE_TTL


def _client_ip(req: Request) -> str:
    """
    The address we will judge against the allowlist.

    Taken from the connection. `X-Forwarded-For` is honoured ONLY when the
    immediate peer is loopback — i.e. a reverse proxy we run — because a header
    anyone can set is not an access control.
    """
    peer = req.client.host if req.client else ""
    try:
        peer_is_local = ipaddress.ip_address(peer).is_loopback
    except ValueError:
        peer_is_local = False

    if peer_is_local:
        fwd = req.headers.get("x-forwarded-for", "")
        if fwd:
            return fwd.split(",")[0].strip()
    return peer


def _ip_allowed(ip: str) -> bool:
    """
    Match against SYSTEM_ADMIN_ALLOWED_IPS — comma-separated addresses or CIDR
    ranges. Empty means enrolment is DISABLED, not open: failing closed is the
    only safe default for the tier that can decrypt answers.
    """
    raw = (get_settings().SYSTEM_ADMIN_ALLOWED_IPS or "").strip()
    if not raw:
        return False
    try:
        candidate = ipaddress.ip_address(ip)
    except ValueError:
        return False
    for entry in (e.strip() for e in raw.split(",") if e.strip()):
        try:
            if "/" in entry:
                if candidate in ipaddress.ip_network(entry, strict=False):
                    return True
            elif candidate == ipaddress.ip_address(entry):
                return True
        except ValueError:
            logger.warning("Ignoring malformed SYSTEM_ADMIN_ALLOWED_IPS entry %r", entry)
    return False


async def _existing_sysadmin(db: AsyncSession) -> User | None:
    return (await db.execute(
        select(User).where(User.role == UserRole.SYSTEM_ADMIN).limit(1)
    )).scalar_one_or_none()


# ═══════════════════════════════════════════════════════════════════════════
# Status — so the UI can explain itself instead of just failing
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/status", summary="Whether tier-0 enrolment is currently possible")
async def sysadmin_status(request: Request, db: AsyncSession = Depends(get_db)):
    ip = _client_ip(request)
    allowed = _ip_allowed(ip)
    existing = await _existing_sysadmin(db)
    configured = bool((get_settings().SYSTEM_ADMIN_ALLOWED_IPS or "").strip())
    return {
        "your_ip": ip,
        "enrolment_open": allowed and existing is None,
        "ip_allowed": allowed,
        "allowlist_configured": configured,
        "already_enrolled": existing is not None,
        "hint": (
            "A System Admin already exists; enrolment is closed."
            if existing is not None
            else "Set SYSTEM_ADMIN_ALLOWED_IPS to enable enrolment — it is disabled by default."
            if not configured
            else f"Add {ip} to SYSTEM_ADMIN_ALLOWED_IPS to enrol from this machine."
            if not allowed
            else "Enrolment is open from this machine."
        ),
    }


# ═══════════════════════════════════════════════════════════════════════════
# Enrolment
# ═══════════════════════════════════════════════════════════════════════════

class RegisterChallengeRequest(BaseModel):
    email: EmailStr


@router.post("/register/challenge", summary="Begin tier-0 enrolment (IP-gated)")
async def register_challenge(
    body: RegisterChallengeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    ip = _client_ip(request)
    if not _ip_allowed(ip):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "reason": "IP_NOT_ALLOWED",
                "your_ip": ip,
                "message": "System Admin enrolment is restricted to approved addresses. Add this address to SYSTEM_ADMIN_ALLOWED_IPS on the server.",
            },
        )
    if await _existing_sysadmin(db):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"reason": "ALREADY_ENROLLED", "message": "A System Admin already exists."},
        )

    settings = get_settings()
    challenge = _issue_challenge("register")
    # `userHandle` must not be an email or anything else identifying (spec
    # guidance) — a random id is stored client-side by the authenticator.
    return {
        "challenge": challenge,
        "rp": {"id": settings.WEBAUTHN_RP_ID, "name": "CryptoExam Core"},
        "user": {
            "id": b64url_encode(secrets.token_bytes(16)),
            "name": body.email,
            "displayName": "System Administrator",
        },
        "pubKeyCredParams": [{"type": "public-key", "alg": -7}, {"type": "public-key", "alg": -257}],
        "authenticatorSelection": {
            # Platform authenticator = the fingerprint sensor on THIS machine.
            "authenticatorAttachment": "platform",
            "residentKey": "required",
            "userVerification": "required",
        },
        "timeout": 120_000,
        "attestation": "none",
    }


class RegisterRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(..., min_length=2, max_length=200)
    password: str = Field(..., min_length=12, max_length=256)
    challenge: str
    credential_id: str
    public_key_spki: str          # base64url SPKI DER from getPublicKey()
    client_data_json: str
    aaguid: str | None = None
    face_descriptor_hash: str | None = Field(None, min_length=64, max_length=64)


@router.post("/register", status_code=201, summary="Complete tier-0 enrolment (IP-gated)")
async def register(body: RegisterRequest, request: Request, db: AsyncSession = Depends(get_db)):
    ip = _client_ip(request)
    if not _ip_allowed(ip):
        raise HTTPException(status_code=403, detail={"reason": "IP_NOT_ALLOWED", "your_ip": ip})
    if await _existing_sysadmin(db):
        raise HTTPException(status_code=409, detail={"reason": "ALREADY_ENROLLED"})
    if not _consume_challenge(body.challenge, "register"):
        raise HTTPException(status_code=400, detail={"reason": "CHALLENGE_INVALID_OR_EXPIRED"})

    # A tier-0 account with no fingerprint could never log in (login demands an
    # assertion), so refuse the enrolment rather than create a dead account.
    try:
        spki = parse_registration_public_key(body.public_key_spki)
    except WebAuthnError as exc:
        raise HTTPException(status_code=400, detail={"reason": "BAD_CREDENTIAL", "message": str(exc)})

    if (await db.execute(select(User).where(User.email == str(body.email).lower()))).scalar_one_or_none():
        raise HTTPException(status_code=409, detail={"reason": "EMAIL_IN_USE"})

    user = User(
        id=str(uuid4()),
        email=str(body.email).lower(),
        full_name=body.full_name.strip(),
        role=UserRole.SYSTEM_ADMIN,
        password_hash=hash_password(body.password),
        is_active=True,
        # Enrolling in person, from an approved machine, IS the consent event.
        dpdp_consent=True,
        dpdp_consent_at=datetime.now(timezone.utc),
        dpdp_consent_ip=ip,
        dpdp_consent_version="1.0",
    )
    db.add(user)
    await db.flush()

    db.add(SystemAdminCredential(
        id=str(uuid4()),
        user_id=user.id,
        credential_id=body.credential_id,
        public_key_spki=spki,
        sign_count=0,
        aaguid=body.aaguid,
        face_embedding_hash=body.face_descriptor_hash,
        registered_ip=ip,
    ))

    logger.warning(
        "SYSTEM ADMIN ENROLLED: %s from %s (face_hash=%s)",
        user.email, ip, "yes" if body.face_descriptor_hash else "no",
    )
    return {
        "ok": True,
        "user_id": str(user.id),
        "message": "System Admin enrolled. Sign-in from now on requires this machine's fingerprint.",
    }


# ═══════════════════════════════════════════════════════════════════════════
# Login — password, then a fingerprint assertion. Both, always.
# ═══════════════════════════════════════════════════════════════════════════

class LoginChallengeRequest(BaseModel):
    email: EmailStr
    password: str


@router.post("/login/challenge", summary="Step 1 — password, returns a WebAuthn challenge")
async def login_challenge(body: LoginChallengeRequest, db: AsyncSession = Depends(get_db)):
    user = (await db.execute(
        select(User).where(User.email == str(body.email).lower(), User.role == UserRole.SYSTEM_ADMIN)
    )).scalar_one_or_none()

    # One message for "no such account" and "wrong password" — a distinct error
    # would tell an attacker which tier-0 email exists.
    invalid = HTTPException(status_code=401, detail={"reason": "INVALID_CREDENTIALS"})
    if not user or not user.password_hash or not verify_password(body.password, user.password_hash):
        raise invalid
    if not user.is_active:
        raise HTTPException(status_code=403, detail={"reason": "ACCOUNT_DISABLED"})

    cred = (await db.execute(
        select(SystemAdminCredential).where(
            SystemAdminCredential.user_id == user.id,
            SystemAdminCredential.revoked_at.is_(None),
        )
    )).scalar_one_or_none()
    if not cred:
        # Fail closed. Falling back to password-only here would quietly undo
        # the entire point of the tier.
        raise HTTPException(
            status_code=403,
            detail={
                "reason": "NO_FINGERPRINT_ENROLLED",
                "message": "This account has no enrolled fingerprint, so it cannot sign in. Re-enrol from an approved machine.",
            },
        )

    return {
        "challenge": _issue_challenge("login"),
        "rpId": get_settings().WEBAUTHN_RP_ID,
        "allowCredentials": [{"type": "public-key", "id": cred.credential_id}],
        "userVerification": "required",
        "timeout": 120_000,
    }


class LoginRequest(BaseModel):
    email: EmailStr
    challenge: str
    credential_id: str
    client_data_json: str
    authenticator_data: str
    signature: str


@router.post("/login", summary="Step 2 — fingerprint assertion, returns the tier-0 token")
async def login(body: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    settings = get_settings()
    if not _consume_challenge(body.challenge, "login"):
        raise HTTPException(status_code=400, detail={"reason": "CHALLENGE_INVALID_OR_EXPIRED"})

    user = (await db.execute(
        select(User).where(User.email == str(body.email).lower(), User.role == UserRole.SYSTEM_ADMIN)
    )).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail={"reason": "INVALID_CREDENTIALS"})

    cred = (await db.execute(
        select(SystemAdminCredential).where(
            SystemAdminCredential.user_id == user.id,
            SystemAdminCredential.credential_id == body.credential_id,
            SystemAdminCredential.revoked_at.is_(None),
        )
    )).scalar_one_or_none()
    if not cred:
        raise HTTPException(status_code=401, detail={"reason": "UNKNOWN_CREDENTIAL"})

    try:
        result = verify_assertion(
            client_data_json_b64=body.client_data_json,
            authenticator_data_b64=body.authenticator_data,
            signature_b64=body.signature,
            expected_challenge=body.challenge,
            expected_origins=[o.strip() for o in settings.WEBAUTHN_ORIGINS.split(",") if o.strip()],
            expected_rp_id=settings.WEBAUTHN_RP_ID,
            public_key_spki=cred.public_key_spki,
            stored_sign_count=cred.sign_count,
            require_user_verification=True,
        )
    except WebAuthnError as exc:
        logger.warning("Tier-0 fingerprint assertion REJECTED for %s: %s", user.email, exc)
        raise HTTPException(
            status_code=401,
            detail={"reason": "FINGERPRINT_VERIFICATION_FAILED", "message": str(exc)},
        )

    cred.sign_count = result.new_sign_count
    cred.last_used_at = datetime.now(timezone.utc)

    logger.warning("SYSTEM ADMIN LOGIN: %s from %s (uv=%s)", user.email, _client_ip(request), result.user_verified)
    token, expires_at = create_access_token(user.id, user.role, user.email)
    return {
        "access_token": token,
        "expires_at": expires_at.isoformat(),
        "token_type": "bearer",
        "user": {"id": str(user.id), "email": user.email, "role": user.role.value, "full_name": user.full_name},
    }
