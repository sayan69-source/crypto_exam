#!/usr/bin/env python3
"""
Mint and inspect centre uplink credentials, from a shell instead of a browser.

The tier-0 console does this too, and normally that is the right place. This
exists for the case the console cannot cover: the very first credential on a
fresh deployment, where nobody has enrolled as System Admin yet and therefore
nobody can call the tier-0 endpoint. Without it, bringing up a centre depends on
a WebAuthn enrolment that depends on a device that depends on being on-site —
and the estate cannot start.

It talks to the database directly, so it needs DATABASE_URL and nothing else.
Run it from the deployment's own shell (Render → the service → Shell) or locally
against the same DSN.

    python scripts/centre_uplink.py --list
    python scripts/centre_uplink.py --mint <centre-id>
    python scripts/centre_uplink.py --create "Kolkata North 021" --state WB --mint-new
    python scripts/centre_uplink.py --hq-pubkey

The minted key is printed ONCE. Only its SHA-256 is stored, so a lost key is
reissued rather than recovered — which is what makes a database read useless to
whoever obtains one.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import os
import secrets
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from app.models import Center  # noqa: E402


def _dsn() -> str:
    raw = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./cryptoexam.db")
    # Render hands out `postgres://` / `postgresql://`; SQLAlchemy's async
    # engine needs the asyncpg driver named explicitly or it picks psycopg2 and
    # fails with a driver error that says nothing about the URL.
    if raw.startswith("postgres://"):
        raw = "postgresql+asyncpg://" + raw[len("postgres://"):]
    elif raw.startswith("postgresql://"):
        raw = "postgresql+asyncpg://" + raw[len("postgresql://"):]
    return raw


async def _assert_schema(engine) -> bool:
    """The `centers` table has to exist before any of this means anything.

    Without the check, a DSN pointing at an empty or wrong database produces a
    twenty-line SQLAlchemy traceback ending in "no such table: centers", which
    reads like a bug in this script rather than what it is — the wrong database,
    or one the API has never started against.
    """
    from sqlalchemy import inspect

    async with engine.connect() as conn:
        names = await conn.run_sync(lambda c: inspect(c).get_table_names())
    if "centers" not in names:
        print("no `centers` table in this database - the API has never started "
              "against it, or DATABASE_URL points somewhere else.", file=sys.stderr)
        print(f"  DSN: {_dsn().split('@')[-1]}", file=sys.stderr)
        return False
    return True


async def _main(args: argparse.Namespace) -> int:
    engine = create_async_engine(_dsn(), future=True)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    try:
        if not await _assert_schema(engine):
            return 4
        async with Session() as s:
            if args.create:
                centre = Center(
                    id=str(uuid.uuid4()), name=args.create,
                    state=args.state, district=args.district,
                )
                s.add(centre)
                await s.commit()
                print(f"created centre {centre.id}  {centre.name}")
                if args.mint_new:
                    args.mint = centre.id

            if args.mint:
                centre = (await s.execute(
                    select(Center).where(Center.id == args.mint)
                )).scalar_one_or_none()
                if centre is None:
                    print(f"no such centre: {args.mint}", file=sys.stderr)
                    return 2
                key = secrets.token_hex(32)
                rotated = centre.sync_key_hash is not None
                centre.sync_key_hash = hashlib.sha256(key.encode()).hexdigest()
                centre.sync_key_issued_at = datetime.now(timezone.utc)
                await s.commit()
                print()
                print(f"  centre        {centre.id}  ({centre.name})")
                print(f"  {'ROTATED' if rotated else 'ISSUED'} - the previous key, if any, no longer works")
                print()
                print(f"  HQ_CENTRE_KEY={key}")
                print()
                print("  Put that line in the centre's centre.conf, then provision its")
                print("  ADMIN_STATION. It is shown once and is not recoverable from here.")
                print()

            if args.list or not (args.mint or args.create or args.hq_pubkey):
                rows = (await s.execute(select(Center))).scalars().all()
                if not rows:
                    print("no centres exist yet - create one with --create")
                for c in rows:
                    state = "issued " if c.sync_key_hash else "NOT SET"
                    last = c.last_sync_at.isoformat() if c.last_sync_at else "never"
                    print(f"{c.id}  {state}  last-sync={last}  {c.name}")

        if args.hq_pubkey:
            # Imported late: it pulls the whole settings object, which is heavy
            # and unnecessary for the database-only paths above.
            from app.api.v1.centre_sync import hq_public_key_hex

            pub = hq_public_key_hex()
            if pub:
                print(f"HQ_PROVISIONING_PUBKEY={pub}")
                print("  -> set this on every centre's Edge; it refuses any bundle "
                      "this platform did not sign.")
            else:
                print("HQ_PROVISIONING_SIGNING_SEED is not set - this deployment signs "
                      "nothing, and an Edge configured with a public key will refuse "
                      "every bundle it sends.", file=sys.stderr)
                return 3
        return 0
    finally:
        await engine.dispose()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Centre uplink credentials (ZUUP-OS §12).")
    ap.add_argument("--list", action="store_true", help="list centres and their credential state")
    ap.add_argument("--mint", metavar="CENTRE_ID", help="issue or rotate a centre's credential")
    ap.add_argument("--create", metavar="NAME", help="create a centre")
    ap.add_argument("--state", default=None, help="with --create")
    ap.add_argument("--district", default=None, help="with --create")
    ap.add_argument("--mint-new", action="store_true", help="with --create: mint its credential too")
    ap.add_argument("--hq-pubkey", action="store_true", help="print HQ's bundle-signing public key")
    sys.exit(asyncio.run(_main(ap.parse_args())))
