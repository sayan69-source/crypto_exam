"""
CryptoExam Core — Public enquiries.

  POST /api/v1/enquiries              — submit an enquiry (PUBLIC, no auth)
  GET  /api/v1/enquiries/{reference}  — check one's own enquiry by reference
  GET  /api/v1/admin/enquiries        — the HQ queue (ADMIN)   [in admin.py]

The public site's contact form used to have no destination: the page set a
"sent" flag in React state and dropped the message. This is the destination.

Deliberately minimal and deliberately unauthenticated on the write side — an
examination board evaluating the platform should not need an account to ask a
question. That makes it the one endpoint an anonymous stranger can write to, so
it is bounded: field lengths are capped, the body is capped, and a per-IP window
limits how fast one source can fill the table.
"""

import logging
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Enquiry, EnquiryStatus

logger = logging.getLogger(__name__)
router = APIRouter()

# Topics the site offers. Anything else is recorded as GENERAL rather than
# rejected — a mis-typed topic is not a reason to lose someone's message.
TOPICS = {"BRIEFING", "PROCUREMENT", "PARTNERSHIP", "PRESS", "SECURITY", "CANDIDATE", "GENERAL"}

# One source may open a handful of enquiries an hour. Generous for a person,
# useless for a script. In-process, so it resets on restart — that is acceptable
# for a soft limit whose worst case is a few extra rows for an admin to close.
_RATE_WINDOW = timedelta(hours=1)
_RATE_MAX = 5
_recent: dict[str, list[datetime]] = {}


def _rate_limited(ip: str, now: datetime) -> bool:
    seen = [t for t in _recent.get(ip, []) if now - t < _RATE_WINDOW]
    if len(_recent) > 10_000:  # bound the map; drop everything stale first
        for k in [k for k, v in _recent.items() if all(now - t >= _RATE_WINDOW for t in v)]:
            _recent.pop(k, None)
    _recent[ip] = seen
    if len(seen) >= _RATE_MAX:
        return True
    seen.append(now)
    return False


def _reference() -> str:
    """A short, unambiguous handle the enquirer can quote back at us.

    Crockford-ish alphabet: no I/O/0/1, so a reference read over the phone or
    copied off a screen does not come back as a different one.
    """
    alphabet = "23456789ABCDEFGHJKMNPQRSTVWXYZ"
    body = "".join(secrets.choice(alphabet) for _ in range(8))
    return f"ENQ-{body[:4]}-{body[4:]}"


class EnquiryCreate(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=200)
    email: EmailStr
    phone: str | None = Field(None, max_length=32)
    organisation: str | None = Field(None, max_length=255)
    role_title: str | None = Field(None, max_length=255)
    topic: str = Field("GENERAL", max_length=64)
    message: str = Field(..., min_length=10, max_length=5000)


class EnquiryReceipt(BaseModel):
    """What the enquirer gets back — proof we hold it, and how to chase it."""
    reference: str
    status: EnquiryStatus
    received_at: datetime


@router.post(
    "",
    response_model=EnquiryReceipt,
    status_code=status.HTTP_201_CREATED,
    summary="Submit an enquiry (public)",
)
async def create_enquiry(
    body: EnquiryCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    ip = request.client.host if request.client else "unknown"
    if _rate_limited(ip, now):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "reason": "TOO_MANY_ENQUIRIES",
                "message": "Several enquiries have already been received from this network in the last hour. Please email us directly if this is urgent.",
            },
        )

    # A reference has to be unique; collisions are vanishingly unlikely but a
    # duplicate would hand two people the same handle, so check rather than hope.
    for _ in range(5):
        reference = _reference()
        exists = (await db.execute(
            select(Enquiry.id).where(Enquiry.reference == reference)
        )).scalar_one_or_none()
        if not exists:
            break
    else:
        raise HTTPException(status_code=503, detail="Could not allocate an enquiry reference.")

    enquiry = Enquiry(
        reference=reference,
        full_name=body.full_name.strip(),
        email=str(body.email).strip().lower(),
        phone=(body.phone or "").strip() or None,
        organisation=(body.organisation or "").strip() or None,
        role_title=(body.role_title or "").strip() or None,
        topic=body.topic.upper() if body.topic.upper() in TOPICS else "GENERAL",
        # Collapse runs of whitespace but keep paragraphs — people paste.
        message=re.sub(r"\n{3,}", "\n\n", body.message.strip()),
        status=EnquiryStatus.NEW,
        source_ip=ip,
        created_at=now,
    )
    db.add(enquiry)
    await db.flush()

    logger.info("Enquiry %s received (topic=%s, org=%s)", reference, enquiry.topic, enquiry.organisation)
    return EnquiryReceipt(reference=reference, status=EnquiryStatus.NEW, received_at=now)


@router.get(
    "/{reference}",
    response_model=EnquiryReceipt,
    summary="Check an enquiry by reference (public)",
)
async def get_enquiry(reference: str, db: AsyncSession = Depends(get_db)):
    """
    Status only — never the message, the contact details or the internal note.

    The reference is a bearer token of sorts: anyone holding it can see that an
    enquiry exists and where it has got to, which is what the enquirer needs and
    all an onlooker should get.
    """
    row = (await db.execute(
        select(Enquiry).where(Enquiry.reference == reference.strip().upper())
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="No enquiry with that reference.")
    return EnquiryReceipt(reference=row.reference, status=row.status, received_at=row.created_at)
