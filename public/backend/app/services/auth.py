"""
CryptoExam Core — JWT RS256 Authentication Service
§ 8 — Role-based access control with RS256 asymmetric JWT.

Why RS256 instead of HS256:
  - Private key signs tokens (server only)
  - Public key verifies tokens (can be shared with microservices)
  - Key rotation without invalidating all tokens
  - Standard for production zero-trust systems

Roles:
  CANDIDATE — Can only access exam session endpoints
  SETTER    — Can create exams, generate questions, lock papers
  ADMIN     — Full access + emergency controls + 2-admin co-signature
"""

import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from uuid import UUID

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.config import get_settings
from app.database import get_db, AsyncSession
from app.models import User, UserRole

logger = logging.getLogger(__name__)
settings = get_settings()

# ── JWT Bearer ──
security = HTTPBearer()


def _load_key(path: str) -> Optional[str]:
    """Load PEM key from file, or return None if not found."""
    p = Path(path)
    if p.exists():
        return p.read_text()
    return None


def _get_private_key() -> str:
    """Load RS256 private key for token signing."""
    # Prod hosts have an ephemeral filesystem, so prefer an env-provided PEM
    # (set once as a secret) — otherwise keys regenerate per restart and every
    # session breaks. `\n` is allowed so the PEM can live on one env line.
    env_pem = os.getenv("JWT_PRIVATE_KEY_PEM")
    if env_pem:
        return env_pem.replace("\\n", "\n")
    key = _load_key(settings.JWT_PRIVATE_KEY_PATH)
    if key:
        return key
    # Fallback: generate ephemeral keys for development
    logger.warning("No RS256 private key found — generating ephemeral key pair (dev only)")
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives import serialization
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()


def _get_public_key() -> str:
    """Load RS256 public key for token verification."""
    env_pem = os.getenv("JWT_PUBLIC_KEY_PEM")
    if env_pem:
        return env_pem.replace("\\n", "\n")
    key = _load_key(settings.JWT_PUBLIC_KEY_PATH)
    if key:
        return key
    # Derive from the *cached* private key — calling the uncached _get_private_key()
    # here would mint a second ephemeral keypair, so the verify key would never
    # match the sign key and every token would fail verification (dev fallback).
    private_pem = get_private_key()
    from cryptography.hazmat.primitives.serialization import load_pem_private_key
    from cryptography.hazmat.primitives import serialization
    private_key = load_pem_private_key(private_pem.encode(), password=None)
    return private_key.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()


# Cache keys at module level
_private_key_cache: Optional[str] = None
_public_key_cache: Optional[str] = None


def get_private_key() -> str:
    global _private_key_cache
    if _private_key_cache is None:
        _private_key_cache = _get_private_key()
    return _private_key_cache


def get_public_key() -> str:
    global _public_key_cache
    if _public_key_cache is None:
        _public_key_cache = _get_public_key()
    return _public_key_cache


# ═══════════════════════════════════════════════════════
# Token Operations
# ═══════════════════════════════════════════════════════

def create_access_token(
    user_id: UUID,
    role: UserRole,
    email: Optional[str] = None,
) -> tuple[str, datetime]:
    """
    Create a signed RS256 JWT access token.

    Returns:
        Tuple of (token_string, expiry_datetime).
    """
    now = datetime.now(timezone.utc)
    expires = now + timedelta(hours=settings.JWT_EXPIRY_HOURS)

    payload = {
        "sub": str(user_id),
        "role": role.value,
        "email": email or "",
        "iat": now,
        "exp": expires,
        "iss": "cryptoexam-core",
    }

    token = jwt.encode(
        payload,
        get_private_key(),
        algorithm=settings.JWT_ALGORITHM,
    )

    logger.info(f"Token created: user={str(user_id)[:8]}..., role={role.value}, expires={expires.isoformat()}")
    return token, expires


def verify_token(token: str) -> dict:
    """
    Verify and decode a JWT token.

    Returns:
        Decoded payload dict.

    Raises:
        HTTPException 401 if token is invalid or expired.
    """
    try:
        payload = jwt.decode(
            token,
            get_public_key(),
            algorithms=[settings.JWT_ALGORITHM],
            issuer="cryptoexam-core",
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
        )
    except jwt.InvalidTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {e}",
        )


# ═══════════════════════════════════════════════════════
# Password Operations
# ═══════════════════════════════════════════════════════

def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a password against its bcrypt hash."""
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


# ═══════════════════════════════════════════════════════
# FastAPI Dependencies
# ═══════════════════════════════════════════════════════

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    """
    FastAPI dependency: extract and verify the current user from JWT.

    Returns:
        Dict with user_id, role, email from the token payload.
    """
    payload = verify_token(credentials.credentials)
    return {
        # id columns are String(36) (dashed UUID strings) for SQLite; return a
        # normalised dashed string so `Model.id == user_id` matches. UUID() still
        # validates the token's sub is a well-formed UUID.
        "user_id": str(UUID(payload["sub"])),
        "role": UserRole(payload["role"]),
        "email": payload.get("email", ""),
    }


def require_role(*allowed_roles: UserRole):
    """
    FastAPI dependency factory: restrict endpoint to specific roles.

    Usage:
        @router.get("/admin/dashboard")
        async def dashboard(user = Depends(require_role(UserRole.ADMIN))):
            ...
    """
    async def role_checker(
        current_user: dict = Depends(get_current_user),
    ) -> dict:
        if current_user["role"] not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role {current_user['role'].value} not authorized. "
                       f"Required: {[r.value for r in allowed_roles]}",
            )
        return current_user
    return role_checker
