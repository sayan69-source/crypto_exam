"""
CryptoExam Core — V3 §10 Emergency Dual-Control API.

  POST /api/v1/emergency/initiate                — admin A starts an emergency request
  POST /api/v1/emergency/{request_id}/confirm    — admin B confirms (must be ≠ initiator)
  POST /api/v1/emergency/{request_id}/reject     — admin B rejects with reason
  GET  /api/v1/emergency/pending                 — list awaiting-confirmation requests
  GET  /api/v1/emergency/history                 — recent confirmed/expired/rejected
  GET  /api/v1/emergency/stats                   — counters + exam state map
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.models import UserRole
from app.services.auth import require_role
from app.services.emergency import emergency_service, EmergencyAction

logger = logging.getLogger(__name__)
router = APIRouter()


class InitiateRequest(BaseModel):
    action: EmergencyAction
    exam_id: str
    reason: str
    params: dict | None = None


class ConfirmRequest(BaseModel):
    confirmer_id: str | None = None  # filled from JWT if omitted


class RejectRequest(BaseModel):
    rejecter_id: str | None = None
    reason: str


@router.post("/initiate", summary="Admin A — initiate emergency action")
async def initiate(
    body: InitiateRequest,
    current=Depends(require_role(UserRole.ADMIN)),
):
    req = emergency_service.initiate(
        action=body.action, initiator_id=str(current["user_id"]),
        exam_id=body.exam_id, reason=body.reason, params=body.params,
    )
    return req.to_dict()


@router.post("/{request_id}/confirm", summary="Admin B — confirm (≠ initiator)")
async def confirm(
    request_id: str, body: ConfirmRequest | None = None,
    current=Depends(require_role(UserRole.ADMIN)),
):
    try:
        req = await emergency_service.confirm(request_id, str(current["user_id"]))
        return req.to_dict()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{request_id}/reject", summary="Reject pending request")
async def reject(
    request_id: str, body: RejectRequest,
    current=Depends(require_role(UserRole.ADMIN)),
):
    try:
        req = emergency_service.reject(request_id, str(current["user_id"]), body.reason)
        return req.to_dict()
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/pending", summary="Awaiting-confirmation requests")
async def pending(current=Depends(require_role(UserRole.ADMIN))):
    return emergency_service.list_pending()


@router.get("/history", summary="Recent confirmed/expired/rejected")
async def history(limit: int = 50, current=Depends(require_role(UserRole.ADMIN))):
    return emergency_service.list_history(limit)


@router.get("/stats", summary="Counters + exam state")
async def stats(current=Depends(require_role(UserRole.ADMIN))):
    return emergency_service.stats()
