"""
CryptoExam Core — §§ 54–55 Key Ceremony + Attestation API.

  GET  /api/v1/ceremony/attestation?nonce=...   — Phase 1: enclave attestation
  POST /api/v1/ceremony/submit-share            — Phase 2: official submits SSS share
  GET  /api/v1/ceremony/status/{exam_id}        — share count + threshold flag
  GET  /api/v1/ceremony/expected-pcr0           — published PCR0 (for repo comparison)
  POST /api/v1/ceremony/demo-prepare/{exam_id}  — issue a fresh SSS-split master key
                                                  (returns 5 shares + ciphertext for one
                                                  question — used only by the demo portal)
  GET  /api/v1/ceremony/health                  — enclave health

All endpoints are additive — none of the existing /api/v1/* routes are touched.
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timezone

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.crypto import (
    enclave_proxy, encrypt_share_for_enclave,
    split_aes_key, encode_share,
)
from app.services.crypto.nitro_enclave import _pcr0_of_source

logger = logging.getLogger(__name__)
router = APIRouter()


# In-memory ceremony state for the demo. In production this is persisted in
# Postgres + mirrored on-chain via CeremonyShareSubmitted/Completed events.
_CEREMONIES: dict[str, dict] = {}

# Polygonscan-style audit log entries. Each entry has a deterministic mock TX hash
# derived from sha256(exam_id || event || index). In production these are emitted
# by the contract additions in contracts/src/CryptoExamCore.sol (recordCeremonyShare,
# completeCeremony, recordEnclaveAttestation).
_AUDIT_LOG: list[dict] = []


def _mock_tx_hash(exam_id: str, event: str, index: int) -> str:
    """Deterministic Polygonscan-style hex (32 bytes) for the demo audit log."""
    import hashlib as _h
    return "0x" + _h.sha256(f"{exam_id}|{event}|{index}".encode()).hexdigest()


def _emit_audit(exam_id: str, event: str, payload: dict) -> dict:
    tx = _mock_tx_hash(exam_id, event, len(_AUDIT_LOG))
    entry = {
        "tx_hash": tx,
        "polygonscan_url": f"https://amoy.polygonscan.com/tx/{tx[2:]}",
        "event": event,
        "exam_id": exam_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **payload,
    }
    _AUDIT_LOG.append(entry)
    if len(_AUDIT_LOG) > 200:
        _AUDIT_LOG[:] = _AUDIT_LOG[-200:]
    return entry


# ── Read-only ────────────────────────────────────────────────────────────

@router.get("/expected-pcr0", summary="Published PCR0 (the PCR0 the repo claims)")
async def expected_pcr0():
    """
    Returns the SHA-384 of the simulated enclave's source file. In a real
    deployment this would be the published expected_pcr0.txt baked into the
    GitHub repo. Officials compare this against the live attestation document.
    """
    return {
        "expected_pcr0": _pcr0_of_source().hex(),
        "source": "app/services/crypto/nitro_enclave.py",
        "note": "Change the file -> different PCR0 -> ceremony portal flashes red mismatch.",
    }


@router.get("/attestation", summary="Phase 1 — fetch enclave attestation document")
async def attestation(nonce: str | None = None, exam_id: str | None = None):
    """Officials call this before submitting a share to verify the enclave.
    When `exam_id` is supplied and PCR0 matches, an EnclaveAttestationVerified
    entry is appended to the audit log (mirrors the on-chain event)."""
    nonce_hex = nonce or os.urandom(16).hex()
    doc = enclave_proxy.get_attestation_document(nonce_hex)
    expected = _pcr0_of_source().hex()
    matches = doc["pcr0"] == expected
    if exam_id and matches:
        import hashlib as _h
        _emit_audit(exam_id, "EnclaveAttestationVerified", {
            "pcr0": doc["pcr0"],
            "enclave_public_key_hash": _h.sha256(doc["public_key_pem"].encode()).hexdigest(),
        })
    return {
        "attestation_document_hex": doc["attestation_document_hex"],
        "pcr0": doc["pcr0"],
        "expected_pcr0": expected,
        "pcr_match": matches,
        "enclave_public_key_pem": doc["public_key_pem"],
        "module_id": doc["module_id"],
        "nonce": nonce_hex,
        "timestamp": int(time.time()),
    }


@router.get("/health", summary="Enclave health")
async def enclave_health():
    return enclave_proxy.health()


@router.get("/status/{exam_id}", summary="Ceremony status for one exam")
async def ceremony_status(exam_id: str):
    state = _CEREMONIES.get(exam_id, {"shares_submitted": [], "threshold": 3, "encrypted_question_hex": None})
    return {
        "exam_id": exam_id,
        "shares_submitted": state["shares_submitted"],
        "shares_count": len(state["shares_submitted"]),
        "threshold": state["threshold"],
        "total_officials": 5,
        "threshold_met": len(state["shares_submitted"]) >= state["threshold"],
        "encrypted_question_available": bool(state.get("encrypted_question_hex")),
    }


# ── Demo plumbing ────────────────────────────────────────────────────────

class DemoPrepareRequest(BaseModel):
    """Request body for demo-prepare (all fields optional)."""
    question_text: str | None = None


@router.post("/demo-prepare/{exam_id}", summary="Demo — issue SSS shares for one exam")
async def demo_prepare(exam_id: str, req: DemoPrepareRequest | None = None):
    """
    Issue a fresh 32-byte AES master key, AES-GCM-encrypt a sample question for it
    (under HKDF(master ‖ drand, salt=exam_id) — same derivation the enclave will run),
    split the master into 5 SSS shares (k=3, n=5), and return:
      - the 5 encoded shares (each official's piece — public-key wrapped client-side)
      - the encrypted question chunk (iv || ciphertext) for q0
      - the drand beacon used (a fixed pattern for the demo)

    The plaintext master key is discarded — it never persists.
    """
    body = req or DemoPrepareRequest()
    qtext = body.question_text or (
        '{"q":"What is 25 x 12?","options":["100","200","300","400"],"correct":"C"}'
    )

    master = os.urandom(32)
    shares = split_aes_key(master, k=3, n=5)
    encoded_shares = [encode_share(s) for s in shares]

    # Bake a per-question key with the same derivation the enclave/client uses
    drand = bytes.fromhex("ab3f00112233445566778899aabbccddeeff00112233445566778899aabbccdd")
    info = f"cryptoexam:{exam_id}:q0".encode()
    per_q = HKDF(algorithm=hashes.SHA256(), length=32,
                 salt=exam_id.encode(), info=info).derive(master + drand)
    iv = os.urandom(12)
    ct = AESGCM(per_q).encrypt(iv, qtext.encode(), exam_id.encode())
    encrypted_q_hex = (iv + ct).hex()

    # Wipe the master locally (and the per-question key)
    master = b"\x00" * 32; del master
    per_q = b"\x00" * 32; del per_q

    # Reset any prior demo state for this exam_id (idempotent demo)
    _CEREMONIES[exam_id] = {
        "shares_submitted": [],
        "threshold": 3,
        "encrypted_question_hex": encrypted_q_hex,
        "drand_beacon_hex": drand.hex(),
        "issued_at": datetime.now(timezone.utc).isoformat(),
    }

    return {
        "exam_id": exam_id,
        "shares": encoded_shares,            # 5 shares — pretend each is mailed to one official
        "threshold": 3,
        "total_officials": 5,
        "encrypted_question_hex": encrypted_q_hex,
        "drand_beacon_hex": drand.hex(),
        "note": (
            "These shares would normally be encrypted with each official's hardware-token "
            "public key. In the demo we hand them all back so the portal can simulate the "
            "5 officials submitting one by one."
        ),
    }


# ── Phase 2 — share submission ──────────────────────────────────────────

class SubmitShareRequest(BaseModel):
    exam_id: str
    official_id: str
    encrypted_share_b64: str          # share encrypted to the enclave's RSA-OAEP pubkey


@router.post("/submit-share", summary="Phase 2 — submit one official's SSS share")
async def submit_share(req: SubmitShareRequest):
    state = _CEREMONIES.setdefault(req.exam_id, {
        "shares_submitted": [], "threshold": 3, "encrypted_question_hex": None,
    })
    if any(s["official_id"] == req.official_id for s in state["shares_submitted"]):
        raise HTTPException(409, "official already submitted a share for this exam")

    try:
        result = enclave_proxy.submit_share(
            req.encrypted_share_b64, req.official_id, req.exam_id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    state["shares_submitted"].append({
        "official_id": req.official_id,
        "received_at": datetime.now(timezone.utc).isoformat(),
    })
    logger.info(
        "Ceremony: exam=%s official=%s shares=%d/%d",
        req.exam_id[:8], req.official_id, result["shares_received"], result["threshold"],
    )

    # § 56 — mirror on-chain CeremonyShareSubmitted event into the audit log
    share_event = _emit_audit(req.exam_id, "CeremonyShareSubmitted", {
        "official_id": req.official_id,
        "share_index": result["shares_received"],
        "total_shares_received": result["shares_received"],
        "threshold": result["threshold"],
    })
    completion_event = None
    if result["threshold_met"] and not state.get("completion_emitted"):
        state["completion_emitted"] = True
        completion_event = _emit_audit(req.exam_id, "CeremonyCompleted", {
            "shares_received": result["shares_received"],
            "threshold": result["threshold"],
            "enclave_pcr0": _pcr0_of_source().hex(),
        })

    return {
        "ok": True,
        "shares_received": result["shares_received"],
        "threshold": result["threshold"],
        "threshold_met": result["threshold_met"],
        "audit": {
            "share_tx": share_event,
            "completion_tx": completion_event,
        },
    }


@router.get("/audit-log", summary="On-chain ceremony audit log (Polygonscan-linked)")
async def audit_log(exam_id: str | None = None, limit: int = 50):
    """Return the recent CeremonyShareSubmitted / CeremonyCompleted events.
    In production these are emitted by `recordCeremonyShare` /
    `completeCeremony` in contracts/src/CryptoExamCore.sol."""
    items = _AUDIT_LOG[::-1]
    if exam_id:
        items = [e for e in items if e.get("exam_id") == exam_id]
    return items[:limit]


# ── Optional — decrypt one question through the enclave (demo only) ─────

class ProcessQuestionRequest(BaseModel):
    exam_id: str
    question_index: int = 0
    drand_beacon_hex: str | None = None         # override; defaults to the demo beacon
    encrypted_question_hex: str | None = None    # override; defaults to /demo-prepare's chunk


@router.post("/process-question", summary="Decrypt one question through the enclave (demo)")
async def process_question(req: ProcessQuestionRequest):
    state = _CEREMONIES.get(req.exam_id)
    if not state:
        raise HTTPException(404, "no demo ceremony state for this exam — call /demo-prepare first")
    drand = req.drand_beacon_hex or state.get("drand_beacon_hex")
    enc = req.encrypted_question_hex or state.get("encrypted_question_hex")
    if not drand or not enc:
        raise HTTPException(400, "missing drand beacon or encrypted question hex")

    try:
        out = enclave_proxy.decrypt_question(req.exam_id, req.question_index, drand, enc)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return out
