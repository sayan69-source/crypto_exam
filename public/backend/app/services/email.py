"""
Email delivery for login OTPs.

WHY THIS EXISTS
---------------
The OTP flow was real but SMS-only: `/auth/login` required `user.phone` and
raised 400 "No phone number registered on this account" when it was missing.
Setter self-registration takes an email and treats phone as optional — so a
setter could register, be approved by an admin, and then be **permanently
unable to log in**. The second factor existed with no way to deliver it.

Real delivery uses plain SMTP over STARTTLS, which every provider speaks and
which costs nothing:

    SMTP_HOST=smtp.gmail.com
    SMTP_PORT=587
    SMTP_USER=you@gmail.com
    SMTP_PASSWORD=<16-char app password, NOT your account password>
    SMTP_FROM="CryptoExam Core <you@gmail.com>"

Gmail requires an App Password (Google Account → Security → 2-Step
Verification → App passwords). Any SMTP host works — Zoho, Fastmail, a
university relay, or a local MailHog for testing.

With nothing configured we are in dev mode: nothing leaves the process and the
caller surfaces the code itself, clearly flagged `delivery="dev"`.

This module never logs the cleartext code — only a masked address.
"""
import asyncio
import logging
import smtplib
import ssl
from email.message import EmailMessage

from app.config import get_settings

logger = logging.getLogger(__name__)


def email_configured() -> bool:
    s = get_settings()
    return bool(getattr(s, "SMTP_HOST", None) and getattr(s, "SMTP_FROM", None))


def mask_email(address: str | None) -> str:
    """`arjun.mehta@nta.ac.in` → `a***a@nta.ac.in`. Enough to recognise, not to read."""
    if not address or "@" not in address:
        return "-"
    local, _, domain = address.partition("@")
    if len(local) <= 2:
        return f"{local[0]}***@{domain}"
    return f"{local[0]}***{local[-1]}@{domain}"


def _build_message(to: str, code: str, ttl_seconds: int) -> EmailMessage:
    s = get_settings()
    minutes = max(1, ttl_seconds // 60)

    msg = EmailMessage()
    msg["Subject"] = f"{code} is your CryptoExam Core sign-in code"
    msg["From"] = s.SMTP_FROM
    msg["To"] = to
    # Not a marketing mail; keep it out of threads and auto-responders.
    msg["Auto-Submitted"] = "auto-generated"

    msg.set_content(
        f"Your CryptoExam Core sign-in code is {code}\n\n"
        f"It expires in {minutes} minute{'s' if minutes != 1 else ''} and can be used once.\n\n"
        "If you did not try to sign in, someone has your password. Change it, and\n"
        "tell your administrator — this code alone will not let them in.\n\n"
        "CryptoExam Core never asks for this code by phone, email or message.\n"
    )
    # A minimal HTML part, because a bare monospace code is easy to mistype.
    msg.add_alternative(
        f"""<html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#0D1526">
  <p style="font-size:15px;margin:0 0 18px">Your CryptoExam Core sign-in code is</p>
  <p style="font-size:34px;font-weight:700;letter-spacing:0.16em;margin:0 0 18px;font-family:ui-monospace,monospace">{code}</p>
  <p style="font-size:13px;color:#4A5578;margin:0 0 20px">
    It expires in {minutes} minute{'s' if minutes != 1 else ''} and can be used once.
  </p>
  <p style="font-size:13px;color:#4A5578;margin:0 0 6px">
    If you did not try to sign in, someone has your password. Change it and tell your
    administrator — this code alone will not let them in.
  </p>
  <p style="font-size:12px;color:#7C8AB8;margin:20px 0 0">
    CryptoExam Core never asks for this code by phone, email or message.
  </p>
</body></html>""",
        subtype="html",
    )
    return msg


def _smtp_password() -> str:
    """
    The App Password, with whitespace removed.

    Google displays app passwords in four groups — `abcd efgh ijkl mnop` — and
    copying that verbatim is the single most common way this configuration
    fails: SMTP then rejects the login with a bare "Username and Password not
    accepted", which points at the wrong thing entirely. The spaces are purely
    presentational, so strip them rather than making the operator notice.
    """
    return "".join((get_settings().SMTP_PASSWORD or "").split())


def _send_blocking(msg: EmailMessage) -> None:
    """smtplib is synchronous; the caller runs this in a worker thread."""
    s = get_settings()
    host, port = s.SMTP_HOST, int(s.SMTP_PORT or 587)

    # Port 465 is implicit TLS; everything else negotiates STARTTLS. Refusing to
    # continue when STARTTLS is unavailable is deliberate — an OTP must not
    # cross the wire in the clear just because the server did not offer TLS.
    if port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=15, context=ssl.create_default_context()) as smtp:
            if s.SMTP_USER:
                smtp.login(s.SMTP_USER, _smtp_password())
            smtp.send_message(msg)
        return

    with smtplib.SMTP(host, port, timeout=15) as smtp:
        smtp.ehlo()
        smtp.starttls(context=ssl.create_default_context())
        smtp.ehlo()
        if s.SMTP_USER:
            smtp.login(s.SMTP_USER, _smtp_password())
        smtp.send_message(msg)


async def send_otp_email(to: str, code: str, ttl_seconds: int) -> bool:
    """
    Deliver an OTP by email. Returns True on success, raises on hard failure so
    the caller can decide whether to fail the login rather than pretend.
    """
    msg = _build_message(to, code, ttl_seconds)
    try:
        await asyncio.to_thread(_send_blocking, msg)
    except Exception as exc:
        logger.warning("OTP email delivery failed to %s: %s", mask_email(to), exc)
        raise RuntimeError(f"EMAIL_SEND_FAILED: {exc}") from exc
    logger.info("OTP email sent to %s", mask_email(to))
    return True
