"""
NOTE ON THE ROLE GATE
---------------------
Every route here is SYSTEM_ADMIN (tier-0), which is what the descriptions
always claimed. They were gated on ADMIN — so a tier-1 operations
administrator could unwrap data keys and read candidate answers, while the
tier that exists to hold exactly that authority could not. The whole point of
separating the tiers is that running the platform day to day does not carry
the power to read answers.

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
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
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
    current_user: dict = Depends(require_role(UserRole.SYSTEM_ADMIN)),
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
    current_user: dict = Depends(require_role(UserRole.SYSTEM_ADMIN)),
):
    # `app.config` exports get_settings(), not a module-level `settings`, so the
    # old `from app.config import settings` here raised ImportError — the tier-0
    # decrypt route could not run at all, and the failure looked like a 500 with
    # no connection to key custody.
    from app.config import get_settings

    private_pem = getattr(get_settings(), "SYSTEM_ADMIN_PRIVATE_KEY_PEM", None)
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
    current_user: dict = Depends(require_role(UserRole.SYSTEM_ADMIN)),
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


class StoreDecryptedRequest(BaseModel):
    centreIdHash: str
    decrypted: list[dict[str, Any]]
    polygonTx: str | None = None
    chainRoot: str | None = None


@router.post(
    "/ledger/store",
    summary="Store decrypted answers (tier-0)",
    description="Persist plaintext answers into the System Admin store. Prefer "
    "/ledger/open, which decrypts what a centre already delivered without the "
    "plaintext ever leaving this process.",
)
async def store_decrypted(
    req: StoreDecryptedRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.SYSTEM_ADMIN)),
):
    """
    Gated on SYSTEM_ADMIN, not ADMIN.

    Every other route in this module is tier-0 because tier-0 is the only tier
    that may turn ciphertext into answers. This one was left on ADMIN, which is
    worse than the read it mirrors: it does not merely let a tier-1 operations
    administrator READ answers, it lets them WRITE the store — post any JSON
    they like as candidate X's paper for exam Y, into the table results are
    computed from.
    """
    from app.models import DecryptedAnswerRecord

    stored = 0
    for a in req.decrypted:
        db.add(DecryptedAnswerRecord(
            exam_id=a["examId"],
            centre_id_hash=req.centreIdHash,
            seat_no=a.get("seatNo"),
            leaf_index=a["leafIndex"],
            answers=a["record"],
            chain_root=req.chainRoot,
            polygon_tx=req.polygonTx,
        ))
        stored += 1

    # The enrolment status is deliberately NOT touched here.
    #
    # This used to set `EnrollmentStatus.SUBMITTED` "if it exists" and fall back
    # to the bare string otherwise. It does not exist — the enum is
    # ENROLLED/PRESENT/ABSENT/DISQUALIFIED — so the fallback always ran and
    # assigned a value outside the type. On Postgres that is
    # `invalid input value for enum`, which failed the whole call on the live
    # deployment for any bundle whose records carried a roll number; on SQLite
    # it wrote a status nothing else understands.
    #
    # The right model is the one the Edge already uses: a candidate stays
    # PRESENT, and "submitted" is a property of the ledger. The existence of the
    # row added above IS the record of submission.
    await db.commit()
    logger.info("Stored %d decrypted answers for centre %s", stored, req.centreIdHash[:12])
    return {"ok": True, "stored": stored}


class OpenRequest(BaseModel):
    """Which of the sealed records that have ARRIVED to open."""
    examId: str | None = None
    centreIdHash: str | None = None
    limit: int = 500


@router.post(
    "/ledger/open",
    summary="Decrypt sealed records a centre already delivered (tier-0 + HSM)",
    description="Reads what the courier delivered, re-walks the chain, HSM-unwraps "
    "each data key and persists the plaintext. Returns counts only — the answers "
    "never leave this process.",
)
async def open_received(
    req: OpenRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.SYSTEM_ADMIN)),
):
    """
    The step that was missing between "the answers arrived" and "the answers exist".

    Until the courier existed, a bundle reached HQ only by an operator pasting it
    into a console: /decrypt returned the plaintext to that browser and /store
    posted it back. That round trip is now avoidable and should be avoided — it
    put the only plaintext copy of a paper through a browser, and it made the
    write path accept whatever came back rather than what was decrypted.

    Here the ciphertext is already in the database, so the whole operation is
    server-side: verify, unwrap, write, mark. What comes back is a count.

    Idempotent: rows already carrying `decrypted_at` are skipped, so re-running
    after a partial failure resumes rather than duplicating.
    """
    from app.config import get_settings
    from app.models import CentreSealedRecord, DecryptedAnswerRecord

    private_pem = getattr(get_settings(), "SYSTEM_ADMIN_PRIVATE_KEY_PEM", None)
    if not private_pem:
        # In production this is an HSM operation and the key never enters this
        # process; a deployment without one cannot open anything, and says so
        # rather than half-succeeding.
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "HSM_NOT_AVAILABLE")

    q = select(CentreSealedRecord).where(CentreSealedRecord.decrypted_at.is_(None))
    if req.examId:
        q = q.where(CentreSealedRecord.exam_id == req.examId)
    if req.centreIdHash:
        q = q.where(CentreSealedRecord.centre_id_hash == req.centreIdHash)
    rows = (await db.execute(q.order_by(
        CentreSealedRecord.exam_id, CentreSealedRecord.leaf_index
    ).limit(max(1, min(req.limit, 5000))))).scalars().all()

    if not rows:
        return {"ok": True, "opened": 0, "failed": [], "note": "nothing sealed is waiting"}

    # Re-walk the chain before any key is used (INV-9), from what was STORED
    # rather than from what a caller sent. A record whose envelope no longer
    # digests to its leaf is refused with the rest of its exam: a chain is only
    # meaningful whole.
    as_records = [ExportRecord(
        examId=r.exam_id, seatNo=r.seat_no, leafIndex=r.leaf_index, leaf=r.leaf,
        prevRoot=r.prev_root, chainRoot=r.chain_root, nodeRootSig=r.node_root_sig,
        ciphertext=r.ciphertext, iv=r.iv, authTag=r.auth_tag, wrappedDk=r.wrapped_dk,
    ) for r in rows]
    _verify_chain(as_records)

    opened = 0
    failed: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc)
    for r in rows:
        try:
            dk = _hsm_unwrap(bytes.fromhex(r.wrapped_dk), private_pem)
            pt = _aes_gcm_open(
                bytes.fromhex(r.ciphertext), bytes.fromhex(r.iv), bytes.fromhex(r.auth_tag), dk,
            )
            answers = json.loads(pt)
        except Exception as exc:
            # One unopenable envelope must not abort the exam. It is quarantined
            # by being left sealed and named here — the previous decrypt path
            # let a single poisoned row take down every other candidate in the
            # same call.
            failed.append({
                "examId": r.exam_id, "seatNo": r.seat_no, "leafIndex": r.leaf_index,
                "reason": type(exc).__name__,
            })
            continue

        db.add(DecryptedAnswerRecord(
            exam_id=r.exam_id,
            centre_id_hash=r.centre_id_hash,
            seat_no=r.seat_no,
            leaf_index=r.leaf_index,
            answers=answers,
            chain_root=r.chain_root,
        ))
        r.decrypted_at = now
        opened += 1

    await db.commit()
    logger.info("tier-0 opened %d sealed record(s); %d quarantined", opened, len(failed))
    return {"ok": True, "opened": opened, "failed": failed}


class AnchorReceivedRequest(BaseModel):
    """Anchor what a centre actually delivered, rather than what a caller types."""
    examId: str
    centreIdHash: str


@router.post(
    "/ledger/anchor-received",
    summary="Anchor a delivered centre's answer-root, derived from storage (tier-0)",
    description="Re-walks the stored chain for one (exam, centre) and anchors ITS "
    "final root. Roots, counts and hashes only — never a roll, a name or ciphertext.",
)
async def anchor_received(
    req: AnchorReceivedRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.SYSTEM_ADMIN)),
):
    """
    The difference from ``/ledger/anchor`` is where the number comes from.

    That route takes ``answerRoot`` from the request body, which was the only
    option while a bundle existed nowhere but in the caller's clipboard. It means
    the value published on a public chain — the one an auditor later checks a
    centre's paper against — is whatever the operator pasted. Now that the
    courier delivers into ``centre_sealed_records``, HQ can derive it: re-walk
    the chain it received and anchor the root that walk produces.

    A broken chain therefore cannot be anchored at all, rather than being
    anchored under a root that describes a different set of answers.

    One anchor per (exam, centre): the contract reverts a second attempt, so this
    route does not need to guard against a re-anchor and deliberately does not
    pretend to — a revert is the honest answer.
    """
    from app.models import CentreSealedRecord, DecryptedAnswerRecord
    from app.services.blockchain import BlockchainService

    rows = (await db.execute(
        select(CentreSealedRecord)
        .where(CentreSealedRecord.exam_id == req.examId,
               CentreSealedRecord.centre_id_hash == req.centreIdHash)
        .order_by(CentreSealedRecord.leaf_index)
    )).scalars().all()
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "NOTHING_RECEIVED_FOR_THIS_CENTRE")

    # Re-walk before publishing. INV-9 applies harder here than anywhere else:
    # an anchor is irreversible and public.
    _verify_chain([ExportRecord(
        examId=r.exam_id, seatNo=r.seat_no, leafIndex=r.leaf_index, leaf=r.leaf,
        prevRoot=r.prev_root, chainRoot=r.chain_root, nodeRootSig=r.node_root_sig,
        ciphertext=r.ciphertext, iv=r.iv, authTag=r.auth_tag, wrappedDk=r.wrapped_dk,
    ) for r in rows])

    final = rows[-1]
    node_pubkeys = {r.node_pubkey for r in rows if r.node_pubkey}
    if len(node_pubkeys) > 1:
        # Two different centre nodes signing one chain is not a chain. Refuse
        # rather than pick one and publish a root nobody can attribute.
        raise HTTPException(status.HTTP_409_CONFLICT, "MULTIPLE_NODE_KEYS_IN_ONE_CHAIN")

    anchor = AnchorRequest(
        examId=req.examId,
        centreIdHash=req.centreIdHash,
        answerRoot=final.chain_root,
        count=len(rows),
        nodePubkey=next(iter(node_pubkeys), ""),
    )
    _assert_no_pii(anchor)

    tx = await BlockchainService().anchor_centre_answer_root(
        exam_id=anchor.examId,
        centre_id_hash=anchor.centreIdHash,
        answer_root=anchor.answerRoot,
        count=anchor.count,
        node_pubkey=anchor.nodePubkey,
    )

    # Record it against the answers this root covers, so a result can be traced
    # to the transaction that published its chain.
    await db.execute(
        update(DecryptedAnswerRecord)
        .where(DecryptedAnswerRecord.exam_id == req.examId,
               DecryptedAnswerRecord.centre_id_hash == req.centreIdHash)
        .values(polygon_tx=tx, chain_root=final.chain_root)
    )
    await db.commit()

    logger.info("anchored centre %s exam %s root %s count %d tx %s",
                req.centreIdHash[:12], req.examId, final.chain_root[:16], len(rows), tx)
    return {"ok": True, "tx": tx, "answerRoot": final.chain_root, "count": len(rows)}
