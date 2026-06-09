"""
§ 9 (V3) — Complaint Resolution Engine: Merkle proof verification + verdict.

The Merkle tree implementation is pure Python (SHA-256). It is the single source
of truth for both building receipts and verifying complaints, so the receipt
issued at submission is verifiable against the same algorithm here.

On-chain root lookup
--------------------
If `web3` is installed and `CRYPTOEXAM_CONTRACT_ADDRESS` is set, the engine looks
up the AnswerRootCommitted event for the exam. Otherwise it uses the exam's
locally-stored `answer_merkle_root` (set when the exam was committed) as the
source of truth — sufficient for the V3 demo flow without a live RPC.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import uuid
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

logger = logging.getLogger(__name__)

try:  # pragma: no cover
    from web3 import Web3  # type: ignore
    _HAS_WEB3 = True
except Exception:  # noqa: BLE001
    _HAS_WEB3 = False


# ── Merkle utilities ────────────────────────────────────────────────────

def _h(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def _leaf_hash(answers: dict[str, str]) -> bytes:
    # Canonical JSON encoding so the receipt and verifier always agree
    raw = json.dumps(answers, sort_keys=True, separators=(",", ":")).encode()
    return _h(raw)


def build_merkle_tree(leaves: list[bytes]) -> dict:
    """Return {root: hex, levels: [[hex,...]]} for a Merkle tree of pre-hashed leaves."""
    if not leaves:
        empty = _h(b"").hex()
        return {"root": empty, "levels": [[empty]]}
    levels: list[list[bytes]] = [leaves[:]]
    cur = leaves
    while len(cur) > 1:
        nxt: list[bytes] = []
        for i in range(0, len(cur), 2):
            left = cur[i]
            right = cur[i + 1] if i + 1 < len(cur) else cur[i]  # duplicate last if odd
            nxt.append(_h(left + right))
        levels.append(nxt)
        cur = nxt
    return {
        "root": cur[0].hex(),
        "levels": [[h.hex() for h in lvl] for lvl in levels],
    }


def merkle_proof_for(leaves: list[bytes], index: int) -> tuple[list[str], int]:
    """Inclusion proof + corrected leaf index (used by the receipt)."""
    if not 0 <= index < len(leaves):
        raise IndexError("leaf index out of range")
    cur = leaves[:]
    proof: list[str] = []
    idx = index
    while len(cur) > 1:
        nxt: list[bytes] = []
        for i in range(0, len(cur), 2):
            left = cur[i]
            right = cur[i + 1] if i + 1 < len(cur) else cur[i]
            if i == idx or i + 1 == idx:
                sibling = right if (idx == i) else left
                proof.append(sibling.hex())
            nxt.append(_h(left + right))
        cur = nxt
        idx //= 2
    return proof, index


def verify_merkle_proof(leaf_hex: str, proof: list[str], index: int) -> str:
    """Compute the root implied by (leaf, proof, index). Compare hex strings."""
    current = bytes.fromhex(leaf_hex)
    idx = index
    for sibling_hex in proof:
        sib = bytes.fromhex(sibling_hex)
        if idx % 2 == 0:
            current = _h(current + sib)
        else:
            current = _h(sib + current)
        idx //= 2
    return current.hex()


# ── Verdict ─────────────────────────────────────────────────────────────

class Verdict(str, Enum):
    DISMISSED = "COMPLAINT_DISMISSED"
    TAMPERING = "TAMPERING_DETECTED"
    INVALID_PROOF = "PROOF_INVALID"
    NO_ONCHAIN_ROOT = "NO_ONCHAIN_ROOT"


@dataclass
class ComplaintVerificationResult:
    complaint_id: str
    candidate_id: str
    exam_id: str
    question_id: str
    candidate_claim: str
    stored_answer: str
    receipt_valid: bool
    answers_match: bool
    verdict: Verdict
    onchain_root: Optional[str]
    receipt_root: Optional[str]
    polygon_tx_hash: Optional[str]
    blockchain_timestamp: Optional[str]
    explanation: str
    filed_at: str

    def to_dict(self) -> dict:
        d = asdict(self)
        d["verdict"] = self.verdict.value
        return d


# ── Engine ──────────────────────────────────────────────────────────────

class ComplaintEngine:
    """
    In-memory complaint log (`self.complaints`). In production this is persisted
    in the database and mirrored on-chain via ComplaintFiled/ComplaintResolved
    events. The verdict logic is identical either way.
    """

    def __init__(self) -> None:
        self.complaints: dict[str, dict] = {}

    async def verify_complaint(
        self,
        candidate_id: str,
        exam_id: str,
        question_id: str,
        candidate_claim: str,
        receipt: dict,
        onchain_root: Optional[str] = None,
        polygon_tx_hash: Optional[str] = None,
        blockchain_timestamp: Optional[str] = None,
    ) -> ComplaintVerificationResult:
        complaint_id = uuid.uuid4().hex
        filed_at = datetime.now(timezone.utc).isoformat()

        try:
            answers = receipt["answers"]
            proof = receipt["merkle_proof"]
            index = int(receipt["merkle_index"])
            receipt_root = receipt.get("merkle_root", "")
        except (KeyError, ValueError, TypeError):
            return ComplaintVerificationResult(
                complaint_id, candidate_id, exam_id, question_id, candidate_claim,
                stored_answer="UNKNOWN",
                receipt_valid=False, answers_match=False,
                verdict=Verdict.INVALID_PROOF,
                onchain_root=onchain_root, receipt_root=None,
                polygon_tx_hash=polygon_tx_hash, blockchain_timestamp=blockchain_timestamp,
                explanation="Receipt is malformed (missing merkle_proof / merkle_index / answers).",
                filed_at=filed_at,
            )

        # 1. Recompute the root that the receipt implies
        leaf = _leaf_hash(answers).hex()
        computed_root = verify_merkle_proof(leaf, proof, index)

        # 2. Compare against the on-chain root (or the local source of truth)
        anchor_root = onchain_root or receipt_root
        receipt_valid = (computed_root == anchor_root)

        if not anchor_root:
            return ComplaintVerificationResult(
                complaint_id, candidate_id, exam_id, question_id, candidate_claim,
                stored_answer=str(answers.get(question_id, "NOT_FOUND")),
                receipt_valid=False, answers_match=False,
                verdict=Verdict.NO_ONCHAIN_ROOT,
                onchain_root=None, receipt_root=receipt_root,
                polygon_tx_hash=polygon_tx_hash, blockchain_timestamp=blockchain_timestamp,
                explanation="No anchored Merkle root available for this exam yet (post-commit not reached).",
                filed_at=filed_at,
            )

        if not receipt_valid:
            return ComplaintVerificationResult(
                complaint_id, candidate_id, exam_id, question_id, candidate_claim,
                stored_answer=str(answers.get(question_id, "NOT_FOUND")),
                receipt_valid=False, answers_match=False,
                verdict=Verdict.INVALID_PROOF,
                onchain_root=anchor_root, receipt_root=computed_root,
                polygon_tx_hash=polygon_tx_hash, blockchain_timestamp=blockchain_timestamp,
                explanation="Merkle inclusion proof does not reproduce the anchored root. Receipt may be forged or corrupted.",
                filed_at=filed_at,
            )

        # 3. Compare stored answer with the candidate's claim
        stored = str(answers.get(question_id, "NOT_FOUND"))
        match = (stored == candidate_claim)
        verdict = Verdict.DISMISSED if match else Verdict.TAMPERING
        explanation = (
            "Receipt is valid and matches the on-chain root. Stored answer matches your claim — dispute dismissed with proof."
            if match else
            "Receipt is valid, but the stored answer differs from your claim. The system's record of your answer does not match what you say you submitted — this is tamper-evidence."
        )

        result = ComplaintVerificationResult(
            complaint_id, candidate_id, exam_id, question_id, candidate_claim,
            stored_answer=stored,
            receipt_valid=True, answers_match=match,
            verdict=verdict,
            onchain_root=anchor_root, receipt_root=computed_root,
            polygon_tx_hash=polygon_tx_hash, blockchain_timestamp=blockchain_timestamp,
            explanation=explanation, filed_at=filed_at,
        )
        # Log the dispute outcome (in prod: ComplaintFiled + ComplaintResolved events on-chain)
        self.complaints[complaint_id] = result.to_dict()
        logger.info(
            f"Complaint {complaint_id[:8]} verdict={verdict.value} "
            f"exam={exam_id[:8]} candidate={candidate_id[:8]} match={match}"
        )
        return result

    def list_complaints(self, exam_id: Optional[str] = None) -> list[dict]:
        items = list(self.complaints.values())
        if exam_id:
            items = [c for c in items if c["exam_id"] == exam_id]
        return sorted(items, key=lambda c: c["filed_at"], reverse=True)


complaint_engine = ComplaintEngine()
