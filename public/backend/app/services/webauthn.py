"""
WebAuthn assertion verification — the real fingerprint check for tier-0 login.

WHY IT IS HAND-ROLLED
---------------------
Verifying an assertion needs three things: the stored public key, a SHA-256, and
a signature check. `cryptography` (already a dependency) does all three. The
usual reason to reach for a library is parsing `attestationObject`, which is
CBOR — and we avoid that entirely by having the browser hand us the public key
in SPKI DER via `AuthenticatorAttestationResponse.getPublicKey()`. So there is
no CBOR parser here, and no new dependency, and the part that matters — the
signature check — is the standard library primitive rather than our own maths.

WHAT IS ACTUALLY CHECKED (all of it, in order)
    1. clientData.type is exactly "webauthn.get"
    2. clientData.challenge equals the challenge THIS server issued, once
    3. clientData.origin is an origin we accept
    4. rpIdHash in authenticatorData == SHA-256(expected RP ID)
    5. the User Present flag is set — a human touched the sensor
    6. the User Verified flag is set — the fingerprint/PIN actually matched,
       not merely "someone tapped the key"
    7. the signature over authenticatorData ‖ SHA-256(clientDataJSON) verifies
       against the enrolled public key
    8. the signature counter advanced (clone detection)

Skipping any one of these turns the ceremony into theatre; (6) in particular is
the difference between "a device was present" and "this person's fingerprint
matched".
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
from dataclasses import dataclass

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from cryptography.hazmat.primitives.serialization import load_der_public_key

logger = logging.getLogger(__name__)

# Authenticator data flag bits (WebAuthn §6.1).
FLAG_USER_PRESENT = 0x01
FLAG_USER_VERIFIED = 0x04


class WebAuthnError(Exception):
    """Raised for any failed check. The message is safe to log, not to show."""


def b64url_decode(data: str) -> bytes:
    """Decode base64url without padding, which is how WebAuthn transports bytes."""
    if not isinstance(data, str):
        raise WebAuthnError("expected a base64url string")
    pad = "=" * (-len(data) % 4)
    try:
        return base64.urlsafe_b64decode(data + pad)
    except Exception as exc:
        raise WebAuthnError(f"malformed base64url: {exc}") from exc


def b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


@dataclass
class AssertionResult:
    new_sign_count: int
    user_verified: bool


def _verify_signature(public_key_spki: bytes, signed: bytes, signature: bytes) -> None:
    try:
        key = load_der_public_key(public_key_spki)
    except Exception as exc:
        raise WebAuthnError(f"stored public key is unreadable: {exc}") from exc

    try:
        if isinstance(key, ec.EllipticCurvePublicKey):
            # ES256 — the platform-authenticator default.
            key.verify(signature, signed, ec.ECDSA(hashes.SHA256()))
        elif isinstance(key, rsa.RSAPublicKey):
            # RS256 — some Windows Hello configurations.
            key.verify(signature, signed, padding.PKCS1v15(), hashes.SHA256())
        else:
            raise WebAuthnError(f"unsupported key type {type(key).__name__}")
    except InvalidSignature as exc:
        raise WebAuthnError("signature did not verify") from exc


def verify_assertion(
    *,
    client_data_json_b64: str,
    authenticator_data_b64: str,
    signature_b64: str,
    expected_challenge: str,
    expected_origins: list[str],
    expected_rp_id: str,
    public_key_spki: bytes,
    stored_sign_count: int,
    require_user_verification: bool = True,
) -> AssertionResult:
    """Run every check. Returns the new counter, or raises WebAuthnError."""
    client_data_raw = b64url_decode(client_data_json_b64)
    auth_data = b64url_decode(authenticator_data_b64)
    signature = b64url_decode(signature_b64)

    # 1–3 — what the browser says it signed.
    try:
        client_data = json.loads(client_data_raw.decode("utf-8"))
    except Exception as exc:
        raise WebAuthnError(f"clientDataJSON is not JSON: {exc}") from exc

    if client_data.get("type") != "webauthn.get":
        raise WebAuthnError(f"wrong ceremony type {client_data.get('type')!r}")

    # Compare raw bytes, not strings: base64url padding differences are not a
    # mismatch, and a string compare would reject a legitimate assertion.
    if b64url_decode(client_data.get("challenge", "")) != b64url_decode(expected_challenge):
        raise WebAuthnError("challenge does not match the one this server issued")

    origin = client_data.get("origin")
    if origin not in expected_origins:
        raise WebAuthnError(f"origin {origin!r} is not permitted")

    # 4 — the assertion is for our relying party, not someone else's site.
    if len(auth_data) < 37:
        raise WebAuthnError("authenticatorData is too short")
    rp_id_hash = auth_data[:32]
    if rp_id_hash != hashlib.sha256(expected_rp_id.encode()).digest():
        raise WebAuthnError("rpIdHash does not match the expected relying party")

    # 5–6 — a human was present, and was actually verified.
    flags = auth_data[32]
    if not flags & FLAG_USER_PRESENT:
        raise WebAuthnError("user presence flag not set")
    user_verified = bool(flags & FLAG_USER_VERIFIED)
    if require_user_verification and not user_verified:
        raise WebAuthnError(
            "user verification flag not set — the fingerprint or PIN was not checked"
        )

    # 7 — the signature itself.
    signed = auth_data + hashlib.sha256(client_data_raw).digest()
    _verify_signature(public_key_spki, signed, signature)

    # 8 — clone detection. Authenticators that do not implement a counter report
    # 0 forever, which is legitimate; only a NON-ZERO counter that failed to
    # advance indicates a replay or a cloned credential.
    new_count = int.from_bytes(auth_data[33:37], "big")
    if new_count != 0 and new_count <= stored_sign_count:
        raise WebAuthnError(
            f"signature counter did not advance ({new_count} <= {stored_sign_count}); "
            "the authenticator may have been cloned"
        )

    return AssertionResult(new_sign_count=new_count, user_verified=user_verified)


def parse_registration_public_key(public_key_spki_b64: str) -> bytes:
    """
    Accept the SPKI DER the browser produced at enrolment, after proving we can
    actually load it — storing an unusable key would only fail at first login,
    when the operator has no other way in.
    """
    spki = b64url_decode(public_key_spki_b64)
    try:
        load_der_public_key(spki)
    except Exception as exc:
        raise WebAuthnError(f"enrolment public key is unreadable: {exc}") from exc
    return spki
