"""
CryptoExam — Public staff-registration relay (HQ → Centre Edge)

Why this exists: an examination centre's LAN is internet-free by design
(ZUUP-OS INV-3), so a NEW Centre Admin / Centre Invigilator — who has no
working centre station yet — registers on the PUBLIC website. This router
relays that capture to the applicant's centre Edge over the HQ↔Edge
provisioning link (WireGuard in production), where it lands as a normal
PENDING_APPROVAL request in the §9 cascade:

    Centre Admin applicant  → approved by the SYSTEM ADMIN  (tier-0)
    Invigilator applicant   → approved by that centre's CENTRE ADMIN (tier-1)

What never changes: ACTIVATION is an in-person ceremony at the centre — the
approver-issued one-time code (TTL'd, single-use, INV-8) plus a live
fingerprint enrolment at a centre station. A web registration alone can never
become an ACTIVE identity, so this public surface adds no bypass of INV-4.

GET  /api/v1/staff/centres   — centre directory (id/name/state; no PII)
POST /api/v1/staff/register  — relay a registration → {requestId, PENDING_APPROVAL}

Production counterpart of public/frontend/app/api/staff-registration/route.ts
(the Next.js dev relay); both speak to the same Edge endpoints.
"""

import hashlib
import logging
import os
import re
import uuid
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)
router = APIRouter()

# The HQ-side address of the centre Edge provisioning link. In production this
# resolves over the HQ↔Edge WireGuard tunnel; never a public address.
EDGE_RELAY_URL = os.getenv("EDGE_RELAY_URL", "http://127.0.0.1:4000")
_HEX64 = re.compile(r"^[0-9a-f]{64}$", re.IGNORECASE)


class StaffRegistration(BaseModel):
    role: str = Field(pattern="^(CENTER_ADMIN|CENTER_INVIGILATOR)$")
    centerId: str
    fullName: str = Field(min_length=2, max_length=255)
    faceEmbeddingHash: str


def _pending_fingerprint_marker() -> str:
    """Explicit ENROL-PENDING template: the SHA-256 of a tagged nonce, which can
    never match a live finger (§8.1 fail-closed). The real template is enrolled
    in person during activation."""
    return hashlib.sha256(f"ZUUP-FP-ENROL-PENDING:{uuid.uuid4()}".encode()).hexdigest()


@router.get("/centres")
async def centres() -> dict[str, Any]:
    """Centre directory for the registration form — id/name/state only."""
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(f"{EDGE_RELAY_URL}/api/centres")
            r.raise_for_status()
            return r.json()
    except httpx.HTTPError as exc:
        logger.warning("staff-reg centre directory relay failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="HQ_EDGE_RELAY_UNAVAILABLE",
        )


@router.post("/register")
async def register(body: StaffRegistration) -> dict[str, Any]:
    """Relay a public registration to the centre Edge; returns the PENDING id."""
    if not _HEX64.match(body.faceEmbeddingHash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="FACE_CAPTURE_REQUIRED"
        )

    path = (
        "/api/centeradmin/register"
        if body.role == "CENTER_ADMIN"
        else "/api/invigilator/register"
    )
    payload = {
        "centerId": body.centerId,
        "fullName": body.fullName.strip(),
        "faceEmbeddingHash": body.faceEmbeddingHash.lower(),
        "fingerprintTemplate": _pending_fingerprint_marker(),
        "boundIp": None,          # bound at the centre during activation
        "boundTerminalId": None,  # bound at the centre during activation
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(f"{EDGE_RELAY_URL}{path}", json=payload)
            data = r.json()
            if r.status_code >= 400:
                raise HTTPException(
                    status_code=r.status_code,
                    detail=data.get("reason", f"EDGE_{r.status_code}"),
                )
            return {
                "ok": True,
                "requestId": data.get("requestId"),
                "status": data.get("status", "PENDING_APPROVAL"),
                "approver": "SYSTEM_ADMIN" if body.role == "CENTER_ADMIN" else "CENTER_ADMIN",
            }
    except httpx.HTTPError as exc:
        logger.warning("staff-reg relay failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="HQ_EDGE_RELAY_UNAVAILABLE",
        )
