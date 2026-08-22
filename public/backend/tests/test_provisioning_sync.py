"""
Public -> centre Edge: does the right data reach the right centre, and nothing else?

Two centres, two exams, two rosters. Every test here fails if a centre can see
anything belonging to another one, or if the paper never arrives at all.

The bundle previously carried candidates and staff and NO question paper:
services/provisioning.ts has always accepted `question_bundles` and nothing ever
sent one, so a centre received its people and no exam to give them.
"""
import asyncio
import sys
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

_DB = Path(tempfile.gettempdir()) / f"zuup_prov_{uuid.uuid4().hex}.db"

from fastapi import Request  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.api.v1.provisioning import _build_bundle  # noqa: E402
from app.models import (  # noqa: E402
    Center, Enrollment, EnrollmentStatus, Exam, ExamBody, ExamPatternRow, ExamStatus,
    ExamType, SealedBundleKeying, SealedQuestionBundle, User, UserRole,
)
from app.services.auth import get_current_user  # noqa: E402

_engine = create_async_engine(f"sqlite+aiosqlite:///{_DB.as_posix()}", future=True)
_Session = async_sessionmaker(_engine, expire_on_commit=False)

A_CENTRE, B_CENTRE = str(uuid.uuid4()), str(uuid.uuid4())
A_EXAM, B_EXAM = str(uuid.uuid4()), str(uuid.uuid4())
FUTURE = datetime.now(timezone.utc) + timedelta(days=7)
PAST = datetime.now(timezone.utc) - timedelta(hours=1)


async def _override_get_db(request: Request):
    async with _Session() as s:
        request.state.db = s
        try:
            yield s
            await s.commit()
        except Exception:
            await s.rollback()
            raise


def _descriptor() -> bytes:
    """A realistic enrolment descriptor: 128 float32, little-endian = 512 bytes.

    The fixture used to seed 32 bytes, which is not a descriptor at all — it is
    the shape of the sha256 that used to be stored, and it would have let a
    length regression pass unnoticed here.
    """
    import struct
    return struct.pack("<128f", *[0.01 * i for i in range(128)])


def _exam(eid, name, when):
    return Exam(id=eid, name=name, exam_body=ExamBody.CUSTOM, subject_taxonomy={},
                exam_type=ExamType.ONLINE_CBT, duration_minutes=180, scheduled_at=when,
                status=ExamStatus.LOCKED, irt_config={}, blooms_config={})


async def _seed():
    async with _engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with _Session() as s:
        s.add(Center(id=A_CENTRE, name="Centre A", state="WB", district="Kolkata"))
        s.add(Center(id=B_CENTRE, name="Centre B", state="MH", district="Pune"))
        s.add(_exam(A_EXAM, "Exam A", FUTURE))
        s.add(_exam(B_EXAM, "Exam B", PAST))
        for centre, exam, tag in ((A_CENTRE, A_EXAM, "a"), (B_CENTRE, B_EXAM, "b")):
            uid = str(uuid.uuid4())
            s.add(User(id=uid, role=UserRole.CANDIDATE, full_name=f"Cand {tag}",
                       date_of_birth="2005-01-01", enrolled_photo_hash=_descriptor()))
            s.add(Enrollment(id=str(uuid.uuid4()), candidate_id=uid, exam_id=exam,
                             center_id=centre, roll_number=f"ROLL-{tag}",
                             status=EnrollmentStatus.ENROLLED))
            s.add(SealedQuestionBundle(
                id=str(uuid.uuid4()), exam_id=exam, questions_root="0x" + tag * 64,
                bundle_cid=f"cid-{tag}", question_count=3,
                bundle={"examId": exam, "items": [{"id": f"q-{tag}"}]}, drand_round=1))
            s.add(SealedBundleKeying(
                id=str(uuid.uuid4()), exam_id=exam,
                hkdf_salt=bytes.fromhex("5a" * 16), t0_beacon=bytes.fromhex(tag * 32),
                t0_at=(FUTURE if tag == "a" else PAST), drand_round=1))
            s.add(ExamPatternRow(
                id=str(uuid.uuid4()), exam_id=exam,
                pattern={"sections": [], "duration_minutes": 180},
                total_questions=3, max_marks=12, duration_minutes=180))
        await s.commit()


@pytest.fixture(scope="module", autouse=True)
def _db():
    prev = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_current_user] = lambda: {
        "user_id": str(uuid.uuid4()), "role": UserRole.ADMIN}
    asyncio.run(_seed())
    yield
    asyncio.run(_engine.dispose())
    _DB.unlink(missing_ok=True)
    app.dependency_overrides.clear()
    app.dependency_overrides.update(prev)


def _bundle(centre):
    async def go():
        async with _Session() as s:
            return await _build_bundle(s, centre)
    return asyncio.run(go())


def test_the_paper_actually_reaches_the_centre():
    """The gap that made every other part of this moot: no paper ever shipped."""
    b = _bundle(A_CENTRE)
    assert len(b["question_bundles"]) == 1, "the centre received no question paper"
    assert b["question_bundles"][0]["exam_id"] == A_EXAM


def test_a_centre_receives_only_its_own_candidates_exams_and_papers():
    """Cross-centre leakage would hand one centre another's roster and paper."""
    a, b = _bundle(A_CENTRE), _bundle(B_CENTRE)
    assert [c["roll_number"] for c in a["candidates"]] == ["ROLL-a"]
    assert [c["roll_number"] for c in b["candidates"]] == ["ROLL-b"]
    assert [e["id"] for e in a["exams"]] == [A_EXAM]
    assert [q["exam_id"] for q in a["question_bundles"]] == [A_EXAM]
    blob = str(a)
    assert B_EXAM not in blob and "ROLL-b" not in blob and "Centre B" not in blob


def test_the_opener_is_withheld_until_T0_but_the_ciphertext_is_not():
    """
    Pre-positioning is only safe if what travels early cannot be opened early.
    Centre A's exam is a week out; its beacon must not be in the bundle. Centre
    B's has passed, so its beacon is released.
    """
    a = _bundle(A_CENTRE)["question_bundles"][0]
    assert a["t0_beacon"] is None, "the opener shipped before T0 — the paper is readable early"
    assert a.get("bundle_json") and a.get("hkdf_salt"), "ciphertext and salt must still travel"

    b = _bundle(B_CENTRE)["question_bundles"][0]
    assert b["t0_beacon"] == "b" * 32, "after T0 the centre cannot open its own paper"


def test_the_paper_shape_travels_so_the_terminal_knows_what_to_draw():
    """Without it a terminal falls back to assuming four-option MCQ."""
    a = _bundle(A_CENTRE)
    assert len(a["exam_patterns"]) == 1
    assert a["exam_patterns"][0]["exam_id"] == A_EXAM
    assert a["exam_patterns"][0]["duration_minutes"] == 180


def test_the_questions_root_is_sent_in_the_form_the_edge_stores():
    """
    The Edge does Buffer.from(questions_root,'hex'). A leading '0x' silently
    decodes to a WRONG 32 bytes there, so the terminal's root check would fail
    against a paper that is actually intact.
    """
    root = _bundle(A_CENTRE)["question_bundles"][0]["questions_root"]
    assert not root.startswith("0x")
    assert len(root) == 64 and bytes.fromhex(root)


def test_an_unknown_centre_is_refused_rather_than_given_an_empty_bundle():
    """An empty bundle looks like a centre with no candidates, not a typo."""
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        _bundle(str(uuid.uuid4()))
    assert e.value.status_code == 404


def test_the_face_model_identity_travels_with_every_descriptor():
    """
    The subtlest break in the chain, and the one a size check cannot catch.

    The terminal embeds with SFace; this platform enrols with face-api.js. Both
    emit 128 float32, so the bytes align, the cosine runs, and it returns an
    ARBITRARY number — the two embedding spaces are unrelated. A genuine
    candidate is scored low for a reason that has nothing to do with their face,
    and it is indistinguishable from a real rejection.

    Matching dimensionality is a coincidence. Shipping the model identity is what
    lets the far end refuse a vector it cannot meaningfully compare.
    """
    from app.api.v1.enroll import FACE_MODEL

    cand = _bundle(A_CENTRE)["candidates"][0]
    assert cand["face_model"] == FACE_MODEL
    assert cand["face_model"], "an unlabelled descriptor is one the terminal must not score"


def test_the_descriptor_is_the_length_the_terminal_will_read_back():
    """
    512 bytes = 128 float32, little-endian, which is exactly what the terminal's
    `np.frombuffer(enrolled, "float32")` recovers. A length that disagrees is the
    older bug: cosine returns a hard 0.0 and refuses everyone.
    """
    cand = _bundle(A_CENTRE)["candidates"][0]
    raw = bytes.fromhex(cand["face_hash"])
    assert len(raw) == 128 * 4
