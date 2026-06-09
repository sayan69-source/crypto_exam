"""
CryptoExam Core — V3 §9 Complaint Resolution API.

  POST /api/v1/complaint/demo-receipt   — issue a sample cryptographic receipt
  POST /api/v1/complaint/file           — file a complaint with a receipt + claim
  GET  /api/v1/complaint/list           — list filed complaints (admin/setter)
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.models import UserRole
from app.services.auth import require_role, get_current_user
from app.services.complaint import (
    complaint_engine, build_merkle_tree, merkle_proof_for, verify_merkle_proof,
)
from app.services.complaint.engine import _leaf_hash  # local helper

logger = logging.getLogger(__name__)
router = APIRouter()


class DemoReceiptRequest(BaseModel):
    exam_id: str = "demo-exam-2026"
    candidate_id: str = "demo-candidate"
    answers: dict[str, str] = {"q1": "A", "q2": "C", "q3": "B"}
    # Synthetic cohort — used to build a tree the candidate's receipt is a leaf of
    cohort_size: int = 8
    leaf_index: int = 3


@router.post("/demo-receipt", summary="Issue a sample cryptographic receipt")
async def issue_demo_receipt(req: DemoReceiptRequest):
    """
    Build a Merkle tree over a small synthetic cohort, place the candidate's
    answers at `leaf_index`, and return a complete CryptoExam receipt — exactly
    the structure post-exam will issue. Public so the demo flow works.
    """
    if not (0 <= req.leaf_index < req.cohort_size):
        raise HTTPException(400, "leaf_index out of range")

    # Build cohort leaves — the candidate's leaf is the real answers; the rest are deterministic stubs
    leaves: list[bytes] = []
    for i in range(req.cohort_size):
        if i == req.leaf_index:
            leaves.append(_leaf_hash(req.answers))
        else:
            leaves.append(_leaf_hash({"q1": chr(65 + (i % 4)), "q2": chr(65 + ((i + 1) % 4))}))

    tree = build_merkle_tree(leaves)
    proof, _ = merkle_proof_for(leaves, req.leaf_index)

    receipt = {
        "version": "V3",
        "candidateId": req.candidate_id,
        "examId": req.exam_id,
        "examName": "CryptoExam Demo Exam",
        "submittedAt": datetime.now(timezone.utc).isoformat(),
        "answers": req.answers,
        "merkle_proof": proof,
        "merkle_index": req.leaf_index,
        "merkle_root": tree["root"],
        "polygonscan_url": f"https://amoy.polygonscan.com/tx/{tree['root'][:64]}",
        "complaint_url": "/exam/complaint",
        "verification_instructions": (
            "1) Open polygonscan_url. 2) Find merkleRoot. 3) Compare to merkle_root above. "
            "If identical, your answers are unchanged on-chain."
        ),
    }
    return receipt


class FileComplaintRequest(BaseModel):
    candidate_id: str
    exam_id: str
    question_id: str
    candidate_claim: str
    receipt: dict
    # Optional: override on-chain root for tamper-test scenarios
    onchain_root: str | None = None
    polygon_tx_hash: str | None = None


@router.post("/file", summary="File a complaint — verifies receipt + verdict")
async def file_complaint(req: FileComplaintRequest):
    """
    Verifies the receipt against (a) the on-chain root if supplied, otherwise
    (b) the root in the receipt itself, and compares the stored answer with the
    candidate's claim. Returns a court-admissible verdict.
    """
    result = await complaint_engine.verify_complaint(
        candidate_id=req.candidate_id,
        exam_id=req.exam_id,
        question_id=req.question_id,
        candidate_claim=req.candidate_claim,
        receipt=req.receipt,
        onchain_root=req.onchain_root,
        polygon_tx_hash=req.polygon_tx_hash,
    )
    return result.to_dict()


@router.get("/list", summary="List filed complaints")
async def list_complaints(
    exam_id: str | None = None,
    current=Depends(require_role(UserRole.ADMIN, UserRole.INVIGILATOR)),
):
    return complaint_engine.list_complaints(exam_id)
