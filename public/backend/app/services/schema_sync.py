"""
Additive schema sync for deploys that run against an existing database.

`Base.metadata.create_all` creates missing TABLES but never ALTERs existing
ones, so a column added to a model that maps to an already-created table is
silently absent at runtime — every query naming it fails with "no such column"
/ UndefinedColumn. On a throwaway dev SQLite file this is invisible (the file
is usually empty, so create_all builds everything fresh); on the Render
Postgres instance, which persists across deploys, it is a guaranteed 500.

This module closes that gap for the additive case, which is the only case the
project actually produces: new nullable columns appended to existing tables.

Deliberate limits — this is not a migration framework:
  * Columns are added NULLABLE and WITHOUT a UNIQUE constraint even when the
    model declares otherwise. An existing table already holds rows that cannot
    satisfy either, and SQLite refuses `ADD COLUMN ... UNIQUE` outright. The
    model keeps the constraint for fresh databases; enforcement on a
    back-filled one is a data decision, not a startup decision.
  * Foreign keys on added columns are skipped for the same reason.
  * Nothing is ever dropped, renamed or retyped. A destructive change still
    needs a human.
"""

from __future__ import annotations

import logging

from sqlalchemy import Enum as SAEnum, inspect, text

from app.models import Base

logger = logging.getLogger(__name__)


def _literal_default(column) -> str | None:
    """Render a column's scalar default as SQL, or None if it has none.

    Callable defaults (``default=datetime.utcnow``) are evaluated per-INSERT by
    SQLAlchemy and have no SQL equivalent, so existing rows simply keep NULL.
    """
    default = column.default
    if default is None or not getattr(default, "is_scalar", False):
        return None

    value = default.arg
    if hasattr(value, "value"):  # a Python enum member
        value = value.value

    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        escaped = value.replace("'", "''")
        return f"'{escaped}'"
    return None


def sync_missing_columns(sync_conn) -> list[str]:
    """Add model columns that are missing from already-existing tables.

    Runs inside ``conn.run_sync(...)``. Returns the list of ``table.column``
    identifiers that were added, so startup can log what changed.
    """
    inspector = inspect(sync_conn)
    dialect = sync_conn.dialect
    existing_tables = set(inspector.get_table_names())
    added: list[str] = []

    for table in Base.metadata.sorted_tables:
        if table.name not in existing_tables:
            continue  # create_all just built it, with every column present

        present = {c["name"] for c in inspector.get_columns(table.name)}

        for column in table.columns:
            if column.name in present:
                continue

            # A Postgres ENUM column needs its type to exist first; on SQLite
            # this is a no-op because Enum compiles to VARCHAR + CHECK.
            if isinstance(column.type, SAEnum):
                try:
                    column.type.create(sync_conn, checkfirst=True)
                except Exception as exc:  # type already present, or not PG
                    logger.debug(f"enum type for {table.name}.{column.name}: {exc}")

            try:
                type_sql = column.type.compile(dialect=dialect)
            except Exception as exc:
                logger.warning(
                    f"schema-sync: cannot render type for "
                    f"{table.name}.{column.name} ({exc}) — skipped"
                )
                continue

            ddl = f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {type_sql}'
            literal = _literal_default(column)
            if literal is not None:
                ddl += f" DEFAULT {literal}"

            try:
                sync_conn.execute(text(ddl))
                added.append(f"{table.name}.{column.name}")
            except Exception as exc:
                # One column failing must not abort startup or block the
                # columns after it — report it and continue.
                logger.error(
                    f"schema-sync: failed to add {table.name}.{column.name}: {exc}"
                )

    return added
