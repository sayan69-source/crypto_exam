"""
§ 28.5 — Answer-key encryption.

The Mode 3 answer key is encrypted SEPARATELY (AES-GCM-256) and stored encrypted;
it is revealed only at exam end. The key is derived from the exam id + a server
secret via HKDF, so the ciphertext alone never exposes the answers (verified by test).
"""

from __future__ import annotations

import json
import os
from base64 import b64encode, b64decode

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes

from app.config import get_settings

settings = get_settings()


def _derive_key(exam_id: str, salt: bytes) -> bytes:
    secret = (settings.DEPLOYER_PRIVATE_KEY or "cryptoexam-answer-key-secret").encode()
    return HKDF(
        algorithm=hashes.SHA256(), length=32, salt=salt,
        info=f"cryptoexam:answerkey:{exam_id}".encode(),
    ).derive(secret)


def encrypt_answer_key(answer_key: dict[int, str], exam_id: str, reveal_time: str | None = None) -> dict:
    """Encrypt an answer key. Returns a JSON-serialisable envelope (no plaintext)."""
    salt = os.urandom(16)
    nonce = os.urandom(12)
    key = _derive_key(exam_id, salt)
    plaintext = json.dumps(
        {"answers": {str(k): v for k, v in answer_key.items()}, "reveal_time": reveal_time}
    ).encode()
    ct = AESGCM(key).encrypt(nonce, plaintext, exam_id.encode())
    return {
        "alg": "AES-GCM-256",
        "exam_id": exam_id,
        "salt": b64encode(salt).decode(),
        "nonce": b64encode(nonce).decode(),
        "ciphertext": b64encode(ct).decode(),
        "reveal_time": reveal_time,
        "count": len(answer_key),
    }


def decrypt_answer_key(envelope: dict) -> dict[int, str]:
    """Reverse of encrypt_answer_key — used only at/after reveal_time."""
    exam_id = envelope["exam_id"]
    salt = b64decode(envelope["salt"])
    nonce = b64decode(envelope["nonce"])
    ct = b64decode(envelope["ciphertext"])
    key = _derive_key(exam_id, salt)
    pt = AESGCM(key).decrypt(nonce, ct, exam_id.encode())
    data = json.loads(pt.decode())
    return {int(k): v for k, v in data["answers"].items()}
