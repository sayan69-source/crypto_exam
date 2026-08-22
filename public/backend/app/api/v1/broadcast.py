"""
CryptoExam Core — § 27 Mass delivery control plane (HTTP side of the T₀ broadcast).

  POST /api/v1/broadcast/trigger/{exam_id}   — admin: publish EXAM_UNLOCK at T₀
  GET  /api/v1/broadcast/delivery/{exam_id}  — live Proof-of-Delivery tally
  GET  /api/v1/broadcast/drand               — fetch the current drand beacon
"""

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.config import get_settings
from app.models import UserRole
from app.services.auth import require_role
from app.services.broadcast_service import broadcast_service

logger = logging.getLogger(__name__)
settings = get_settings()
router = APIRouter()

# drand's League of Entropy publishes the same chain through several
# independently operated HTTP relays. One of them refusing a request is routine
# — it does not mean the beacon is unavailable — so all of them are tried before
# the exam is declared un-unlockable. They are relays over one chain, so the
# round they return is the same fact from a different messenger, not a second
# opinion to be reconciled.
DRAND_RELAYS = (
    "https://api.drand.sh",
    "https://api2.drand.sh",
    "https://api3.drand.sh",
    "https://drand.cloudflare.com",
)
DRAND_PATH = "/public/latest"
DRAND_URL = DRAND_RELAYS[0] + DRAND_PATH


class UnlockTrigger(BaseModel):
    drand_round: int | None = None
    beacon_hash: str | None = None     # override (else fetched from drand)
    signature: str | None = None


async def _fetch_drand() -> dict:
    """
    Fetch the public randomness beacon that gates T₀.

    FAIL CLOSED. The whole point of deriving the unlock key from drand is that
    the randomness is produced by a distributed network no one here controls,
    and does not exist until its round arrives. If that is unreachable, the
    honest outcome is "the exam cannot be unlocked right now" — not a locally
    computed substitute.

    The substitute this used to return was sha256(current_unix_second), with a
    "signature" of that value concatenated with itself. Anyone could compute
    the beacon for any future second and derive the paper key ahead of time,
    and nothing in any response said the guarantee was gone. That converts
    Guarantee #1 into decoration.
    """
    errors: list[str] = []
    async with httpx.AsyncClient(timeout=5.0) as client:
        for relay in DRAND_RELAYS:
            try:
                r = await client.get(relay + DRAND_PATH)
                r.raise_for_status()
                beacon = r.json()
            except Exception as e:  # noqa: BLE001 — try the next relay
                errors.append(f"{relay}: {type(e).__name__}: {e}")
                continue

            # A relay that answers 200 with something that is not a beacon is a
            # failed relay, not a beacon — keep going rather than pass it on.
            if not beacon.get("randomness") or not beacon.get("round"):
                errors.append(f"{relay}: malformed beacon {list(beacon)[:5]}")
                continue

            beacon["source"] = f"drand:{relay.removeprefix('https://')}"
            if errors:
                logger.info("drand served by %s after %d relay failure(s)", relay, len(errors))
            return beacon

    if not settings.ALLOW_INSECURE_DRAND_FALLBACK:
        logger.error("every drand relay failed — refusing to substitute a local beacon: %s", errors)
        raise HTTPException(
            status_code=503,
            detail={
                "reason": "BEACON_UNAVAILABLE",
                "message": (
                    "The drand randomness beacon is unreachable on every relay, so no T₀ "
                    "key can be derived. Refusing to substitute a locally computed value "
                    "— that would let anyone derive the paper key early."
                ),
                "relays_tried": list(DRAND_RELAYS),
                "errors": errors,
            },
        )
    # Explicitly enabled for offline development. Labelled at every layer so
    # it can never be mistaken for the real thing in a UI or a recording.
    logger.warning(
        "drand unreachable (%s) — ALLOW_INSECURE_DRAND_FALLBACK is set, "
        "emitting an INSECURE local beacon. The time-lock guarantee does NOT hold.",
        "; ".join(errors),
    )
    import hashlib, time
    seed = hashlib.sha256(str(int(time.time())).encode()).hexdigest()
    return {
        "round": int(time.time()),
        "randomness": seed,
        "signature": seed + seed,
        "source": "INSECURE_LOCAL_FALLBACK",
        "warning": "NOT a drand beacon. Derived from the local clock. The T₀ time-lock does not hold.",
    }


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
