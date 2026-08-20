"""
Public CANDIDATE enrolment (§ candidate model).

A candidate is NOT a web account — they never log in online. They enrol here
with their details + a face capture (only the digest leaves the device); their
fingerprint is bound in person at the centre seat (a browser cannot produce a
template an air-gapped OS terminal could match). The enrolment is stored, then
provisioned to the centre's Edge before the exam, where the candidate is
verified biometrically, OFFLINE, on exam day.

GET  /api/v1/enroll/exams       — open exams (for the form)
POST /api/v1/enroll/candidate   — store a real candidate enrolment (no password)
"""

import logging
import math
import re
import secrets
import struct
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import (
    CandidateChoice, Center, Enrollment, EnrollmentStatus, Exam, ExamLocation,
    ExamOffering, ExamStatus, ExamSubject, User, UserRole,
)
from app.services.exam_registration import (
    LocationChoiceError, SubjectChoiceError, allot_location, normalise,
    offering_is_open, public_offering, validate_subject_choice,
)

# Exam states a student may still register for. Everything else — LIVE, PAUSED,
# COMPLETED, AUDITED, ABORTED — has either started or finished, and issuing a
# roll number for one of those is meaningless.
ENROLLABLE_STATES = (
    ExamStatus.DRAFT,
    ExamStatus.GENERATING,
    ExamStatus.PROOF_PENDING,
    ExamStatus.LOCKED,
    ExamStatus.DISTRIBUTED,
)
from app.services.auth import hash_password

logger = logging.getLogger(__name__)
router = APIRouter()

_DOB = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FACE_DIM = 128                 # face-api.js / FaceNet descriptor length

# WHICH network produced the descriptor — not merely how long it is.
#
# The terminal embeds with SFace (face_engine_cv.py); this page embeds with
# face-api.js. Both emit 128 float32, so the bytes line up perfectly and a
# cosine between them runs without error and returns a number — an
# ARBITRARY one, because the two embedding spaces are unrelated. Matching
# dimensionality is a coincidence, not compatibility.
#
# That is a worse failure than a size mismatch: a size mismatch scores a hard
# 0.0 and every candidate is refused, which is at least visible. This scores
# something plausible and low, which reads as "the face didn't match" for the
# genuine candidate and cannot be told apart from a real rejection.
#
# So the model identity travels with the descriptor and the terminal refuses
# anything it did not produce itself, rather than scoring it.
FACE_MODEL = "face-api.js/faceRecognitionNet@1.0-128d"
FACE_MATCH_THRESHOLD = 0.5     # Euclidean distance for "same person" (exam-grade)


def _pack_descriptor(vec: list[float]) -> bytes:
    return struct.pack(f"<{FACE_DIM}f", *vec)


def _unpack_descriptor(blob: bytes) -> list[float]:
    return list(struct.unpack(f"<{FACE_DIM}f", blob)) if blob and len(blob) == FACE_DIM * 4 else []


def _distance(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return math.inf
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


class CandidateEnrolment(BaseModel):
    fullName: str = Field(min_length=2, max_length=255)
    dateOfBirth: str = Field(description="YYYY-MM-DD")
    examId: str
    # ORDERED best-first. A single-location exam may send an empty list and the
    # server fills in the only location there is — the form should not have to
    # fabricate a choice that was never offered.
    locationPreferences: list[str] = Field(default_factory=list,
                                           description="exam_locations.id, best first")
    # The OPTIONAL subjects the candidate picked. Compulsory ones are added
    # server-side; sending them back would only create a way to get it wrong.
    subjectIds: list[str] = Field(default_factory=list)
    faceDescriptor: list[float] = Field(min_length=FACE_DIM, max_length=FACE_DIM,
                                        description="128-float face-recognition descriptor")


class FaceVerify(BaseModel):
    roll: str
    faceDescriptor: list[float] = Field(min_length=FACE_DIM, max_length=FACE_DIM)


async def _load_offering(db: AsyncSession, exam_id: str) -> tuple[ExamOffering, Exam]:
    """An exam a candidate may actually register for, or a 4xx explaining why not."""
    offering = (await db.execute(
        select(ExamOffering)
        .options(selectinload(ExamOffering.locations), selectinload(ExamOffering.subjects))
        .where(ExamOffering.exam_id == exam_id)
    )).scalar_one_or_none()
    if not offering:
        # An exam with no offering was never approved through the request route,
        # so it is not something the public may register for — even if a row
        # exists in `exams`.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="UNKNOWN_EXAM")
    exam = (await db.execute(select(Exam).where(Exam.id == exam_id))).scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="UNKNOWN_EXAM")

    is_open, reason = offering_is_open(offering, exam)
    if not is_open:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"reason": reason})
    return offering, exam


@router.get("/organisations")
async def organisations(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """
    The bodies currently conducting a registerable exam.

    Registration starts here rather than with a free-text box: a candidate picks
    the organisation, then picks from the exams that organisation is actually
    running. It is impossible to name an exam that does not exist, and there is
    no near-miss matching to get wrong.
    """
    rows = (await db.execute(
        select(ExamOffering.organisation, ExamOffering.organisation_norm)
        .join(Exam, Exam.id == ExamOffering.exam_id)
        .where(ExamOffering.is_active.is_(True), Exam.status.in_(ENROLLABLE_STATES))
        .distinct()
        .order_by(ExamOffering.organisation)
    )).all()
    return {"organisations": [{"name": r[0], "key": r[1]} for r in rows]}


@router.get("/exams")
async def open_exams(
    organisation: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    Exams open to registration, optionally narrowed to one conducting body.

    Only exams that came through an approved ExamRequest appear: the listing is
    driven by ExamOffering, so an `exams` row that no authority approved is not
    offered to anybody. Previously this listed every exam in the database
    regardless of state, so a student was offered a COMPLETED paper.
    """
    q = (
        select(ExamOffering, Exam)
        .join(Exam, Exam.id == ExamOffering.exam_id)
        .where(ExamOffering.is_active.is_(True), Exam.status.in_(ENROLLABLE_STATES))
        .order_by(Exam.scheduled_at)
    )
    if organisation:
        # Matched on the normalised form so the caller may pass either the
        # display name or the key.
        q = q.where(ExamOffering.organisation_norm == normalise(organisation))

    rows = (await db.execute(q)).all()
    return {
        "exams": [
            {
                "id": e.id,
                "name": e.name,
                "organisation": o.organisation,
                "scheduled_at": e.scheduled_at.isoformat() if e.scheduled_at else None,
            }
            for o, e in rows
        ]
    }


@router.get("/exams/{exam_id}/options")
async def exam_options(exam_id: str, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """
    What this exam lets a candidate choose: its locations and its subjects.

    `locationChoice` / `subjectChoice` are computed here rather than left to the
    form to infer. An exam with one location is not a choice — the form fills it
    in and says so instead of presenting a list of one.
    """
    offering, exam = await _load_offering(db, exam_id)
    return public_offering(offering, exam)


@router.post("/candidate")
async def enrol_candidate(
    body: CandidateEnrolment,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Store a real candidate enrolment — User(CANDIDATE) + Enrollment, with a
    real 128-d face descriptor and DOB. NO usable password is set: candidates
    cannot log in online; they are verified biometrically at the centre OS."""
    if not _DOB.match(body.dateOfBirth):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="DOB must be YYYY-MM-DD")

    # The listing is a convenience; this is the gate. Without it a student could
    # POST any exam id — including one already sat, or one no authority ever
    # approved — and be issued a roll number for it. `_load_offering` refuses an
    # exam with no approved offering, one whose registration window is shut, and
    # one whose paper has already been sat.
    offering, exam = await _load_offering(db, body.examId)

    # ── the subjects ────────────────────────────────────────────────────────
    # Validated before anything is written, so a bad selection costs the
    # candidate a message rather than a half-created enrolment.
    try:
        subject_ids = validate_subject_choice(
            offering.subjects, body.subjectIds,
            offering.subject_choice_min, offering.subject_choice_max,
        )
    except SubjectChoiceError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"reason": str(e), "message": _subject_message(offering)},
        ) from e

    # ── the location ────────────────────────────────────────────────────────
    # One location is not a choice: the form is not asked to invent a preference
    # list, and an empty one here means "the only location there is".
    preferences = list(body.locationPreferences)
    if not preferences and len(offering.locations) == 1:
        preferences = [offering.locations[0].id]
    try:
        location, rank = await allot_location(db, offering.locations, preferences)
    except LocationChoiceError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "reason": str(e),
                "message": (
                    "Every centre you chose is now full. Please choose another."
                    if str(e) == "ALL_PREFERRED_LOCATIONS_FULL"
                    else "Choose where you want to sit the exam."
                ),
            },
        ) from e

    # A location becomes a centre only once one has been commissioned for it.
    # Until then the enrolment is real but not yet provisionable, which is the
    # truth and is better than attaching it to an arbitrary centre so the
    # bundle-builder has something to group by.
    centre = None
    if location.center_id:
        centre = (await db.execute(
            select(Center).where(Center.id == location.center_id)
        )).scalar_one_or_none()

    # One person, one enrolment per exam. Nothing stopped the same candidate
    # submitting the form repeatedly and collecting a fresh roll number each
    # time — which would have put duplicate people on a centre's roster.
    dup = (await db.execute(
        select(Enrollment.roll_number)
        .join(User, User.id == Enrollment.candidate_id)
        .where(
            Enrollment.exam_id == exam.id,
            User.full_name == body.fullName.strip(),
            User.date_of_birth == body.dateOfBirth,
        )
        .limit(1)
    )).scalar_one_or_none()
    if dup:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "reason": "ALREADY_ENROLLED",
                "message": f"That name and date of birth is already enrolled for this exam as {dup}.",
            },
        )

    # Candidate identity. password_hash is a random throwaway so no online login
    # is ever possible — the only "login" is a biometric check at the centre OS.
    candidate = User(
        id=str(uuid.uuid4()),
        full_name=body.fullName.strip(),
        role=UserRole.CANDIDATE,
        date_of_birth=body.dateOfBirth,
        # Real face-recognition descriptor (128 float32 = 512 bytes). Only the
        # descriptor is stored — never the photo (DPDP). Matched by distance.
        enrolled_photo_hash=_pack_descriptor(body.faceDescriptor),
        password_hash=hash_password(secrets.token_urlsafe(32)),
        dpdp_consent=True,
        dpdp_consent_at=datetime.now(timezone.utc),
        dpdp_consent_version="1.0",
        state=location.state or (centre.state if centre else None),
        is_active=True,
    )
    db.add(candidate)

    # Roll numbers came from count(*) + 1, which two simultaneous enrolments
    # both read as the same value — issuing one roll number to two people, on
    # the identifier the centre uses to seat them. Retry on the unique index
    # instead of trusting a read-then-write.
    body_code = exam.exam_body.value if exam.exam_body else "EXM"
    state_code = ((location.state or (centre.state if centre else None)) or "IND")[:3].upper()
    year = exam.scheduled_at.year if exam.scheduled_at else datetime.now(timezone.utc).year

    # Uniqueness must be GLOBAL, not per-exam.
    #
    # The sequence was counted within one exam, so the first enrolment of every
    # exam got ...0000001 — three different people held NTA-2026-GUJ-0000001.
    # A roll number is what a candidate types at the centre terminal, and
    # auth.py resolved it with `.limit(1)`, i.e. picked an arbitrary one of
    # them. Two candidates could be seated as each other.
    roll = None
    for attempt in range(12):
        seq = (await db.execute(
            select(func.count()).select_from(Enrollment)
            .where(Enrollment.roll_number.like(f"{body_code}-{year}-{state_code}-%"))
        )).scalar() or 0
        candidate_roll = f"{body_code}-{year}-{state_code}-{seq + 1 + attempt:07d}"
        clash = (await db.execute(
            select(Enrollment.id).where(Enrollment.roll_number == candidate_roll)
        )).scalar_one_or_none()
        if not clash:
            roll = candidate_roll
            break
    if roll is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"reason": "ROLL_ALLOCATION_FAILED", "message": "Could not allocate a roll number. Please try again."},
        )

    enrolment = Enrollment(
        id=str(uuid.uuid4()),
        candidate_id=candidate.id,
        exam_id=exam.id,
        center_id=centre.id if centre else None,
        roll_number=roll,
        status=EnrollmentStatus.ENROLLED,
    )
    db.add(enrolment)

    # What they asked for AND what they got. Keeping the preference list beside
    # the allotment is what lets anyone check afterwards that allotment actually
    # followed the choices, rather than taking it on trust.
    db.add(CandidateChoice(
        id=str(uuid.uuid4()),
        enrollment_id=enrolment.id,
        location_preferences=list(preferences),
        allotted_location_id=location.id,
        allotted_preference_rank=rank,
        allotted_at=datetime.now(timezone.utc),
        subject_ids=subject_ids,
    ))
    await db.commit()

    logger.info(
        "candidate enrolled: %s roll=%s location=%s (choice #%d) centre=%s",
        candidate.full_name, roll, location.name, rank + 1, centre.name if centre else "unassigned",
    )
    chosen = {s.id: s.name for s in offering.subjects}
    return {
        "ok": True,
        "rollNumber": roll,
        "exam": exam.name,
        "organisation": offering.organisation,
        "location": location.name,
        # Which preference was satisfied — 1 means they got their first choice.
        # A candidate who is told only the result cannot tell whether the system
        # honoured them or ignored them.
        "locationChoiceRank": rank + 1,
        "subjects": [chosen[s] for s in subject_ids if s in chosen],
        # Null until a centre is commissioned for the location. Saying so beats
        # implying a centre that does not exist yet.
        "centre": centre.name if centre else None,
        "note": "No online login. You will be verified by face + fingerprint at your centre on exam day.",
    }


def _subject_message(offering: ExamOffering) -> str:
    """Turn the exam's own rule into a sentence a candidate can act on."""
    lo, hi = offering.subject_choice_min, offering.subject_choice_max
    optional = [s.name for s in offering.subjects if not s.is_compulsory]
    if not optional:
        return "This exam has no optional subjects."
    if lo and hi and lo == hi:
        return f"Choose exactly {lo} of: {', '.join(optional)}."
    if lo and hi:
        return f"Choose between {lo} and {hi} of: {', '.join(optional)}."
    if lo:
        return f"Choose at least {lo} of: {', '.join(optional)}."
    if hi:
        return f"Choose no more than {hi} of: {', '.join(optional)}."
    return f"Optional subjects: {', '.join(optional)}."


@router.post("/verify-face")
async def verify_face(body: FaceVerify, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Real face match: compare a LIVE descriptor against the candidate's enrolled
    descriptor (Euclidean distance). The enrolled biometric never leaves the
    server. This mirrors what the OS terminal does on-device at the centre."""
    row = (await db.execute(
        select(User).join(Enrollment, Enrollment.candidate_id == User.id)
        .where(Enrollment.roll_number == body.roll)
    )).scalars().first()
    if not row or not row.enrolled_photo_hash:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No enrolled face for that roll number")

    enrolled = _unpack_descriptor(row.enrolled_photo_hash)
    if not enrolled:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Enrolled record is not a face descriptor")

    dist = _distance(body.faceDescriptor, enrolled)
    matched = dist <= FACE_MATCH_THRESHOLD
    return {
        "matched": matched,
        "distance": round(dist, 4),
        "threshold": FACE_MATCH_THRESHOLD,
        "confidence": round(max(0.0, min(1.0, 1.0 - dist)), 4),
        "candidate": row.full_name if matched else None,
    }
