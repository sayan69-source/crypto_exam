"""
Runs the actual seeder against real Postgres, with foreign keys enforced.

Every other test in this suite runs against SQLite, which does not enforce
foreign keys by default — so an INSERT ordering bug (a child row flushed
before the parent row it references) is invisible there no matter how many
times the suite runs. It surfaced for real on Render exactly this way:
`ExamOffering`/`BiometricEnrollment` have a bare `ForeignKey` column but no
ORM `relationship()` back to their parent, so SQLAlchemy's automatic
unit-of-work insert ordering did not reliably see the dependency. On Postgres
that produced a real `ForeignKeyViolationError`, which aborted the ENTIRE
seeding transaction — silently emptying the production database on every
restart while the log claimed "Seeding complete".

This test is the CI counterpart of that finding: it is the one place in the
suite where a regression of this specific class — a new seeded model added
without either a relationship() or an intervening flush — would actually fail
loudly instead of passing quietly on SQLite forever.

Skips (does not fail) when no real Postgres is reachable, so local runs and
this file's own collection are never blocked on having Docker or a local
Postgres running. CI provides one via a `postgres:` service and sets
SEEDER_POSTGRES_URL — see .github/workflows/ci.yml.
"""

import os

import pytest

POSTGRES_URL = os.environ.get("SEEDER_POSTGRES_URL")

pytestmark = pytest.mark.skipif(
    not POSTGRES_URL,
    reason="SEEDER_POSTGRES_URL not set — no Postgres available for this test",
)


async def _run_full_seed(engine):
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from app.database import Base
    from app.services.seeder import seed_database

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)  # start from a clean schema
        await conn.run_sync(Base.metadata.create_all)

    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as s:
        summary = await seed_database(s)
        await s.commit()
    return summary, Session


def test_seed_database_completes_on_real_postgres():
    """
    The load-bearing assertion. Every phase must actually reach the database —
    not just log "Created N" and then have the whole transaction roll back.
    """
    import asyncio
    from sqlalchemy.ext.asyncio import create_async_engine
    from sqlalchemy import select, func
    from app.models import User, ExamOffering, BiometricEnrollment, Enrollment

    async def run():
        engine = create_async_engine(POSTGRES_URL)
        summary, Session = await _run_full_seed(engine)

        async with Session() as s:
            counts = {
                "users": (await s.execute(select(func.count()).select_from(User))).scalar(),
                "exam_offerings": (await s.execute(select(func.count()).select_from(ExamOffering))).scalar(),
                "biometric_enrollments": (await s.execute(select(func.count()).select_from(BiometricEnrollment))).scalar(),
                "enrollments": (await s.execute(select(func.count()).select_from(Enrollment))).scalar(),
            }
        await engine.dispose()
        return summary, counts

    summary, counts = asyncio.run(run())

    assert summary.get("status") != "already_seeded"
    # The bug this test exists for: these logged as "Created N" while the
    # transaction had already rolled back, leaving every one of them at 0.
    assert counts["users"] > 0
    assert counts["exam_offerings"] > 0
    assert counts["biometric_enrollments"] > 0
    assert counts["enrollments"] > 0
    # And the log's own claim should match what actually landed.
    assert counts["exam_offerings"] == summary["exam_offerings"]
    assert counts["biometric_enrollments"] == summary["biometric_enrollments"]


def test_seed_database_is_idempotent_on_restart():
    """A second startup (the common case — every redeploy) must not error and
    must not duplicate data; this is what render.yaml's SEED_ON_START relies on."""
    import asyncio
    from sqlalchemy.ext.asyncio import create_async_engine
    from app.services.seeder import seed_database

    async def run():
        engine = create_async_engine(POSTGRES_URL)
        summary1, Session = await _run_full_seed(engine)
        async with Session() as s:
            summary2 = await seed_database(s)
            await s.commit()
        await engine.dispose()
        return summary1, summary2

    summary1, summary2 = asyncio.run(run())
    assert summary1.get("status") != "already_seeded"
    assert summary2 == {"status": "already_seeded"}
