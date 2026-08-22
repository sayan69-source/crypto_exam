"""
Registration rules — the claims the architecture makes, tested as claims.

Each test below is a sentence from the specification that would otherwise be
prose in a design document:

  * a candidate finds their exam however they spell the organisation;
  * an exam with one location is not a choice;
  * an exam with several is allotted BY the candidate's order of preference;
  * "choose 2 of these 4" means 2 of the four optionals, and compulsory
    subjects are not a choice at all;
  * an exam nobody approved is not registerable.
"""
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base  # noqa: E402
from app.models import (  # noqa: E402
    CandidateChoice, Exam, ExamLocation, ExamOffering, ExamStatus, ExamSubject, ExamType,
)
from app.services.exam_registration import (  # noqa: E402
    LocationChoiceError, SubjectChoiceError, allot_location, normalise,
    offering_is_open, public_offering, validate_subject_choice,
)


# ── how a candidate names their exam ────────────────────────────────────────

@pytest.mark.parametrize("a,b", [
    ("N.T.A.", "NTA"),
    ("  nta ", "NTA"),
    ("C.B.S.E", "CBSE"),
    ("Joint Entrance Exam", "joint-entrance-exam"),
    ("Bhāratīya", "Bharatiya"),
])
def test_organisation_matches_however_it_is_written(a, b):
    """
    An organisation only findable when spelled exactly as an administrator typed
    it is one most applicants cannot find — and to them the failure reads as
    "this exam does not exist".
    """
    assert normalise(a) == normalise(b)


def test_normalise_still_separates_genuinely_different_bodies():
    """Forgiving is not the same as blind; this must not collapse everything."""
    assert normalise("NTA") != normalise("NTAA")
    assert normalise("CBSE") != normalise("ICSE")


# ── subjects ────────────────────────────────────────────────────────────────

def _subject(name, compulsory, sid=None):
    return ExamSubject(id=sid or str(uuid.uuid4()), name=name, is_compulsory=compulsory)


def test_compulsory_subjects_are_added_not_demanded():
    """
    The form sends only the optional picks. Requiring it to echo the compulsory
    ones back would just create a way to get it wrong.
    """
    maths = _subject("Maths", True)
    phys, chem = _subject("Physics", False), _subject("Chemistry", False)
    got = validate_subject_choice([maths, phys, chem], [phys.id], choice_min=1, choice_max=1)
    assert got == [maths.id, phys.id]


def test_choose_exactly_two_of_four_is_enforced_on_the_optionals_only():
    """"Take 2 of these 4" means 2 of the four optionals — not 2 including the
    compulsory paper, which is the reading that silently lets someone sit one
    subject."""
    comp = _subject("General", True)
    opts = [_subject(f"Opt{i}", False) for i in range(4)]
    subjects = [comp, *opts]

    ok = validate_subject_choice(subjects, [opts[0].id, opts[2].id], 2, 2)
    assert ok == [comp.id, opts[0].id, opts[2].id]

    with pytest.raises(SubjectChoiceError, match="AT_LEAST"):
        validate_subject_choice(subjects, [opts[0].id], 2, 2)
    with pytest.raises(SubjectChoiceError, match="AT_MOST"):
        validate_subject_choice(subjects, [o.id for o in opts[:3]], 2, 2)


def test_a_subject_from_another_exam_is_refused():
    comp = _subject("Maths", True)
    with pytest.raises(SubjectChoiceError, match="UNKNOWN_SUBJECT"):
        validate_subject_choice([comp], [str(uuid.uuid4())], None, None)


def test_exam_with_no_optional_subjects_takes_no_choice():
    """
    Nothing to choose, so nothing to refuse: a form that echoes the compulsory
    id back is ignored rather than rejected. (An earlier NO_OPTIONAL_SUBJECTS
    branch could never fire — an unknown id is caught before it and a compulsory
    id never lands in the optional list — so it was removed rather than left
    looking like a rule.)
    """
    comp = _subject("Maths", True)
    assert validate_subject_choice([comp], [], None, None) == [comp.id]
    assert validate_subject_choice([comp], [comp.id], None, None) == [comp.id]


# ── what the form is told ───────────────────────────────────────────────────

def _exam():
    return Exam(id=str(uuid.uuid4()), name="Test Paper", exam_type=ExamType.ONLINE_CBT,
                duration_minutes=180, scheduled_at=datetime.now(timezone.utc),
                status=ExamStatus.DRAFT, subject_taxonomy={}, irt_config={}, blooms_config={})


def _offering(locations, subjects, **kw):
    kw.setdefault("is_active", True)
    o = ExamOffering(id=str(uuid.uuid4()), exam_id=str(uuid.uuid4()), organisation="NTA",
                     organisation_norm="nta", exam_name_norm="test paper", **kw)
    o.locations, o.subjects = locations, subjects
    return o


def test_single_location_is_not_offered_as_a_choice():
    """One location is a fact, not a decision. The form fills it in."""
    only = ExamLocation(id=str(uuid.uuid4()), name="Kolkata")
    view = public_offering(_offering([only], []), _exam())
    assert view["locationChoice"] is False
    assert len(view["locations"]) == 1


def test_several_locations_are_offered_as_a_choice():
    locs = [ExamLocation(id=str(uuid.uuid4()), name=n) for n in ("Kolkata", "Delhi", "Pune")]
    view = public_offering(_offering(locs, []), _exam())
    assert view["locationChoice"] is True
    assert [l["name"] for l in view["locations"]] == ["Kolkata", "Delhi", "Pune"]


def test_registration_is_shut_once_the_paper_has_been_sat():
    """The offering flag and the exam's own state answer different questions."""
    exam = _exam()
    exam.status = ExamStatus.COMPLETED
    ok, reason = offering_is_open(_offering([], []), exam)
    assert (ok, reason) == (False, "ENROLMENT_CLOSED")


def test_an_offering_switched_off_closes_registration():
    ok, reason = offering_is_open(_offering([], [], is_active=False), _exam())
    assert (ok, reason) == (False, "REGISTRATION_NOT_ACTIVE")


def test_registration_window_is_honoured_with_naive_timestamps():
    """
    SQLite hands back naive datetimes. Comparing one to an aware `now` raises
    TypeError, which would 500 the registration form rather than close it.
    """
    future = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=5)
    ok, reason = offering_is_open(_offering([], [], registration_opens_at=future), _exam())
    assert (ok, reason) == (False, "REGISTRATION_NOT_OPEN_YET")


# ── allotment ───────────────────────────────────────────────────────────────

# Locations are NOT NULL on offering_id. SQLite does not enforce the foreign
# key by default, so one constant stands in for "some offering" and keeps
# these tests about allotment rather than about fixture construction.
OFFERING = str(uuid.uuid4())


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        yield session
    await engine.dispose()


async def _fill(db, location, n):
    """Seat n people at a location, as registration itself would."""
    for _ in range(n):
        db.add(CandidateChoice(id=str(uuid.uuid4()), enrollment_id=str(uuid.uuid4()),
                               location_preferences=[location.id],
                               allotted_location_id=location.id, subject_ids=[]))
    await db.flush()


@pytest.mark.asyncio
async def test_first_preference_is_honoured(db):
    a = ExamLocation(id=str(uuid.uuid4()), offering_id=OFFERING, name="Kolkata", capacity=10)
    b = ExamLocation(id=str(uuid.uuid4()), offering_id=OFFERING, name="Delhi", capacity=10)
    got, rank = await allot_location(db, [a, b], [b.id, a.id])
    assert (got.name, rank) == ("Delhi", 0)


@pytest.mark.asyncio
async def test_a_full_first_choice_falls_to_the_second(db):
    """The point of an ordered list: not getting Kolkata means getting Delhi,
    not being dropped somewhere nobody asked for."""
    a = ExamLocation(id=str(uuid.uuid4()), offering_id=OFFERING, name="Kolkata", capacity=2)
    b = ExamLocation(id=str(uuid.uuid4()), offering_id=OFFERING, name="Delhi", capacity=5)
    db.add_all([a, b])
    await db.flush()
    await _fill(db, a, 2)

    got, rank = await allot_location(db, [a, b], [a.id, b.id])
    assert (got.name, rank) == ("Delhi", 1)


@pytest.mark.asyncio
async def test_all_choices_full_is_refused_rather_than_reassigned(db):
    """Seating someone in a city they did not ask for is worse than saying no."""
    a = ExamLocation(id=str(uuid.uuid4()), offering_id=OFFERING, name="Kolkata", capacity=1)
    b = ExamLocation(id=str(uuid.uuid4()), offering_id=OFFERING, name="Delhi", capacity=1)
    c = ExamLocation(id=str(uuid.uuid4()), offering_id=OFFERING, name="Pune", capacity=50)   # not chosen
    db.add_all([a, b, c])
    await db.flush()
    await _fill(db, a, 1)
    await _fill(db, b, 1)

    with pytest.raises(LocationChoiceError, match="ALL_PREFERRED_LOCATIONS_FULL"):
        await allot_location(db, [a, b, c], [a.id, b.id])


@pytest.mark.asyncio
async def test_a_location_without_a_stated_capacity_never_fills(db):
    a = ExamLocation(id=str(uuid.uuid4()), offering_id=OFFERING, name="Kolkata", capacity=None)
    db.add(a)
    await db.flush()
    await _fill(db, a, 5000)
    got, rank = await allot_location(db, [a], [a.id])
    assert (got.name, rank) == ("Kolkata", 0)


@pytest.mark.asyncio
async def test_a_location_from_another_exam_cannot_be_requested(db):
    a = ExamLocation(id=str(uuid.uuid4()), offering_id=OFFERING, name="Kolkata", capacity=10)
    with pytest.raises(LocationChoiceError, match="UNKNOWN_LOCATION"):
        await allot_location(db, [a], [str(uuid.uuid4())])


@pytest.mark.asyncio
async def test_no_preference_at_all_is_refused(db):
    a = ExamLocation(id=str(uuid.uuid4()), offering_id=OFFERING, name="Kolkata", capacity=10)
    with pytest.raises(LocationChoiceError, match="NO_PREFERENCE_GIVEN"):
        await allot_location(db, [a], [])
