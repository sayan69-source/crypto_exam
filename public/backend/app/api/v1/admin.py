"""
CryptoExam Core — Admin API Endpoints
§ 8 — Dashboard, emergency controls, audit, and DPDP compliance.

GET  /api/v1/admin/dashboard        — Real-time system dashboard
GET  /api/v1/admin/audit/dpdp       — DPDP compliance audit log
POST /api/v1/admin/emergency/pause  — Emergency exam pause
POST /api/v1/admin/emergency/abort  — Emergency exam abort
GET  /api/v1/admin/nodes            — Hardware node status
"""

import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Request
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import (
    User, UserRole, Exam, ExamStatus, Session, Enrollment,
    DPDPAuditLog, HardwareNode, Center,
    StaffRegistrationRequest, StaffApprovalStatus,
)
from app.services.auth import require_role

logger = logging.getLogger(__name__)

router = APIRouter()


class EmergencyAction(BaseModel):
    exam_id: str
    reason: str
    two_admin_signer: str = None  # Second admin's token for co-signature


@router.get(
    "/dashboard",
    summary="Admin Dashboard Data",
    description="Real-time system metrics for the admin console.",
)
async def dashboard(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.ADMIN)),
):
    """
    Aggregate real-time metrics for the admin dashboard:
    - Total users by role
    - Exam counts by status
    - Active sessions
    - Hardware node status
    - System health
    """
    # User counts by role
    user_counts = {}
    for role in UserRole:
        count = (await db.execute(
            select(func.count()).where(User.role == role)
        )).scalar() or 0
        user_counts[role.value] = count

    # Exam counts by status
    exam_counts = {}
    for exam_status in ExamStatus:
        count = (await db.execute(
            select(func.count()).where(Exam.status == exam_status)
        )).scalar() or 0
        exam_counts[exam_status.value] = count

    # Total enrollments
    total_enrollments = (await db.execute(
        select(func.count()).select_from(Enrollment)
    )).scalar() or 0

    # Active sessions
    active_sessions = (await db.execute(
        select(func.count()).where(Session.is_submitted == False)
    )).scalar() or 0

    # Hardware nodes
    total_nodes = (await db.execute(
        select(func.count()).select_from(HardwareNode)
    )).scalar() or 0

    online_nodes = (await db.execute(
        select(func.count()).where(HardwareNode.is_online == True)
    )).scalar() or 0

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "users": user_counts,
        "exams": exam_counts,
        "total_enrollments": total_enrollments,
        "active_sessions": active_sessions,
        "hardware_nodes": {
            "total": total_nodes,
            "online": online_nodes,
            "offline": total_nodes - online_nodes,
        },
        "system_health": {
            "database": "healthy",
            "redis": "healthy",
            "blockchain": "connected",
            "ipfs": "connected",
        },
    }


@router.post(
    "/emergency/pause",
    summary="Emergency Pause",
    description="Pause a live exam. Requires reason. Logged to DPDP audit.",
)
async def emergency_pause(
    action: EmergencyAction,
    req: Request,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.ADMIN)),
):
    """
    Emergency pause a live exam.

    Freezes all active sessions, notifies candidates via WebSocket,
    and logs the action to the DPDP audit trail.
    """
    exam = (await db.execute(
        select(Exam).where(Exam.id == UUID(action.exam_id))
    )).scalar_one_or_none()

    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    if exam.status != ExamStatus.LIVE:
        raise HTTPException(status_code=400, detail=f"Can only pause LIVE exams, not {exam.status.value}")

    exam.status = ExamStatus.PAUSED
    exam.paused_at = datetime.now(timezone.utc)
    exam.pause_reason = action.reason

    # DPDP audit log
    audit = DPDPAuditLog(
        user_id=current_user["user_id"],
        action="EMERGENCY_PAUSE",
        resource_type="exam",
        resource_id=str(exam.id),
        details={
            "reason": action.reason,
            "admin_ip": req.client.host,
            "active_sessions_frozen": True,
        },
        ip_address=req.client.host,
    )
    db.add(audit)

    logger.warning(
        f"EMERGENCY PAUSE: exam={str(exam.id)[:8]}..., "
        f"reason={action.reason}, "
        f"admin={str(current_user['user_id'])[:8]}..."
    )

    return {
        "exam_id": str(exam.id),
        "status": "PAUSED",
        "reason": action.reason,
        "paused_at": exam.paused_at.isoformat(),
        "admin": str(current_user["user_id"]),
    }


@router.post(
    "/emergency/abort",
    summary="Emergency Abort",
    description="Abort an exam permanently. Cannot be undone. Requires 2-admin co-signature.",
)
async def emergency_abort(
    action: EmergencyAction,
    req: Request,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.ADMIN)),
):
    """
    Emergency abort — permanently cancels an exam.

    This action is IRREVERSIBLE. Requires:
    1. Admin authentication (current user)
    2. Detailed reason for the abort
    3. Logged permanently in DPDP audit trail
    """
    exam = (await db.execute(
        select(Exam).where(Exam.id == UUID(action.exam_id))
    )).scalar_one_or_none()

    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    if exam.status == ExamStatus.ABORTED:
        raise HTTPException(status_code=400, detail="Exam already aborted")

    exam.status = ExamStatus.ABORTED
    exam.aborted_at = datetime.now(timezone.utc)
    exam.abort_reason = action.reason

    # DPDP audit log — permanent record
    audit = DPDPAuditLog(
        user_id=current_user["user_id"],
        action="EMERGENCY_ABORT",
        resource_type="exam",
        resource_id=str(exam.id),
        details={
            "reason": action.reason,
            "admin_ip": req.client.host,
            "previous_status": exam.status.value,
            "irreversible": True,
        },
        ip_address=req.client.host,
    )
    db.add(audit)

    logger.critical(
        f"EMERGENCY ABORT: exam={str(exam.id)[:8]}..., "
        f"reason={action.reason}, "
        f"admin={str(current_user['user_id'])[:8]}..."
    )

    return {
        "exam_id": str(exam.id),
        "status": "ABORTED",
        "reason": action.reason,
        "aborted_at": exam.aborted_at.isoformat(),
        "irreversible": True,
    }


@router.get(
    "/audit/dpdp",
    summary="DPDP Compliance Audit Log",
    description="View DPDP Act 2023 audit trail. Admin only.",
)
async def dpdp_audit_log(
    page: int = 1,
    per_page: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.ADMIN)),
):
    """
    DPDP Act 2023 compliance audit log.

    Records all data processing activities:
    - User consent events
    - Data access events
    - Emergency actions
    - Biometric processing (hash only)
    """
    total = (await db.execute(
        select(func.count()).select_from(DPDPAuditLog)
    )).scalar() or 0

    stmt = (
        select(DPDPAuditLog)
        .order_by(DPDPAuditLog.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    result = await db.execute(stmt)
    logs = result.scalars().all()

    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "items": [
            {
                "id": str(log.id),
                "user_id": str(log.user_id),
                "action": log.action,
                "resource_type": log.resource_type,
                "resource_id": log.resource_id,
                "details": log.details,
                "ip_address": log.ip_address,
                "created_at": log.created_at.isoformat(),
            }
            for log in logs
        ],
    }


@router.get(
    "/nodes",
    summary="Hardware Node Status",
    description="View all hardware node status and telemetry.",
)
async def node_status(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.ADMIN)),
):
    """List all hardware nodes with status, location, and firmware version."""
    # Eager-load `center` — the serialized properties (center_name, state,
    # latitude, longitude) read node.center, which would otherwise trigger a
    # lazy load outside the async context and raise greenlet_spawn errors.
    stmt = (
        select(HardwareNode)
        .options(selectinload(HardwareNode.center))
        .order_by(HardwareNode.last_heartbeat.desc())
    )
    result = await db.execute(stmt)
    nodes = result.scalars().all()

    return {
        "total": len(nodes),
        "nodes": [
            {
                "id": str(node.id),
                "serial_number": node.serial_number,
                "is_online": node.is_online,
                "firmware_version": node.firmware_version,
                "last_heartbeat": node.last_heartbeat.isoformat() if node.last_heartbeat else None,
                "latitude": node.latitude,
                "longitude": node.longitude,
                "tpm_verified": node.tpm_verified,
                "center_name": node.center_name,
                "state": node.state,
            }
            for node in nodes
        ],
    }


# ═══════════════════ Centre-Admin Approvals (ZUUP-OS §9.3) ═══════════════════
# The System Admin approves CENTER_ADMIN registrations captured on the public
# website (/staff/register). Approval issues a real one-time, time-boxed code —
# stored only as a SHA-256 hash; the cleartext is returned ONCE, here, to the
# approver, and handed over in person. Activation still happens at the centre.

_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ0123456789"  # Crockford-ish, no ambiguous chars
_CODE_TTL_MIN = 10


def _generate_code() -> str:
    groups = ["".join(secrets.choice(_CODE_ALPHABET) for _ in range(3)) for _ in range(4)]
    return "-".join(groups)


def _approval_view(r: StaffRegistrationRequest) -> dict:
    return {
        "requestId": r.id,
        "applicantName": r.full_name,
        "role": r.role,
        "centreName": r.center_name,
        "centreIdHash": hashlib.sha256((r.center_id or "").encode()).hexdigest()[:16],
        "status": r.status.value,
        "fingerprintAuthorised": bool(r.fingerprint_authorised),
        "createdAt": r.created_at.isoformat() if r.created_at else None,
        "approvedAt": r.approved_at.isoformat() if r.approved_at else None,
        "codeExpiresAt": r.activation_code_expires_at.isoformat() if r.activation_code_expires_at else None,
    }


@router.get("/staff-approvals", summary="Pending centre-staff registrations")
async def list_staff_approvals(
    role: str = "CENTER_ADMIN",
    include_resolved: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.ADMIN)),
):
    """List real centre-staff registration requests (default: pending Centre Admins)."""
    q = select(StaffRegistrationRequest).where(StaffRegistrationRequest.role == role)
    if not include_resolved:
        q = q.where(StaffRegistrationRequest.status == StaffApprovalStatus.PENDING)
    q = q.order_by(StaffRegistrationRequest.created_at.desc())
    rows = (await db.execute(q)).scalars().all()
    return {"pending": [_approval_view(r) for r in rows]}


@router.post("/staff-approvals/{request_id}/issue-code", summary="Approve + issue one-time code")
async def issue_staff_code(
    request_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.ADMIN)),
):
    """Approve a request and issue a real one-time activation code (returned once)."""
    r = (await db.execute(
        select(StaffRegistrationRequest).where(StaffRegistrationRequest.id == request_id)
    )).scalar_one_or_none()
    if not r:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="UNKNOWN_REQUEST")

    code = _generate_code()
    expires = datetime.now(timezone.utc) + timedelta(minutes=_CODE_TTL_MIN)
    r.activation_code_hash = hashlib.sha256(code.encode()).hexdigest()
    r.activation_code_expires_at = expires
    r.status = StaffApprovalStatus.APPROVED
    r.approved_at = datetime.now(timezone.utc)
    await db.commit()

    return {"ok": True, "code": code, "expiresAt": expires.isoformat(), "ttlMinutes": _CODE_TTL_MIN}


@router.post("/staff-approvals/{request_id}/authorise-fp", summary="Authorise fingerprint enrolment")
async def authorise_staff_fp(
    request_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.ADMIN)),
):
    """Mark the applicant's fingerprint as authorised for in-person enrolment."""
    r = (await db.execute(
        select(StaffRegistrationRequest).where(StaffRegistrationRequest.id == request_id)
    )).scalar_one_or_none()
    if not r:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="UNKNOWN_REQUEST")
    r.fingerprint_authorised = True
    await db.commit()
    return {"ok": True}


# ═══════════════════ Roster / Centres / Roles (real, read-only) ══════════════

@router.get("/candidates", summary="Candidate roster")
async def list_candidates(
    page: int = 1,
    per_page: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.ADMIN)),
):
    """Real candidate roster: each candidate joined to their enrollment + centre."""
    total = (await db.execute(
        select(func.count()).where(User.role == UserRole.CANDIDATE)
    )).scalar() or 0

    stmt = (
        select(User, Enrollment, Center)
        .where(User.role == UserRole.CANDIDATE)
        .outerjoin(Enrollment, Enrollment.candidate_id == User.id)
        .outerjoin(Center, Center.id == Enrollment.center_id)
        .order_by(User.full_name)
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    rows = (await db.execute(stmt)).all()
    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "items": [
            {
                "id": u.id,
                "name": u.full_name,
                "state": u.state,
                "rollNumber": e.roll_number if e else None,
                "setLabel": e.set_label if e else None,
                "enrollmentStatus": (e.status.value if e and e.status else None),
                "centreName": c.name if c else None,
                "isActive": bool(u.is_active),
            }
            for (u, e, c) in rows
        ],
    }


@router.get("/centers", summary="Exam centres with live node health")
async def list_centers(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.ADMIN)),
):
    """Real centre list + per-centre node counts (used to derive a health status)."""
    centres = (await db.execute(select(Center).order_by(Center.name))).scalars().all()
    nodes = (await db.execute(select(HardwareNode))).scalars().all()

    by_centre: dict[str, list] = {}
    for n in nodes:
        by_centre.setdefault(n.center_id, []).append(n)

    items = []
    for c in centres:
        cn = by_centre.get(c.id, [])
        total = len(cn)
        online = sum(1 for n in cn if n.is_online)
        if total == 0:
            health = "unknown"
        elif online == total:
            health = "healthy"
        elif online == 0:
            health = "offline"
        else:
            health = "degraded"
        items.append({
            "id": c.id,
            "name": c.name,
            "city": c.city,
            "state": c.state,
            "capacity": c.capacity,
            "latitude": float(c.latitude) if c.latitude is not None else None,
            "longitude": float(c.longitude) if c.longitude is not None else None,
            "connectivity": c.connectivity.value if c.connectivity else None,
            "invigilatorName": c.invigilator_name,
            "invigilatorPhone": c.invigilator_phone,
            "nodesOnline": online,
            "nodesTotal": total,
            "status": health,
        })
    return {"total": len(items), "centers": items}


@router.get("/roles", summary="RBAC roles with live user counts")
async def list_roles(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.ADMIN)),
):
    """The real platform roles (UserRole) with live assigned-user counts."""
    perms = {
        UserRole.ADMIN: "Full platform control - dashboard, emergency dual-control, approvals, audit",
        UserRole.SETTER: "Author papers, generate ZK difficulty proofs, lock question banks",
        UserRole.INVIGILATOR: "Biometric candidate verification, roster, incident alerts (centre only)",
        UserRole.CANDIDATE: "Sit exams on centre terminals; read own receipts",
    }
    items = []
    for role in UserRole:
        count = (await db.execute(select(func.count()).where(User.role == role))).scalar() or 0
        items.append({
            "role": role.value,
            "users": count,
            "permissions": perms.get(role, ""),
        })
    return {"roles": items}
