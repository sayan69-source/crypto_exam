#!/usr/bin/env bash
# Stage 25 — fold the whole centre stack into the rootfs (the --allinone demo).
#
# Runs after stage 20, only when stage 20 left the .allinone marker. It drops the
# pre-built, Docker-VERIFIED app bundle (edge + both portals + a seeded SQL dump)
# into the read-only rootfs, adds a pinned Node 24 runtime and a static Caddy,
# installs the systemd app layer, and points the kiosk at the local proxy. The
# database itself is built fresh in tmpfs at every boot from the baked dump
# (zuup-allinone-db-init.sh) — so the device still persists NOTHING (INV-2).
#
# The app bundle is produced on the host first:
#   bash private/all-in-one/build-artifacts.sh      → out/zuup-app-bundle.tar.zst
# which docker-build.sh mounts at /dist.
set -euo pipefail
[[ "$(uname -s)" == "Linux" ]] || { echo "[zuup-os] Linux build host only (use docker-build.sh)"; exit 0; }

BUILD="${BUILD:-/build}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ZOS="${ZUUP_OS_DIR:-$(cd "$HERE/.." && pwd)}"
ROOT="$BUILD/rootfs"
AIO="$ZOS/security/allinone"

[[ -f "$BUILD/.allinone" ]] || { echo "[zuup-os] stage 25: not an --allinone build, skipping."; exit 0; }
[[ -d "$ROOT" ]] || { echo "[zuup-os] stage 25: rootfs missing — run stage 20 first" >&2; exit 1; }

BUNDLE="${ZUUP_APP_BUNDLE:-/dist/zuup-app-bundle.tar.zst}"
[[ -f "$BUNDLE" ]] || BUNDLE="$BUILD/zuup-app-bundle.tar.zst"
[[ -f "$BUNDLE" ]] || {
  cat >&2 <<EOF
[zuup-os] stage 25: app bundle not found.
          Build it on the host first:
              bash private/all-in-one/build-artifacts.sh
          (produces out/zuup-app-bundle.tar.zst, mounted at /dist here).
EOF
  exit 1
}

inst() { install -D -m "$1" "$2" "$ROOT/$3"; }   # mode src dest(relative)

# Pinned-hash verification (same discipline as the face models in stage 20): a
# release asset is immutable, so we compare its sha256 to a value recorded here.
# A mismatch fails the build — no silently-swapped runtime ships in the image.
check_sha256() { # file  expected-sha256  label
  local got; got="$(sha256sum "$1" | awk '{print $1}')"
  [[ "$got" == "$2" ]] || { echo "[zuup-os] $3 sha256 $got != pinned $2" >&2; exit 1; }
  echo "[zuup-os]   $(basename "$1")  sha256=$got (pinned OK)"
}

# ── 1. the app bundle → /opt/zuup/app (edge, terminal, admin, seed.sql) ────
echo "[zuup-os] stage 25: unpacking app bundle → /opt/zuup/app …"
mkdir -p "$ROOT/opt/zuup/app"
zstd -dc "$BUNDLE" | tar -C "$ROOT/opt/zuup/app" -xf -
[[ -f "$ROOT/opt/zuup/app/seed.sql" ]] || { echo "[zuup-os] bundle missing seed.sql" >&2; exit 1; }

# ── 2. pinned Node 24 runtime (official glibc linux-x64 build) ─────────────
NODE_VER="${ZUUP_NODE_VER:-v24.14.0}"
NODE_TAR="node-${NODE_VER}-linux-x64.tar.xz"
# Pin recorded from the verified 2026-06-15 fetch; override BOTH when bumping.
NODE_SHA256="${ZUUP_NODE_SHA256:-41cd79bb7877c81605a9e68ec4c91547774f46a40c67a17e34d7179ef11729df}"
echo "[zuup-os] stage 25: fetching Node ${NODE_VER} …"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
curl -fL --retry 3 --proto '=https' -o "$TMP/$NODE_TAR"  "https://nodejs.org/dist/${NODE_VER}/${NODE_TAR}"
check_sha256 "$TMP/$NODE_TAR" "$NODE_SHA256" "Node ${NODE_VER}"
mkdir -p "$ROOT/opt/zuup/node"
tar -C "$ROOT/opt/zuup/node" --strip-components=1 -xJf "$TMP/$NODE_TAR"
# Trim what a runtime never needs (npm/npx/corepack + headers/docs).
rm -rf "$ROOT/opt/zuup/node/lib/node_modules/npm" \
       "$ROOT/opt/zuup/node/bin/npm" "$ROOT/opt/zuup/node/bin/npx" \
       "$ROOT/opt/zuup/node/bin/corepack" \
       "$ROOT/opt/zuup/node/include" "$ROOT/opt/zuup/node/share" 2>/dev/null || true

# ── 3. static Caddy (official linux-amd64 release tarball) ──────────────────
CADDY_VER="${ZUUP_CADDY_VER:-2.8.4}"
CADDY_TAR="caddy_${CADDY_VER}_linux_amd64.tar.gz"
GH="https://github.com/caddyserver/caddy/releases/download/v${CADDY_VER}"
# Pin recorded from the verified 2026-06-15 fetch; override BOTH when bumping.
CADDY_SHA256="${ZUUP_CADDY_SHA256:-a7e8306c54138cf88e371c5ec0caf7baf142ecc1d60a30897dfb67d65d3748c8}"
echo "[zuup-os] stage 25: fetching Caddy ${CADDY_VER} …"
curl -fL --retry 3 --proto '=https' -o "$TMP/$CADDY_TAR"  "$GH/$CADDY_TAR"
check_sha256 "$TMP/$CADDY_TAR" "$CADDY_SHA256" "Caddy ${CADDY_VER}"
tar -C "$TMP" -xzf "$TMP/$CADDY_TAR" caddy
install -D -m 0755 "$TMP/caddy" "$ROOT/opt/zuup/caddy"

# ── 4. app-layer systemd units + scripts + proxy config ────────────────────
echo "[zuup-os] stage 25: installing the app-layer units …"
inst 0755 "$AIO/zuup-allinone-db-init.sh"      usr/lib/zuup/zuup-allinone-db-init.sh
inst 0644 "$AIO/Caddyfile"                      opt/zuup/Caddyfile
for u in zuup-db zuup-edge zuup-portal-terminal zuup-portal-admin zuup-proxy; do
  inst 0644 "$AIO/$u.service" "etc/systemd/system/$u.service"
done
# kiosk drop-in: point Firefox at the local proxy + wait for the stack
inst 0644 "$AIO/kiosk-allinone.conf" etc/systemd/system/zuup-kiosk.service.d/allinone.conf

# ── 5. edge.local → loopback, and the invigilator terminal identity ────────
# Append the host alias without clobbering whatever stage 20 wrote.
grep -q 'edge.local' "$ROOT/etc/hosts" 2>/dev/null || \
  printf '127.0.0.1\tedge.local\n' >> "$ROOT/etc/hosts"
# This demo terminal boots as the INVIGILATOR_STATION seeded by seed-demo.ts →
# the Gate opens the invigilator console (the 487-candidate roster, one-by-one
# check-in + seat assignment). Re-image with a different id to demo another role.
printf '55555555-5555-5555-5555-555555555555\n' > "$ROOT/etc/zuup/terminal-id"

# ── 6. unprivileged service account for the node apps + Caddy ──────────────
chroot "$ROOT" useradd --system --no-create-home --shell /usr/sbin/nologin zuup-app 2>/dev/null || true

# ── 7. enable the app layer in the session target ──────────────────────────
systemctl --root="$ROOT" enable \
  zuup-db.service zuup-edge.service \
  zuup-portal-terminal.service zuup-portal-admin.service zuup-proxy.service >/dev/null 2>&1 || true

BYTES=$(du -sb "$ROOT/opt/zuup" | awk '{print $1}')
echo "[zuup-os] stage 25: all-in-one app layer staged (/opt/zuup = $(numfmt --to=iec "$BYTES"))"
