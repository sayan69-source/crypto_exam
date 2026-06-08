"""
§ 29 — Centre Invigilator Biometric Gateway services.

Two verification layers:
  Layer 1: Invigilator self-authentication (face + FIDO2 + TOTP + geofence)
  Layer 2: Candidate verification (face + fingerprint) before paper unlock

DPDP Act 2023 compliance: only derived embeddings / template hashes are stored,
never the raw photo or fingerprint image.
"""

from app.services.biometric.face_service import face_service, FaceVerificationResult
from app.services.biometric.fingerprint_service import fingerprint_service, FingerprintResult
from app.services.biometric.geofence import geofence_service

__all__ = [
    "face_service",
    "FaceVerificationResult",
    "fingerprint_service",
    "FingerprintResult",
    "geofence_service",
]
