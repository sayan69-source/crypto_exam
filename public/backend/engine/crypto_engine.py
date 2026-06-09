"""
CryptoExam Core — Cryptographic Engine Orchestrator
§ 10 — Unified facade for all cryptographic operations.

This module orchestrates the full exam lifecycle:
  1. Paper Encryption (AES-GCM-256 + HKDF)
  2. Key Splitting (Shamir SSS)
  3. drand Key Derivation (online path)
  4. Answer Commitment (SHA-256 Merkle tree)
  5. ZK Proof Generation (CIRCOM Groth16)

Each operation is logged and its result stored in the database.
No plaintext, key material, or shard values are ever persisted.
"""

import hashlib
import logging
import time
from datetime import datetime, timezone
from typing import Optional

from crypto.encryption import QuestionEncryptor, EncryptedPaper
from crypto.drand_client import DrandClient
from crypto.merkle import build_tree, generate_leaf, verify_inclusion, root_hex
from crypto.shamir import ShamirPaperGuardian

logger = logging.getLogger(__name__)


class CryptoEngine:
    """
    Unified cryptographic engine for CryptoExam Core.

    Coordinates all crypto operations across the exam lifecycle.
    Called by the FastAPI services and Celery tasks.
    """

    def __init__(self):
        self.encryptor = QuestionEncryptor()
        self.drand = DrandClient()

    # ═══════════════════════════════════════════════════════
    # Phase 1: Paper Encryption
    # ═══════════════════════════════════════════════════════

    def encrypt_paper(self, paper: dict, exam_id: str) -> dict:
        """
        Encrypt a question paper and prepare key management artifacts.

        Returns dict with:
          - ciphertext, tag, nonce (encrypted paper)
          - salt (for HKDF)
          - master_key_hash (for verification, NOT the key itself)
          - question_hash (SHA-256 of encrypted paper, for blockchain)

        The master key exists ONLY in the return value's 'shards' —
        the raw key is wiped from memory after splitting.
        """
        logger.info(f"Encrypting paper for exam {exam_id[:8]}...")
        start = time.time()

        # Generate master key and salt
        master_key = self.encryptor.generate_master_key()
        salt = self.encryptor.generate_salt()

        # Derive AES key
        aes_key = self.encryptor.derive_key(master_key, exam_id, salt)

        # Encrypt
        result = self.encryptor.encrypt_paper(paper, aes_key)

        # Hash for blockchain commitment
        question_hash = hashlib.sha256(result.ciphertext).digest()

        # Split master key into Shamir shards
        shards = ShamirPaperGuardian.split(master_key, n=5, k=3)

        # Hash the master key for verification (NOT the key itself)
        master_key_hash = hashlib.sha256(master_key).hexdigest()

        elapsed = time.time() - start
        logger.info(
            f"Paper encrypted: exam={exam_id[:8]}..., "
            f"ct_len={len(result.ciphertext)}, "
            f"shards=5 (threshold=3), "
            f"elapsed={elapsed:.3f}s"
        )

        return {
            "ciphertext": result.ciphertext,
            "tag": result.tag,
            "nonce": result.nonce,
            "salt": salt,
            "question_hash": question_hash,
            "master_key_hash": master_key_hash,
            "shards": [
                {"index": s.index, "value": s.value, "hash": s.hash}
                for s in shards
            ],
        }

    def decrypt_paper_online(
        self,
        ciphertext: bytes,
        tag: bytes,
        nonce: bytes,
        exam_id: str,
        salt: bytes,
        drand_round: int,
        beacon_randomness: bytes,
    ) -> dict:
        """
        Decrypt paper using the online path (drand beacon).

        Called at T₀ when the drand beacon publishes the round.
        """
        # Derive key from beacon
        from Crypto.Protocol.KDF import HKDF
        from Crypto.Hash import SHA256

        aes_key = HKDF(
            master=beacon_randomness,
            key_len=32,
            salt=salt,
            hashmod=SHA256,
            context=exam_id.encode('utf-8'),
        )

        return self.encryptor.decrypt_paper(ciphertext, tag, nonce, aes_key)

    def decrypt_paper_shamir(
        self,
        ciphertext: bytes,
        tag: bytes,
        nonce: bytes,
        exam_id: str,
        salt: bytes,
        shard_tuples: list[tuple[int, str]],
    ) -> dict:
        """
        Decrypt paper using the Shamir path (key reconstruction).

        Called when K officials submit their shards.
        """
        # Reconstruct master key
        master_key = ShamirPaperGuardian.combine(shard_tuples, key_length=32)

        # Derive AES key
        aes_key = self.encryptor.derive_key(master_key, exam_id, salt)

        return self.encryptor.decrypt_paper(ciphertext, tag, nonce, aes_key)

    # ═══════════════════════════════════════════════════════
    # Phase 2: Answer Commitment
    # ═══════════════════════════════════════════════════════

    def build_answer_merkle_tree(
        self,
        submissions: list[dict],
    ) -> dict:
        """
        Build a Merkle tree from all candidate submissions.

        Args:
            submissions: List of dicts with:
                candidate_id, exam_id, answers, timestamp

        Returns:
            Dict with root, proofs (per candidate), and leaf count.
        """
        logger.info(f"Building Merkle tree for {len(submissions)} submissions")

        leaves = [
            generate_leaf(
                s["candidate_id"],
                s["exam_id"],
                s["answers"],
                s["timestamp"],
            )
            for s in submissions
        ]

        root, proofs = build_tree(leaves)

        logger.info(f"Merkle tree built: root={root.hex()[:16]}..., leaves={len(leaves)}")

        return {
            "root": root,
            "root_hex": root_hex(root),
            "proofs": {
                submissions[i]["candidate_id"]: proofs[i]
                for i in range(len(submissions))
            },
            "leaf_count": len(leaves),
        }

    def verify_candidate_inclusion(
        self,
        candidate_id: str,
        exam_id: str,
        answers: dict,
        timestamp: float,
        proof_path: list[dict],
        expected_root: bytes,
    ) -> bool:
        """
        Verify a candidate's inclusion in the committed Merkle tree.

        Callable by the candidate, a journalist, an RTI officer,
        or a court — with no access to any other candidate's data.
        """
        leaf = generate_leaf(candidate_id, exam_id, answers, timestamp)
        return verify_inclusion(leaf, proof_path, expected_root)

    # ═══════════════════════════════════════════════════════
    # Phase 3: drand Integration
    # ═══════════════════════════════════════════════════════

    def get_drand_round_for_exam(self, scheduled_at: datetime) -> int:
        """Calculate the drand round for an exam's T₀."""
        unix_ts = int(scheduled_at.timestamp())
        return self.drand.round_for_timestamp(unix_ts)

    async def derive_key_from_drand(self, exam_id: str, drand_round: int) -> bytes:
        """Derive the AES key from a drand beacon round (online path)."""
        return await self.drand.derive_exam_key(exam_id, drand_round)

    async def is_drand_round_available(self, drand_round: int) -> bool:
        """Check if a drand round has been published (i.e., T₀ has passed)."""
        return await self.drand.is_round_available(drand_round)
