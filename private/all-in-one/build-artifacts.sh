#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════
# Produce the app bundle the ZUUP-OS all-in-one image bakes in.
#
# Runs on the developer HOST (uses Docker). It reuses the EXACT images the
# Docker proving ground already built and verified — so the bytes that ship in
# the OS image are the same ones tested in compose — and captures a seeded SQL
# dump that the image restores into a tmpfs database at boot (no seeding work,
# no Argon, runs on the device in seconds; nothing persists).
#
# Output: out/zuup-app-bundle.tar.zst  ← consumed by image-build stage 25.
#
#   bash private/all-in-one/build-artifacts.sh
#
# Then build the image:
#   bash private/zuup-os/image-build/docker-build.sh -- --allinone
# ════════════════════════════════════════════════════════════════════════
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
COMPOSE="$HERE/docker-compose.yml"
OUT="${ZUUP_OUT:-$REPO/private/zuup-os/image-build/out}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

dc() { docker compose -f "$COMPOSE" "$@"; }

# The §11 answer-sealing keypair is gitignored (a private key does not belong in
# a repo), so a fresh clone has none — and without it the Edge answers
# SEALING_KEY_NOT_PROVISIONED and no candidate can submit. Create it here, once,
# before anything mounts it. Idempotent: an existing pair is left alone.
node "$REPO/private/hq-demo-key/ensure-keys.mjs"

echo "[bundle] 1/4 building the app images (cached if unchanged)…"
# edge-init MUST be in this list even though it shares edge's Dockerfile and
# context. It was omitted, so `dc run edge-init` kept using whatever image was
# last built — one carrying the JUNE migration set. It applied migrations 000-002
# to an already-migrated database, printed "up to date", exited 0, and the dump
# below was captured from a schema three migrations behind the code. The image
# built from it booted, restored cleanly, started the Edge, and then answered
# HTTP 500 `column "commissioned_via" does not exist` to every commissioning
# request — discovered on the laptop, after the flash.
dc build edge edge-init exam-terminal centre-admin

echo "[bundle] 2/4 applying migrations and capturing the SQL dump…"
# From an EMPTY database, every time.
#
# `edge_pg` is a NAMED VOLUME: it survives `dc down` and had been alive since
# 2026-06-15, accumulating everything every run of the stack ever wrote. The dump
# is taken from it wholesale, so the image shipped 487 users, 487 enrolments, 43
# terminals, 19 staff identities and four answer-ledger rows — the demo seed that
# was deleted from the repo in August, still living in a Docker volume and
# reaching the device anyway. Two of those terminals already held seats `ADM-1`
# and `INV-1`, so first-boot commissioning collided with them.
#
# Discarding the volume is what makes the bundle a function of the repo (plus the
# operator's bundle, if any) rather than of this machine's Docker history.
dc down -v >/dev/null 2>&1 || true
dc up -d postgres
# Migrations only, always. The image needs the SCHEMA baked in; the CONTENTS are
# a separate question with two answers, neither of which is a fixture:
#
#   • an operator's provisioning bundle, if one is mounted (a real centre), or
#   • nothing, in which case the machine commissions its own stations at first
#     boot (zuup-commission.sh) and the roster arrives by provisioning later.
#
# `edge-init`'s compose command is migrate+provision, and provision exits
# non-zero with no bundle — which under `set -e` used to take this whole build
# down. Run the two steps separately so a missing bundle is a choice, not a
# build failure.
dc run --rm edge-init node src/migrate.ts >/dev/null

BUNDLE="$REPO/private/all-in-one/provisioning/centre-bundle.json"
if [ -f "$BUNDLE" ]; then
  dc run --rm edge-init node src/provision.ts >/dev/null
  echo "[bundle]   commissioned from $(basename "$BUNDLE")"
else
  echo "[bundle]   no provisioning bundle at $BUNDLE"
  echo "[bundle]   → the image ships an EMPTY centre and commissions its own"
  echo "[bundle]     stations on first boot. Run 'node private/edge-server/src/provision.ts --schema'"
  echo "[bundle]     to see the bundle shape if you want real rosters baked in."
fi
# --no-owner/--no-privileges so the image's boot script restores it under its
# own freshly-created zuup role regardless of the build-time role.
dc exec -T postgres pg_dump -U zuup -d zuup_edge --no-owner --no-privileges \
  > "$STAGE/seed.sql"
echo "[bundle]   seed.sql: $(wc -c < "$STAGE/seed.sql") bytes"

# ── the dump is the device's whole database: check it before it is baked ─────
#
# Neither of the two faults above was visible in anything: the build succeeded,
# the image built, the restore succeeded at boot, the Edge started. The first
# symptom was an HTTP 500 on a laptop that had already been flashed. These two
# assertions are cheap and they run while the database is still up to be asked.
bad=0

# 1. Every migration in the repo must be recorded as applied. This is the one
#    that turns "the Edge is three migrations ahead of its schema" from a
#    runtime 500 into a build failure.
applied="$(dc exec -T postgres psql -U zuup -d zuup_edge -tAc \
             'SELECT name FROM _migrations' | tr -d '\r')"
for f in "$REPO"/private/edge-server/migrations/*.sql; do
  base="$(basename "$f")"
  printf '%s\n' "$applied" | grep -qx "$base" || {
    echo "[bundle]   NOT APPLIED: $base" >&2
    bad=1
  }
done

# 2. With no operator bundle the centre must be EMPTY. "No fixture data ships in
#    the image" is a claim the README, FIRST-BOOT.md and the commissioning script
#    all rest on; it deserves to be measured rather than asserted.
if [ ! -f "$BUNDLE" ]; then
  rows="$(dc exec -T postgres psql -U zuup -d zuup_edge -tAc "
            SELECT coalesce(sum(n), 0) FROM (
              SELECT count(*) n FROM users            UNION ALL
              SELECT count(*)   FROM terminals        UNION ALL
              SELECT count(*)   FROM staff_identities UNION ALL
              SELECT count(*)   FROM enrollments      UNION ALL
              SELECT count(*)   FROM answer_ledger
            ) t" | tr -d '\r[:space:]')"
  if [ "${rows:-0}" != "0" ]; then
    echo "[bundle]   $rows fixture row(s) in a centre that should be empty —" >&2
    echo "[bundle]   the dump is carrying data no bundle provisioned." >&2
    bad=1
  fi
fi

if [ "$bad" -ne 0 ]; then
  echo "[bundle] FAILED: the schema captured here is not the schema the code needs." >&2
  echo "[bundle] The image would boot, restore, start — and then deny every request" >&2
  echo "[bundle] that touches a column the dump predates. Not shipping it." >&2
  dc down -v >/dev/null 2>&1 || true
  exit 1
fi
echo "[bundle]   schema verified: $(printf '%s\n' "$applied" | grep -c . ) migrations applied"
dc down >/dev/null 2>&1 || true

echo "[bundle] 3/4 extracting /app from each verified image…"
extract() { # image  dest
  local cid; cid="$(docker create "$1")"
  docker cp "$cid:/app/." "$2"
  docker rm -f "$cid" >/dev/null
}
mkdir -p "$STAGE/app/edge" "$STAGE/app/terminal" "$STAGE/app/admin"
extract zuup-all-in-one-edge          "$STAGE/app/edge"
extract zuup-all-in-one-exam-terminal "$STAGE/app/terminal"
extract zuup-all-in-one-centre-admin  "$STAGE/app/admin"

# A manifest the image can sanity-check / print at boot.
cat > "$STAGE/manifest.txt" <<EOF
zuup-os all-in-one app bundle
built: $(date -u +%Y-%m-%dT%H:%M:%SZ)
edge:     private/edge-server (run: node src/index.ts)
terminal: exam-terminal standalone (run: node server.js, :3000)
admin:    centre-admin standalone (run: node private/centre-admin/server.js, :3002, basePath /admin)
seed.sql: $(wc -c < "$STAGE/seed.sql") bytes (schema + whatever was provisioned)
EOF

echo "[bundle] 4/4 packing → $OUT/zuup-app-bundle.tar.zst …"
mkdir -p "$OUT"
# Pack FLAT (edge/, terminal/, admin/, seed.sql, manifest.txt at the tar root):
# stage 25 extracts straight into /opt/zuup/app, so a parent `app/` dir here
# double-nests the services' WorkingDirectory paths and the image boots with
# every app unit in a 200/CHDIR crash-loop.
mv "$STAGE/seed.sql" "$STAGE/manifest.txt" "$STAGE/app/"
tar -C "$STAGE/app" -cf - edge terminal admin seed.sql manifest.txt \
  | zstd -q -19 -o "$OUT/zuup-app-bundle.tar.zst" -f
echo "[bundle] done: $(du -h "$OUT/zuup-app-bundle.tar.zst" | cut -f1)  ($OUT/zuup-app-bundle.tar.zst)"
