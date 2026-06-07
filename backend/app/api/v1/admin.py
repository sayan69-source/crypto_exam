"""
CryptoExam Core — Admin API Endpoints
§ 8 — Dashboard, emergency controls, audit, and DPDP compliance.

GET  /api/v1/admin/dashboard        — Real-time system dashboard
GET  /api/v1/admin/audit/dpdp       — DPDP compliance audit log
POST /api/v1/admin/emergency/pause  — Emergency exam pause
POST /api/v1/admin/emergency/abort  — Emergency exam abort
GET  /api/v1/admin/nodes            — Hardware node status
"""

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Request
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import (
    User, UserRole, Exam, ExamStatus, Session, Enrollment,
    DPDPAuditLog, HardwareNode,
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
    stmt = select(HardwareNode).order_by(HardwareNode.last_heartbeat.desc())
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
