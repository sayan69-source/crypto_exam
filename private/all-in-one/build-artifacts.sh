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

echo "[bundle] 1/4 building the three app images (cached if unchanged)…"
dc build edge exam-terminal centre-admin

echo "[bundle] 2/4 seeding a throwaway DB and capturing the SQL dump…"
dc up -d postgres
dc run --rm edge-init >/dev/null
# --no-owner/--no-privileges so the image's boot script restores it under its
# own freshly-created zuup role regardless of the build-time role.
dc exec -T postgres pg_dump -U zuup -d zuup_edge --no-owner --no-privileges \
  > "$STAGE/seed.sql"
echo "[bundle]   seed.sql: $(wc -c < "$STAGE/seed.sql") bytes"
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
seed.sql: $(wc -c < "$STAGE/seed.sql") bytes (487-candidate demo centre)
EOF

echo "[bundle] 4/4 packing → $OUT/zuup-app-bundle.tar.zst …"
mkdir -p "$OUT"
tar -C "$STAGE" -cf - app seed.sql manifest.txt \
  | zstd -q -19 -o "$OUT/zuup-app-bundle.tar.zst" -f
echo "[bundle] done: $(du -h "$OUT/zuup-app-bundle.tar.zst" | cut -f1)  ($OUT/zuup-app-bundle.tar.zst)"
