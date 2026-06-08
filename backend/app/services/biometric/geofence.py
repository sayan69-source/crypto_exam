"""
§ 29.2 — Geofence verification.

The invigilator's device GPS must be within a configured radius of the assigned
exam centre before login can proceed. Pure-Python haversine — no dependencies.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass
class GeofenceResult:
    within_center_bounds: bool
    distance_m: float
    radius_m: float
    reason: str = ""

    def to_dict(self) -> dict:
        return {
            "within_center_bounds": self.within_center_bounds,
            "distance_m": round(self.distance_m, 1),
            "radius_m": self.radius_m,
            "reason": self.reason,
        }


class GeofenceService:
    DEFAULT_RADIUS_M = 200.0      # ±200 m of assigned centre (§29.1)
    MAX_ACCEPTABLE_ACCURACY_M = 100.0

    @staticmethod
    def _haversine_m(lat1, lon1, lat2, lon2) -> float:
        r = 6_371_000.0  # Earth radius in metres
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlmb = math.radians(lon2 - lon1)
        a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
        return 2 * r * math.asin(min(1.0, math.sqrt(a)))

    def verify(
        self,
        device_lat: float,
        device_lon: float,
        center_lat: float,
        center_lon: float,
        accuracy_m: float | None = None,
        radius_m: float | None = None,
    ) -> GeofenceResult:
        radius = radius_m or self.DEFAULT_RADIUS_M
        distance = self._haversine_m(device_lat, device_lon, center_lat, center_lon)

        if accuracy_m is not None and accuracy_m > self.MAX_ACCEPTABLE_ACCURACY_M:
            return GeofenceResult(
                within_center_bounds=False,
                distance_m=distance,
                radius_m=radius,
                reason=f"GPS accuracy too low ({accuracy_m:.0f} m). Move to open sky and retry.",
            )

        # Allow the device's reported accuracy as slack on the boundary check
        effective = radius + (accuracy_m or 0.0)
        within = distance <= effective
        return GeofenceResult(
            within_center_bounds=within,
            distance_m=distance,
            radius_m=radius,
            reason="Inside centre perimeter" if within
            else f"{distance:.0f} m from centre — must be within {radius:.0f} m",
        )


geofence_service = GeofenceService()
