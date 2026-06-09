"""
§ 10 (V3) — Emergency Dual-Control service.
"""

from app.services.emergency.dual_control import (
    EmergencyAction,
    EmergencyDualControlService,
    emergency_service,
)

__all__ = ["EmergencyAction", "EmergencyDualControlService", "emergency_service"]
