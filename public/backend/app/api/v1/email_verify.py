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
from app.models import EmailOtpChallenge, EmailVerificationGrant, User, UserRole
from app.config import get_settings
from app.services.auth import require_role
from app.services.email import send_email, smtp_status

logger = logging.getLogger(__name__)
router = APIRouter()

# Deliberately conservative: this list is a speed bump against the laziest
# abuse, not a boundary — the OTP is the boundary. A false positive rejects a
# real registrar, so nothing ambiguous belongs in it.
DISPOSABLE_DOMAINS = {
    "mailinator.com", "yopmail.com", "yopmail.fr", "guerrillamail.com",
    "guerrillamail.net", "sharklasers.com", "10minutemail.com", "10minutemail.net",
    "tempmail.com", "dispostable.com", "temp-mail.org", "maildrop.cc",
    "throwawaymail.com", "trashmail.com", "getnada.com", "nada.email",
    "fakeinbox.com", "mailnesia.com", "spamgourmet.com", "mytemp.email",
    "moakt.com", "emailondeck.com", "tempmailo.com", "mohmal.com",
    "grr.la", "spam4.me", "discard.email",
}

# How many codes one source IP may trigger in an hour, across ALL addresses.
# The existing per-address limits stop one mailbox being flooded; they do not
# stop one caller walking a list of a thousand addresses, because each address
# is then only asked for once. That is the shape that makes this endpoint a
# reflector — it sends OUR mail to people who never asked, on someone else's
# say-so — so the two limits are both needed and neither replaces the other.
MAX_SENDS_PER_IP_PER_HOUR = 20


def domain_accepts_mail(email: str) -> bool:
    """Does any host accept mail for this domain? One DNS lookup.

    This is what separates `arjun@yourorganisaton.in` — a typo nobody will ever
    receive — from a real mailbox host, and it rejects it in the form rather
    than a week later when no reply has arrived. It cannot tell whether the
    individual mailbox exists: VRFY is disabled everywhere and catch-all domains
    accept anything. That remaining gap is exactly what the OTP closes, which is
    why both checks are here and neither is sufficient alone.

    THE DISTINCTION THAT MATTERS IS DEFINITIVE-NO versus COULD-NOT-ASK, and it
    is the whole reason this does not simply call `validate_email(...,
    check_deliverability=True)`. That helper reports both through one exception
    type, so a resolver timeout — a restricted-egress container, a DNS blip —
    would be indistinguishable from a domain that genuinely accepts no mail, and
    the endpoint would refuse every university on earth until someone noticed.

    So: NXDOMAIN and an empty MX-and-address set are refusals. Timeouts and
    resolver failures are not. Failing open there costs nothing, because the
    code still has to be read out of the real mailbox afterwards.
    """
    if not getattr(get_settings(), "EMAIL_CHECK_DELIVERABILITY", True):
        return True

    domain = email.rpartition("@")[2]
    try:
        import dns.exception
        import dns.resolver
    except ImportError:            # dependency absent — do not block on it
        return True

    resolver = dns.resolver.Resolver()
    resolver.lifetime = 5.0
    resolver.timeout = 5.0

    try:
        answers = resolver.resolve(domain, "MX")
        # A single "." MX is the RFC 7505 null MX: the domain is explicitly
        # saying it accepts no mail at all.
        hosts = [str(r.exchange).rstrip(".") for r in answers]
        if hosts and any(h for h in hosts):
            return True
    except dns.resolver.NXDOMAIN:
        return False               # the domain does not exist — definitive
    except dns.resolver.NoAnswer:
        pass                       # no MX; an address record still implies one
    except (dns.exception.Timeout, dns.resolver.NoNameservers):
        logger.warning("Deliverability check unavailable for %s (resolver)", domain)
        return True                # could not ask — do not punish the address
    except Exception as exc:
        logger.warning("Deliverability check errored for %s: %s", domain, exc)
        return True

    # No MX record. RFC 5321 §5.1 says fall back to the address record, so a
    # domain with only an A/AAAA still accepts mail.
    for record in ("A", "AAAA"):
        try:
            if resolver.resolve(domain, record):
                return True
        except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
            continue
        except Exception:
            return True            # could not ask
    return False


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

    # Adjudicate the address BEFORE spending a send, so a typo comes back as a
    # message against the email field instead of a code that goes nowhere.
    if not domain_accepts_mail(email):
        raise HTTPException(
            status_code=400,
            detail=f"'{domain}' does not appear to accept email. Please check the spelling.",
        )

    settings = get_settings()
    now = datetime.now(timezone.utc)
    client_ip = req.client.host if req.client else None

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
        raise HTTPException(status_code=429, detail="Maximum OTP resend attempts reached. Please restart the registration process.")

    # Per-SOURCE, across every address. The two limits above are per (email,
    # purpose) and so are silent about a caller that asks for one code each for
    # a thousand different people.
    if client_ip:
        ip_stmt = select(EmailOtpChallenge).where(
            EmailOtpChallenge.request_ip == client_ip,
            EmailOtpChallenge.created_at >= now - timedelta(hours=1),
        )
        ip_count = len((await db.execute(ip_stmt)).scalars().all())
        if ip_count >= MAX_SENDS_PER_IP_PER_HOUR:
            logger.warning(
                "Email OTP rate limit hit for ip=%s (%s sends in the last hour)",
                client_ip, ip_count,
            )
            raise HTTPException(
                status_code=429,
                detail="Too many verification requests from this connection. Please try again later.",
            )

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
        request_ip=client_ip
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
        if res.delivery == "dev":
            logger.info("DEV MODE OTP PREVIEW:\n%s", res.dev_preview)
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


@router.get(
    "/health",
    summary="What SMTP configuration this process actually resolved (ADMIN)",
    description=(
        "Masked diagnostic for the deployed environment: which host, port and TLS "
        "mode were resolved, whether a password is present, and whether the From "
        "address is set. No secret is returned. ADMIN only — it names the mail "
        "host and the sending account's domain."
    ),
)
async def email_health(
    current_user: dict = Depends(require_role(UserRole.ADMIN, UserRole.SYSTEM_ADMIN)),
):
    """Answer 'why is the code not arriving?' from inside the process.

    Every cause below is invisible to the client, which is why this endpoint
    exists rather than a longer error message: the request fails identically
    whether the host is wrong, the password is absent, or the sender is
    unauthorised.
    """
    status_report = smtp_status()
    hints: list[str] = []

    if not status_report["configured"]:
        missing = []
        if not status_report["host"]:
            missing.append("SMTP_HOST")
        if not status_report["from_present"]:
            missing.append("SMTP_FROM")
        hints.append(f"Not configured — {' and '.join(missing)} empty.")

    if status_report["configured"] and not status_report["password_present"]:
        hints.append(
            "No SMTP_PASSWORD. Fine for an IP-authenticated relay; every hosted "
            "provider will reject the login without one."
        )

    if status_report["password_had_spaces"]:
        hints.append(
            "SMTP_PASSWORD contained spaces — Google displays app passwords in "
            "four groups. They are stripped before use, so this is informational."
        )

    if status_report["port"] not in (25, 465, 587, 2525):
        hints.append(
            f"Port {status_report['port']} is unusual: 587 for STARTTLS, 465 for "
            "implicit TLS."
        )

    settings = get_settings()
    if settings.DEBUG and getattr(settings, "EMAIL_OTP_DEV_MODE", False):
        hints.append(
            "DEBUG and EMAIL_OTP_DEV_MODE are both on, so a failed send degrades "
            "to a dev-mode preview instead of raising. Turn DEBUG off in "
            "production or a delivery failure will look like a success."
        )

    return {"smtp": status_report, "hints": hints}
