"""
The pattern endpoint — tested for the two things that would let a marking scheme
change underneath a paper.
"""
import asyncio
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
import tempfile

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

_DB = Path(tempfile.gettempdir()) / f"zuup_pat_{uuid.uuid4().hex}.db"

from fastapi import Request  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402

_engine = create_async_engine(f"sqlite+aiosqlite:///{_DB.as_posix()}", future=True)
_Session = async_sessionmaker(_engine, expire_on_commit=False)


async def _override_get_db(request: Request):
    async with _Session() as s:
        request.state.db = s
        try:
            yield s
            await s.commit()
        except Exception:
            await s.rollback()
            raise


app.dependency_overrides[get_db] = _override_get_db

from app.models import (  # noqa: E402
    Exam, ExamBody, ExamFormSet, ExamStatus, ExamType, UserRole,
)
from app.services.auth import get_current_user  # noqa: E402

ADMIN = {"user_id": str(uuid.uuid4()), "role": UserRole.ADMIN}
app.dependency_overrides[get_current_user] = lambda: ADMIN
EXAM = str(uuid.uuid4())


async def _seed():
    async with _engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with _Session() as s:
        s.add(Exam(id=EXAM, name="P", exam_body=ExamBody.CUSTOM,
                   subject_taxonomy={}, exam_type=ExamType.ONLINE_CBT,
                   duration_minutes=180,
                   scheduled_at=datetime(2030, 1, 1, tzinfo=timezone.utc),
                   status=ExamStatus.DRAFT, irt_config={}, blooms_config={}))
        await s.commit()


@pytest.fixture(scope="module", autouse=True)
def _db():
    asyncio.run(_seed())
    yield
    asyncio.run(_engine.dispose())
    _DB.unlink(missing_ok=True)


def _run(c):
    return asyncio.run(c)


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


def test_a_preset_becomes_a_full_pattern_with_a_blueprint():
    """The blueprint is the join to the item pool: assembly draws exactly this."""
    async def go():
        async with _client() as c:
            r = await c.put(f"/api/v1/pattern/{EXAM}", json={"preset": "JEE_MAIN"})
            assert r.status_code == 200, r.text
            b = r.json()
            assert b["max_marks"] == "300"
            assert b["blueprint"] == {"Physics": 30, "Chemistry": 30, "Mathematics": 30}
            types = {s["type"] for s in b["sections"]}
            assert types == {"SINGLE_CHOICE", "NUMERIC"}
    _run(go())


def test_the_marking_scheme_is_readable_without_a_login():
    """
    A candidate is entitled to know the scheme of the paper they are about to
    sit. It reveals no question — only that there are 20 worth +4/-1.
    """
    async def go():
        async with _client() as c:
            r = await c.get(f"/api/v1/pattern/{EXAM}")
            assert r.status_code == 200
            assert r.json()["pattern"]["sections"][0]["marks_wrong"] == "-1"
    _run(go())


def test_an_invalid_pattern_is_refused_with_the_rule_it_broke():
    async def go():
        async with _client() as c:
            r = await c.put(f"/api/v1/pattern/{EXAM}", json={"pattern": {
                "duration_minutes": 60,
                "sections": [{"name": "A", "subject": "P",
                              "question_type": "SINGLE_CHOICE", "count": 5,
                              "marks_correct": "4", "marks_wrong": "1"}],
            }})
            assert r.status_code == 422
            assert "NEGATIVE" in r.json()["detail"]["message"]
    _run(go())


def test_the_pattern_locks_once_forms_are_committed():
    """
    The pattern IS the marking scheme. One that can be edited after the forms are
    committed is one that can be edited after the exam has been sat, and from
    outside the two are indistinguishable.
    """
    async def go():
        async with _Session() as s:
            s.add(ExamFormSet(id=str(uuid.uuid4()), exam_id=EXAM, form_count=4,
                              paper_length=90, blueprint={"Physics": 30},
                              form_set_root="ab" * 32, seed_hex="cd" * 32))
            await s.commit()
        async with _client() as c:
            r = await c.put(f"/api/v1/pattern/{EXAM}", json={"preset": "NEET_UG"})
            assert r.status_code == 409
            assert r.json()["detail"]["reason"] == "PATTERN_LOCKED"
    _run(go())
