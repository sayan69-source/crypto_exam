import pytest
from app.services.biometric.geofence import GeofenceService

class TestGeofenceService:
    def setup_method(self):
        self.service = GeofenceService()

    def test_within_radius(self):
        # Coordinates that are very close (same point)
        lat = 28.6139
        lon = 77.2090
        result = self.service.verify(
            device_lat=lat, device_lon=lon,
            center_lat=lat, center_lon=lon,
            accuracy_m=10.0
        )
        assert result.within_center_bounds is True
        assert result.distance_m == 0.0

    def test_outside_radius(self):
        # Coordinates that are far apart
        # Delhi
        center_lat = 28.6139
        center_lon = 77.2090
        # Mumbai
        device_lat = 19.0760
        device_lon = 72.8777
        result = self.service.verify(
            device_lat=device_lat, device_lon=device_lon,
            center_lat=center_lat, center_lon=center_lon,
            accuracy_m=10.0
        )
        assert result.within_center_bounds is False
        assert result.distance_m > 200.0

    def test_low_accuracy_rejected(self):
        # Accuracy above 100m should be rejected
        lat = 28.6139
        lon = 77.2090
        result = self.service.verify(
            device_lat=lat, device_lon=lon,
            center_lat=lat, center_lon=lon,
            accuracy_m=150.0
        )
        assert result.within_center_bounds is False
        assert "accuracy too low" in result.reason

    def test_haversine_calculation(self):
        # Known distance test
        # Point 1: 0, 0
        # Point 2: 0, 1 (1 degree longitude at equator is ~111km)
        distance = self.service._haversine_m(0, 0, 0, 1)
        # 1 degree at equator is approx 111,195 meters (depending on earth radius used)
        # Given r=6371000, distance = 2 * r * asin(sin(0.5 deg)) ≈ 111195 m
        assert 111000 < distance < 112000
