"""
§ 29.4 — Face Verification Service.

DPDP Act 2023 data minimisation:
  - enroll() returns a derived face *embedding* (feature vector). Store this, NOT the photo.
  - The original photo is never retained post-enrollment.

Pluggable matcher
-----------------
If the optional `face_recognition` (dlib) library is installed, it is used to
produce a 128-d face embedding — the production path described in the spec.

Otherwise a dependency-free fallback embedding is used: the face image is
converted to greyscale, resized to 16×16, histogram-equalised and L2-normalised
into a 256-float vector. Matching uses cosine similarity. This is fully runnable
without native build tools and is swappable for dlib by installing the library —
the public interface (enroll / verify) does not change.
"""

from __future__ import annotations

import io
import logging
from base64 import b64decode
from dataclasses import dataclass
from typing import Optional

import numpy as np
from PIL import Image, ImageOps

logger = logging.getLogger(__name__)

# Detect optional production-grade backend
try:  # pragma: no cover - depends on environment
    import face_recognition  # type: ignore

    _HAS_DLIB = True
    logger.info("FaceVerificationService: using face_recognition (dlib) backend")
except Exception:  # noqa: BLE001
    _HAS_DLIB = False
    logger.info("FaceVerificationService: using dependency-free fallback embedding backend")


@dataclass
class FaceVerificationResult:
    matched: bool
    confidence: float
    distance: float = 0.0
    reason: str = ""

    def to_dict(self) -> dict:
        return {
            "matched": self.matched,
            "confidence": round(self.confidence, 4),
            "distance": round(self.distance, 4),
            "reason": self.reason,
            "backend": "dlib" if _HAS_DLIB else "fallback",
        }


class FaceVerificationService:
    """Compares a live capture against a stored, derived embedding."""

    CONFIDENCE_THRESHOLD = 0.90   # invigilator login (§29.4)
    CANDIDATE_THRESHOLD = 0.85    # candidate verification (lighting/makeup tolerance)

    # ── internal helpers ──────────────────────────────────────────────────

    @staticmethod
    def _decode_image(image_b64_or_bytes) -> bytes:
        """Accept a data URL, bare base64 string, or raw bytes."""
        if isinstance(image_b64_or_bytes, (bytes, bytearray)):
            return bytes(image_b64_or_bytes)
        s = image_b64_or_bytes
        if "," in s:  # strip data URL prefix e.g. "data:image/jpeg;base64,...."
            s = s.split(",", 1)[1]
        return b64decode(s)

    def _fallback_embedding(self, photo_bytes: bytes) -> np.ndarray:
        """Dependency-free perceptual embedding (256 floats, L2-normalised)."""
        img = Image.open(io.BytesIO(photo_bytes)).convert("L")
        img = ImageOps.equalize(ImageOps.autocontrast(img))
        img = img.resize((16, 16), Image.LANCZOS)
        vec = np.asarray(img, dtype=np.float32).flatten()
        vec = vec - vec.mean()
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec = vec / norm
        return vec

    def _embed(self, photo_bytes: bytes) -> Optional[np.ndarray]:
        if _HAS_DLIB:  # pragma: no cover
            image = face_recognition.load_image_file(io.BytesIO(photo_bytes))
            encodings = face_recognition.face_encodings(image)
            return encodings[0] if encodings else None
        return self._fallback_embedding(photo_bytes)

    # ── public API ────────────────────────────────────────────────────────

    def enroll(self, photo_b64_or_bytes) -> list[float]:
        """
        Return a derived face embedding to be stored.
        Raises ValueError if no usable face/image is found.
        """
        photo_bytes = self._decode_image(photo_b64_or_bytes)
        emb = self._embed(photo_bytes)
        if emb is None:
            raise ValueError("No face detected in enrollment image. Please retake.")
        return [float(x) for x in emb]

    def verify(
        self,
        live_image_b64,
        stored_embedding: list[float] | np.ndarray | None,
        threshold: float,
    ) -> FaceVerificationResult:
        """Compare a live capture to a stored embedding."""
        if stored_embedding is None or len(stored_embedding) == 0:
            return FaceVerificationResult(False, 0.0, reason="No enrollment embedding on file")

        try:
            live_bytes = self._decode_image(live_image_b64)
            live_emb = self._embed(live_bytes)
        except Exception as e:  # noqa: BLE001
            return FaceVerificationResult(False, 0.0, reason=f"Invalid live image: {e}")

        if live_emb is None:
            return FaceVerificationResult(False, 0.0, reason="No face detected in live image")

        stored = np.asarray(stored_embedding, dtype=np.float32)
        live = np.asarray(live_emb, dtype=np.float32)

        if _HAS_DLIB:  # pragma: no cover
            # Euclidean distance (0 = identical); convert to similarity
            distance = float(np.linalg.norm(stored - live))
            confidence = max(0.0, 1.0 - distance)
        else:
            # Cosine similarity mapped to [0, 1]
            denom = (np.linalg.norm(stored) * np.linalg.norm(live)) or 1.0
            cosine = float(np.dot(stored, live) / denom)
            confidence = max(0.0, min(1.0, (cosine + 1.0) / 2.0))
            distance = 1.0 - confidence

        matched = confidence >= threshold
        return FaceVerificationResult(
            matched=matched,
            confidence=confidence,
            distance=distance,
            reason="Match" if matched else f"Insufficient confidence ({confidence:.2%})",
        )


face_service = FaceVerificationService()
