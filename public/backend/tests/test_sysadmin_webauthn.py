"""
The tier-0 fingerprint check, exercised against a software authenticator.

A real fingerprint sensor cannot be driven from a test, but the thing that
actually protects the account is the SERVER-side verification, and that can be
tested exactly: build assertions the way a genuine authenticator does (ES256
over authenticatorData ‖ SHA-256(clientDataJSON)), then confirm the server
accepts the honest one and rejects every forgery.

If any of these rejections stops working, tier-0 login has silently become
"password only" — which is the failure mode this whole module exists to prevent.
"""
import base64
import hashlib
import json
import sys
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.webauthn import (  # noqa: E402
    WebAuthnError,
    b64url_encode,
    parse_registration_public_key,
    verify_assertion,
)

RP_ID = "localhost"
ORIGIN = "http://localhost:3000"
ORIGINS = [ORIGIN]


def b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


class SoftAuthenticator:
    """A minimal stand-in for the platform authenticator (Windows Hello etc.)."""

    def __init__(self, rp_id: str = RP_ID, user_verified: bool = True):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.rp_id = rp_id
        self.user_verified = user_verified
        self.counter = 0

    @property
    def public_key_spki_b64(self) -> str:
        spki = self.key.public_key().public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo)
        return b64u(spki)

    def _auth_data(self) -> bytes:
        self.counter += 1
        flags = 0x01 | (0x04 if self.user_verified else 0x00)
        return (
            hashlib.sha256(self.rp_id.encode()).digest()
            + bytes([flags])
            + self.counter.to_bytes(4, "big")
        )

    def assert_(self, challenge: str, origin: str = ORIGIN, ceremony: str = "webauthn.get"):
        client_data = json.dumps(
            {"type": ceremony, "challenge": challenge, "origin": origin}
        ).encode()
        auth_data = self._auth_data()
        signed = auth_data + hashlib.sha256(client_data).digest()
        signature = self.key.sign(signed, ec.ECDSA(hashes.SHA256()))
        return {
            "client_data_json_b64": b64u(client_data),
            "authenticator_data_b64": b64u(auth_data),
            "signature_b64": b64u(signature),
        }


def _verify(auth: SoftAuthenticator, assertion: dict, challenge: str, **over):
    kwargs = dict(
        expected_challenge=challenge,
        expected_origins=ORIGINS,
        expected_rp_id=RP_ID,
        public_key_spki=parse_registration_public_key(auth.public_key_spki_b64),
        stored_sign_count=0,
        require_user_verification=True,
    )
    kwargs.update(over)
    return verify_assertion(**assertion, **kwargs)


def test_a_genuine_assertion_is_accepted():
    auth = SoftAuthenticator()
    challenge = b64url_encode(b"a-real-server-challenge-32-bytes")
    result = _verify(auth, auth.assert_(challenge), challenge)
    assert result.user_verified is True
    assert result.new_sign_count == 1


def test_a_forged_signature_is_rejected():
    """The attacker has the challenge and the credential id, but not the key."""
    real = SoftAuthenticator()
    attacker = SoftAuthenticator()
    challenge = b64url_encode(b"a-real-server-challenge-32-bytes")

    # Attacker signs with their own key; server checks against the enrolled one.
    with pytest.raises(WebAuthnError, match="signature did not verify"):
        _verify(real, attacker.assert_(challenge), challenge)


def test_a_replayed_challenge_is_rejected():
    auth = SoftAuthenticator()
    issued = b64url_encode(b"the-challenge-the-server-issued!")
    stale = b64url_encode(b"a-challenge-from-an-older-login!")
    with pytest.raises(WebAuthnError, match="challenge does not match"):
        _verify(auth, auth.assert_(stale), issued)


def test_an_assertion_for_another_origin_is_rejected():
    """Phishing: the ceremony happened on a site that is not ours."""
    auth = SoftAuthenticator()
    challenge = b64url_encode(b"a-real-server-challenge-32-bytes")
    with pytest.raises(WebAuthnError, match="origin"):
        _verify(auth, auth.assert_(challenge, origin="https://cryptoexam-core.evil.example"), challenge)


def test_an_assertion_for_another_rp_is_rejected():
    auth = SoftAuthenticator(rp_id="someone-elses-site.example")
    challenge = b64url_encode(b"a-real-server-challenge-32-bytes")
    with pytest.raises(WebAuthnError, match="rpIdHash"):
        _verify(auth, auth.assert_(challenge), challenge)


def test_the_wrong_ceremony_type_is_rejected():
    """A registration response must not be replayed as a login."""
    auth = SoftAuthenticator()
    challenge = b64url_encode(b"a-real-server-challenge-32-bytes")
    with pytest.raises(WebAuthnError, match="ceremony type"):
        _verify(auth, auth.assert_(challenge, ceremony="webauthn.create"), challenge)


def test_presence_without_fingerprint_is_rejected():
    """
    THE load-bearing check. A device that is merely present — tapped, plugged
    in — reports UP but not UV. Accepting that would turn the fingerprint
    requirement into "any authenticator will do".
    """
    auth = SoftAuthenticator(user_verified=False)
    challenge = b64url_encode(b"a-real-server-challenge-32-bytes")
    with pytest.raises(WebAuthnError, match="user verification flag not set"):
        _verify(auth, auth.assert_(challenge), challenge)


def test_a_stalled_counter_is_rejected_as_a_clone():
    auth = SoftAuthenticator()
    challenge = b64url_encode(b"a-real-server-challenge-32-bytes")
    assertion = auth.assert_(challenge)          # counter becomes 1
    with pytest.raises(WebAuthnError, match="counter did not advance"):
        _verify(auth, assertion, challenge, stored_sign_count=5)


def test_an_authenticator_without_a_counter_still_works():
    """Counter 0 forever is legitimate; only a stalled NON-ZERO counter is not."""
    auth = SoftAuthenticator()
    challenge = b64url_encode(b"a-real-server-challenge-32-bytes")
    assertion = auth.assert_(challenge)
    auth.counter = 0                              # pretend it never counts
    a2 = auth.assert_(challenge)
    a2["authenticator_data_b64"] = b64u(
        hashlib.sha256(RP_ID.encode()).digest() + bytes([0x05]) + (0).to_bytes(4, "big")
    )
    # Re-sign over the zero-counter authenticatorData.
    client = base64.urlsafe_b64decode(a2["client_data_json_b64"] + "==")
    auth_data = base64.urlsafe_b64decode(a2["authenticator_data_b64"] + "==")
    sig = auth.key.sign(auth_data + hashlib.sha256(client).digest(), ec.ECDSA(hashes.SHA256()))
    a2["signature_b64"] = b64u(sig)
    assert _verify(auth, a2, challenge, stored_sign_count=0).new_sign_count == 0


def test_an_unreadable_enrolment_key_is_refused_at_registration():
    """Storing a broken key would only fail at first login, locking the operator out."""
    with pytest.raises(WebAuthnError, match="unreadable"):
        parse_registration_public_key(b64u(b"this is not a DER public key"))
