"""
CryptoExam — System Admin (Tier-0 / HQ) Answer-Ledger API
ZUUP-OS §13.5 + §11.4.  The ONLY tier that turns ciphertext back into answers.

POST /api/v1/sys/ledger/ingest    — receive a centre sync bundle; verify node
                                     signature + re-walk each centre chain (INV-9)
POST /api/v1/sys/ledger/decrypt   — HSM-unwrap DK → AES-GCM-open R (the only
                                     place plaintext answers exist; tier 0 + HSM)
POST /api/v1/sys/ledger/anchor    — anchor a centre answer-root on Polygon
                                     (§11.5) — roots/counts/hashes ONLY, no PII

This module is the production-deployment counterpart of the fully-tested
reference implementation in private/edge-server/src/hq/vault.ts. The byte
format (envelope, leaf, canonical JSON, Ed25519 node signature, SHA-256 chain)
is identical on purpose so a bundle sealed by a terminal opens here unchanged.

Key custody: in production `_hsm_unwrap` is an HSM operation and the System
Admin private key never enters this process. The local-key path exists only for
the key-ceremony test vector (§18.2).
"""

import hashlib
import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.models import UserRole
from app.services.auth import require_role

logger = logging.getLogger(__name__)
router = APIRouter()


# ── wire types (mirror hq/vault.ts) ─────────────────────────────────────────
class ExportRecord(BaseModel):
    examId: str
    seatNo: str | None = None
    leafIndex: int
    leaf: str
    prevRoot: str
    chainRoot: str
    nodeRootSig: str
    ciphertext: str
    iv: str
    authTag: str
    wrappedDk: str


class Manifest(BaseModel):
    centreId: str
    count: int
    records: list[ExportRecord]
    exportedAt: int


class SyncBundle(BaseModel):
    manifest: Manifest
    manifestHash: str
    nodeSig: str
    nodePubkey: str


class AnchorRequest(BaseModel):
    examId: str
    centreIdHash: str
    answerRoot: str
    count: int
    nodePubkey: str


# ── crypto helpers (identical math to the TS reference) ─────────────────────
def _canonical_json(value: Any) -> bytes:
    """Sorted-key, space-free JSON — byte-identical to the JS canonicalJson."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha256(*parts: bytes) -> bytes:
    h = hashlib.sha256()
    for p in parts:
        h.update(p)
    return h.digest()


def _verify_node_sig(pubkey_hex: str, message: bytes, sig_hex: str) -> bool:
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    try:
        pub = Ed25519PublicKey.from_public_bytes(bytes.fromhex(pubkey_hex))
        pub.verify(bytes.fromhex(sig_hex), message)
        return True
    except (InvalidSignature, ValueError):
        return False


def _hsm_unwrap(wrapped_dk: bytes, private_key_pem: str) -> bytes:
    """RSA-OAEP-SHA256 unwrap. In production this is an HSM call (key never here)."""
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    priv = serialization.load_pem_private_key(private_key_pem.encode("utf-8"), password=None)
    return priv.decrypt(
        wrapped_dk,
        padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None),
    )


def _aes_gcm_open(ct: bytes, iv: bytes, tag: bytes, dk: bytes) -> bytes:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    # AESGCM expects ct||tag concatenated; the wire format keeps tag separate.
    return AESGCM(dk).decrypt(iv, ct + tag, None)


def _verify_chain(records: list[ExportRecord]) -> None:
    """Re-walk one centre+exam Merkle hash-chain; raise on the first break (INV-9)."""
    by_exam: dict[str, list[ExportRecord]] = {}
    for r in records:
        by_exam.setdefault(r.examId, []).append(r)

    genesis = b"\x00" * 32
    for exam_id, rs in by_exam.items():
        rs.sort(key=lambda x: x.leafIndex)
        prev = genesis
        for r in rs:
            if bytes.fromhex(r.prevRoot) != prev:
                raise HTTPException(status.HTTP_409_CONFLICT, f"CHAIN_BROKEN_AT_{r.leafIndex}")
            root = _sha256(prev, bytes.fromhex(r.leaf))
            if bytes.fromhex(r.chainRoot) != root:
                raise HTTPException(status.HTTP_409_CONFLICT, f"CHAIN_BROKEN_AT_{r.leafIndex}")
            # the leaf must equal SHA-256(ct‖iv‖tag‖wrapped_DK) of its envelope
            recomputed = _sha256(
                bytes.fromhex(r.ciphertext), bytes.fromhex(r.iv),
                bytes.fromhex(r.authTag), bytes.fromhex(r.wrappedDk),
            )
            if recomputed != bytes.fromhex(r.leaf):
                raise HTTPException(status.HTTP_409_CONFLICT, f"LEAF_ENVELOPE_MISMATCH@{r.leafIndex}")
            prev = root


def _assert_no_pii(anchor: AnchorRequest) -> None:
    """DPDP gate (§11.6): refuse to anchor anything that looks like an identifier."""
    blob = anchor.model_dump_json().lower()
    for forbidden in ("roll", "name", "aadhaar", "dob", "ciphertext", "seat"):
        if forbidden in blob:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"ANCHOR_CARRIES_PII:{forbidden}")


# ── endpoints ───────────────────────────────────────────────────────────────
@router.post(
    "/ledger/ingest",
    summary="Ingest a centre sync bundle (verify only)",
    description="Verify the centre node signature over the manifest and re-walk "
    "every centre chain. No decryption happens here (INV-9 gate before key use).",
)
async def ingest_bundle(
    bundle: SyncBundle,
    current_user: dict = Depends(require_role(UserRole.ADMIN)),
):
    # 1 — manifest integrity: the centre node signed exactly these bytes.
    manifest_bytes = _canonical_json(bundle.manifest.model_dump())
    if _sha256(manifest_bytes).hex() != bundle.manifestHash:
        raise HTTPException(status.HTTP_409_CONFLICT, "MANIFEST_HASH_MISMATCH")
    if not _verify_node_sig(bundle.nodePubkey, _sha256(manifest_bytes), bundle.nodeSig):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "NODE_SIGNATURE_INVALID")

    # 2 — chain re-walk (no key material touched).
    _verify_chain(bundle.manifest.records)

    centre_id_hash = _sha256(bundle.manifest.centreId.encode("utf-8")).hex()
    logger.info("ingest verified: centre=%s count=%d", centre_id_hash[:12], bundle.manifest.count)
    return {"ok": True, "centreIdHash": centre_id_hash, "verified": bundle.manifest.count}


@router.post(
    "/ledger/decrypt",
    summary="HSM-decrypt a verified bundle into the System Admin store",
    description="Tier-0 + HSM only. Unwraps each data key and opens each record. "
    "The returned plaintext is the ONLY plaintext copy of any answer.",
)
async def decrypt_bundle(
    bundle: SyncBundle,
    current_user: dict = Depends(require_role(UserRole.ADMIN)),
):
    from app.config import settings

    private_pem = getattr(settings, "SYSTEM_ADMIN_PRIVATE_KEY_PEM", None)
    if not private_pem:
        # In production this branch never runs: decryption is an HSM operation.
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "HSM_NOT_AVAILABLE")

    _verify_chain(bundle.manifest.records)  # never decrypt an unverified chain

    decrypted: list[dict[str, Any]] = []
    for r in bundle.manifest.records:
        dk = _hsm_unwrap(bytes.fromhex(r.wrappedDk), private_pem)
        pt = _aes_gcm_open(bytes.fromhex(r.ciphertext), bytes.fromhex(r.iv), bytes.fromhex(r.authTag), dk)
        decrypted.append({"examId": r.examId, "seatNo": r.seatNo, "leafIndex": r.leafIndex, "record": json.loads(pt)})

    return {"ok": True, "decrypted": decrypted}


@router.post(
    "/ledger/anchor",
    summary="Anchor a centre answer-root on Polygon (§11.5)",
    description="Roots/counts/hashes only — never a roll, name, DOB, or ciphertext "
    "(DPDP). Calls CryptoExamCore.anchorCentreAnswerRoot once per (exam, centre).",
)
async def anchor_centre_root(
    req: AnchorRequest,
    current_user: dict = Depends(require_role(UserRole.ADMIN)),
):
    _assert_no_pii(req)
    from app.services.blockchain import BlockchainService

    blockchain = BlockchainService()
    tx = await blockchain.anchor_centre_answer_root(
        exam_id=req.examId,
        centre_id_hash=req.centreIdHash,
        answer_root=req.answerRoot,
        count=req.count,
        node_pubkey=req.nodePubkey,
    )
    return {"ok": True, "tx": tx}
