"""
CryptoExam — Public centre-staff registration (real, DB-backed).

A centre's LAN is internet-free by design (ZUUP-OS INV-3), so a NEW Centre
Admin / Centre Invigilator registers on the PUBLIC website. This router stores
the request as a real PENDING row in the platform DB; it then lands in the §9
approval cascade:

    Centre Admin applicant  → approved by the SYSTEM ADMIN  (tier-0)
    Invigilator applicant   → approved by that centre's CENTRE ADMIN (tier-1)

Approval (in app/api/v1/admin.py) issues a real one-time, time-boxed code.
ACTIVATION is still an in-person ceremony at the centre — a web registration
alone can never become an ACTIVE identity (INV-4).

GET  /api/v1/staff/centres   — real centre directory (id/name/state) from the DB
POST /api/v1/staff/register  — store a real PENDING request → {requestId, status}
"""

import hashlib
import logging
import re
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Center, StaffRegistrationRequest, StaffApprovalStatus

logger = logging.getLogger(__name__)
router = APIRouter()

_HEX64 = re.compile(r"^[0-9a-f]{64}$", re.IGNORECASE)


class StaffRegistration(BaseModel):
    role: str = Field(pattern="^(CENTER_ADMIN|CENTER_INVIGILATOR)$")
    centerId: str
    fullName: str = Field(min_length=2, max_length=255)
    faceEmbeddingHash: str


@router.get("/centres")
async def centres(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Real centre directory for the registration form — id/name/state only."""
    rows = (await db.execute(select(Center).order_by(Center.name))).scalars().all()
    return {
        "centres": [
            {"centerId": c.id, "name": c.name, "state": c.state}
            for c in rows
        ]
    }


@router.post("/register")
async def register(
    body: StaffRegistration,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Persist a real PENDING centre-staff registration."""
    if not _HEX64.match(body.faceEmbeddingHash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="FACE_CAPTURE_REQUIRED"
        )

    centre = (
        await db.execute(select(Center).where(Center.id == body.centerId))
    ).scalar_one_or_none()
    if not centre:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="UNKNOWN_CENTRE")

    req = StaffRegistrationRequest(
        id=str(uuid.uuid4()),
        role=body.role,
        center_id=centre.id,
        center_name=centre.name,
        full_name=body.fullName.strip(),
        face_embedding_hash=body.faceEmbeddingHash.lower(),
        status=StaffApprovalStatus.PENDING,
        approver_role="SYSTEM_ADMIN" if body.role == "CENTER_ADMIN" else "CENTER_ADMIN",
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)

    logger.info("staff registration stored: %s (%s) at %s", req.full_name, req.role, centre.name)
    return {
        "ok": True,
        "requestId": req.id,
        "status": req.status.value,
        "approver": req.approver_role,
    }
