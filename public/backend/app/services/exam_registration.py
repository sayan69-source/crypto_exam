"""
Turning an approved exam request into something a candidate can register for.

Three jobs live here, and they are together because they share one set of rules
about what an offering means:

  * `normalise`      — how an exam name or an organisation is matched.
  * `materialise`    — what happens the moment both approvals land.
  * `allot_location` / `validate_subject_choice` — what a candidate may choose,
                       and what they get.

None of this is in the route handlers, because the same rules are applied from
three different places (public registration, the approval console, and the
tests) and a rule that is written down three times is a rule with three
behaviours.
"""

from __future__ import annotations

import re
import secrets
import unicodedata
from datetime import datetime, timezone
from typing import Any, Iterable, Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    CandidateChoice,
    Exam,
    ExamBody,
    ExamLocation,
    ExamOffering,
    ExamRequest,
    ExamRequestStatus,
    ExamStatus,
    ExamSubject,
    ExamType,
)

# Exam states in which registration is still meaningful. Mirrors enroll.py's
# ENROLLABLE_STATES: an offering may be flagged active, but a paper that has
# already been sat cannot take new candidates whatever the flag says.
REGISTERABLE_EXAM_STATES = (
    ExamStatus.DRAFT,
    ExamStatus.GENERATING,
    ExamStatus.PROOF_PENDING,
    ExamStatus.LOCKED,
    ExamStatus.DISTRIBUTED,
)

_PUNCT = re.compile(r"[^a-z0-9]+")


def normalise(value: str) -> str:
    """
    Fold a name to its matching form.

    A candidate is asked which body is conducting their exam, and they will
    write "N.T.A.", "NTA", or "nta " with a trailing space. An organisation that
    is only findable when spelled exactly as an administrator typed it is an
    organisation most applicants cannot find, and the failure looks to them like
    "this exam does not exist".

    Separators are removed rather than collapsed to spaces. Replacing them gave
    "N.T.A." -> "n t a" while "NTA" stayed "nta", so the two most common ways of
    writing the same body did not match — the precise failure this exists to
    prevent. Dropping them entirely makes both "nta".

    Accents are folded too, so "Bhāratīya" and "Bharatiya" agree.
    """
    folded = unicodedata.normalize("NFKD", value or "")
    ascii_only = "".join(c for c in folded if not unicodedata.combining(c))
    return _PUNCT.sub("", ascii_only.casefold()).strip()


def new_reference(prefix: str = "EXR") -> str:
    """A short human-quotable handle for a request (e.g. EXR-7F3K2Q)."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"   # no I/O/0/1 — these get read aloud
    return f"{prefix}-{''.join(secrets.choice(alphabet) for _ in range(6))}"


def both_approved(req: ExamRequest) -> bool:
    """Dual approval, stated once so no caller can decide it differently."""
    return req.sysadmin_approved_at is not None and req.admin_approved_at is not None


async def materialise(db: AsyncSession, req: ExamRequest) -> ExamOffering:
    """
    Create the Exam and its public ExamOffering from an approved request.

    Called only when BOTH approvals are in. The locations and subjects are
    copied from the request rather than referenced, because the request is a
    record of what was asked for and must not change retroactively when someone
    later edits a live exam's centre list.
    """
    if not both_approved(req):
        raise ValueError("materialise() called on a request that is not fully approved")

    exam = Exam(
        name=req.exam_name,
        exam_body=ExamBody.CUSTOM,
        subject_taxonomy={"subjects": [s.name for s in req.subjects]},
        # ONLINE_CBT is the only member and deliberately so: the platform runs
        # online computer-based tests, offline/OMR centres having been removed
        # as unsecurable. Naming it beats a list(ExamType)[0] that would silently
        # pick something else the day a second member is added.
        exam_type=ExamType.ONLINE_CBT,
        duration_minutes=req.duration_minutes or 180,
        scheduled_at=req.proposed_date or datetime.now(timezone.utc),
        status=ExamStatus.DRAFT,
        irt_config={},
        blooms_config={},
    )
    db.add(exam)
    await db.flush()          # need exam.id for the offering

    offering = ExamOffering(
        exam_id=exam.id,
        request_id=req.id,
        organisation=req.organisation,
        organisation_norm=req.organisation_norm,
        exam_name_norm=req.exam_name_norm,
        is_active=True,
        subject_choice_min=req.subject_choice_min,
        subject_choice_max=req.subject_choice_max,
    )
    db.add(offering)
    await db.flush()

    for loc in req.locations:
        db.add(ExamLocation(
            offering_id=offering.id, name=loc.name, city=loc.city, state=loc.state,
            address=loc.address, capacity=loc.capacity, display_order=loc.display_order,
        ))
    for sub in req.subjects:
        db.add(ExamSubject(
            offering_id=offering.id, name=sub.name, code=sub.code,
            is_compulsory=sub.is_compulsory, display_order=sub.display_order,
        ))

    req.exam_id = exam.id
    req.status = ExamRequestStatus.ACTIVE
    await db.flush()
    return offering


class SubjectChoiceError(ValueError):
    """A candidate's subject selection does not satisfy the exam's rule."""


def validate_subject_choice(
    subjects: Sequence[ExamSubject],
    chosen_ids: Iterable[str],
    choice_min: int | None,
    choice_max: int | None,
) -> list[str]:
    """
    Resolve a candidate's subject selection into the full stored list.

    Compulsory subjects are ADDED rather than required to be sent: they are not
    a choice, so making the form send them back only creates a way to get it
    wrong. The min/max applies to the optional ones alone — "choose 2 of these
    4" means 2 of the four optionals, not 2 including the compulsory paper.
    """
    by_id = {s.id: s for s in subjects}
    compulsory = [s.id for s in subjects if s.is_compulsory]
    optional_ids = {s.id for s in subjects if not s.is_compulsory}

    chosen = list(dict.fromkeys(chosen_ids))          # de-dupe, keep order
    unknown = [c for c in chosen if c not in by_id]
    if unknown:
        raise SubjectChoiceError("UNKNOWN_SUBJECT")

    chosen_optional = [c for c in chosen if c in optional_ids]

    # Only the optionals are counted. An exam with none of them takes no choice
    # at all, and a form that echoes a compulsory id back is simply ignored —
    # there is nothing there to get wrong, so there is nothing to refuse.
    if optional_ids:
        lo = choice_min if choice_min is not None else 0
        hi = choice_max if choice_max is not None else len(optional_ids)
        if len(chosen_optional) < lo:
            raise SubjectChoiceError(f"CHOOSE_AT_LEAST_{lo}")
        if len(chosen_optional) > hi:
            raise SubjectChoiceError(f"CHOOSE_AT_MOST_{hi}")

    return compulsory + chosen_optional


class LocationChoiceError(ValueError):
    """A candidate's location preferences cannot be honoured."""


async def allot_location(
    db: AsyncSession,
    locations: Sequence[ExamLocation],
    preferences: Sequence[str],
) -> tuple[ExamLocation, int]:
    """
    Give the candidate the first of their choices that still has room.

    Returns (location, rank) where rank 0 is their first choice — recorded so
    "how many people got their first preference" is a question the data can
    answer, which is the only way anyone can tell whether allotment is working.

    A location with no stated capacity never fills. Capacity is counted inside
    the caller's transaction and the row is locked while it is read, so two
    simultaneous registrations cannot both take the last seat. (SQLAlchemy's
    SQLite dialect drops FOR UPDATE, which is harmless there — SQLite serialises
    writers anyway.)
    """
    by_id = {l.id: l for l in locations}
    if not preferences:
        raise LocationChoiceError("NO_PREFERENCE_GIVEN")
    unknown = [p for p in preferences if p not in by_id]
    if unknown:
        raise LocationChoiceError("UNKNOWN_LOCATION")

    for rank, loc_id in enumerate(dict.fromkeys(preferences)):
        loc = by_id[loc_id]
        if loc.capacity is None:
            return loc, rank
        locked = (await db.execute(
            select(ExamLocation).where(ExamLocation.id == loc.id).with_for_update()
        )).scalar_one_or_none() or loc
        taken = (await db.execute(
            select(func.count()).select_from(CandidateChoice)
            .where(CandidateChoice.allotted_location_id == loc.id)
        )).scalar() or 0
        if taken < (locked.capacity or 0):
            return locked, rank

    # Every choice is full. Saying so is right: silently seating someone in a
    # city they did not ask for is worse than telling them to pick again.
    raise LocationChoiceError("ALL_PREFERRED_LOCATIONS_FULL")


def offering_is_open(offering: ExamOffering, exam: Exam, now: datetime | None = None) -> tuple[bool, str | None]:
    """Both gates, in one place. Returns (open, reason_if_closed)."""
    now = now or datetime.now(timezone.utc)
    if not offering.is_active:
        return False, "REGISTRATION_NOT_ACTIVE"
    if exam.status not in REGISTERABLE_EXAM_STATES:
        return False, "ENROLMENT_CLOSED"

    def _aware(dt: datetime | None) -> datetime | None:
        # SQLite hands back naive datetimes; comparing those to an aware `now`
        # raises TypeError and would 500 the registration form.
        if dt is not None and dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt

    opens, closes = _aware(offering.registration_opens_at), _aware(offering.registration_closes_at)
    if opens and now < opens:
        return False, "REGISTRATION_NOT_OPEN_YET"
    if closes and now > closes:
        return False, "REGISTRATION_CLOSED"
    return True, None


def public_offering(offering: ExamOffering, exam: Exam) -> dict[str, Any]:
    """The shape the registration form consumes. Nothing sealed appears here."""
    return {
        "examId": exam.id,
        "offeringId": offering.id,
        "name": exam.name,
        "organisation": offering.organisation,
        "scheduledAt": exam.scheduled_at.isoformat() if exam.scheduled_at else None,
        "durationMinutes": exam.duration_minutes,
        "locations": [
            {"id": l.id, "name": l.name, "city": l.city, "state": l.state, "address": l.address}
            for l in offering.locations
        ],
        # A single location is not a choice. The form fills it in and says so,
        # rather than presenting a list of one and asking someone to pick.
        "locationChoice": len(offering.locations) > 1,
        "subjects": [
            {"id": s.id, "name": s.name, "code": s.code, "compulsory": s.is_compulsory}
            for s in offering.subjects
        ],
        "subjectChoiceMin": offering.subject_choice_min,
        "subjectChoiceMax": offering.subject_choice_max,
        "subjectChoice": any(not s.is_compulsory for s in offering.subjects),
    }
