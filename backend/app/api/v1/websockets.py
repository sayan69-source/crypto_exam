"""
CryptoExam Core — WebSocket Channels
§ 8 — Real-time communication channels.

Channels:
  /ws/dashboard         — Admin dashboard real-time updates
  /ws/exam/{exam_id}    — Live exam monitoring (admin)
  /ws/session/{sid}     — Candidate session heartbeat (anti-cheat)
  /ws/nodes             — Hardware node telemetry (admin)
"""

import json
import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from app.websocket_manager import ws_manager
from app.services.broadcast_service import broadcast_service

logger = logging.getLogger(__name__)

router = APIRouter()


@router.websocket("/broadcast/{exam_id}")
async def ws_exam_broadcast(websocket: WebSocket, exam_id: str, token: str = Query(None)):
    """
    § 27 — Candidate T₀ broadcast channel.

    400,000 clients connect here before T₀ and wait. At T₀ the backend publishes a
    single EXAM_UNLOCK event (Redis pub/sub → all instances → all clients), and each
    client decrypts its pre-positioned paper locally. Clients report SESSION_START
    back for the on-chain Proof-of-Delivery tally.
    """
    await broadcast_service.connect(websocket, exam_id)
    try:
        while True:
            msg = json.loads(await websocket.receive_text())
            if msg.get("event") == "SESSION_START":
                count = await broadcast_service.record_session_start(
                    exam_id, msg.get("candidateId", "unknown"), msg.get("centerNodeId"),
                )
                await websocket.send_json({"event": "SESSION_START_ACK", "deliveredCount": count})
            elif msg.get("action") == "ping":
                await websocket.send_json({"event": "pong", "examId": exam_id})
    except WebSocketDisconnect:
        broadcast_service.disconnect(websocket, exam_id)
        logger.info(f"Broadcast WS disconnected: exam={exam_id[:8]}...")


@router.websocket("/dashboard")
async def ws_dashboard(websocket: WebSocket, token: str = Query(None)):
    """
    Admin dashboard — broadcasts system metrics every 5 seconds.

    Pushed data:
      - Active session count
      - Exam status changes
      - Hardware node online/offline transitions
      - Anomaly alerts
    """
    await ws_manager.connect(websocket, room="dashboard")
    try:
        while True:
            data = await websocket.receive_text()
            # Admin can send commands via WebSocket
            msg = json.loads(data)
            logger.info(f"Dashboard WS command: {msg.get('action', 'unknown')}")

            if msg.get("action") == "ping":
                await websocket.send_json({
                    "type": "pong",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })

    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, room="dashboard")
        logger.info("Dashboard WS client disconnected")


@router.websocket("/exam/{exam_id}")
async def ws_exam_monitor(websocket: WebSocket, exam_id: str, token: str = Query(None)):
    """
    Live exam monitoring — real-time updates for a specific exam.

    Pushed data:
      - Candidate session starts/submits
      - Answer submission counts
      - Time remaining broadcasts
      - Anomaly detection alerts (tab switch, face mismatch)
    """
    room = f"exam:{exam_id}"
    await ws_manager.connect(websocket, room=room)
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)

            if msg.get("action") == "ping":
                await websocket.send_json({
                    "type": "pong",
                    "exam_id": exam_id,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })

    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, room=room)
        logger.info(f"Exam WS client disconnected: exam={exam_id[:8]}...")


@router.websocket("/session/{session_id}")
async def ws_session_heartbeat(
    websocket: WebSocket,
    session_id: str,
    token: str = Query(None),
):
    """
    Candidate session heartbeat — anti-cheat monitoring.

    Client sends:
      - Periodic heartbeats (every 10 seconds)
      - Tab visibility change events
      - Window focus/blur events

    Server sends:
      - Time remaining updates
      - Emergency notifications (pause/abort)
      - Paper decrypted notification at T₀
    """
    room = f"session:{session_id}"
    await ws_manager.connect(websocket, room=room)
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)

            if msg.get("type") == "heartbeat":
                await websocket.send_json({
                    "type": "heartbeat_ack",
                    "session_id": session_id,
                    "server_time": datetime.now(timezone.utc).isoformat(),
                })

            elif msg.get("type") == "tab_hidden":
                logger.warning(
                    f"TAB HIDDEN: session={session_id[:8]}..., "
                    f"timestamp={msg.get('timestamp', 'unknown')}"
                )
                # Broadcast to exam monitoring room
                exam_room = f"exam:{msg.get('exam_id', 'unknown')}"
                await ws_manager.broadcast(exam_room, {
                    "type": "anomaly",
                    "anomaly_type": "tab_hidden",
                    "session_id": session_id,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })

            elif msg.get("type") == "focus_lost":
                logger.warning(
                    f"FOCUS LOST: session={session_id[:8]}..., "
                    f"timestamp={msg.get('timestamp', 'unknown')}"
                )

    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, room=room)
        logger.info(f"Session WS disconnected: {session_id[:8]}...")


@router.websocket("/nodes")
async def ws_node_telemetry(websocket: WebSocket, token: str = Query(None)):
    """
    Hardware node telemetry — real-time node status.

    Nodes push:
      - Heartbeat with GPS coordinates
      - Time-lock puzzle progress (%)
      - TPM attestation status
      - Paper decryption events

    Admin console visualizes node locations on a map.
    """
    await ws_manager.connect(websocket, room="nodes")
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)

            if msg.get("type") == "node_heartbeat":
                # Broadcast to admin dashboard
                await ws_manager.broadcast("dashboard", {
                    "type": "node_update",
                    "node_id": msg.get("node_id"),
                    "status": msg.get("status"),
                    "gps": msg.get("gps"),
                    "puzzle_progress": msg.get("puzzle_progress"),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })

            elif msg.get("type") == "paper_decrypted":
                logger.info(
                    f"PAPER DECRYPTED: node={msg.get('node_id', 'unknown')[:8]}..., "
                    f"exam={msg.get('exam_id', 'unknown')[:8]}..."
                )
                await ws_manager.broadcast("dashboard", {
                    "type": "paper_decrypted",
                    "node_id": msg.get("node_id"),
                    "exam_id": msg.get("exam_id"),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })

    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, room="nodes")
        logger.info("Node WS client disconnected")
