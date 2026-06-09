"""
§ 9 (V3) — Complaint Resolution Engine.

Every candidate receives a cryptographic receipt with a Merkle inclusion proof.
A complaint is resolved mathematically:
  receipt valid? + stored answer matches claim? → COMPLAINT_DISMISSED
  receipt valid but stored answer ≠ claim       → TAMPERING_DETECTED
  receipt invalid                               → PROOF_INVALID
"""

from app.services.complaint.engine import (
    complaint_engine,
    ComplaintEngine,
    ComplaintVerificationResult,
    Verdict,
    verify_merkle_proof,
    build_merkle_tree,
    merkle_proof_for,
)

__all__ = [
    "complaint_engine", "ComplaintEngine", "ComplaintVerificationResult",
    "Verdict", "verify_merkle_proof", "build_merkle_tree", "merkle_proof_for",
]
