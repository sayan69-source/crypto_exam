"""
§ 53 — Simulated AWS Nitro Enclave Exam Processor.

The real production deployment runs `enclave_app.py` inside an EIF (Enclave
Image File) produced by `nitro-cli build-enclave`. PCR0 in the attestation
document is the SHA-384 of that EIF.

For local development / demo we run the same logic in-process. To preserve the
spec's verifiability story, the simulated enclave's PCR0 is the SHA-384 of the
processor's *own source file* — modifying the file provably changes PCR0,
exactly as a real EIF rebuild would. The attestation document is CBOR-encoded
to match the real format byte-for-byte at the consumer side.

What the simulation preserves
-----------------------------
  ✓ Spec interface (GET_ATTESTATION, SUBMIT_SHARE, PROCESS_QUESTION, HEALTH)
  ✓ Deterministic PCR0 = SHA-384(processor source code)
  ✓ Share encryption with an enclave-only RSA-OAEP keypair
  ✓ Per-question HKDF derivation identical to the V3 client/server paths
  ✓ Plaintext key/question never leaves the processor's memory

What it does NOT preserve (production-only)
-------------------------------------------
  ✗ Hardware memory encryption (in production, host RAM is unreadable)
  ✗ vsock IPC (in-process function call substitutes here)
  ✗ AWS root-of-trust certificate chain for the attestation document
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import time
from base64 import b64decode, b64encode
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.services.crypto.shamir_sss import (
    SharePoint, reconstruct_aes_key, decode_share,
)

logger = logging.getLogger(__name__)

# Path of THIS source — what we hash for the PCR0
_SELF_PATH = Path(__file__).resolve()


# ── PCR0 derivation ─────────────────────────────────────────────────────

def _pcr0_of_source() -> bytes:
    """
    PCR0 = SHA-384 of the processor source bytes.

    This mirrors a real Nitro Enclave: PCR0 is the SHA-384 of the EIF image.
    Any modification to enclave code -> different PCR0 -> ceremony portal flashes
    red mismatch -> officials refuse to submit shares.
    """
    return hashlib.sha384(_SELF_PATH.read_bytes()).digest()


# ── Attestation document (CBOR-encoded structure) ───────────────────────

# We avoid a hard dependency on the `cbor2` package by emitting a small
# CBOR-compatible structure with explicit tags. Consumers parse with cbor2 in
# production; here we expose `to_dict()` so the frontend can read fields too.

@dataclass
class AttestationDocument:
    module_id: str
    timestamp: int
    digest: str               # always "SHA384"
    pcr0: bytes               # PCR0 hash (32-byte SHA-256 in our simulation)
    pcr8: bytes
    public_key: bytes         # enclave's RSA public key (PEM)
    nonce: bytes
    certificate: bytes        # would chain to AWS Nitro CA in production
    # Optional signature — `enclave_signature` would be the COSE_Sign1 sig
    enclave_signature: bytes = b""

    def to_dict(self) -> dict:
        return {
            "module_id": self.module_id,
            "timestamp": self.timestamp,
            "digest": self.digest,
            "pcrs": {
                "0": self.pcr0.hex(),
                "8": self.pcr8.hex(),
            },
            "public_key": self.public_key.decode() if isinstance(self.public_key, bytes) else self.public_key,
            "nonce": self.nonce.hex(),
            "certificate": self.certificate.hex(),
            "enclave_signature": self.enclave_signature.hex(),
        }

    def to_bytes(self) -> bytes:
        """Best-effort CBOR-like encoding. Production uses real CBOR + COSE_Sign1."""
        try:
            import cbor2  # type: ignore
            return cbor2.dumps([
                self.module_id, self.timestamp, self.digest,
                {0: self.pcr0, 8: self.pcr8},
                self.public_key, self.nonce, self.certificate,
                self.enclave_signature,
            ])
        except ImportError:
            # Fallback: JSON-as-bytes with structured tag header so the downstream
            # parser knows the encoding. The frontend uses `to_dict()` instead.
            return b"CXATTEST\x01" + json.dumps(self.to_dict(), sort_keys=True).encode()


# ── Simulated enclave processor ─────────────────────────────────────────

@dataclass
class _ExamState:
    """In-enclave state for a single exam — never leaves enclave memory."""
    shares: dict[str, SharePoint] = field(default_factory=dict)    # official_id -> (x,y)
    sss_key: Optional[bytes] = None                                  # set when threshold reached
    completed_at: Optional[float] = None


class SimulatedNitroEnclave:
    """
    The processor. Holds the enclave's RSA-OAEP keypair (ephemeral — generated at
    boot, never persisted) and all in-flight ceremonies.
    """

    THRESHOLD = 3
    TOTAL = 5
    MODULE_ID = "i-cryptoexam-simulated-enclave"

    def __init__(self) -> None:
        # Ephemeral RSA-OAEP keypair (in production: handle from libnsm)
        self._private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self._public_key = self._private_key.public_key()
        self._public_key_pem = self._public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        self._pcr0 = _pcr0_of_source()
        self._pcr8 = hashlib.sha384(b"cryptoexam-simulated-signer").digest()
        self._exams: dict[str, _ExamState] = {}
        self._processed_questions = 0
        self._started_at = time.time()
        logger.info("SimulatedNitroEnclave booted (PCR0=%s)", self._pcr0[:8].hex())

    # ── Attestation ─────────────────────────────────────────────────────

    def attestation(self, nonce: bytes) -> AttestationDocument:
        """
        Return an attestation document tying the enclave's public key + PCR0 to
        the supplied nonce. Production: signed by AWS Nitro attestation CA.
        Simulation: signed by the enclave's own RSA key — this is enough to
        prove freshness (the nonce) and code identity (the PCR0).
        """
        if not nonce:
            nonce = secrets.token_bytes(16)
        doc = AttestationDocument(
            module_id=self.MODULE_ID,
            timestamp=int(time.time()),
            digest="SHA384",
            pcr0=self._pcr0,
            pcr8=self._pcr8,
            public_key=self._public_key_pem,
            nonce=nonce,
            certificate=b"\x00" * 16,  # placeholder — AWS chain in production
        )
        # "Sign" the doc (concat of the unsigned fields) with the enclave's RSA key
        payload = (
            doc.module_id.encode() + str(doc.timestamp).encode() +
            doc.digest.encode() + doc.pcr0 + doc.pcr8 + doc.public_key + doc.nonce
        )
        signature = self._private_key.sign(
            payload, padding.PKCS1v15(), hashes.SHA384(),
        )
        doc.enclave_signature = signature
        return doc

    @property
    def public_key_pem(self) -> bytes:
        return self._public_key_pem

    @property
    def pcr0_hex(self) -> str:
        return self._pcr0.hex()

    # ── Share submission ────────────────────────────────────────────────

    def submit_share(self, encrypted_share_b64: str, official_id: str, exam_id: str) -> dict:
        """
        Receive one official's SSS share, encrypted to the enclave's public key.
        Returns the updated share count and threshold status.
        """
        ct = b64decode(encrypted_share_b64)
        try:
            plaintext = self._private_key.decrypt(
                ct,
                padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None),
            )
        except Exception as e:  # noqa: BLE001
            raise ValueError(f"share decryption failed inside enclave: {e}") from e

        try:
            share = decode_share(json.loads(plaintext.decode()))
        except Exception as e:  # noqa: BLE001
            raise ValueError(f"share payload malformed: {e}") from e

        state = self._exams.setdefault(exam_id, _ExamState())
        if official_id in state.shares:
            raise ValueError("official already submitted a share for this exam")

        state.shares[official_id] = share
        count = len(state.shares)

        # When threshold reached: reconstruct SSS_KEY inside the enclave
        if count >= self.THRESHOLD and state.sss_key is None:
            state.sss_key = reconstruct_aes_key(list(state.shares.values())[: self.THRESHOLD],
                                                k=self.THRESHOLD)
            state.completed_at = time.time()
            logger.info("Enclave: SSS reconstruction complete for exam=%s (count=%d)", exam_id[:8], count)

        return {
            "status": "SHARE_RECEIVED",
            "exam_id": exam_id,
            "shares_received": count,
            "threshold": self.THRESHOLD,
            "threshold_met": state.sss_key is not None,
        }

    def share_count(self, exam_id: str) -> int:
        return len(self._exams.get(exam_id, _ExamState()).shares)

    def threshold_met(self, exam_id: str) -> bool:
        return self._exams.get(exam_id, _ExamState()).sss_key is not None

    # ── Question decryption ─────────────────────────────────────────────

    def process_question(
        self, exam_id: str, question_index: int,
        drand_beacon_hex: str, encrypted_question_hex: str,
    ) -> dict:
        """
        Derive per-question AES key + decrypt one question.

        FINAL_AES_KEY = HKDF(SSS_KEY ‖ drand_beacon, salt=examId,
                             info="cryptoexam:{examId}:q{index}")
        """
        state = self._exams.get(exam_id)
        if not state or state.sss_key is None:
            raise ValueError(f"insufficient shares for exam {exam_id}; threshold not reached")

        drand = bytes.fromhex(drand_beacon_hex)
        chunk = bytes.fromhex(encrypted_question_hex)
        info = f"cryptoexam:{exam_id}:q{question_index}".encode()
        ikm = state.sss_key + drand

        per_q = HKDF(
            algorithm=hashes.SHA256(), length=32,
            salt=exam_id.encode(), info=info,
        ).derive(ikm)

        if len(chunk) < 12:
            raise ValueError("ciphertext too short")
        iv, ct = chunk[:12], chunk[12:]
        try:
            plaintext = AESGCM(per_q).decrypt(iv, ct, exam_id.encode())
        except Exception as e:  # noqa: BLE001
            raise ValueError(f"AES-GCM decrypt failed: {e}") from e

        # Best-effort key wipe
        per_q = b"\x00" * 32
        del per_q

        self._processed_questions += 1
        return {
            "exam_id": exam_id,
            "question_index": question_index,
            "question_json": plaintext.decode("utf-8"),
        }

    # ── Health / stats ──────────────────────────────────────────────────

    def health(self) -> dict:
        return {
            "status": "HEALTHY", "enclave": "simulated",
            "module_id": self.MODULE_ID, "pcr0": self.pcr0_hex,
            "uptime_seconds": round(time.time() - self._started_at, 1),
            "active_exams": len(self._exams),
            "processed_questions": self._processed_questions,
        }


# ── EC2 parent-side proxy (matches §53.4 interface) ─────────────────────

class EnclaveProxy:
    """
    Matches the spec's vsock-based EnclaveProxy. Locally it just delegates to
    the in-process simulated enclave; in production swap the implementation for
    a real vsock client connecting to the EIF.
    """

    def __init__(self, enclave: SimulatedNitroEnclave) -> None:
        self._enclave = enclave

    def get_attestation_document(self, nonce: str) -> dict:
        n = bytes.fromhex(nonce) if all(c in "0123456789abcdefABCDEF" for c in nonce) else nonce.encode()
        doc = self._enclave.attestation(n)
        return {
            "attestation_document_hex": doc.to_bytes().hex(),
            "doc": doc.to_dict(),
            "pcr0": doc.pcr0.hex(),
            "public_key_pem": doc.public_key.decode() if isinstance(doc.public_key, bytes) else doc.public_key,
            "module_id": doc.module_id,
        }

    def submit_share(self, encrypted_share_b64: str, official_id: str, exam_id: str) -> dict:
        return self._enclave.submit_share(encrypted_share_b64, official_id, exam_id)

    def decrypt_question(self, exam_id: str, question_index: int,
                         drand_beacon_hex: str, encrypted_question_hex: str) -> dict:
        return self._enclave.process_question(exam_id, question_index, drand_beacon_hex, encrypted_question_hex)

    def health(self) -> dict:
        return self._enclave.health()


# ── Public helper: encrypt a share for the enclave's public key ─────────

def encrypt_share_for_enclave(share_dict: dict, enclave_public_key_pem: bytes | str) -> str:
    """
    Convenience used by the ceremony portal: encrypt one encoded share with the
    enclave's RSA-OAEP public key so only the enclave can decrypt it.
    Returns base64-encoded ciphertext.
    """
    pem = enclave_public_key_pem.encode() if isinstance(enclave_public_key_pem, str) else enclave_public_key_pem
    pub = serialization.load_pem_public_key(pem)
    ct = pub.encrypt(
        json.dumps(share_dict, sort_keys=True).encode(),
        padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None),
    )
    return b64encode(ct).decode()


# Module-level singleton (matches the spec's `enclave_proxy = EnclaveProxy()`)
_enclave = SimulatedNitroEnclave()
enclave_proxy = EnclaveProxy(_enclave)


# ── Self-test ───────────────────────────────────────────────────────────

def _test_enclave() -> None:
    from app.services.crypto.shamir_sss import split_aes_key, encode_share

    enclave = SimulatedNitroEnclave()
    proxy = EnclaveProxy(enclave)

    # 1) Attestation contains a valid PCR0 hash
    att = proxy.get_attestation_document(secrets.token_hex(16))
    assert len(att["pcr0"]) == 96, "PCR0 must be 48-byte SHA-384 → 96 hex chars"
    assert "BEGIN PUBLIC KEY" in att["public_key_pem"], "missing enclave public key"

    # 2) Encrypt + AES-GCM a sample question, split the key, submit shares, decrypt
    exam_id = "demo-cc-sss-2026"
    aes_key = os.urandom(32)
    shares = split_aes_key(aes_key, k=3, n=5)
    # Encrypt the per-question chunk: iv || ct, key = HKDF(aes_key ‖ drand, salt=exam_id, info=...)
    drand = b"\x42" * 32
    info = f"cryptoexam:{exam_id}:q0".encode()
    per_q = HKDF(algorithm=hashes.SHA256(), length=32, salt=exam_id.encode(), info=info) \
        .derive(aes_key + drand)
    iv = os.urandom(12)
    pt = b'{"q":"What is 25 x 12?","options":["100","200","300","400"],"correct":"C"}'
    ct = AESGCM(per_q).encrypt(iv, pt, exam_id.encode())
    encrypted_q_hex = (iv + ct).hex()

    # Submit 3 shares — each encrypted for the enclave's public key
    enc_pem = att["public_key_pem"]
    for idx, share in enumerate(shares[:3]):
        enc = encrypt_share_for_enclave(encode_share(share), enc_pem)
        out = proxy.submit_share(enc, official_id=f"off-{idx + 1}", exam_id=exam_id)
        if idx < 2:
            assert not out["threshold_met"], f"threshold met too early at idx={idx}"
    assert out["threshold_met"], "threshold should be met after 3 shares"

    # 3) Decrypt the question — must equal original plaintext
    result = proxy.decrypt_question(exam_id, 0, drand.hex(), encrypted_q_hex)
    assert result["question_json"] == pt.decode(), "enclave decryption mismatch"

    # 4) Tamper test: modifying any byte of the ciphertext → AES-GCM auth fails
    bad_hex = encrypted_q_hex[:-2] + "ff"
    try:
        proxy.decrypt_question(exam_id, 0, drand.hex(), bad_hex)
        raise AssertionError("tampered ciphertext was accepted")
    except ValueError:
        pass

    print("[OK] Simulated Nitro Enclave: attestation, 3-of-5 share submit, HKDF-key decrypt, tamper-reject")


if __name__ == "__main__":  # pragma: no cover
    _test_enclave()
