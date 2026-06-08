"""
§ 27.3 — Exam broadcast service: 4-lakh (400,000) concurrent T₀ delivery.

Pattern: pre-position encrypted papers at the edge; at T₀ broadcast only a tiny
512-byte unlock event (beaconHash + HKDF salt). Redis pub/sub fans the event out
across N WebSocket server instances (Redis → N servers → 400K clients), so the
T₀ network load is ~200 MB total and decryption happens client-side (zero server
round-trip).

Runs with or without Redis:
  - With Redis  : horizontal cluster — every instance subscribes to
                  `exam:broadcast:*` and fans out to its local sockets.
  - Without Redis: single-instance local fan-out via the in-process ws_manager.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import defaultdict

from fastapi import WebSocket

from app.config import get_settings
from app.websocket_manager import ws_manager

logger = logging.getLogger(__name__)
settings = get_settings()

try:
    import redis.asyncio as aioredis  # type: ignore
    _HAS_REDIS = True
except Exception:  # noqa: BLE001
    _HAS_REDIS = False


class ExamBroadcastService:
    CHANNEL_PREFIX = "exam:broadcast:"

    def __init__(self) -> None:
        # examId -> set[WebSocket] connected to THIS instance
        self.connections: dict[str, set[WebSocket]] = defaultdict(set)
        # examId -> count of SESSION_START events (Proof-of-Delivery tally)
        self.session_starts: dict[str, int] = defaultdict(int)
        self.redis = None
        self._subscriber_task: asyncio.Task | None = None

    async def startup(self) -> None:
        if not _HAS_REDIS:
            logger.info("BroadcastService: Redis not available — single-instance local fan-out mode")
            return
        try:
            self.redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True, max_connections=20)
            await self.redis.ping()
            self._subscriber_task = asyncio.create_task(self._redis_subscriber())
            logger.info("BroadcastService: Redis pub/sub cluster mode active")
        except Exception as e:  # noqa: BLE001
            self.redis = None
            logger.warning("BroadcastService: Redis connect failed (%s) — local fan-out mode", e)

    async def shutdown(self) -> None:
        if self._subscriber_task:
            self._subscriber_task.cancel()
        if self.redis:
            await self.redis.close()

    # ── candidate connections ────────────────────────────────────────────

    async def connect(self, ws: WebSocket, exam_id: str) -> None:
        await ws.accept()
        self.connections[exam_id].add(ws)
        await ws.send_json({
            "event": "CONNECTED",
            "examId": exam_id,
            "serverTime": int(time.time()),
            "message": "Waiting for exam to begin. Do not close this window.",
        })

    def disconnect(self, ws: WebSocket, exam_id: str) -> None:
        self.connections[exam_id].discard(ws)

    # ── T₀ trigger ───────────────────────────────────────────────────────

    async def trigger_exam_unlock(self, exam_id: str, drand_beacon: dict) -> dict:
        """Publish the EXAM_UNLOCK event to every server instance (and local sockets)."""
        payload = {
            "event": "EXAM_UNLOCK",
            "examId": exam_id,
            "drandRound": drand_beacon.get("round"),
            "beaconHash": drand_beacon.get("randomness"),
            "hkdfSalt": (drand_beacon.get("signature") or "")[:32],
            "timestamp": int(time.time()),
        }
        if self.redis:
            await self.redis.publish(f"{self.CHANNEL_PREFIX}{exam_id}", json.dumps(payload))
        else:
            await self._broadcast_to_local(exam_id, payload)
        # Also mirror to the admin/exam monitoring room for the dashboard
        await ws_manager.broadcast(f"exam:{exam_id}", {"type": "exam_unlock", **payload})
        return payload

    async def record_session_start(self, exam_id: str, candidate_id: str, center_node_id: str | None = None) -> int:
        """Tally a SESSION_START for the on-chain Proof-of-Delivery (§27.2)."""
        self.session_starts[exam_id] += 1
        count = self.session_starts[exam_id]
        await ws_manager.broadcast(f"exam:{exam_id}", {
            "type": "session_start",
            "examId": exam_id,
            "candidateId": candidate_id,
            "centerNodeId": center_node_id,
            "deliveredCount": count,
            "timestamp": int(time.time()),
        })
        return count

    def delivery_count(self, exam_id: str) -> int:
        return self.session_starts.get(exam_id, 0)

    # ── fan-out internals ────────────────────────────────────────────────

    async def _redis_subscriber(self) -> None:
        assert self.redis is not None
        pubsub = self.redis.pubsub()
        await pubsub.psubscribe(f"{self.CHANNEL_PREFIX}*")
        async for message in pubsub.listen():
            if message["type"] != "pmessage":
                continue
            exam_id = message["channel"].split(":", 2)[2]
            payload = json.loads(message["data"])
            await self._broadcast_to_local(exam_id, payload)

    async def _broadcast_to_local(self, exam_id: str, payload: dict) -> None:
        dead = set()
        await asyncio.gather(
            *[self._safe_send(ws, payload, dead) for ws in self.connections.get(exam_id, set())],
            return_exceptions=True,
        )
        self.connections[exam_id] -= dead

    @staticmethod
    async def _safe_send(ws: WebSocket, payload: dict, dead: set) -> None:
        try:
            await ws.send_json(payload)
        except Exception:  # noqa: BLE001
            dead.add(ws)


broadcast_service = ExamBroadcastService()
