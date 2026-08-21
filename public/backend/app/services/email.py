"""
CryptoExam Core — Shared Email Service (Problem 0.5)

A single, testable email-sending code path consumed by:
  - Candidate enrolment confirmation (Problem 1)
  - Contact form submission (Problem 2)

Real delivery: set SMTP_HOST / SMTP_USER / SMTP_PASS in the environment.

Dev-mode (no SMTP configured): the composed message is returned in the API
response, clearly flagged as delivery="dev", mirroring the existing SMS OTP
dev-mode pattern in app/services/sms.py.

Never logs email addresses or content at INFO level. Only masked recipients.
"""
import logging
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from functools import lru_cache

from app.config import get_settings

logger = logging.getLogger(__name__)


def _email_configured() -> bool:
    s = get_settings()
    return bool(
        getattr(s, "SMTP_HOST", None)
        and getattr(s, "SMTP_USER", None)
        and getattr(s, "SMTP_PASS", None)
    )


def _mask_email(email: str | None) -> str:
    if not email:
        return "-"
    parts = email.split("@")
    if len(parts) != 2:
        return "***@***"
    local, domain = parts
    return f"{local[:2]}***@{domain}"


@dataclass
class EmailResult:
    """Result of an email send attempt."""
    delivery: str          # "smtp" | "dev"
    subject: str
    body: str
    to: str
    # In dev-mode the composed message is returned so the caller can surface it.
    dev_preview: str | None = None


async def send_email(to: str, subject: str, body: str, critical: bool = False) -> EmailResult:
    """
    Send an email via SMTP (if configured) or return dev-mode preview.

    If critical=True (e.g. for authentication OTPs), the function will NOT fall back
    to dev-mode preview if SMTP fails or is not configured, unless EMAIL_OTP_DEV_MODE
    and DEBUG are both explicitly True. It will raise an exception instead.
    """
    settings = get_settings()
    is_dev_fallback_allowed = not critical or (settings.DEBUG and getattr(settings, "EMAIL_OTP_DEV_MODE", False))
    
    if _email_configured():
        return await _send_smtp(to, subject, body, allow_dev_fallback=is_dev_fallback_allowed)

    if not is_dev_fallback_allowed:
        raise RuntimeError("SMTP is not configured and dev-mode fallback is disabled for this critical email.")

    # Dev-mode: no gateway configured
    logger.info(
        "EMAIL dev-mode (no SMTP): would send to %s subject=%r",
        _mask_email(to), subject,
    )
    preview = f"[DEV-MODE] To: {to}\nSubject: {subject}\n\n{body}"
    return EmailResult(delivery="dev", subject=subject, body=body, to=to, dev_preview=preview)


async def _send_smtp(to: str, subject: str, body: str, allow_dev_fallback: bool = True) -> EmailResult:
    """Real SMTP send (synchronous in a thread-pool would be ideal; kept simple here)."""
    s = get_settings()
    smtp_host: str = getattr(s, "SMTP_HOST", "")
    smtp_port: int = int(getattr(s, "SMTP_PORT", 587))
    smtp_user: str = getattr(s, "SMTP_USER", "")
    smtp_pass: str = getattr(s, "SMTP_PASS", "")
    smtp_from: str = getattr(s, "SMTP_FROM", smtp_user)

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = smtp_from
    msg["To"] = to
    msg.set_content(body)

    try:
        ctx = ssl.create_default_context()
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.ehlo()
            server.starttls(context=ctx)
            server.login(smtp_user, smtp_pass)
            server.send_message(msg)
        logger.info("Email sent to %s subject=%r", _mask_email(to), subject)
        return EmailResult(delivery="smtp", subject=subject, body=body, to=to)
    except Exception as exc:
        if not allow_dev_fallback:
            logger.error("SMTP send failed to %s: %s (critical email, failing closed)", _mask_email(to), exc)
            raise RuntimeError(f"Could not deliver email: {exc}")
            
        logger.warning(
            "SMTP send failed to %s: %s — falling back to dev-mode preview",
            _mask_email(to), exc,
        )
        # Soft failure: don't crash the calling endpoint; surface as dev-mode
        preview = f"[SMTP-FAILED] To: {to}\nSubject: {subject}\n\n{body}"
        return EmailResult(delivery="dev", subject=subject, body=body, to=to, dev_preview=preview)
