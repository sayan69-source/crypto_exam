"""
The second cross-feature flow: the PUBLIC site → the tier-1 admin console.

WHY THIS IS A SEPARATE FILE FROM test_notifications.py
------------------------------------------------------
That file pins the tier-0 flow, where a courier daemon delivers sealed answers.
This one pins the flow with the widest gap between its two ends: the caller is
a member of the public with NO ACCOUNT AT ALL — not an unauthenticated daemon
holding a credential, but a person filling in a form on the marketing site —
and the reader is an authenticated administrator whose console may not be open
for hours.

Together they demonstrate the property that makes this one feature rather than
two: both feeds are the same table, and neither role can see the other's rows.
The last test here is the one that proves it.

The four things pinned:
  1. a public registration reaches the admin feed, with no session on either side;
  2. approving it raises a second event — the queue is shared, so a row that
     vanishes from another administrator's screen must leave a record of who
     actioned it;
  3. an activation code and a biometric descriptor NEVER reach the feed;
  4. tier-0 and tier-1 cannot read each other's notifications.
"""
import asyncio
import sys
import tempfile
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

_DB = Path(tempfile.gettempdir()) / f"zuup_notif_pub_{uuid.uuid4().hex}.db"

from fastapi import Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Center, Notification, NotificationKind, UserRole  # noqa: E402
from app.services.auth import get_current_user  # noqa: E402

_engine = create_async_engine(f"sqlite+aiosqlite:///{_DB.as_posix()}", future=True)
_Session = async_sessionmaker(_engine, expire_on_commit=False)

CENTRE = str(uuid.uuid4())

# A real 128-float face descriptor is what the endpoint requires; the values do
# not matter here, only that the shape is genuine.
DESCRIPTOR = [round(0.01 * i, 4) for i in range(128)]


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
        s.add(Center(id=CENTRE, name="Siliguri Centre 3", state="WB"))
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


client = TestClient(app)


def _as_role(role: UserRole):
    app.dependency_overrides[get_current_user] = lambda: {
        "user_id": str(uuid.uuid4()), "role": role, "email": "duty@example.test",
    }


def _no_role():
    app.dependency_overrides.pop(get_current_user, None)


async def _rows(kind: NotificationKind | None = None):
    async with _Session() as s:
        q = select(Notification)
        if kind is not None:
            q = q.where(Notification.kind == kind)
        return (await s.execute(q.order_by(Notification.created_at))).scalars().all()


def _register(name: str, role: str = "CENTER_ADMIN"):
    """Apply on the public site — no Authorization header anywhere."""
    return client.post("/api/v1/staff/register", json={
        "role": role,
        "centerId": CENTRE,
        "fullName": name,
        "faceDescriptor": DESCRIPTOR,
    })


# ── 1. the crossing ─────────────────────────────────────────────────────────
def test_a_public_registration_reaches_the_admin_feed():
    """No session on the writing side, a session on the reading side.

    The POST carries no Authorization header at all — it cannot, the applicant
    has no account and the whole point of registering is to acquire one. The
    GET carries an ADMIN identity. Nothing is shared but the row.
    """
    r = _register("Anita Bose")
    assert r.status_code == 200, r.text
    request_id = r.json()["requestId"]

    # A Centre Admin applicant is tier-0's decision, so that is the feed it
    # must land in — see the routing note in staff_reg.register.
    _as_role(UserRole.SYSTEM_ADMIN)
    try:
        feed = client.get("/api/v1/notifications").json()
    finally:
        _no_role()

    assert feed["unread"] == 1, feed
    n = feed["notifications"][0]
    assert n["kind"] == "STAFF_REGISTRATION_SUBMITTED"
    assert n["sourceFeature"] == "staff-registration"
    assert n["subjectId"] == request_id
    assert "Anita Bose" in n["title"]
    assert n["payload"]["centreName"] == "Siliguri Centre 3"
    assert n["read"] is False


def test_an_application_is_not_shown_to_a_role_that_cannot_approve_it():
    """A tier-1 administrator gets 403 SYSTEM_ADMIN_REQUIRED if they try to
    approve a Centre Admin. Putting that application in their feed would be an
    invitation to a refusal, and would make the queue look handled to the one
    console that can actually handle it."""
    _as_role(UserRole.ADMIN)
    try:
        feed = client.get("/api/v1/notifications?limit=200").json()
    finally:
        _no_role()
    assert all(n["kind"] != "STAFF_REGISTRATION_SUBMITTED" for n in feed["notifications"]), \
        "a Centre Admin application was shown to a role that cannot approve it"


def test_the_notification_names_who_holds_the_approval():
    """A Centre Admin applicant is tier-0's to approve; an Invigilator is their
    own centre's. Getting that wrong sends an operator to the wrong queue."""
    _register("Rakesh Iyer", role="CENTER_INVIGILATOR")

    rows = asyncio.run(_rows(NotificationKind.STAFF_REGISTRATION_SUBMITTED))
    by_name = {r.payload["applicantName"]: r for r in rows}
    assert by_name["Anita Bose"].payload["approverRole"] == "SYSTEM_ADMIN"
    assert by_name["Rakesh Iyer"].payload["approverRole"] == "CENTER_ADMIN"
    assert "Invigilator" in by_name["Rakesh Iyer"].title


# ── 2. the return leg ───────────────────────────────────────────────────────
def test_approving_records_the_decision_for_the_other_administrator():
    """The approvals queue is shared. Without this, a second administrator with
    the page open sees a row vanish on their next poll and has no way to learn
    who actioned it."""
    r = _register("Meera Nair")
    request_id = r.json()["requestId"]

    _as_role(UserRole.SYSTEM_ADMIN)
    try:
        approved = client.post(f"/api/v1/admin/staff-approvals/{request_id}/issue-code")
        assert approved.status_code == 200, approved.text
        code = approved.json()["code"]
        assert code, "no activation code was issued"
    finally:
        _no_role()

    rows = asyncio.run(_rows(NotificationKind.STAFF_REGISTRATION_APPROVED))
    assert len(rows) == 1
    assert rows[0].payload["applicantName"] == "Meera Nair"
    assert rows[0].subject_id == request_id
    assert rows[0].severity.value == "SUCCESS"

    # The whole journey for one applicant is now two rows that share a subject.
    submitted = [r for r in asyncio.run(_rows(NotificationKind.STAFF_REGISTRATION_SUBMITTED))
                 if r.subject_id == request_id]
    assert len(submitted) == 1, "the submission and the approval must both be on file"


# ── 3. what must never be in a feed ─────────────────────────────────────────
def test_no_activation_code_and_no_biometric_material_reaches_the_feed():
    """The two secrets this flow handles.

    The activation code is returned to ONE browser once and stored only as a
    hash; a feed that echoed it would hand a second administrator a credential
    they were never issued. The face descriptor is biometric data under the
    DPDP Act and belongs in the row the approver opens, behind its own
    authorisation — never in a list rendered on every page load.
    """
    r = _register("Suresh Pillai")
    rid = r.json()["requestId"]
    _as_role(UserRole.SYSTEM_ADMIN)
    try:
        code = client.post(f"/api/v1/admin/staff-approvals/{rid}/issue-code").json()["code"]
    finally:
        _no_role()

    import json
    blob = json.dumps([
        {"t": n.title, "b": n.body, "p": n.payload} for n in asyncio.run(_rows())
    ]).lower()

    assert code.lower() not in blob, "an activation code leaked into the notification feed"
    for forbidden in ("facedescriptor", "face_embedding", "embedding", "descriptor",
                      "activationcode", "activation_code"):
        assert forbidden not in blob, f"{forbidden!r} leaked into a notification"
    # A couple of the descriptor's actual values, in case it were serialised raw.
    assert "0.07" not in blob and "0.11" not in blob


# ── 4. one table, two feeds ─────────────────────────────────────────────────
def test_the_two_consoles_cannot_read_each_others_feeds():
    """The property that makes this one feature rather than two.

    A tier-1 administrator learning that a specific centre's sealed papers
    arrived is exactly the leak the two-tier separation exists to prevent, and
    tier-0 has no business reading the public registration queue either. There
    is no `?role=` to abuse — the scope comes from the token.
    """
    from app.services.notifications import notify

    # One event for the OTHER console, staged directly. Its producer — the
    # centre uplink — is exercised for real in test_notifications.py; what is
    # under test here is who can READ it, so staging it is the honest way to
    # get a tier-0 row into a database this file otherwise fills with tier-1
    # and CENTRE_ADMIN ones.
    async def raise_a_tier0_event():
        async with _Session() as s:
            notify(
                s,
                kind=NotificationKind.CENTRE_DELIVERY_RECEIVED,
                recipient_role=UserRole.SYSTEM_ADMIN,
                title="4 sealed record(s) delivered by Siliguri Centre 3",
                source_feature="centre-uplink",
                subject_type="centre",
                subject_id=CENTRE,
                payload={"stored": 4},
            )
            await s.commit()

    asyncio.run(raise_a_tier0_event())

    def feed_for(role):
        _as_role(role)
        try:
            return client.get("/api/v1/notifications?limit=200").json()
        finally:
            _no_role()

    tier0 = feed_for(UserRole.SYSTEM_ADMIN)
    tier1 = feed_for(UserRole.ADMIN)
    # Not a UserRole on this platform: a Centre Admin's console runs inside the
    # locked OS on the centre LAN. The row is still addressed to them, and the
    # scoping still has to hold for a role this enum has never heard of.
    centre = feed_for("CENTER_ADMIN")

    tier0_kinds = {n["kind"] for n in tier0["notifications"]}
    tier1_kinds = {n["kind"] for n in tier1["notifications"]}
    centre_kinds = {n["kind"] for n in centre["notifications"]}

    # Tier-0 holds the Centre Admin applications it must approve, plus its own
    # operational events.
    assert "STAFF_REGISTRATION_SUBMITTED" in tier0_kinds
    assert "CENTRE_DELIVERY_RECEIVED" in tier0_kinds
    assert tier0["unread"] >= 2

    # The Invigilator application went to the centre that must approve it, and
    # nowhere else.
    assert centre_kinds == {"STAFF_REGISTRATION_SUBMITTED"}
    assert all(n["payload"]["applicantName"] == "Rakesh Iyer"
               for n in centre["notifications"])

    # Tier-1 sees NEITHER. Learning which centre's sealed papers arrived is
    # exactly the leak the two-tier separation exists to prevent, and it has no
    # business in the tier-0 approval queue either.
    assert tier1_kinds == set(), f"tier-1 can read another duty's feed: {tier1_kinds}"
    assert tier1["unread"] == 0

    # No pair of feeds overlaps, and none of them is empty by accident.
    assert tier0_kinds and centre_kinds
    assert not (tier0_kinds & centre_kinds & tier1_kinds)
