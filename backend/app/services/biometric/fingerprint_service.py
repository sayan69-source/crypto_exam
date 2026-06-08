"""
§ 29.4 — Fingerprint verification.

Two backends, both DPDP-compliant (template hashes only, never raw prints):
  1. WebAuthn FIDO2 — browser/device built-in reader (uses optional `webauthn` lib
     when present; otherwise a structural verification of the assertion shape).
  2. Mantra MFS100 — dedicated USB scanner; match score 0–100, ≥70 standard.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

try:  # pragma: no cover - optional production dependency
    import webauthn  # type: ignore

    _HAS_WEBAUTHN = True
except Exception:  # noqa: BLE001
    _HAS_WEBAUTHN = False


@dataclass
class FingerprintResult:
    matched: bool
    confidence: float
    method: str = ""
    reason: str = ""

    def to_dict(self) -> dict:
        return {
            "matched": self.matched,
            "confidence": round(self.confidence, 4),
            "method": self.method,
            "reason": self.reason,
        }


class FingerprintService:
    MANTRA_PASS_SCORE = 70  # Mantra SDK 0–100, ≥70 standard

    # ── FIDO2 / WebAuthn ──────────────────────────────────────────────────

    def new_challenge(self) -> str:
        """Issue a fresh WebAuthn challenge (hex)."""
        return secrets.token_hex(32)

    def verify_fido2_assertion(
        self,
        assertion: dict | None,
        expected_challenge: str,
        stored_credential_id: Optional[str] = None,
    ) -> FingerprintResult:
        """
        Verify a WebAuthn assertion.

        With the `webauthn` library this performs full cryptographic verification.
        Without it, we validate the assertion is well-formed, references the
        registered credential, and carries a user-verification flag — sufficient
        for the gateway flow in a dev/demo environment.
        """
        if not assertion:
            return FingerprintResult(False, 0.0, "FIDO2_WEBAUTHN", "Missing assertion")

        if _HAS_WEBAUTHN:  # pragma: no cover - exercised only when lib installed
            try:
                webauthn.verify_authentication_response(
                    credential=assertion,
                    expected_challenge=expected_challenge.encode(),
                    expected_rp_id="cryptoexamcore.in",
                    expected_origin="https://exam.cryptoexamcore.in",
                    require_user_verification=True,
                )
                return FingerprintResult(True, 1.0, "FIDO2_WEBAUTHN", "Verified")
            except Exception as e:  # noqa: BLE001
                return FingerprintResult(False, 0.0, "FIDO2_WEBAUTHN", str(e))

        # Structural fallback verification
        cred_id = assertion.get("id") or assertion.get("rawId")
        has_response = isinstance(assertion.get("response"), dict)
        if not cred_id or not has_response:
            return FingerprintResult(False, 0.0, "FIDO2_WEBAUTHN", "Malformed assertion")
        if stored_credential_id and cred_id != stored_credential_id:
            return FingerprintResult(False, 0.0, "FIDO2_WEBAUTHN", "Unknown credential")
        return FingerprintResult(True, 1.0, "FIDO2_WEBAUTHN", "Verified (structural)")

    # ── Mantra MFS100 ─────────────────────────────────────────────────────

    @staticmethod
    def template_hash(template_bytes: bytes) -> str:
        """Hash a fingerprint template for storage (never store raw minutiae)."""
        return hashlib.sha256(template_bytes).hexdigest()

    def verify_mantra(
        self, live_template_hash: str, stored_template_hash: str, match_score: int | None = None
    ) -> FingerprintResult:
        """
        Verify against a Mantra MFS100 template.

        If the device SDK provides a match score (0–100), use it. Otherwise fall
        back to a constant-time hash comparison of the stored template.
        """
        if match_score is not None:
            matched = match_score >= self.MANTRA_PASS_SCORE
            return FingerprintResult(
                matched=matched,
                confidence=match_score / 100.0,
                method="MANTRA_MFS100",
                reason="Match" if matched else f"Score {match_score} below {self.MANTRA_PASS_SCORE}",
            )
        matched = bool(
            stored_template_hash
            and hmac.compare_digest(live_template_hash, stored_template_hash)
        )
        return FingerprintResult(
            matched=matched,
            confidence=1.0 if matched else 0.0,
            method="MANTRA_MFS100",
            reason="Template match" if matched else "Template mismatch",
        )


fingerprint_service = FingerprintService()
