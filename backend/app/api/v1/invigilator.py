"""
CryptoExam Core — § 29 Centre Invigilator Biometric Gateway (Interface D).

Two verification layers:
  Layer 1 — Invigilator self-auth: geofence → face → FIDO2 fingerprint → TOTP → token
  Layer 2 — Candidate verification: dual biometric (face + fingerprint) before unlock

DPDP Act 2023: only derived embeddings / template hashes are read or written.
"""

import logging
from datetime import datetime, timezone, timedelta

import pyotp
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models import (
    User, UserRole, Center, Enrollment, BiometricEnrollment,
    CandidateVerification, VerificationResultEnum, EnrollmentStatus,
)
from app.schemas import (
    GeofenceRequest, GeofenceResponse, FaceVerifyRequest, FaceVerifyResponse,
    TOTPVerifyRequest, FIDO2ChallengeResponse, FIDO2VerifyRequest,
    CandidateVerifyRequest, CandidateVerifyResponse, RosterEntry,
    InvigilatorAlert, TokenResponse,
)
from app.services.auth import create_access_token, get_current_user, require_role
from app.services.biometric import face_service, fingerprint_service, geofence_service

logger = logging.getLogger(__name__)
settings = get_settings()
router = APIRouter()

# In-memory FIDO2 challenge store (single instance / dev). Production: Redis.
_fido2_challenges: dict[str, str] = {}


# ════════════════════════════════════════════════════════════════════
# Layer 1 — Invigilator self-authentication
# ════════════════════════════════════════════════════════════════════

@router.post("/verify-geofence", response_model=GeofenceResponse, summary="Geofence check")
async def verify_geofence(req: GeofenceRequest, db: AsyncSession = Depends(get_db)):
    """Confirm the invigilator's device is within ±200 m of the assigned centre."""
    center = None
    if req.center_id:
        center = (await db.execute(select(Center).where(Center.id == req.center_id))).scalar_one_or_none()
    if center is None:
        center = (await db.execute(select(Center).limit(1))).scalar_one_or_none()

    if center is None or center.latitude is None or center.longitude is None:
        # No centre coordinates on file — cannot enforce; fail closed with reason
        return GeofenceResponse(
            within_center_bounds=False, distance_m=0.0, radius_m=geofence_service.DEFAULT_RADIUS_M,
            reason="No centre coordinates on file. Contact administrator.",
        )

    result = geofence_service.verify(
        device_lat=req.latitude, device_lon=req.longitude,
        center_lat=float(center.latitude), center_lon=float(center.longitude),
        accuracy_m=req.accuracy,
    )
    return GeofenceResponse(**result.to_dict())


@router.post("/verify-face", response_model=FaceVerifyResponse, summary="Invigilator face match")
async def verify_face(req: FaceVerifyRequest, db: AsyncSession = Depends(get_db)):
    """Match a live capture against the invigilator's enrolled face embedding."""
    user = None
    if req.staff_id:
        user = (await db.execute(
            select(User).where(User.email == req.staff_id, User.role == UserRole.INVIGILATOR)
        )).scalar_one_or_none()

    enrollment = None
    if user:
        enrollment = (await db.execute(
            select(BiometricEnrollment).where(BiometricEnrollment.user_id == user.id)
        )).scalar_one_or_none()

    if enrollment is None or not enrollment.face_embedding:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No biometric enrollment found for this invigilator.",
        )

    result = face_service.verify(
        req.image, enrollment.face_embedding, face_service.CONFIDENCE_THRESHOLD
    )
    return FaceVerifyResponse(verified=result.matched, confidence=result.confidence, reason=result.reason)


@router.get("/fido2-challenge", response_model=FIDO2ChallengeResponse, summary="FIDO2 challenge")
async def fido2_challenge(staff_id: str | None = None, db: AsyncSession = Depends(get_db)):
    """Issue a WebAuthn challenge for fingerprint assertion."""
    challenge = fingerprint_service.new_challenge()
    credential_id = None
    if staff_id:
        user = (await db.execute(
            select(User).where(User.email == staff_id, User.role == UserRole.INVIGILATOR)
        )).scalar_one_or_none()
        if user:
            _fido2_challenges[user.id] = challenge
            enr = (await db.execute(
                select(BiometricEnrollment).where(BiometricEnrollment.user_id == user.id)
            )).scalar_one_or_none()
            credential_id = enr.webauthn_credential_id if enr else None
    _fido2_challenges[challenge] = challenge
    return FIDO2ChallengeResponse(challenge=challenge, credential_id=credential_id)


@router.post("/fido2-verify", summary="FIDO2 fingerprint verify")
async def fido2_verify(req: FIDO2VerifyRequest, db: AsyncSession = Depends(get_db)):
    """Verify a WebAuthn fingerprint assertion."""
    stored_cred = None
    if req.staff_id:
        user = (await db.execute(
            select(User).where(User.email == req.staff_id, User.role == UserRole.INVIGILATOR)
        )).scalar_one_or_none()
        if user:
            enr = (await db.execute(
                select(BiometricEnrollment).where(BiometricEnrollment.user_id == user.id)
            )).scalar_one_or_none()
            stored_cred = enr.webauthn_credential_id if enr else None
    result = fingerprint_service.verify_fido2_assertion(req.assertion, req.challenge, stored_cred)
    return {"ok": result.matched, **result.to_dict()}


@router.post("/verify-totp", response_model=TokenResponse, summary="TOTP + issue session")
async def verify_totp(req: TOTPVerifyRequest, db: AsyncSession = Depends(get_db)):
    """
    Final factor. On success, issue the invigilator session JWT.
    In DEBUG the TOTP check is lenient (accepts any 6-digit code) so the gateway
    is demoable without provisioning an authenticator app.
    """
    user = None
    if req.staff_id:
        user = (await db.execute(
            select(User).where(User.email == req.staff_id, User.role == UserRole.INVIGILATOR)
        )).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invigilator not found")

    valid = False
    if user.totp_secret:
        valid = pyotp.TOTP(user.totp_secret).verify(req.code, valid_window=1)
    if not valid and settings.DEBUG and req.code.isdigit() and len(req.code) == 6:
        valid = True  # dev convenience

    if not valid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid TOTP code")

    token, expires = create_access_token(user_id=user.id, role=user.role, email=user.email)
    logger.info(f"Invigilator login: {user.email}")
    return TokenResponse(access_token=token, token_type="bearer", expires_at=expires,
                         role=user.role, user_id=user.id)


# ════════════════════════════════════════════════════════════════════
# Layer 2 — Candidate verification
# ════════════════════════════════════════════════════════════════════

@router.post("/candidate/verify", response_model=CandidateVerifyResponse,
             summary="Dual biometric candidate verification")
async def candidate_verify(
    req: CandidateVerifyRequest,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_role(UserRole.INVIGILATOR, UserRole.ADMIN)),
):
    """§ 29.3 — verify a candidate via face + fingerprint, logged with score & invigilator."""
    # Resolve candidate by hall ticket (roll number on enrollment)
    enrollment = (await db.execute(
        select(Enrollment).where(Enrollment.roll_number == req.hall_ticket)
    )).scalar_one_or_none()
    candidate = None
    if enrollment:
        candidate = (await db.execute(
            select(User).where(User.id == enrollment.candidate_id)
        )).scalar_one_or_none()

    # Face
    face_match, face_conf, face_reason = False, 0.0, "No capture"
    if req.face_image and candidate:
        bio = (await db.execute(
            select(BiometricEnrollment).where(BiometricEnrollment.user_id == candidate.id)
        )).scalar_one_or_none()
        if bio and bio.face_embedding:
            fr = face_service.verify(req.face_image, bio.face_embedding, face_service.CANDIDATE_THRESHOLD)
            face_match, face_conf, face_reason = fr.matched, fr.confidence, fr.reason

    # Fingerprint
    fp_match, fp_conf = False, 0.0
    if req.fido2_assertion:
        fpr = fingerprint_service.verify_fido2_assertion(
            req.fido2_assertion, req.fido2_challenge or "", None
        )
        fp_match, fp_conf = fpr.matched, fpr.confidence
    elif req.fp_template_hash and candidate:
        bio = (await db.execute(
            select(BiometricEnrollment).where(BiometricEnrollment.user_id == candidate.id)
        )).scalar_one_or_none()
        stored = bio.fp_template_hash if bio else ""
        fpr = fingerprint_service.verify_mantra(req.fp_template_hash, stored or "", req.fp_match_score)
        fp_match, fp_conf = fpr.matched, fpr.confidence

    overall = (
        VerificationResultEnum.VERIFIED if (face_match and fp_match)
        else VerificationResultEnum.MISMATCH
    )

    record = CandidateVerification(
        candidate_id=candidate.id if candidate else None,
        invigilator_id=current["user_id"],
        exam_id=req.exam_id,
        center_id=req.center_id,
        hall_ticket=req.hall_ticket,
        face_match=face_match,
        face_confidence=round(face_conf, 4),
        fp_match=fp_match,
        fp_confidence=round(fp_conf, 4),
        overall_result=overall,
        action_taken="AUTO_VERIFIED" if overall == VerificationResultEnum.VERIFIED else "FLAGGED",
    )
    db.add(record)
    await db.flush()

    return CandidateVerifyResponse(
        candidate_id=candidate.id if candidate else None,
        candidate_name=candidate.full_name if candidate else None,
        hall_ticket=req.hall_ticket,
        face_match=face_match,
        face_confidence=round(face_conf, 4),
        fp_match=fp_match,
        fp_confidence=round(fp_conf, 4),
        overall_result=overall.value,
        timestamp=datetime.now(timezone.utc),
        verification_id=record.id,
    )


@router.get("/roster", response_model=list[RosterEntry], summary="Candidate roster")
async def roster(
    exam_id: str | None = None,
    center_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_role(UserRole.INVIGILATOR, UserRole.ADMIN)),
):
    """Roster of candidates with live verification status."""
    stmt = select(Enrollment, User).join(User, Enrollment.candidate_id == User.id)
    if exam_id:
        stmt = stmt.where(Enrollment.exam_id == exam_id)
    if center_id:
        stmt = stmt.where(Enrollment.center_id == center_id)
    rows = (await db.execute(stmt.limit(1000))).all()

    # Latest verification per candidate
    out: list[RosterEntry] = []
    for enr, user in rows:
        v = (await db.execute(
            select(CandidateVerification)
            .where(CandidateVerification.candidate_id == user.id)
            .order_by(CandidateVerification.created_at.desc())
            .limit(1)
        )).scalar_one_or_none()
        if v:
            statemap = {
                VerificationResultEnum.VERIFIED: "VERIFIED",
                VerificationResultEnum.MISMATCH: "MISMATCH",
                VerificationResultEnum.MANUAL_OVERRIDE: "VERIFIED",
            }
            st = statemap.get(v.overall_result, "PENDING")
        else:
            st = "PENDING"
        out.append(RosterEntry(
            candidate_id=user.id, candidate_name=user.full_name,
            roll_number=enr.roll_number, hall_ticket=enr.roll_number,
            status=st, verified_at=v.created_at if v else None,
        ))
    return out


@router.get("/alerts", response_model=list[InvigilatorAlert], summary="Centre alerts")
async def alerts(
    center_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_role(UserRole.INVIGILATOR, UserRole.ADMIN)),
):
    """Mismatches and incidents requiring invigilator attention."""
    stmt = (
        select(CandidateVerification, User)
        .join(User, CandidateVerification.candidate_id == User.id, isouter=True)
        .where(CandidateVerification.overall_result == VerificationResultEnum.MISMATCH)
        .order_by(CandidateVerification.created_at.desc())
        .limit(100)
    )
    if center_id:
        stmt = stmt.where(CandidateVerification.center_id == center_id)
    rows = (await db.execute(stmt)).all()
    return [
        InvigilatorAlert(
            id=v.id, type="MISMATCH", severity="CRITICAL",
            candidate_name=u.full_name if u else v.hall_ticket,
            message=f"Biometric mismatch (face {float(v.face_confidence or 0):.0%}, "
                    f"fp {float(v.fp_confidence or 0):.0%}). Awaiting supervisor.",
            created_at=v.created_at, resolved=False,
        )
        for v, u in rows
    ]


# ── V3 §7.3 — Panic alerts (silent distress signals from candidates) ─────

# In-memory panic queue (production: Redis Stream + invigilator dashboard fan-out)
_PANIC_ALERTS: list[dict] = []


class PanicAlertPayload(BaseModel):
    examId: str
    candidateId: str
    seatNumber: str | None = None
    centerId: str | None = None
    method: str = "TOUCH"
    timestamp: str | None = None


@router.post("/panic-alert", summary="Candidate panic alert (silent)")
async def panic_alert(req: PanicAlertPayload):
    """Candidate-side panic button hit. Public — exam JWT is verified upstream.
    Silent: candidate sees a confirmation; only the invigilator dashboard is notified.
    Exam timer is NOT paused; the candidate chose to continue or wait."""
    import uuid as _uuid
    item = {
        "id": f"panic-{_uuid.uuid4().hex[:10]}",
        "examId": req.examId, "candidateId": req.candidateId,
        "seatNumber": req.seatNumber, "centerId": req.centerId,
        "method": req.method, "timestamp": req.timestamp or datetime.now(timezone.utc).isoformat(),
        "resolved": False,
    }
    _PANIC_ALERTS.insert(0, item)
    # Cap retention to avoid unbounded growth
    if len(_PANIC_ALERTS) > 500:
        _PANIC_ALERTS[:] = _PANIC_ALERTS[:500]
    logger.info(f"PANIC ALERT exam={req.examId[:8]} candidate={req.candidateId[:8]} method={req.method}")
    return {"ok": True, "id": item["id"]}


@router.get("/panic-alerts", summary="Open panic alerts for the invigilator")
async def list_panic_alerts(
    center_id: str | None = None,
    current=Depends(require_role(UserRole.INVIGILATOR, UserRole.ADMIN)),
):
    if center_id:
        return [a for a in _PANIC_ALERTS if a.get("centerId") == center_id]
    return list(_PANIC_ALERTS)


@router.post("/panic-alerts/{alert_id}/resolve", summary="Mark a panic alert resolved")
async def resolve_panic_alert(
    alert_id: str,
    current=Depends(require_role(UserRole.INVIGILATOR, UserRole.ADMIN)),
):
    for a in _PANIC_ALERTS:
        if a["id"] == alert_id:
            a["resolved"] = True
            return {"ok": True}
    raise HTTPException(404, "Panic alert not found")


@router.get("/stats", summary="Centre verification stats")
async def stats(
    center_id: str | None = None,
    exam_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_role(UserRole.INVIGILATOR, UserRole.ADMIN)),
):
    """Aggregate counts for the invigilator dashboard."""
    base = select(func.count()).select_from(Enrollment)
    if exam_id:
        base = base.where(Enrollment.exam_id == exam_id)
    if center_id:
        base = base.where(Enrollment.center_id == center_id)
    total = (await db.execute(base)).scalar() or 0

    vbase = select(CandidateVerification.overall_result, func.count())
    if center_id:
        vbase = vbase.where(CandidateVerification.center_id == center_id)
    vbase = vbase.group_by(CandidateVerification.overall_result)
    counts = {r.value: 0 for r in VerificationResultEnum}
    for res, c in (await db.execute(vbase)).all():
        counts[res.value if hasattr(res, "value") else str(res)] = c

    verified = counts.get("VERIFIED", 0)
    return {
        "total": total,
        "verified": verified,
        "mismatch": counts.get("MISMATCH", 0),
        "pending": max(0, total - verified - counts.get("MISMATCH", 0)),
    }
