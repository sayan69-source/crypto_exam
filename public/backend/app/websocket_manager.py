"""
CryptoExam Core — WebSocket Connection Manager
Manages WebSocket pools for real-time admin dashboard, anomaly feed,
exam status, and AI generation progress streaming.
"""

from fastapi import WebSocket
from collections import defaultdict
import json
import logging

logger = logging.getLogger(__name__)


class ConnectionManager:
    """
    WebSocket connection manager with room-based broadcasting.

    Rooms:
      - admin:dashboard       — Live metrics push
      - admin:centers:{id}    — Center status updates per exam
      - admin:anomalies       — Anomaly stream
      - admin:nodes:{id}      — Node heartbeat stream per exam
      - exam:{id}:status      — Exam status updates to candidates
      - generation:{task_id}  — AI generation progress stream
    """

    def __init__(self):
        self.rooms: dict[str, list[WebSocket]] = defaultdict(list)

    async def connect(self, websocket: WebSocket, room: str):
        """Accept WebSocket connection and add to room."""
        await websocket.accept()
        self.rooms[room].append(websocket)
        logger.info(f"WebSocket connected to room: {room} (total: {len(self.rooms[room])})")

    def disconnect(self, websocket: WebSocket, room: str):
        """Remove WebSocket from room."""
        if websocket in self.rooms[room]:
            self.rooms[room].remove(websocket)
        if not self.rooms[room]:
            del self.rooms[room]
        logger.info(f"WebSocket disconnected from room: {room}")

    async def broadcast(self, room: str, data: dict):
        """Broadcast JSON message to all connections in a room."""
        message = json.dumps(data)
        dead_connections = []
        for ws in self.rooms.get(room, []):
            try:
                await ws.send_text(message)
            except Exception:
                dead_connections.append(ws)
        # Clean up dead connections
        for ws in dead_connections:
            self.disconnect(ws, room)

    async def send_personal(self, websocket: WebSocket, data: dict):
        """Send JSON message to a specific connection."""
        await websocket.send_text(json.dumps(data))

    def get_room_count(self, room: str) -> int:
        """Get number of active connections in a room."""
        return len(self.rooms.get(room, []))

    def get_all_rooms(self) -> dict[str, int]:
        """Get all active rooms with connection counts."""
        return {room: len(conns) for room, conns in self.rooms.items()}


# Global singleton
ws_manager = ConnectionManager()
