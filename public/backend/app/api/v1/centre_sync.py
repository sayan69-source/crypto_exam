"""
The centre's own uplink — the API the Admin Station's courier talks to (§12, §13.4).

WHY THIS EXISTS SEPARATELY FROM /provisioning AND /sys
------------------------------------------------------
Both halves of the centre round-trip already existed on paper and neither could
actually run:

  * ``/api/v1/provisioning/sync/{center_id}`` builds a centre's bundle and PUSHES
    it to that centre's Edge over ``EDGE_RELAY_URL``. That direction cannot work
    for a real centre: the exam LAN has no inbound route from the internet, by
    construction (§6.2). HQ cannot reach an Edge; the centre has to come and get
    it.
  * ``/api/v1/sys/ledger/ingest`` accepts a sealed bundle — but only from a
    SYSTEM_ADMIN session, and the thing carrying that bundle is a daemon on a
    terminal with nobody logged in. It also verified the bundle and then threw
    it away, so a centre could complete the entire journey and leave nothing
    behind at HQ.

So this module is the pull-shaped, centre-authenticated surface: the Admin
Station fetches what it needs and posts back what it has, using a credential
scoped to one centre.

WHAT A CENTRE CREDENTIAL CAN DO, PRECISELY
------------------------------------------
It can read that centre's own bundle — the roster, the staff and the sealed
papers for the exams that centre is running — and it can deliver sealed answers
for that centre. It cannot read an answer (every record is ciphertext with an
HSM-wrapped data key), cannot touch another centre, cannot approve anyone, and
cannot decrypt or anchor anything. Those stay tier-0.

The bundle is signed on the way out with HQ's Ed25519 provisioning key. The
station's ESP necessarily carries the transport credential in plaintext — it is
a FAT partition outside dm-verity — so the signature is what keeps a stolen
station from being able to WRITE a roster rather than merely carry one.
"""

import hashlib
import hmac
import json
import logging
import os
import secrets
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.provisioning import _build_bundle
from app.api.v1.sys_ledger import (
    SyncBundle,
    _canonical_json,
    _sha256,
    _verify_chain,
    _verify_node_sig,
)
from app.config import get_settings
from app.database import get_db
from app.models import (
    Center,
    CentreSealedRecord,
    DecryptedAnswerRecord,
    NotificationKind,
    NotificationSeverity,
    UserRole,
)
from app.services.auth import require_role
from app.services.notifications import notify

logger = logging.getLogger(__name__)
router = APIRouter()


# ── HQ's provisioning signing key ───────────────────────────────────────────
def _signing_seed() -> bytes | None:
    """The Ed25519 seed, or None when this deployment signs nothing.

    Read from settings, then the environment, so a platform that injects the
    variable after import (Render sets them on the service, not in the image)
    still finds it.

    Two accepted forms, and the second one exists because of how these values
    actually get set. 64 hex characters is the seed itself — what
    ``openssl rand -hex 32`` produces. Anything else of at least 32 characters
    is run through SHA-256 to derive one, because a hosting platform's
    "generate a value for me" button emits a random string of its own choosing
    and rejecting it would mean the deployment quietly signs nothing.

    Below 32 characters it is refused outright rather than stretched: a short
    value is a human-chosen passphrase, and hashing it would turn a guessable
    secret into a key that looks strong while being exactly as guessable.
    """
    raw = (get_settings().HQ_PROVISIONING_SIGNING_SEED or os.getenv("HQ_PROVISIONING_SIGNING_SEED", "")).strip()
    if not raw:
        return None

    candidate = raw[2:] if raw.lower().startswith("0x") else raw
    if len(candidate) == 64:
        try:
            return bytes.fromhex(candidate)
        except ValueError:
            pass  # 64 characters but not hex — fall through to the derivation

    if len(raw) < 32:
        logger.error("HQ_PROVISIONING_SIGNING_SEED is too short to derive a key from; refusing to sign.")
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "HQ_SIGNING_SEED_TOO_SHORT")

    return hashlib.sha256(raw.encode("utf-8")).digest()


def _hq_keypair():
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    seed = _signing_seed()
    if seed is None:
        return None
    return Ed25519PrivateKey.from_private_bytes(seed)


def hq_public_key_hex() -> str | None:
    """The public half, as the 64 hex characters an Edge is configured with."""
    from cryptography.hazmat.primitives import serialization

    priv = _hq_keypair()
    if priv is None:
        return None
    return priv.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    ).hex()


def _sign_bundle(bundle: dict[str, Any]) -> str | None:
    """Ed25519 over SHA-256 of the bundle's canonical bytes.

    The digest, not the document: the same convention the centre node uses when
    it signs a chain root, so there is one signing rule on this link rather than
    two that can drift.
    """
    priv = _hq_keypair()
    if priv is None:
        return None
    return priv.sign(_sha256(_canonical_json(bundle))).hex()


# ── centre authentication ───────────────────────────────────────────────────
def hash_sync_key(plaintext: str) -> str:
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()


async def _authenticate_centre(
    db: AsyncSession,
    centre_id: str | None,
    presented_key: str | None,
) -> Center:
    """Resolve the calling centre, or refuse.

    Every failure returns the same 401 with the same body. A courier has no use
    for the distinction between "no such centre" and "wrong key", and telling
    the difference to an unauthenticated caller turns this into an oracle for
    which centre ids exist.
    """
    denied = HTTPException(status.HTTP_401_UNAUTHORIZED, "BAD_CENTRE_CREDENTIAL")
    if not centre_id or not presented_key:
        raise denied

    centre = (await db.execute(select(Center).where(Center.id == centre_id))).scalar_one_or_none()
    if centre is None or not centre.sync_key_hash:
        # Still burn a comparison so a missing centre and a wrong key take the
        # same shape; the timing difference of one DB row is not the concern,
        # an early return that skips the compare entirely is.
        hmac.compare_digest(hash_sync_key(presented_key), "0" * 64)
        raise denied

    if not hmac.compare_digest(hash_sync_key(presented_key), centre.sync_key_hash):
        logger.warning("centre-sync: bad key presented for centre %s", centre_id)
        raise denied
    return centre


async def current_centre(
    db: AsyncSession = Depends(get_db),
    x_centre_id: str | None = Header(default=None),
    x_centre_key: str | None = Header(default=None),
) -> Center:
    return await _authenticate_centre(db, x_centre_id, x_centre_key)


# ── endpoints ───────────────────────────────────────────────────────────────
@router.get("/hq-pubkey", summary="HQ's provisioning signing public key (public)")
async def hq_pubkey():
    """The key an Edge is configured with as ``HQ_PROVISIONING_PUBKEY``.

    Unauthenticated on purpose: it is a public key, and the provisioning host
    that needs it is offline and has no credential of its own. Publishing it
    lets an operator pin the value they are about to trust from the same
    deployment the centres will talk to.
    """
    pub = hq_public_key_hex()
    return {
        "ok": True,
        "signed": pub is not None,
        "hqPublicKey": pub,
        "algorithm": "ed25519-over-sha256-canonical-json",
    }


@router.get("/hello", summary="Uplink reachability + clock check for a centre")
async def hello(centre: Center = Depends(current_centre), db: AsyncSession = Depends(get_db)):
    """One cheap call the courier makes first.

    It answers the two questions that decide whether anything else is worth
    attempting: is this station's credential still good, and is HQ's clock where
    the station thinks it is. A terminal has no NTP (§6.3 drops it), so a clock
    that has drifted far enough to break a signature window is a fault the
    operator needs named rather than discovered as a mystery 401 later.
    """
    counts = await _build_bundle(db, centre.id)
    return {
        "ok": True,
        "centre": {"id": centre.id, "name": centre.name},
        "serverTime": datetime.now(timezone.utc).isoformat(),
        "signed": hq_public_key_hex() is not None,
        "available": {
            "candidates": len(counts["candidates"]),
            "staff": len(counts["staff"]),
            "exams": len(counts["exams"]),
            "question_bundles": len(counts["question_bundles"]),
        },
        "lastSyncAt": centre.last_sync_at.isoformat() if centre.last_sync_at else None,
    }


@router.get("/bundle", summary="Pull this centre's provisioning bundle (§12)")
async def pull_bundle(
    centre: Center = Depends(current_centre),
    db: AsyncSession = Depends(get_db),
):
    """The roster, the staff and the sealed papers, addressed to one centre.

    The response is shaped so the courier can forward it verbatim: ``bundle``
    is exactly the body ``POST /api/provisioning/ingest`` on the Edge expects,
    and ``signature`` is what that endpoint checks before it writes a row. The
    station copies bytes; it does not compose them.

    Note what is NOT here even on exam morning: the T₀ beacon of a paper whose
    time has not come. ``_build_bundle`` withholds it until T₀ has passed, so a
    centre holding this bundle days early holds inert ciphertext.
    """
    bundle = await _build_bundle(db, centre.id)
    signature = _sign_bundle(bundle)
    return {
        "ok": True,
        "bundle": bundle,
        "signature": signature,
        "hqPublicKey": hq_public_key_hex(),
        "counts": {
            "candidates": len(bundle["candidates"]),
            "staff": len(bundle["staff"]),
            "exams": len(bundle["exams"]),
            "question_bundles": len(bundle["question_bundles"]),
        },
    }


async def _refuse(
    db: AsyncSession,
    centre: Center,
    *,
    code: str,
    http_status: int,
    what_happened: str,
) -> HTTPException:
    """Record a refused delivery for tier-0, then hand back the error to raise.

    A bundle that fails verification is the single most operationally important
    thing this endpoint can produce, and it was previously invisible to anyone
    not reading server logs: the courier gets a 4xx it cannot interpret and
    retries on its next tick, forever, while HQ shows nothing wrong.

    This is the one place in this module that commits a notification on its own
    rather than letting the caller's transaction carry it, and the reason is
    that there IS no caller transaction to join — every refusal below happens
    before the first ``db.add`` of a record, so the session holds no pending
    write of ours to be made consistent with. The alternative, staging it and
    then raising, would roll the notification back with the request and record
    nothing at all, which is the bug this function exists to prevent.
    """
    notify(
        db,
        kind=NotificationKind.CENTRE_DELIVERY_REJECTED,
        severity=NotificationSeverity.CRITICAL,
        recipient_role=UserRole.SYSTEM_ADMIN,
        title=f"Delivery REFUSED from {centre.name}",
        body=(
            f"{what_happened} The bundle was refused whole and nothing was stored. "
            "A centre whose deliveries keep failing verification needs looking at: "
            "either its node key has been rotated without HQ being told, or the "
            "bundle was altered between the terminal that sealed it and here."
        ),
        source_feature="centre-uplink",
        subject_type="centre",
        subject_id=centre.id,
        payload={"centreName": centre.name, "reason": code, "httpStatus": http_status},
    )
    await db.commit()
    logger.warning("centre-sync: refused delivery from centre %s — %s", centre.id, code)
    return HTTPException(http_status, code)


@router.post("/ledger", summary="Deliver a centre's sealed answer bundle (§13.4)")
async def deliver_ledger(
    payload: SyncBundle,
    request: Request,
    centre: Center = Depends(current_centre),
    db: AsyncSession = Depends(get_db),
):
    """Receive sealed answers, verify them, and — the part that was missing —
    keep them.

    Verification is the same arithmetic tier-0's ``/sys/ledger/ingest`` performs
    and deliberately shares its code: the manifest hash, the centre node's
    Ed25519 signature over it, and a re-walk of every chain including each
    leaf's envelope digest (INV-9). A bundle that fails any of those is refused
    whole — a partially-stored chain is worse than none, because it looks
    complete.

    The credential's centre must also be the manifest's centre. Without that
    check a valid credential for centre A could deliver a bundle claiming to be
    centre B and have it stored under B's hash.
    """
    if payload.manifest.centreId != centre.id:
        raise await _refuse(
            db, centre, code="CENTRE_MISMATCH", http_status=status.HTTP_403_FORBIDDEN,
            what_happened=(
                f"A credential belonging to {centre.name} presented a bundle claiming to be "
                f"centre {payload.manifest.centreId}."
            ),
        )

    manifest_bytes = _canonical_json(payload.manifest.model_dump())
    if _sha256(manifest_bytes).hex() != payload.manifestHash:
        raise await _refuse(
            db, centre, code="MANIFEST_HASH_MISMATCH", http_status=status.HTTP_409_CONFLICT,
            what_happened="The manifest did not hash to the digest the station said it would.",
        )
    if not _verify_node_sig(payload.nodePubkey, _sha256(manifest_bytes), payload.nodeSig):
        raise await _refuse(
            db, centre, code="NODE_SIGNATURE_INVALID", http_status=status.HTTP_401_UNAUTHORIZED,
            what_happened="The centre node's signature over the manifest did not verify.",
        )
    if payload.manifest.count != len(payload.manifest.records):
        raise await _refuse(
            db, centre, code="MANIFEST_COUNT_MISMATCH", http_status=status.HTTP_409_CONFLICT,
            what_happened=(
                f"The manifest declared {payload.manifest.count} record(s) but carried "
                f"{len(payload.manifest.records)}."
            ),
        )

    # `_verify_chain` raises on the first broken link. Catching it here is what
    # turns "the courier got a 409" into something tier-0 can see; the original
    # error is re-raised unchanged so the courier's behaviour does not alter.
    try:
        _verify_chain(payload.manifest.records)
    except HTTPException as exc:
        raise await _refuse(
            db, centre, code=str(exc.detail), http_status=exc.status_code,
            what_happened="The record chain did not re-walk: a leaf did not digest to its own envelope.",
        )

    centre_id_hash = _sha256(centre.id.encode("utf-8")).hex()

    # Idempotent by leaf. A courier whose window shut mid-POST retries the whole
    # bundle on its next tick and must not double-store a candidate's paper.
    existing = set(
        (await db.execute(
            select(CentreSealedRecord.leaf).where(
                CentreSealedRecord.leaf.in_([r.leaf for r in payload.manifest.records])
            )
        )).scalars().all()
    )

    stored = 0
    for r in payload.manifest.records:
        if r.leaf in existing:
            continue
        db.add(CentreSealedRecord(
            centre_id=centre.id,
            centre_id_hash=centre_id_hash,
            exam_id=r.examId,
            seat_no=r.seatNo,
            leaf_index=r.leafIndex,
            leaf=r.leaf,
            prev_root=r.prevRoot,
            chain_root=r.chainRoot,
            node_root_sig=r.nodeRootSig,
            ciphertext=r.ciphertext,
            iv=r.iv,
            auth_tag=r.authTag,
            wrapped_dk=r.wrappedDk,
            node_pubkey=payload.nodePubkey,
            manifest_hash=payload.manifestHash,
        ))
        stored += 1

    centre.last_sync_at = datetime.now(timezone.utc)

    # Tell tier-0 that a centre's papers landed.
    #
    # This is the whole reason the console can stop being a page somebody has to
    # remember to refresh. The courier runs unattended — no session, no operator,
    # frequently outside working hours — so until now the only trace of a
    # delivery was a log line on the server and a row count that changed if
    # someone happened to press Refresh afterwards.
    #
    # Only when something was actually STORED. A courier that retries a bundle
    # it already delivered answers stored=0/duplicate=N, and that is the same
    # delivery arriving twice, not news. Notifying on it would let one stuck
    # courier drive the badge up forever — see services/notifications.py.
    if stored:
        notify(
            db,
            kind=NotificationKind.CENTRE_DELIVERY_RECEIVED,
            severity=NotificationSeverity.SUCCESS,
            recipient_role=UserRole.SYSTEM_ADMIN,
            title=f"{stored} sealed record(s) delivered by {centre.name}",
            body=(
                f"{centre.name} delivered a verified bundle of {payload.manifest.count} record(s) "
                f"for exam {payload.manifest.records[0].examId if payload.manifest.records else '—'}. "
                "The chain, the manifest hash and the centre node's signature all verified. "
                "The records are sealed — opening them needs the HSM."
            ),
            source_feature="centre-uplink",
            subject_type="centre",
            subject_id=centre.id,
            payload={
                "centreIdHash": centre_id_hash,
                "centreName": centre.name,
                "examId": payload.manifest.records[0].examId if payload.manifest.records else None,
                "delivered": payload.manifest.count,
                "stored": stored,
                "duplicate": payload.manifest.count - stored,
                "manifestHash": payload.manifestHash,
                "nodePubkey": payload.nodePubkey,
            },
        )

    await db.commit()

    logger.info(
        "centre-sync: centre=%s delivered=%d stored=%d duplicate=%d from %s",
        centre.id, payload.manifest.count, stored, payload.manifest.count - stored,
        request.client.host if request.client else "?",
    )
    return {
        "ok": True,
        "centreIdHash": centre_id_hash,
        "verified": payload.manifest.count,
        "stored": stored,
        "duplicate": payload.manifest.count - stored,
    }


# ── tier-0 administration of the credential ────────────────────────────────
@router.post("/centres/{center_id}/key", summary="Mint a centre's uplink credential (tier-0)")
async def mint_centre_key(
    center_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.SYSTEM_ADMIN)),
):
    """Issue (or rotate) one centre's sync credential.

    Returned in full exactly once. Only the hash is stored, so a lost key is
    reissued rather than recovered — which is the property that makes a database
    read useless to an attacker.

    Rotation revokes the previous key the instant this returns: the old station
    stops syncing until it is re-provisioned with the new one. That is the
    correct behaviour for a credential that may have walked out of the building.
    """
    centre = (await db.execute(select(Center).where(Center.id == center_id))).scalar_one_or_none()
    if centre is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "UNKNOWN_CENTRE")

    key = secrets.token_hex(32)
    rotated = centre.sync_key_hash is not None
    centre.sync_key_hash = hash_sync_key(key)
    centre.sync_key_issued_at = datetime.now(timezone.utc)

    # Rotation silently stops the old station syncing. That is the intended
    # behaviour for a credential that may have walked out of the building, but
    # it also means the next thing an operator sees is a centre that has quietly
    # stopped delivering — so the rotation itself goes in the feed, where it
    # sits immediately above the failures it is about to cause.
    notify(
        db,
        kind=NotificationKind.CENTRE_CREDENTIAL_ISSUED,
        severity=NotificationSeverity.WARNING if rotated else NotificationSeverity.INFO,
        recipient_role=UserRole.SYSTEM_ADMIN,
        title=f"Uplink credential {'rotated' if rotated else 'issued'} for {centre.name}",
        body=(
            "The previous credential stopped working the moment this was issued. "
            "That centre's Admin Station cannot sync until it is re-provisioned with the new key."
            if rotated else
            "This centre can now pull its bundle and deliver sealed answers. "
            "The key is shown once and only its hash is stored here."
        ),
        source_feature="centre-uplink",
        subject_type="centre",
        subject_id=centre.id,
        payload={"centreName": centre.name, "rotated": rotated},
    )

    await db.commit()

    logger.info("centre-sync: %s uplink credential for centre %s",
                "rotated" if rotated else "issued", center_id)
    return {
        "ok": True,
        "centre": {"id": centre.id, "name": centre.name},
        "rotated": rotated,
        "syncKey": key,
        "note": "Shown once. Put it in the centre's centre.conf as HQ_CENTRE_KEY; "
                "it is never retrievable from HQ again.",
    }


@router.get("/centres", summary="Which centres have an uplink credential (tier-0)")
async def list_centre_uplinks(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.SYSTEM_ADMIN)),
):
    rows = (await db.execute(select(Center))).scalars().all()
    return {
        "ok": True,
        "hqSigningKey": hq_public_key_hex(),
        "centres": [{
            "id": c.id,
            "name": c.name,
            "provisioned": c.sync_key_hash is not None,
            "issuedAt": c.sync_key_issued_at.isoformat() if c.sync_key_issued_at else None,
            "lastSyncAt": c.last_sync_at.isoformat() if c.last_sync_at else None,
        } for c in rows],
    }


@router.get("/received", summary="Sealed records that have arrived from centres (tier-0)")
async def received(
    exam_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.SYSTEM_ADMIN)),
):
    """What is in the vault, counted — never the ciphertext itself.

    Enough for tier-0 to see that a centre's papers actually arrived and how
    many, which is the question an operator asks on results day. Reading them
    is ``/sys/ledger/decrypt``, and that needs the HSM.
    """
    q = select(CentreSealedRecord)
    if exam_id:
        q = q.where(CentreSealedRecord.exam_id == exam_id)
    rows = (await db.execute(q)).scalars().all()

    # Which (exam, centre) pairs have had their root published. Read from the
    # decrypted rows because that is where the anchoring route records the tx —
    # the console otherwise offers "Anchor" forever on a chain already on Polygon,
    # and the only feedback is the contract's revert.
    anchored: dict[tuple[str, str], str] = {}
    for exam, centre_hash, tx in (await db.execute(
        select(DecryptedAnswerRecord.exam_id, DecryptedAnswerRecord.centre_id_hash,
               DecryptedAnswerRecord.polygon_tx)
        .where(DecryptedAnswerRecord.polygon_tx.is_not(None))
    )).all():
        anchored[(centre_hash, exam)] = tx

    by_centre: dict[tuple[str, str], dict[str, Any]] = {}
    for r in rows:
        k = (r.centre_id_hash, r.exam_id)
        b = by_centre.setdefault(k, {
            "centreIdHash": r.centre_id_hash, "examId": r.exam_id,
            "count": 0, "decrypted": 0, "firstReceivedAt": None, "lastReceivedAt": None,
            "anchorTx": anchored.get(k),
        })
        b["count"] += 1
        if r.decrypted_at:
            b["decrypted"] += 1
        ts = r.received_at.isoformat() if r.received_at else None
        if ts:
            b["firstReceivedAt"] = min(b["firstReceivedAt"] or ts, ts)
            b["lastReceivedAt"] = max(b["lastReceivedAt"] or ts, ts)

    return {"ok": True, "total": len(rows), "groups": list(by_centre.values())}
