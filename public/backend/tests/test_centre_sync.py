"""
The centre uplink, from HQ's side (§12 in, §13.4 out).

This is the surface an Admin Station talks to with no human logged in, so every
guarantee it has is in the credential check and the verification of what it
delivers. Four things are pinned here, and each one failed differently before
this endpoint existed:

  1. a centre credential is scoped to ONE centre — it cannot pull another
     centre's roster, and it cannot deliver answers claiming to be another
     centre;
  2. the bundle HQ hands out is SIGNED, so possession of the transport
     credential (which necessarily sits in plaintext on the station's ESP) is
     not the power to write a roster;
  3. sealed answers that arrive are VERIFIED and then actually KEPT — the
     previous ingest route verified a bundle and discarded it, so a centre could
     complete the whole round trip and leave nothing at HQ;
  4. delivering the same bundle twice does not duplicate a candidate's paper.
"""
import asyncio
import hashlib
import json
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

_DB = Path(tempfile.gettempdir()) / f"zuup_csync_{uuid.uuid4().hex}.db"

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey  # noqa: E402
from fastapi import Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from app.api.v1 import centre_sync  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Center, CentreSealedRecord  # noqa: E402

_engine = create_async_engine(f"sqlite+aiosqlite:///{_DB.as_posix()}", future=True)
_Session = async_sessionmaker(_engine, expire_on_commit=False)

A_CENTRE, B_CENTRE = str(uuid.uuid4()), str(uuid.uuid4())
A_KEY, B_KEY = "a" * 64, "b" * 64
EXAM = str(uuid.uuid4())

# The centre node's signing key (the Edge's TPM stand-in) and HQ's own.
NODE = Ed25519PrivateKey.from_private_bytes(bytes(range(32)))
HQ_SEED = bytes([7]) * 32


async def _override_get_db(request: Request):
    async with _Session() as s:
        request.state.db = s
        try:
            yield s
            await s.commit()
        except Exception:
            await s.rollback()
            raise


async def _seed():
    async with _engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with _Session() as s:
        s.add(Center(id=A_CENTRE, name="Centre A", state="WB",
                     sync_key_hash=hashlib.sha256(A_KEY.encode()).hexdigest()))
        s.add(Center(id=B_CENTRE, name="Centre B", state="MH",
                     sync_key_hash=hashlib.sha256(B_KEY.encode()).hexdigest()))
        await s.commit()


@pytest.fixture(scope="module", autouse=True)
def _db(monkeypatch_module=None):
    prev = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = _override_get_db
    asyncio.run(_seed())
    yield
    asyncio.run(_engine.dispose())
    _DB.unlink(missing_ok=True)
    app.dependency_overrides.clear()
    app.dependency_overrides.update(prev)


@pytest.fixture(autouse=True)
def _hq_signs(monkeypatch):
    """HQ has a signing key for every test here.

    Patched at the module's own accessor rather than through the environment:
    `get_settings` is lru_cached, so an env var set after the first import would
    silently not take effect and the signature assertions would pass vacuously.
    """
    monkeypatch.setattr(centre_sync, "_signing_seed", lambda: HQ_SEED)


client = TestClient(app)


def _auth(centre=A_CENTRE, key=A_KEY):
    return {"x-centre-id": centre, "x-centre-key": key}


def _canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def _sealed_bundle(centre_id=A_CENTRE, count=2):
    """A sync bundle whose chain and envelopes actually verify.

    Built the way the Edge builds it — leaf = sha256(ct‖iv‖tag‖wrappedDk),
    root = sha256(prev‖leaf) — because a fixture that skips that only proves the
    endpoint accepts its own invention.
    """
    genesis = bytes(32)
    prev = genesis
    records = []
    for i in range(count):
        ct = bytes([i + 1]) * 48
        iv = bytes([i + 2]) * 12
        tag = bytes([i + 3]) * 16
        dk = bytes([i + 4]) * 256
        leaf = hashlib.sha256(ct + iv + tag + dk).digest()
        root = hashlib.sha256(prev + leaf).digest()
        records.append({
            "examId": EXAM, "seatNo": f"A-{i:02d}", "leafIndex": i,
            "leaf": leaf.hex(), "prevRoot": prev.hex(), "chainRoot": root.hex(),
            "nodeRootSig": NODE.sign(root).hex(),
            "ciphertext": ct.hex(), "iv": iv.hex(), "authTag": tag.hex(),
            "wrappedDk": dk.hex(),
        })
        prev = root

    manifest = {"centreId": centre_id, "count": count, "records": records,
                "exportedAt": 1_700_000_000_000}
    manifest_bytes = _canonical(manifest)
    manifest_hash = hashlib.sha256(manifest_bytes).digest()
    pub = NODE.public_key().public_bytes_raw().hex()
    return {
        "manifest": manifest,
        "manifestHash": manifest_hash.hex(),
        "nodeSig": NODE.sign(manifest_hash).hex(),
        "nodePubkey": pub,
    }


# ── the credential ──────────────────────────────────────────────────────────
def test_no_credential_is_refused_and_says_nothing_about_which_centres_exist():
    for headers in ({}, {"x-centre-id": A_CENTRE}, _auth(key="wrong" * 12),
                    _auth(centre=str(uuid.uuid4()))):
        r = client.get("/api/v1/centre-sync/hello", headers=headers)
        assert r.status_code == 401, headers
        assert r.json()["detail"] == "BAD_CENTRE_CREDENTIAL"


def test_a_centre_pulls_its_own_bundle_and_it_is_signed_by_hq():
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    r = client.get("/api/v1/centre-sync/bundle", headers=_auth())
    assert r.status_code == 200
    body = r.json()
    assert body["bundle"]["centre"]["id"] == A_CENTRE
    assert body["signature"], "HQ handed out an unsigned bundle"

    # The signature must cover the exact bytes the courier forwards, or the Edge
    # will reject every bundle that ever leaves here.
    digest = hashlib.sha256(_canonical(body["bundle"])).digest()
    Ed25519PublicKey.from_public_bytes(bytes.fromhex(body["hqPublicKey"])).verify(
        bytes.fromhex(body["signature"]), digest)


def test_a_centre_cannot_pull_another_centres_bundle():
    # There is no parameter to abuse: the bundle is chosen by the credential.
    r = client.get("/api/v1/centre-sync/bundle", headers=_auth(centre=B_CENTRE, key=A_KEY))
    assert r.status_code == 401


# ── the sealed ledger ───────────────────────────────────────────────────────
def test_sealed_answers_are_verified_and_actually_stored():
    bundle = _sealed_bundle()
    r = client.post("/api/v1/centre-sync/ledger", headers=_auth(), json=bundle)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["verified"] == 2 and body["stored"] == 2

    async def count():
        async with _Session() as s:
            from sqlalchemy import select
            rows = (await s.execute(select(CentreSealedRecord))).scalars().all()
            return rows
    rows = asyncio.run(count())
    assert len(rows) == 2, "the bundle verified and was then thrown away"
    # Ciphertext only — nothing here is readable without the HSM.
    assert all(r.wrapped_dk and r.ciphertext for r in rows)
    assert all(r.decrypted_at is None for r in rows)


def test_redelivering_the_same_bundle_is_idempotent():
    """A courier whose window shut mid-POST retries the whole bundle."""
    bundle = _sealed_bundle()
    r = client.post("/api/v1/centre-sync/ledger", headers=_auth(), json=bundle)
    assert r.status_code == 200
    assert r.json()["stored"] == 0 and r.json()["duplicate"] == 2


def test_a_centre_cannot_deliver_a_bundle_claiming_to_be_another_centre():
    bundle = _sealed_bundle(centre_id=B_CENTRE)
    r = client.post("/api/v1/centre-sync/ledger", headers=_auth(), json=bundle)
    assert r.status_code == 403
    assert r.json()["detail"] == "CENTRE_MISMATCH"


def test_a_tampered_record_is_refused_whole():
    bundle = _sealed_bundle(count=3)
    # Flip one byte of one envelope: the leaf no longer digests to its contents.
    bundle["manifest"]["records"][1]["ciphertext"] = "ff" * 48
    manifest_hash = hashlib.sha256(_canonical(bundle["manifest"])).digest()
    bundle["manifestHash"] = manifest_hash.hex()
    bundle["nodeSig"] = NODE.sign(manifest_hash).hex()

    before = asyncio.run(_stored_count())
    r = client.post("/api/v1/centre-sync/ledger", headers=_auth(), json=bundle)
    assert r.status_code == 409
    assert "LEAF_ENVELOPE_MISMATCH" in r.json()["detail"]
    assert asyncio.run(_stored_count()) == before, "a refused bundle left rows behind"


def test_a_bundle_signed_by_the_wrong_node_is_refused():
    bundle = _sealed_bundle()
    impostor = Ed25519PrivateKey.from_private_bytes(bytes([99]) * 32)
    bundle["nodeSig"] = impostor.sign(bytes.fromhex(bundle["manifestHash"])).hex()
    r = client.post("/api/v1/centre-sync/ledger", headers=_auth(), json=bundle)
    assert r.status_code == 401
    assert r.json()["detail"] == "NODE_SIGNATURE_INVALID"


async def _stored_count():
    from sqlalchemy import select, func
    async with _Session() as s:
        return (await s.execute(select(func.count()).select_from(CentreSealedRecord))).scalar_one()


# ── the public half ─────────────────────────────────────────────────────────
def test_the_hq_public_key_is_published_unauthenticated():
    """The offline provisioning host has no credential and needs this value."""
    r = client.get("/api/v1/centre-sync/hq-pubkey")
    assert r.status_code == 200
    body = r.json()
    assert body["signed"] is True
    assert len(body["hqPublicKey"]) == 64


def test_hello_reports_what_is_waiting_for_this_centre():
    r = client.get("/api/v1/centre-sync/hello", headers=_auth())
    assert r.status_code == 200
    body = r.json()
    assert body["centre"]["id"] == A_CENTRE
    assert set(body["available"]) == {"candidates", "staff", "exams", "question_bundles"}
    # The clock a terminal with no NTP is checking itself against.
    datetime.fromisoformat(body["serverTime"]).astimezone(timezone.utc)
