"""
CryptoExam Core — § 27 Mass delivery control plane (HTTP side of the T₀ broadcast).

  POST /api/v1/broadcast/trigger/{exam_id}   — admin: publish EXAM_UNLOCK at T₀
  GET  /api/v1/broadcast/delivery/{exam_id}  — live Proof-of-Delivery tally
  GET  /api/v1/broadcast/drand               — fetch the current drand beacon
"""

import logging

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.config import get_settings
from app.models import UserRole
from app.services.auth import require_role
from app.services.broadcast_service import broadcast_service

logger = logging.getLogger(__name__)
settings = get_settings()
router = APIRouter()

DRAND_URL = "https://api.drand.sh/public/latest"


class UnlockTrigger(BaseModel):
    drand_round: int | None = None
    beacon_hash: str | None = None     # override (else fetched from drand)
    signature: str | None = None


async def _fetch_drand() -> dict:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(DRAND_URL)
            r.raise_for_status()
            return r.json()
    except Exception as e:  # noqa: BLE001
        logger.warning("drand fetch failed (%s) — using deterministic fallback beacon", e)
        import hashlib, time
        seed = hashlib.sha256(str(int(time.time())).encode()).hexdigest()
        return {"round": int(time.time()), "randomness": seed, "signature": seed + seed}


@router.get("/drand", summary="Current drand beacon")
async def get_drand():
    return await _fetch_drand()


@router.post("/trigger/{exam_id}", summary="Trigger T₀ exam unlock broadcast")
async def trigger_unlock(
    exam_id: str,
    body: UnlockTrigger | None = None,
    current=Depends(require_role(UserRole.ADMIN, UserRole.SETTER)),
):
    """Publish the EXAM_UNLOCK event to all connected candidates (Redis fan-out)."""
    if body and body.beacon_hash:
        beacon = {"round": body.drand_round, "randomness": body.beacon_hash, "signature": body.signature or body.beacon_hash}
    else:
        beacon = await _fetch_drand()
    payload = await broadcast_service.trigger_exam_unlock(exam_id, beacon)
    return {"status": "BROADCAST", "exam_id": exam_id, "unlock": payload}


@router.get("/delivery/{exam_id}", summary="Proof-of-Delivery tally")
async def delivery_count(exam_id: str):
    return {"exam_id": exam_id, "delivered_count": broadcast_service.delivery_count(exam_id)}
