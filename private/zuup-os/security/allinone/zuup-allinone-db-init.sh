#!/bin/sh
# ZUUP-OS all-in-one — bring up the centre database in RAM at boot.
#
# The root filesystem is read-only dm-verity and the OS persists NOTHING
# (INV-2). So PostgreSQL's data directory lives in /run (tmpfs): a fresh
# `initdb` every boot, the baked demo dump restored into it, and the whole
# thing evaporates on power-off. No exam data ever touches stable storage on
# the device — the same air-gapped, leave-no-trace property the production
# terminal has, now with the centre stack folded in for a self-contained demo.
set -eu

PGDATA=/run/zuup/pgdata
SOCKDIR=/run/zuup
SEED=/opt/zuup/app/seed.sql

PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
[ -n "$PGBIN" ] || { echo "zuup-db: no PostgreSQL install found" >&2; exit 1; }
[ -f "$SEED" ]  || { echo "zuup-db: seed dump $SEED missing" >&2; exit 1; }

# Fresh, empty, postgres-owned tmpfs data dir.
rm -rf "$SOCKDIR"
install -d -m 0750 -o postgres -g postgres "$SOCKDIR"
install -d -m 0700 -o postgres -g postgres "$PGDATA"

run() { runuser -u postgres -- "$@"; }
export PGHOST="$SOCKDIR" PGPORT=5432

# -A trust: single-host loopback demo; default pg_hba then trusts local socket
# AND 127.0.0.1/::1, which is exactly (and only) what the edge connects over.
run "$PGBIN/initdb" -D "$PGDATA" -U postgres --no-locale --encoding=UTF8 -A trust >/dev/null

cat >> "$PGDATA/postgresql.conf" <<CONF
listen_addresses = '127.0.0.1'
port = 5432
unix_socket_directories = '$SOCKDIR'
fsync = off
full_page_writes = off
synchronous_commit = off
CONF

run "$PGBIN/pg_ctl" -D "$PGDATA" -w -t 60 start

# The role + database the edge authenticates as
# (postgres://zuup:zuup@127.0.0.1:5432/zuup_edge). Restoring the dump AS zuup
# makes zuup own every object, so the non-superuser edge has full access.
run "$PGBIN/psql" -v ON_ERROR_STOP=1 -q <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'zuup') THEN
    CREATE ROLE zuup LOGIN PASSWORD 'zuup';
  END IF;
END $$;
SQL
run "$PGBIN/createdb" -O zuup zuup_edge
run "$PGBIN/psql" -U zuup -d zuup_edge -v ON_ERROR_STOP=1 -q -f "$SEED"

echo "zuup-db: tmpfs PostgreSQL up, demo centre restored (487 candidates)"
