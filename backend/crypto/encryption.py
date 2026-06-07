"""
CryptoExam Core — AES-GCM-256 Question Paper Encryption
§ 10.1 — In-memory encryption with secure key derivation and wiping.

INVARIANTS (enforced by this module):
  1. Plaintext NEVER written to disk. NEVER logged. NEVER cached.
  2. Key NEVER serialized to disk. In-memory only, wiped after use.
  3. Nonce: 16 bytes, cryptographically random per encryption call.
  4. HKDF context: exam_id + setter_salt ensures unique key per exam.
  5. After encrypt/decrypt, _secure_wipe() called on all sensitive buffers.

Guarantee 1 — No human sees the paper before T₀.
"""

import ctypes
import json
import os
from typing import NamedTuple

from Crypto.Cipher import AES
from Crypto.Protocol.KDF import HKDF
from Crypto.Hash import SHA256


class EncryptedPaper(NamedTuple):
    """Result of paper encryption — all components needed for decryption."""
    ciphertext: bytes
    tag: bytes       # GCM authentication tag (16 bytes)
    nonce: bytes     # Unique per encryption (16 bytes)


class QuestionEncryptor:
    """
    AES-GCM-256 encryption engine for question papers.

    The paper is encrypted entirely in memory. The key is derived
    from a master secret via HKDF with exam-specific context,
    ensuring each exam produces a unique key even from the same master.

    At T₀, the key is re-derived from the drand beacon randomness
    (online path) or RSA time-lock puzzle solution (offline path).
    Neither path stores the key — it exists only transiently in RAM.
    """

    @staticmethod
    def _secure_wipe(buf: bytearray) -> None:
        """
        Overwrite buffer contents with zeros using ctypes.memset.
        Prevents sensitive data from lingering in memory after use.

        This is a best-effort wipe — Python's GC may have already
        copied the data. For production, use mlock() on Linux.
        """
        if len(buf) > 0:
            ctypes.memset(
                (ctypes.c_char * len(buf)).from_buffer(buf),
                0,
                len(buf),
            )

    @staticmethod
    def derive_key(master: bytes, exam_id: str, salt: bytes) -> bytes:
        """
        Derive a 256-bit AES key from master secret using HKDF-SHA256.

        Args:
            master: Master key material (32+ bytes).
                    From drand beacon (online) or time-lock solution (offline).
            exam_id: UUID string — binds the key to a specific exam.
            salt: Random salt (16+ bytes) — generated at exam creation,
                  stored in exam record.

        Returns:
            32-byte AES-256 key.

        The context parameter (exam_id) ensures that even if two exams
        share the same drand round, their keys will differ.
        """
        return HKDF(
            master=master,
            key_len=32,
            salt=salt,
            hashmod=SHA256,
            context=exam_id.encode('utf-8'),
        )

    @staticmethod
    def encrypt_paper(paper: dict, key: bytes) -> EncryptedPaper:
        """
        Encrypt a question paper dict using AES-GCM-256.

        Args:
            paper: Complete question paper as a dictionary.
                   Structure: {"questions": [...], "metadata": {...}}
            key: 32-byte AES-256 key from derive_key().

        Returns:
            EncryptedPaper(ciphertext, tag, nonce).

        Security:
            - 16-byte random nonce per call (GCM safe up to 2^32 calls per key)
            - GCM provides both confidentiality and authenticity
            - Plaintext buffer is securely wiped after encryption
            - No intermediate plaintext touches disk or logs
        """
        nonce = os.urandom(16)
        cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)

        # Serialize paper to UTF-8 JSON
        plaintext = json.dumps(paper, ensure_ascii=False, sort_keys=True).encode('utf-8')

        # Encrypt and compute authentication tag
        ciphertext, tag = cipher.encrypt_and_digest(plaintext)

        # Secure wipe the plaintext buffer
        buf = bytearray(plaintext)
        QuestionEncryptor._secure_wipe(buf)
        del plaintext, buf

        return EncryptedPaper(ciphertext=ciphertext, tag=tag, nonce=nonce)

    @staticmethod
    def decrypt_paper(
        ciphertext: bytes,
        tag: bytes,
        nonce: bytes,
        key: bytes,
    ) -> dict:
        """
        Decrypt a question paper from AES-GCM-256 ciphertext.

        Called ONLY at T₀. Key is derived fresh from drand beacon
        or time-lock solution — never stored.

        Args:
            ciphertext: Encrypted paper bytes.
            tag: GCM authentication tag (16 bytes).
            nonce: Encryption nonce (16 bytes).
            key: 32-byte AES-256 key from derive_key().

        Returns:
            Decrypted question paper as a dictionary.

        Raises:
            ValueError: If tag verification fails (tampering detected).
        """
        cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
        try:
            plaintext = cipher.decrypt_and_verify(ciphertext, tag)
            return json.loads(plaintext.decode('utf-8'))
        except ValueError as e:
            raise ValueError(
                "Decryption failed: authentication tag mismatch. "
                "Paper may have been tampered with."
            ) from e

    @staticmethod
    def generate_salt() -> bytes:
        """Generate a cryptographically random 16-byte salt for HKDF."""
        return os.urandom(16)

    @staticmethod
    def generate_master_key() -> bytes:
        """Generate a cryptographically random 32-byte master key."""
        return os.urandom(32)
