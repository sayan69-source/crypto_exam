"""
The cross-feature flow: a centre delivers, and tier-0 is told.

WHAT THESE TESTS ARE ACTUALLY FOR
---------------------------------
The claim being made is not "there is a notifications table". It is that an
event raised in ONE feature (the centre uplink, hit by an unattended courier
with no session) becomes visible in ANOTHER (the tier-0 console's feed, read by
a human with a SYSTEM_ADMIN token). Those two halves share no request, no
session and no user, so the only thing joining them is the row — which is
exactly what makes it worth pinning.

So the tests below drive the REAL delivery endpoint with a REAL signed bundle
and then read the REAL feed endpoint. Nothing here inserts a Notification
directly; a test that did would prove only that SQLAlchemy works.

The four properties that would each have been a bug:
  1. a successful delivery raises exactly one notification, addressed to tier-0;
  2. a REFUSED delivery raises one too — the case that was previously invisible
     to everyone not reading server logs;
  3. a courier RETRY does not raise a second one (the badge must not climb
     forever because a station's window keeps shutting mid-POST);
  4. a notification cannot be read, or acknowledged, by another role.
"""
import asyncio
import hashlib
import json
import sys
import tempfile
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

_DB = Path(tempfile.gettempdir()) / f"zuup_notif_{uuid.uuid4().hex}.db"

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey  # noqa: E402
from fastapi import Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from app.api.v1 import centre_sync  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Center, Notification, NotificationKind, UserRole  # noqa: E402
from app.services.auth import get_current_user  # noqa: E402

_engine = create_async_engine(f"sqlite+aiosqlite:///{_DB.as_posix()}", future=True)
_Session = async_sessionmaker(_engine, expire_on_commit=False)

CENTRE = str(uuid.uuid4())
CENTRE_KEY = "c" * 64
EXAM = str(uuid.uuid4())

# A centre that has never been given a credential, so the issue→rotate
# progression can be observed from its true start. CENTRE is seeded WITH a key
# (the delivery tests need one), which makes its very first mint a rotation.
FRESH_CENTRE = str(uuid.uuid4())

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
        s.add(Center(id=CENTRE, name="Kolkata Centre 7", state="WB",
                     sync_key_hash=hashlib.sha256(CENTRE_KEY.encode()).hexdigest()))
        s.add(Center(id=FRESH_CENTRE, name="Durgapur Centre 2", state="WB"))
        await s.commit()


@pytest.fixture(scope="module", autouse=True)
def _db():
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
    monkeypatch.setattr(centre_sync, "_signing_seed", lambda: HQ_SEED)


client = TestClient(app)


def _as_role(role: UserRole):
    """Read the feed as a given duty.

    `get_current_user` is overridden rather than a token minted, because what is
    under test is the ROLE SCOPING of the feed, and a real token would drag key
    management into a test about which rows come back.
    """
    app.dependency_overrides[get_current_user] = lambda: {
        "user_id": str(uuid.uuid4()), "role": role, "email": "duty@example.test",
    }


def _no_role():
    app.dependency_overrides.pop(get_current_user, None)


def _auth(centre=CENTRE, key=CENTRE_KEY):
    return {"x-centre-id": centre, "x-centre-key": key}


def _canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def _bundle(centre_id=CENTRE, count=2, seat_prefix="N"):
    """A bundle whose chain and envelopes genuinely verify — same construction
    the Edge uses, so the endpoint is not accepting its own invention.

    The filler bytes are derived from ``seat_prefix`` because a leaf is
    ``sha256(ct‖iv‖tag‖wrappedDk)`` and does NOT cover the seat number. Deriving
    them from the loop index alone produced byte-identical leaves for what were
    meant to be two different deliveries, so the second one deduplicated away
    and the test that needed a fresh event silently got a retry instead.
    """
    salt = seat_prefix.encode()
    prev = bytes(32)
    records = []
    for i in range(count):
        ct = hashlib.sha256(salt + b"ct" + bytes([i])).digest() * 2
        iv = hashlib.sha256(salt + b"iv" + bytes([i])).digest()[:12]
        tag = hashlib.sha256(salt + b"tag" + bytes([i])).digest()[:16]
        dk = hashlib.sha256(salt + b"dk" + bytes([i])).digest() * 8
        leaf = hashlib.sha256(ct + iv + tag + dk).digest()
        root = hashlib.sha256(prev + leaf).digest()
        records.append({
            "examId": EXAM, "seatNo": f"{seat_prefix}-{i:02d}", "leafIndex": i,
            "leaf": leaf.hex(), "prevRoot": prev.hex(), "chainRoot": root.hex(),
            "nodeRootSig": NODE.sign(root).hex(),
            "ciphertext": ct.hex(), "iv": iv.hex(), "authTag": tag.hex(),
            "wrappedDk": dk.hex(),
        })
        prev = root

    manifest = {"centreId": centre_id, "count": count, "records": records,
                "exportedAt": 1_700_000_000_000}
    mh = hashlib.sha256(_canonical(manifest)).digest()
    return {"manifest": manifest, "manifestHash": mh.hex(),
            "nodeSig": NODE.sign(mh).hex(),
            "nodePubkey": NODE.public_key().public_bytes_raw().hex()}


async def _rows(kind: NotificationKind | None = None):
    async with _Session() as s:
        q = select(Notification)
        if kind is not None:
            q = q.where(Notification.kind == kind)
        return (await s.execute(q.order_by(Notification.created_at))).scalars().all()


# ── 1. the flow itself ──────────────────────────────────────────────────────
def test_a_delivery_by_an_unauthenticated_courier_reaches_the_tier0_feed():
    """The point of the whole feature, in one test.

    The POST carries a centre credential and no user; the GET carries a
    SYSTEM_ADMIN identity and no centre credential. Nothing is shared between
    them but the notification row.
    """
    r = client.post("/api/v1/centre-sync/ledger", headers=_auth(), json=_bundle())
    assert r.status_code == 200, r.text
    assert r.json()["stored"] == 2

    _as_role(UserRole.SYSTEM_ADMIN)
    try:
        feed = client.get("/api/v1/notifications").json()
    finally:
        _no_role()

    assert feed["unread"] == 1, feed
    n = feed["notifications"][0]
    assert n["kind"] == "CENTRE_DELIVERY_RECEIVED"
    assert n["sourceFeature"] == "centre-uplink"
    assert n["read"] is False
    # The counts the operator needs are IN the row, not re-derived by the client.
    assert n["payload"]["stored"] == 2
    assert n["payload"]["centreName"] == "Kolkata Centre 7"
    assert "Kolkata Centre 7" in n["title"]


def test_the_notification_carries_no_candidate_identifying_data():
    """DPDP: this row describes a delivery, never its contents.

    Seat numbers are in the manifest the courier posted, so an over-eager
    payload would leak them into a feed that is read far more casually than the
    vault is.
    """
    rows = asyncio.run(_rows(NotificationKind.CENTRE_DELIVERY_RECEIVED))
    assert rows, "nothing was raised to inspect"
    blob = json.dumps([{"t": r.title, "b": r.body, "p": r.payload} for r in rows]).lower()
    for forbidden in ("seatno", "n-00", "n-01", "roll", "ciphertext", "wrappeddk"):
        assert forbidden not in blob, f"{forbidden!r} leaked into a notification"


# ── 2. the case that used to be invisible ───────────────────────────────────
def test_a_refused_delivery_is_recorded_even_though_the_request_fails():
    """A bundle that fails verification must leave a trace at HQ.

    This is the subtle one: the request raises, so the request's transaction
    rolls back. A notification staged and left to that transaction would vanish
    with it — the endpoint would 4xx, the courier would retry forever, and HQ
    would show nothing wrong.
    """
    before = len(asyncio.run(_rows(NotificationKind.CENTRE_DELIVERY_REJECTED)))

    bad = _bundle(count=3, seat_prefix="X")
    bad["manifest"]["records"][1]["ciphertext"] = "ff" * 48  # leaf no longer digests to it
    mh = hashlib.sha256(_canonical(bad["manifest"])).digest()
    bad["manifestHash"] = mh.hex()
    bad["nodeSig"] = NODE.sign(mh).hex()

    r = client.post("/api/v1/centre-sync/ledger", headers=_auth(), json=bad)
    assert r.status_code == 409
    assert "LEAF_ENVELOPE_MISMATCH" in r.json()["detail"]

    after = asyncio.run(_rows(NotificationKind.CENTRE_DELIVERY_REJECTED))
    assert len(after) == before + 1, "a refused delivery left no trace for tier-0"
    assert after[-1].severity.value == "CRITICAL"
    # The chain verifier names the index of the link that broke
    # ("LEAF_ENVELOPE_MISMATCH@1"), and that index is carried through verbatim —
    # "which record" is the first thing an operator asks.
    assert after[-1].payload["reason"].startswith("LEAF_ENVELOPE_MISMATCH")
    assert after[-1].payload["reason"].endswith("@1")


def test_a_bundle_claiming_another_centre_is_recorded_against_the_credential_used():
    """The row must name who actually presented the credential, not who the
    bundle claimed to be — otherwise the feed blames the impersonated centre."""
    r = client.post("/api/v1/centre-sync/ledger", headers=_auth(),
                    json=_bundle(centre_id=str(uuid.uuid4())))
    assert r.status_code == 403

    rows = asyncio.run(_rows(NotificationKind.CENTRE_DELIVERY_REJECTED))
    assert rows[-1].payload["reason"] == "CENTRE_MISMATCH"
    assert rows[-1].subject_id == CENTRE
    assert rows[-1].payload["centreName"] == "Kolkata Centre 7"


# ── 3. a retry is not an event ──────────────────────────────────────────────
def test_a_courier_retry_does_not_raise_a_second_notification():
    """``/ledger`` is idempotent, so a station whose window shut mid-POST
    re-sends the whole bundle. That is the same delivery arriving again.

    Without this, one stuck courier drives the badge up forever and trains the
    operator to ignore the number that matters.
    """
    before = len(asyncio.run(_rows(NotificationKind.CENTRE_DELIVERY_RECEIVED)))

    again = client.post("/api/v1/centre-sync/ledger", headers=_auth(), json=_bundle())
    assert again.status_code == 200
    assert again.json() == {**again.json(), "stored": 0, "duplicate": 2}

    after = len(asyncio.run(_rows(NotificationKind.CENTRE_DELIVERY_RECEIVED)))
    assert after == before, "a retry of an already-delivered bundle raised a fresh notification"


# ── 4. the feed is scoped to a duty ─────────────────────────────────────────
def test_another_role_cannot_see_tier0s_feed():
    """There is no ``?role=`` to abuse: the scope comes from the token."""
    _as_role(UserRole.CANDIDATE)
    try:
        feed = client.get("/api/v1/notifications").json()
    finally:
        _no_role()
    assert feed["notifications"] == []
    assert feed["unread"] == 0


def test_an_unauthenticated_reader_gets_nothing():
    assert client.get("/api/v1/notifications").status_code in (401, 403)
    assert client.get("/api/v1/notifications/summary").status_code in (401, 403)


def test_another_role_cannot_acknowledge_a_row_it_cannot_see():
    """404 rather than 403 — the caller has no business learning the id exists."""
    target = asyncio.run(_rows(NotificationKind.CENTRE_DELIVERY_RECEIVED))[0]

    _as_role(UserRole.ADMIN)
    try:
        r = client.post(f"/api/v1/notifications/{target.id}/read")
    finally:
        _no_role()
    assert r.status_code == 404
    assert r.json()["detail"] == "NO_SUCH_NOTIFICATION"

    async def still_unread():
        async with _Session() as s:
            row = (await s.execute(
                select(Notification).where(Notification.id == str(target.id))
            )).scalar_one()
            return row.read_at is None

    assert asyncio.run(still_unread()), "another role marked tier-0's notification read"


# ── acknowledgement ─────────────────────────────────────────────────────────
def test_acknowledging_clears_the_badge_and_survives_a_reload():
    """Read state is the property a socket frame or a toast cannot provide."""
    _as_role(UserRole.SYSTEM_ADMIN)
    try:
        before = client.get("/api/v1/notifications/summary").json()
        assert before["unread"] > 0
        assert before["latest"] is not None

        done = client.post("/api/v1/notifications/read-all").json()
        assert done["acknowledged"] == before["unread"]
        assert done["unread"] == 0

        # A fresh request — i.e. what a page reload does — still sees zero.
        assert client.get("/api/v1/notifications/summary").json()["unread"] == 0

        # ...but the history is still there. Acknowledged is not deleted.
        feed = client.get("/api/v1/notifications").json()
        assert feed["count"] > 0
        assert all(n["read"] for n in feed["notifications"])
        assert all(n["readAt"] for n in feed["notifications"])
    finally:
        _no_role()


def test_unread_only_filters_and_a_new_event_reappears_after_acknowledging():
    """The badge has to come back, or acknowledging once silences it forever."""
    _as_role(UserRole.SYSTEM_ADMIN)
    try:
        client.post("/api/v1/notifications/read-all")
        assert client.get("/api/v1/notifications?unread_only=true").json()["count"] == 0
    finally:
        _no_role()

    # A genuinely new delivery (different seats → different leaves).
    r = client.post("/api/v1/centre-sync/ledger", headers=_auth(),
                    json=_bundle(count=1, seat_prefix="Z"))
    assert r.status_code == 200 and r.json()["stored"] == 1

    _as_role(UserRole.SYSTEM_ADMIN)
    try:
        unread = client.get("/api/v1/notifications?unread_only=true").json()
        assert unread["count"] == 1
        assert unread["unread"] == 1
        assert unread["notifications"][0]["payload"]["stored"] == 1
    finally:
        _no_role()


def test_acknowledging_twice_keeps_the_first_time_it_was_seen():
    """When it was seen is the audit-relevant fact; a re-click must not move it."""
    _as_role(UserRole.SYSTEM_ADMIN)
    try:
        row = client.get("/api/v1/notifications?unread_only=true").json()["notifications"][0]
        first = client.post(f"/api/v1/notifications/{row['id']}/read").json()
        assert first["notification"]["read"] is True

        second = client.post(f"/api/v1/notifications/{row['id']}/read").json()
        assert second["notification"]["readAt"] == first["notification"]["readAt"]
    finally:
        _no_role()


# ── the credential half of the same feature ─────────────────────────────────
def test_rotating_a_credential_warns_that_the_old_station_will_stop_syncing():
    """Rotation silently breaks the centre's station until it is re-provisioned.
    The feed is where that consequence becomes visible."""
    _as_role(UserRole.SYSTEM_ADMIN)
    try:
        # A centre that has never held a credential, so the first call is a
        # genuine issue rather than a rotation.
        client.post(f"/api/v1/centre-sync/centres/{FRESH_CENTRE}/key")  # issue
        client.post(f"/api/v1/centre-sync/centres/{FRESH_CENTRE}/key")  # rotate
    finally:
        _no_role()

    rows = asyncio.run(_rows(NotificationKind.CENTRE_CREDENTIAL_ISSUED))
    assert len(rows) == 2
    assert rows[0].payload["rotated"] is False and rows[0].severity.value == "INFO"
    assert rows[1].payload["rotated"] is True and rows[1].severity.value == "WARNING"
