"""
Guards the deploy path against an existing database.

`create_all` adds missing tables but never ALTERs existing ones, so a column
appended to a model that maps to an already-created table is absent at runtime.
Render's Postgres persists across deploys, so this is the difference between a
working deploy and a 500 on every query naming the new column.

The test builds a database from an OLDER model definition (a table deliberately
missing columns the current model declares), runs the startup path, and asserts
the columns arrive.
"""

import uuid
from datetime import datetime

from sqlalchemy import Column, Integer, MetaData, String, Table, create_engine, inspect, select
from sqlalchemy.orm import Session

from app.models import Base, User, UserRole
from app.services.schema_sync import sync_missing_columns


def _startup(engine):
    """What app.main's lifespan does to the schema, in order."""
    with engine.begin() as conn:
        Base.metadata.create_all(conn)
        return sync_missing_columns(conn)


def test_adds_columns_missing_from_an_existing_table(tmp_path):
    db = tmp_path / "legacy.sqlite"
    engine = create_engine(f"sqlite:///{db}")

    # A "users" table as an older release created it: no email_verified family.
    legacy = MetaData()
    Table(
        "users", legacy,
        Column("id", String(36), primary_key=True),
        Column("email", String(255)),
        Column("role", String(32), nullable=False),
        Column("full_name", String(255), nullable=False),
    )
    legacy.create_all(engine)

    before = {c["name"] for c in inspect(engine).get_columns("users")}
    assert "email_verified" not in before, "fixture must start without the column"

    added = _startup(engine)

    after = {c["name"] for c in inspect(engine).get_columns("users")}
    for column in ("email_normalized", "email_verified", "email_verified_at"):
        assert column in after, f"{column} was never added to the existing table"
    assert any(a.startswith("users.") for a in added)


def test_is_idempotent(tmp_path):
    """Every deploy re-runs this; the second run must be a no-op."""
    db = tmp_path / "repeat.sqlite"
    engine = create_engine(f"sqlite:///{db}")

    legacy = MetaData()
    Table(
        "users", legacy,
        Column("id", String(36), primary_key=True),
        Column("role", String(32), nullable=False),
        Column("full_name", String(255), nullable=False),
    )
    legacy.create_all(engine)

    first = _startup(engine)
    assert first, "first run should have added something"
    assert _startup(engine) == [], "second run must add nothing"


def test_migrated_table_accepts_orm_writes(tmp_path):
    """A column that exists but rejects a write would still break the deploy."""
    db = tmp_path / "orm.sqlite"
    engine = create_engine(f"sqlite:///{db}")

    legacy = MetaData()
    Table(
        "users", legacy,
        Column("id", String(36), primary_key=True),
        Column("email", String(255)),
        Column("role", String(32), nullable=False),
        Column("full_name", String(255), nullable=False),
    )
    legacy.create_all(engine)
    _startup(engine)

    with Session(engine) as s:
        s.add(User(
            id=str(uuid.uuid4()),
            email="probe@example.com",
            email_normalized="probe@example.com",
            email_verified=True,
            email_verified_at=datetime.utcnow(),
            role=UserRole.CANDIDATE,
            full_name="Probe",
        ))
        s.commit()
        got = s.scalar(select(User).where(User.email == "probe@example.com"))

    assert got is not None and got.email_verified is True


def test_enum_column_is_added_to_an_existing_table(tmp_path):
    """Enum columns need their type to exist first on Postgres — and must not
    break the SQLite path, where Enum compiles to VARCHAR."""
    db = tmp_path / "enum.sqlite"
    engine = create_engine(f"sqlite:///{db}")

    legacy = MetaData()
    Table(
        "enrollments", legacy,
        Column("id", String(36), primary_key=True),
        Column("candidate_id", String(36)),
        Column("exam_id", String(36)),
        Column("seat_number", Integer),
    )
    legacy.create_all(engine)

    _startup(engine)

    cols = {c["name"] for c in inspect(engine).get_columns("enrollments")}
    assert "approval_status" in cols
    assert "registration_year" in cols
