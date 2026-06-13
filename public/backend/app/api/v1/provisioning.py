"""
HQ → Centre-Edge pre-exam provisioning (§12).

BEFORE exam day, while a centre still has an uplink, the System Admin pushes
that centre's enrolment bundle — candidates (roll + DOB + face hash) and the
centre's staff — into the centre's local Edge DB. After that the centre runs the
exam fully OFFLINE: login + biometric checks are answered locally, with no
internet for anyone. Raw biometrics never travel; only DPDP-safe hashes do.

    GET  /api/v1/provisioning/bundle/{center_id}  — build the per-centre bundle
    POST /api/v1/provisioning/sync/{center_id}    — build it AND push to the Edge
"""
import logging
import os
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import (
    Center, User, UserRole, Enrollment, Exam,
    StaffRegistrationRequest, StaffApprovalStatus,
)
from app.services.auth import require_role

logger = logging.getLogger(__name__)
router = APIRouter()

EDGE_RELAY_URL = os.getenv("EDGE_RELAY_URL", "http://127.0.0.1:4000")
EDGE_PROVISIONING_KEY = os.getenv("EDGE_PROVISIONING_KEY", "")

# Public registration status → Edge identity status. A Centre Admin/Invigilator
# the System Admin has APPROVED becomes a usable local identity; everyone else
# stays PENDING until approved (fail-closed).
_STAFF_STATUS = {
    StaffApprovalStatus.APPROVED: "ACTIVE",
    StaffApprovalStatus.PENDING: "PENDING_APPROVAL",
    StaffApprovalStatus.REJECTED: "REVOKED",
}


async def _build_bundle(db: AsyncSession, center_id: str) -> dict[str, Any]:
    centre = (await db.execute(select(Center).where(Center.id == center_id))).scalar_one_or_none()
    if not centre:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="UNKNOWN_CENTRE")

    # Candidates enrolled at this centre (+ their exam), with face hash + DOB.
    rows = (await db.execute(
        select(Enrollment)
        .where(Enrollment.center_id == center_id)
        .options(selectinload(Enrollment.candidate), selectinload(Enrollment.exam))
    )).scalars().all()

    candidates, exams_by_id = [], {}
    for e in rows:
        u, x = e.candidate, e.exam
        if not u or not x:
            continue
        candidates.append({
            "id": u.id,
            "full_name": u.full_name,
            "dob": u.date_of_birth or "2005-01-01",
            "face_hash": u.enrolled_photo_hash.hex() if u.enrolled_photo_hash else None,
            "fingerprint": None,                       # candidate finger enrolled in person at the seat
            "roll_number": e.roll_number,
            "exam_id": x.id,
            "status": e.status.value if hasattr(e.status, "value") else str(e.status),
        })
        exams_by_id[x.id] = {
            "id": x.id, "name": x.name,
            "scheduled_at": x.scheduled_at.isoformat() if x.scheduled_at else None,
            "duration_minutes": x.duration_minutes or 180,
        }

    # Centre staff captured via public registration.
    staff_rows = (await db.execute(
        select(StaffRegistrationRequest).where(StaffRegistrationRequest.center_id == center_id)
    )).scalars().all()
    staff = [{
        "id": s.id,
        "role": s.role,
        "full_name": s.full_name,
        "face_hash": s.face_embedding_hash,
        "fingerprint": None,                           # enrolled in person at activation
        "status": _STAFF_STATUS.get(s.status, "PENDING_APPROVAL"),
    } for s in staff_rows]

    return {
        "centre": {"id": centre.id, "name": centre.name, "state": centre.state, "district": centre.district},
        "exams": list(exams_by_id.values()),
        "candidates": candidates,
        "staff": staff,
    }


@router.get("/bundle/{center_id}", summary="Build a centre's offline enrolment bundle")
async def bundle(
    center_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.ADMIN)),
):
    b = await _build_bundle(db, center_id)
    return {
        "ok": True,
        "counts": {"candidates": len(b["candidates"]), "staff": len(b["staff"]), "exams": len(b["exams"])},
        "bundle": b,
    }


@router.post("/sync/{center_id}", summary="Push a centre's bundle to its Edge (pre-exam)")
async def sync(
    center_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.ADMIN)),
):
    b = await _build_bundle(db, center_id)
    if not EDGE_PROVISIONING_KEY:
        raise HTTPException(status_code=503, detail="EDGE_PROVISIONING_KEY not configured on HQ")
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                f"{EDGE_RELAY_URL}/api/provisioning/ingest",
                json=b,
                headers={"x-provisioning-key": EDGE_PROVISIONING_KEY},
            )
        data = r.json()
        if r.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"EDGE_{r.status_code}:{data.get('reason')}")
        logger.info("Provisioned centre %s → Edge: %s", center_id, data)
        return {"ok": True, "centre": center_id, "edge": data}
    except httpx.HTTPError as exc:
        logger.warning("Edge provisioning push failed: %s", exc)
        raise HTTPException(status_code=503, detail="EDGE_UNREACHABLE")
