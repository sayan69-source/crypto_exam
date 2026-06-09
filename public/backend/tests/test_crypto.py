"""
CryptoExam Core — AES-GCM-256 Encryption Unit Tests
§ 14.2 — test_crypto.py

Tests the core invariants:
  1. Encrypt → decrypt roundtrip produces identical plaintext
  2. Tampering with ciphertext causes authentication failure
  3. Wrong key causes decryption failure
  4. Each encryption produces unique nonce (no nonce reuse)
  5. Key derivation is deterministic for same inputs
  6. Key derivation produces different keys for different exam_ids
"""

import os
import pytest
from crypto.encryption import QuestionEncryptor, EncryptedPaper


# ── Sample Data ──

SAMPLE_PAPER = {
    "metadata": {
        "exam_id": "550e8400-e29b-41d4-a716-446655440000",
        "exam_name": "NEET UG 2025",
        "exam_body": "NTA",
        "duration_minutes": 180,
        "total_questions": 180,
    },
    "questions": [
        {
            "id": "q001",
            "text": "A body of mass 2 kg is thrown vertically upward with velocity 20 m/s. What is the maximum height reached?",
            "text_hi": "2 kg द्रव्यमान का एक पिण्ड 20 m/s वेग से ऊर्ध्वाधर ऊपर फेंका जाता है। अधिकतम ऊँचाई क्या है?",
            "options": {"A": "10 m", "B": "20 m", "C": "30 m", "D": "40 m"},
            "correct_option": "B",
            "subject": "Physics",
            "topic": "Kinematics",
            "irt_b": 0.5,
            "irt_a": 1.2,
            "irt_c": 0.25,
            "blooms_level": 3,
        },
        {
            "id": "q002",
            "text": "Which organelle is known as the 'powerhouse of the cell'?",
            "options": {"A": "Nucleus", "B": "Ribosome", "C": "Mitochondria", "D": "Golgi body"},
            "correct_option": "C",
            "subject": "Biology",
            "topic": "Cell Biology",
            "irt_b": -1.0,
            "irt_a": 0.8,
            "irt_c": 0.25,
            "blooms_level": 1,
        },
    ],
}

EXAM_ID = "550e8400-e29b-41d4-a716-446655440000"


class TestQuestionEncryptor:
    """Tests for AES-GCM-256 paper encryption."""

    def test_encrypt_decrypt_roundtrip(self):
        """Core invariant: encrypt then decrypt must return identical paper."""
        enc = QuestionEncryptor()
        key = enc.generate_master_key()
        salt = enc.generate_salt()
        derived_key = enc.derive_key(key, EXAM_ID, salt)

        result = enc.encrypt_paper(SAMPLE_PAPER, derived_key)

        assert isinstance(result, EncryptedPaper)
        assert len(result.nonce) == 16
        assert len(result.tag) == 16
        assert len(result.ciphertext) > 0

        decrypted = enc.decrypt_paper(
            result.ciphertext, result.tag, result.nonce, derived_key
        )

        assert decrypted == SAMPLE_PAPER
        assert decrypted["questions"][0]["text"] == SAMPLE_PAPER["questions"][0]["text"]
        assert decrypted["questions"][0]["correct_option"] == "B"

    def test_tampered_ciphertext_fails(self):
        """Tampering with ciphertext must cause authentication failure."""
        enc = QuestionEncryptor()
        key = enc.generate_master_key()
        salt = enc.generate_salt()
        derived_key = enc.derive_key(key, EXAM_ID, salt)

        result = enc.encrypt_paper(SAMPLE_PAPER, derived_key)

        # Flip one byte in ciphertext
        tampered_ct = bytearray(result.ciphertext)
        tampered_ct[0] ^= 0xFF
        tampered_ct = bytes(tampered_ct)

        with pytest.raises(ValueError, match="[Tt]amper|tag"):
            enc.decrypt_paper(tampered_ct, result.tag, result.nonce, derived_key)

    def test_tampered_tag_fails(self):
        """Tampering with authentication tag must cause failure."""
        enc = QuestionEncryptor()
        key = enc.generate_master_key()
        salt = enc.generate_salt()
        derived_key = enc.derive_key(key, EXAM_ID, salt)

        result = enc.encrypt_paper(SAMPLE_PAPER, derived_key)

        tampered_tag = bytes([b ^ 0xFF for b in result.tag])

        with pytest.raises(ValueError):
            enc.decrypt_paper(result.ciphertext, tampered_tag, result.nonce, derived_key)

    def test_wrong_key_fails(self):
        """Decryption with wrong key must fail."""
        enc = QuestionEncryptor()
        key1 = enc.generate_master_key()
        key2 = enc.generate_master_key()
        salt = enc.generate_salt()

        derived_key1 = enc.derive_key(key1, EXAM_ID, salt)
        derived_key2 = enc.derive_key(key2, EXAM_ID, salt)

        result = enc.encrypt_paper(SAMPLE_PAPER, derived_key1)

        with pytest.raises(ValueError):
            enc.decrypt_paper(result.ciphertext, result.tag, result.nonce, derived_key2)

    def test_unique_nonce_per_encryption(self):
        """Each encryption call must produce a unique nonce."""
        enc = QuestionEncryptor()
        key = enc.generate_master_key()
        salt = enc.generate_salt()
        derived_key = enc.derive_key(key, EXAM_ID, salt)

        nonces = set()
        for _ in range(100):
            result = enc.encrypt_paper(SAMPLE_PAPER, derived_key)
            nonces.add(result.nonce)

        assert len(nonces) == 100, "Nonce reuse detected — critical security failure"

    def test_key_derivation_deterministic(self):
        """Same inputs must produce the same derived key."""
        enc = QuestionEncryptor()
        master = os.urandom(32)
        salt = os.urandom(16)

        key1 = enc.derive_key(master, EXAM_ID, salt)
        key2 = enc.derive_key(master, EXAM_ID, salt)

        assert key1 == key2

    def test_key_derivation_different_exam_ids(self):
        """Different exam_ids must produce different keys from same master."""
        enc = QuestionEncryptor()
        master = os.urandom(32)
        salt = os.urandom(16)

        key1 = enc.derive_key(master, "exam-001", salt)
        key2 = enc.derive_key(master, "exam-002", salt)

        assert key1 != key2, "Different exams must get different keys"

    def test_key_derivation_different_salts(self):
        """Different salts must produce different keys."""
        enc = QuestionEncryptor()
        master = os.urandom(32)

        key1 = enc.derive_key(master, EXAM_ID, os.urandom(16))
        key2 = enc.derive_key(master, EXAM_ID, os.urandom(16))

        assert key1 != key2

    def test_key_length(self):
        """Derived key must be exactly 32 bytes (256 bits)."""
        enc = QuestionEncryptor()
        master = os.urandom(32)
        salt = os.urandom(16)
        key = enc.derive_key(master, EXAM_ID, salt)
        assert len(key) == 32

    def test_master_key_length(self):
        """Generated master key must be 32 bytes."""
        key = QuestionEncryptor.generate_master_key()
        assert len(key) == 32

    def test_salt_length(self):
        """Generated salt must be 16 bytes."""
        salt = QuestionEncryptor.generate_salt()
        assert len(salt) == 16

    def test_unicode_paper_roundtrip(self):
        """Hindi/Devanagari content must survive encryption roundtrip."""
        enc = QuestionEncryptor()
        key = enc.generate_master_key()
        salt = enc.generate_salt()
        derived_key = enc.derive_key(key, EXAM_ID, salt)

        unicode_paper = {
            "questions": [{
                "text": "निम्नलिखित में से कौन सा कोशिकांग 'कोशिका का शक्ति-गृह' कहलाता है?",
                "options": {
                    "A": "केन्द्रक",
                    "B": "राइबोसोम",
                    "C": "माइटोकॉन्ड्रिया",
                    "D": "गॉल्जी बॉडी"
                },
                "correct_option": "C",
            }],
        }

        result = enc.encrypt_paper(unicode_paper, derived_key)
        decrypted = enc.decrypt_paper(
            result.ciphertext, result.tag, result.nonce, derived_key
        )

        assert decrypted == unicode_paper
        assert "माइटोकॉन्ड्रिया" in decrypted["questions"][0]["options"]["C"]

    def test_empty_paper_rejected(self):
        """Empty paper dict should still work (it's valid JSON)."""
        enc = QuestionEncryptor()
        key = enc.generate_master_key()
        salt = enc.generate_salt()
        derived_key = enc.derive_key(key, EXAM_ID, salt)

        result = enc.encrypt_paper({}, derived_key)
        decrypted = enc.decrypt_paper(
            result.ciphertext, result.tag, result.nonce, derived_key
        )
        assert decrypted == {}

    def test_large_paper_roundtrip(self):
        """180-question NEET-sized paper must encrypt/decrypt correctly."""
        enc = QuestionEncryptor()
        key = enc.generate_master_key()
        salt = enc.generate_salt()
        derived_key = enc.derive_key(key, EXAM_ID, salt)

        large_paper = {
            "questions": [
                {
                    "id": f"q{i:03d}",
                    "text": f"Question {i} text with sufficient length to simulate real content " * 3,
                    "options": {"A": f"A-{i}", "B": f"B-{i}", "C": f"C-{i}", "D": f"D-{i}"},
                    "correct_option": "A",
                }
                for i in range(180)
            ]
        }

        result = enc.encrypt_paper(large_paper, derived_key)
        decrypted = enc.decrypt_paper(
            result.ciphertext, result.tag, result.nonce, derived_key
        )

        assert len(decrypted["questions"]) == 180
        assert decrypted == large_paper
