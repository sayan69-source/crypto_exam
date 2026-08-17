"""
Assembly end to end (§6.1) — the property is the ORDERING, so that is what is tested.

Every test here fails if the paper can be known before the beacon picks it. The
happy path is almost incidental: what matters is that the commitment cannot be
rebuilt, the draw cannot be re-rolled, and the drawn items cannot be read early.

Driven through the real ASGI app against a throwaway SQLite file, so the
endpoints, the role gates and the ORM mappings are all exercised rather than the
service functions being called directly (which the existing test_item_pool.py
already does).
"""
import asyncio
import os
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

_DB = Path(tempfile.gettempdir()) / f"zuup_forms_{uuid.uuid4().hex}.db"

from fastapi import Request  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402

# A private engine, and `get_db` overridden to hand it out.
#
# NOT `os.environ["DATABASE_URL"] = …` at import time, which is what this file
# did first. `app.database` binds its engine once, at ITS import — so setting the
# variable here only works when this module happens to be imported before any
# other test module touches the app. Alone: 6 passed. In the full suite: 6
# errors, because something else got there first. A test that depends on
# collection order is a test that will lie eventually.
_engine = create_async_engine(f"sqlite+aiosqlite:///{_DB.as_posix()}", future=True)
_Session = async_sessionmaker(_engine, expire_on_commit=False)


# `request: Request` must be ANNOTATED. Without the annotation FastAPI reads it
# as a query parameter and every call 422s with "Field required" — the override
# is otherwise correct, which makes the error read like a bug in the endpoint.
async def _override_get_db(request: Request):
    async with _Session() as session:
        request.state.db = session
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


# NOT set at import time. `app.dependency_overrides` is ONE global dict shared by
# every test module, so an import-time assignment means the module that happens
# to be imported last owns the database for the whole run — each file passes
# alone and they fail together. The autouse fixture below claims the override
# for the duration of THIS module's tests and puts back whatever was there.
from app.models import (  # noqa: E402
    Exam, ExamBody, ExamStatus, ExamType, ItemStatus, PoolItem, ItemTemplate, UserRole,
)
from app.services.auth import get_current_user  # noqa: E402

# SQLite's DateTime column takes datetime objects, not strings.
_T0 = datetime(2030, 1, 1, 9, 0, tzinfo=timezone.utc)

ADMIN = {"user_id": str(uuid.uuid4()), "role": UserRole.ADMIN}
EXAM_ID = str(uuid.uuid4())

# Override get_current_user, NOT require_role. `require_role(...)` is a factory
# that returns a fresh closure on every call, so keying the override on one would
# key it on an object no route actually depends on — the override silently does
# nothing and every request 401s. require_role delegates to get_current_user,
# which is a stable module-level function, so that is the real seam.

def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


async def _seed() -> None:
    """A pool wide enough to satisfy the 5% cap: 24 authors x 4 items each."""
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with _Session() as s:
        s.add(Exam(
            id=EXAM_ID, name="Assembly Test", exam_body=ExamBody.CUSTOM,
            subject_taxonomy={"Physics": []}, exam_type=ExamType.ONLINE_CBT,
            duration_minutes=180, scheduled_at=_T0,
            status=ExamStatus.DRAFT, irt_config={}, blooms_config={},
        ))
        for a in range(24):
            author = str(uuid.uuid4())
            for k in range(4):
                tpl = ItemTemplate(
                    id=str(uuid.uuid4()), template_id=f"T-{a}-{k}", author_id=author,
                    subject="Physics", stem="s", params={"x": [1]}, answer_expr="x",
                    distractors=[], status=ItemStatus.PROVISIONAL,
                )
                s.add(tpl)
                await s.flush()
                s.add(PoolItem(
                    id=str(uuid.uuid4()), template_pk=tpl.id, author_id=author,
                    blob_id=uuid.uuid4().hex, stem=f"item {a}-{k}",
                    options=["1", "2", "3", "4"], correct_index=0,
                    subject="Physics", status=ItemStatus.PROVISIONAL,
                ))
        await s.commit()


@pytest.fixture(scope="module", autouse=True)
def _db():
    _prev = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_current_user] = lambda: ADMIN
    asyncio.get_event_loop_policy().new_event_loop()
    asyncio.run(_seed())
    yield
    asyncio.run(_engine.dispose())
    _DB.unlink(missing_ok=True)
    app.dependency_overrides.clear()
    app.dependency_overrides.update(_prev)


def _run(coro):
    return asyncio.run(coro)


BLUEPRINT = {"Physics": 40}


def test_the_full_chain_commits_then_draws():
    async def go():
        async with _client() as c:
            r = await c.post(f"/api/v1/forms/{EXAM_ID}/assemble",
                             json={"blueprint": BLUEPRINT, "count": 8})
            assert r.status_code == 201, r.text
            body = r.json()
            assert body["form_count"] == 8
            assert len(body["form_set_root"]) == 64
            # §5.3.3 — the cap holds on every committed form, not on average.
            assert all(share <= 0.05 + 1e-9 for share in body["max_author_share"]), body["max_author_share"]

            beacon = "ab" * 32
            r = await c.post(f"/api/v1/forms/{EXAM_ID}/select", json={"beacon_hex": beacon})
            assert r.status_code == 200, r.text
            idx = r.json()["selected_index"]
            assert 0 <= idx < 8

            # The draw must be recomputable by a stranger from published values.
            import hashlib, hmac
            expect = int.from_bytes(
                hmac.new(bytes.fromhex(beacon), f"cryptoexam:form:{EXAM_ID}".encode(),
                         hashlib.sha256).digest(), "big") % 8
            assert idx == expect
    _run(go())


def test_the_commitment_does_not_reveal_which_items_are_in_which_form():
    """
    The commitment is public so that the draw can be checked. If it also carried
    the item ids, publishing it would hand over the entire pool-to-paper mapping
    — every form, a week early, to anyone who asked.
    """
    async def go():
        async with _client() as c:
            r = await c.get(f"/api/v1/forms/{EXAM_ID}/commitment")
            assert r.status_code == 200
            blob = r.text.lower()
            assert "item_ids" not in blob
            assert "blob_id" not in blob
            assert "stem" not in blob
    _run(go())


def test_a_committed_form_set_cannot_be_rebuilt():
    """
    Re-assembly would let whoever holds the token roll again until a favourable
    set appeared, while `form_set_root` still looked like a commitment.
    """
    async def go():
        async with _client() as c:
            r = await c.post(f"/api/v1/forms/{EXAM_ID}/assemble",
                             json={"blueprint": BLUEPRINT, "count": 8})
            assert r.status_code == 409
            assert r.json()["detail"]["reason"] == "ALREADY_COMMITTED"
    _run(go())


def test_a_second_beacon_cannot_re_roll_the_draw():
    """
    The one way to defeat this scheme from the inside while every published
    artifact still looks correct: draw, dislike the answer, draw again.
    """
    async def go():
        async with _client() as c:
            r = await c.post(f"/api/v1/forms/{EXAM_ID}/select", json={"beacon_hex": "cd" * 32})
            assert r.status_code == 409
            assert r.json()["detail"]["reason"] == "ALREADY_DRAWN"

            # …but the SAME beacon is idempotent, so a retried call after a
            # network blip does not look like tampering.
            r = await c.post(f"/api/v1/forms/{EXAM_ID}/select", json={"beacon_hex": "ab" * 32})
            assert r.status_code == 200 and r.json()["repeat"] is True
    _run(go())


def test_the_paper_is_unreadable_before_the_draw_and_readable_after():
    """
    The refusal before T₀ is the mechanism, not a policy detail: an endpoint that
    answered early would leak the paper while the commitment, the beacon and the
    author cap all remained perfectly intact.
    """
    async def go():
        other = str(uuid.uuid4())
        async with _client() as c:
            # A second exam, committed but not drawn.
            async with _Session() as s:
                s.add(Exam(
                    id=other, name="Undrawn", exam_body=ExamBody.CUSTOM,
                    subject_taxonomy={"Physics": []}, exam_type=ExamType.ONLINE_CBT,
                    duration_minutes=180, scheduled_at=_T0,
                    status=ExamStatus.DRAFT, irt_config={}, blooms_config={},
                ))
                await s.commit()

            r = await c.post(f"/api/v1/forms/{other}/assemble",
                             json={"blueprint": BLUEPRINT, "count": 4})
            assert r.status_code == 201
            r = await c.get(f"/api/v1/forms/{other}/paper")
            assert r.status_code == 425
            assert r.json()["detail"]["reason"] == "BEFORE_T0"

            # The drawn exam answers, and gives back a full paper.
            r = await c.get(f"/api/v1/forms/{EXAM_ID}/paper")
            assert r.status_code == 200, r.text
            assert len(r.json()["items"]) == 40
    _run(go())


def test_too_few_authors_is_refused_with_the_arithmetic_that_explains_it():
    """
    The failure operators will actually hit. At a 5% cap a 40-item paper needs 20
    distinct setters; a pool of 200 items from 3 people cannot produce one, and
    saying "infeasible" without saying why sends someone hunting for more items,
    which is the one thing that does not help.
    """
    async def go():
        lonely = str(uuid.uuid4())
        async with _Session() as s:
            s.add(Exam(
                id=lonely, name="Too few authors", exam_body=ExamBody.CUSTOM,
                subject_taxonomy={"Chemistry": []}, exam_type=ExamType.ONLINE_CBT,
                duration_minutes=180, scheduled_at=_T0,
                status=ExamStatus.DRAFT, irt_config={}, blooms_config={},
            ))
            for a in range(3):
                author = str(uuid.uuid4())
                for k in range(70):
                    tpl = ItemTemplate(
                        id=str(uuid.uuid4()), template_id=f"C-{a}-{k}", author_id=author,
                        subject="Chemistry", stem="s", params={"x": [1]}, answer_expr="x",
                        distractors=[], status=ItemStatus.PROVISIONAL,
                    )
                    s.add(tpl)
                    await s.flush()
                    s.add(PoolItem(
                        id=str(uuid.uuid4()), template_pk=tpl.id, author_id=author,
                        blob_id=uuid.uuid4().hex, stem=f"c {a}-{k}",
                        options=["1", "2", "3", "4"], correct_index=0,
                        subject="Chemistry", status=ItemStatus.PROVISIONAL,
                    ))
            await s.commit()

        async with _client() as c:
            r = await c.post(f"/api/v1/forms/{lonely}/assemble",
                             json={"blueprint": {"Chemistry": 40}, "count": 4})
            assert r.status_code == 422
            msg = r.json()["detail"]["message"]
            assert "distinct setters" in msg, msg
    _run(go())
