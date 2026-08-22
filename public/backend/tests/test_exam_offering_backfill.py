"""
Guards the deploy path against an already-seeded database.

`seed_database`'s guard returns early the moment a single User row exists —
correct for users/centres/exams (re-running would duplicate them), but it
meant a database seeded before `_seed_exam_offerings` existed stayed on the
old, offering-less shape forever: `seed_database` keeps reporting
"already_seeded" and the offerings a later code change started depending on
never arrive. This is exactly what happened on the live Render deployment —
`/enroll/organisations` still returned `[]` after the fix had shipped, because
nothing told the EXISTING database about it.

`backfill_exam_offerings` runs on every startup regardless of whether
`seed_database` did anything, and targets only what's missing.
"""

from sqlalchemy import create_engine, delete, select
from sqlalchemy.orm import Session

from app.models import Base, ExamOffering


def _fresh_engine(tmp_path):
    return create_engine(f"sqlite:///{tmp_path / 'offerings.sqlite'}")


async def _run_seed_and_strip_offerings(async_engine):
    """Seed a fresh DB, then delete the offerings — simulating a database
    that predates the offerings feature but already has users/exams."""
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from app.services.seeder import seed_database
    from app.models import ExamLocation, ExamSubject

    Session_ = async_sessionmaker(async_engine, expire_on_commit=False)
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with Session_() as s:
        summary = await seed_database(s)
        await s.commit()
        assert summary.get("exam_offerings", 0) > 0, "fixture must start with offerings to strip"

    async with Session_() as s:
        await s.execute(delete(ExamLocation))
        await s.execute(delete(ExamSubject))
        await s.execute(delete(ExamOffering))
        await s.commit()

    return Session_


def test_backfill_populates_offerings_seed_database_wont_touch(tmp_path):
    import asyncio
    from sqlalchemy.ext.asyncio import create_async_engine
    from app.services.seeder import seed_database, backfill_exam_offerings

    async def run():
        engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'db.sqlite'}")
        Session_ = await _run_seed_and_strip_offerings(engine)

        # The realistic startup sequence: seed_database first (no-ops, since
        # users already exist), THEN the backfill.
        async with Session_() as s:
            second_pass = await seed_database(s)
            await s.commit()
        assert second_pass == {"status": "already_seeded"}, \
            "fixture invariant: seed_database must NOT recreate offerings itself"

        async with Session_() as s:
            added = await backfill_exam_offerings(s)
            await s.commit()

        async with Session_() as s:
            count = len((await s.execute(select(ExamOffering))).scalars().all())

        await engine.dispose()
        return added, count

    added, count = asyncio.run(run())
    assert len(added) > 0
    assert count == len(added)


def test_backfill_is_idempotent(tmp_path):
    import asyncio
    from sqlalchemy.ext.asyncio import create_async_engine
    from app.services.seeder import backfill_exam_offerings

    async def run():
        engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'db.sqlite'}")
        Session_ = await _run_seed_and_strip_offerings(engine)

        async with Session_() as s:
            first = await backfill_exam_offerings(s)
            await s.commit()
        async with Session_() as s:
            second = await backfill_exam_offerings(s)
            await s.commit()

        await engine.dispose()
        return first, second

    first, second = asyncio.run(run())
    assert len(first) > 0
    assert second == [], "a second backfill pass must add nothing"
