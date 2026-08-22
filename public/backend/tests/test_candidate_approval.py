"""
Candidate approval, for a candidate who sits more than one exam.

The roster at /admin/candidates is one row per candidate (`group_by(User.id)`),
but a candidate has one Enrollment row per exam. The approve/reject endpoints
originally resolved that with `scalar_one_or_none()`, which raises
MultipleResultsFound the moment a candidate has a second enrolment — a 500 on
the Approve button for every candidate in a normally seeded database, since the
seeder gives each of them four.

The decision is about the person, so it must land on all of their enrolments.
"""

import asyncio
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api.v1.admin import approve_candidate, reject_candidate  # noqa: E402
from app.database import Base  # noqa: E402
from app.models import (  # noqa: E402
    CandidateApprovalStatus, Center, Enrollment, Exam, ExamBody, ExamStatus,
    ExamType, User, UserRole,
)

ADMIN = {"user_id": str(uuid.uuid4()), "role": "ADMIN"}
CANDIDATE_ID = str(uuid.uuid4())
_ENROLMENTS = 3


class _Req:
    """Stands in for fastapi.Request — the endpoints only read `.client`."""
    client = None


async def _fresh_session(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{(tmp_path / 'approve.db').as_posix()}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def _seed(Session):
    """One candidate, sitting several exams — the shape that broke."""
    now = datetime.now(timezone.utc)
    async with Session() as s:
        s.add(User(id=CANDIDATE_ID, role=UserRole.CANDIDATE, full_name="Multi Exam Candidate"))
        s.add(User(id=ADMIN["user_id"], role=UserRole.ADMIN, full_name="Approving Admin"))
        centre = Center(id=str(uuid.uuid4()), name="Test Centre")
        s.add(centre)
        for i in range(_ENROLMENTS):
            exam = Exam(
                id=str(uuid.uuid4()), name=f"Exam {i}", exam_body=ExamBody.NTA,
                exam_type=ExamType.ONLINE_CBT, duration_minutes=60,
                scheduled_at=now + timedelta(days=i + 1), status=ExamStatus.LOCKED,
                subject_taxonomy={"subjects": []}, irt_config={}, blooms_config={},
            )
            s.add(exam)
            s.add(Enrollment(
                id=str(uuid.uuid4()), candidate_id=CANDIDATE_ID, exam_id=exam.id,
                center_id=centre.id, approval_status=CandidateApprovalStatus.PENDING,
            ))
        await s.commit()


async def _statuses(Session):
    from sqlalchemy import select
    async with Session() as s:
        rows = (await s.execute(
            select(Enrollment).where(Enrollment.candidate_id == CANDIDATE_ID)
        )).scalars().all()
        return [r.approval_status for r in rows]


def test_approve_covers_every_enrolment(tmp_path):
    async def run():
        engine, Session = await _fresh_session(tmp_path)
        await _seed(Session)
        async with Session() as db:
            result = await approve_candidate(CANDIDATE_ID, _Req(), db=db, current_user=ADMIN)
        statuses = await _statuses(Session)
        await engine.dispose()
        return result, statuses

    result, statuses = asyncio.run(run())
    assert result["approvalStatus"] == "APPROVED"
    assert len(statuses) == _ENROLMENTS
    assert all(s == CandidateApprovalStatus.APPROVED for s in statuses)


def test_reject_covers_every_enrolment_and_keeps_the_reason(tmp_path):
    async def run():
        engine, Session = await _fresh_session(tmp_path)
        await _seed(Session)

        class Body:
            rejection_reason = "Duplicate face match"

        async with Session() as db:
            result = await reject_candidate(CANDIDATE_ID, Body(), _Req(), db=db, current_user=ADMIN)
        statuses = await _statuses(Session)
        await engine.dispose()
        return result, statuses

    result, statuses = asyncio.run(run())
    assert result["approvalStatus"] == "REJECTED"
    assert all(s == CandidateApprovalStatus.REJECTED for s in statuses)


def test_approving_twice_is_refused(tmp_path):
    async def run():
        engine, Session = await _fresh_session(tmp_path)
        await _seed(Session)
        async with Session() as db:
            await approve_candidate(CANDIDATE_ID, _Req(), db=db, current_user=ADMIN)
        async with Session() as db:
            try:
                await approve_candidate(CANDIDATE_ID, _Req(), db=db, current_user=ADMIN)
                return None
            except HTTPException as exc:
                return exc.status_code
            finally:
                await engine.dispose()

    assert asyncio.run(run()) == 400


def test_unknown_candidate_is_404_not_500(tmp_path):
    async def run():
        engine, Session = await _fresh_session(tmp_path)
        await _seed(Session)
        async with Session() as db:
            try:
                await approve_candidate(str(uuid.uuid4()), _Req(), db=db, current_user=ADMIN)
                return None
            except HTTPException as exc:
                return exc.status_code
            finally:
                await engine.dispose()

    assert asyncio.run(run()) == 404
