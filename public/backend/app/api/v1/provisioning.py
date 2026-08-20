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

from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import (
    Center, User, UserRole, Enrollment, Exam, ExamPatternRow,
    SealedBundleKeying, SealedQuestionBundle,
    StaffRegistrationRequest, StaffApprovalStatus,
)
from app.api.v1.enroll import FACE_MODEL
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
            # WHICH network produced that vector. The terminal embeds with SFace
            # and this descriptor comes from face-api.js — both 128 float32, so
            # the bytes align and a cosine between them returns an arbitrary
            # number rather than an error. Sending the model identity lets the
            # terminal REFUSE a vector it cannot compare, instead of scoring a
            # genuine candidate low for a reason that is not their face.
            "face_model": FACE_MODEL,
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

    # ── the sealed papers for THIS centre's exams ─────────────────────────
    #
    # This was absent, and its absence is why a centre could never run an exam:
    # services/provisioning.ts has always accepted `question_bundles` and
    # nothing ever sent one, so the Edge's `exam_question_bundle` table was only
    # ever written by the demo seed. A centre received its candidates and its
    # staff and no paper.
    #
    # Only the exams this centre's candidates are actually sitting — the same
    # scoping as the roster above. A centre is never handed a paper for an exam
    # it is not running.
    bundles = []
    if exams_by_id:
        rows_b = (await db.execute(
            select(SealedQuestionBundle, SealedBundleKeying)
            .join(SealedBundleKeying, SealedBundleKeying.exam_id == SealedQuestionBundle.exam_id)
            .where(SealedQuestionBundle.exam_id.in_(list(exams_by_id)))
        )).all()
        now = datetime.now(timezone.utc)
        for sb, key in rows_b:
            t0 = key.t0_at
            if t0 is not None and t0.tzinfo is None:
                t0 = t0.replace(tzinfo=timezone.utc)
            # THE line that makes pre-positioning safe. The ciphertext, the salt
            # and the schedule all travel days early; the beacon that opens it
            # does not travel until T0 has passed. Until then a centre holding
            # the paper holds inert bytes — which is the entire point of shipping
            # it early.
            released = t0 is not None and now >= t0
            bundles.append({
                "exam_id": sb.exam_id,
                "questions_root": sb.questions_root[2:] if sb.questions_root.startswith("0x") else sb.questions_root,
                "bundle_cid": sb.bundle_cid,
                "chain_tx": sb.chain_tx,
                "bundle": sb.bundle,
                "drand_round": sb.drand_round or 0,
                "hkdf_salt": key.hkdf_salt.hex(),
                "t0_at": t0.isoformat() if t0 else None,
                "t0_beacon": key.t0_beacon.hex() if released else None,
            })

    # ── the paper's SHAPE, so the terminal knows what to draw ─────────────
    # Without this the terminal cannot render a numeric-entry section or apply a
    # section's marks; it would fall back to assuming every exam is four-option
    # MCQ, which is the assumption the pattern exists to remove.
    patterns = []
    if exams_by_id:
        for row in (await db.execute(
            select(ExamPatternRow).where(ExamPatternRow.exam_id.in_(list(exams_by_id)))
        )).scalars().all():
            patterns.append({
                "exam_id": row.exam_id,
                "pattern": row.pattern,
                "total_questions": row.total_questions,
                "duration_minutes": row.duration_minutes,
            })

    return {
        "centre": {"id": centre.id, "name": centre.name, "state": centre.state, "district": centre.district},
        "exams": list(exams_by_id.values()),
        "candidates": candidates,
        "staff": staff,
        "question_bundles": bundles,
        "exam_patterns": patterns,
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
