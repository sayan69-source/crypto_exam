"""
SMS delivery for login OTPs.

Real delivery uses Twilio (set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN /
TWILIO_FROM_NUMBER in the environment). When those are unset we are in dev mode:
nothing is sent over the wire — the caller surfaces the code itself (clearly
flagged delivery="dev") so the OTP flow stays testable without a paid gateway.

This module never logs the cleartext code at INFO; only a masked phone.
"""
import logging

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


def sms_configured() -> bool:
    s = get_settings()
    return bool(s.TWILIO_ACCOUNT_SID and s.TWILIO_AUTH_TOKEN and s.TWILIO_FROM_NUMBER)


def mask_phone(phone: str | None) -> str:
    if not phone:
        return "-"
    digits = "".join(ch for ch in phone if ch.isdigit())
    if len(digits) < 4:
        return "***"
    return f"+** ***** *{digits[-4:]}"  # e.g. +** ***** *0000


async def send_sms(to: str, body: str) -> bool:
    """Send an SMS via Twilio. Returns True on success. Raises on a hard failure
    so the caller can decide whether to fail the login or fall back to dev mode."""
    s = get_settings()
    url = f"https://api.twilio.com/2010-04-01/Accounts/{s.TWILIO_ACCOUNT_SID}/Messages.json"
    async with httpx.AsyncClient(timeout=12.0) as client:
        r = await client.post(
            url,
            data={"To": to, "From": s.TWILIO_FROM_NUMBER, "Body": body},
            auth=(s.TWILIO_ACCOUNT_SID, s.TWILIO_AUTH_TOKEN),
        )
    if r.status_code >= 400:
        logger.warning("Twilio send failed (%s) to %s", r.status_code, mask_phone(to))
        raise RuntimeError(f"SMS_SEND_FAILED_{r.status_code}")
    logger.info("OTP SMS sent to %s", mask_phone(to))
    return True
