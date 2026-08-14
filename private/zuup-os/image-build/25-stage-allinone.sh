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
# Historical bundles carry the apps under an `app/` parent while seed.sql and
# manifest.txt sit at the tar root; flat bundles have everything at the root.
# The transform strips the parent so BOTH layouts land identically — extracting
# verbatim double-nested the apps (/opt/zuup/app/app/…) and every service died
# at boot with 200/CHDIR while the seed.sql assert still passed.
echo "[zuup-os] stage 25: unpacking app bundle → /opt/zuup/app …"
mkdir -p "$ROOT/opt/zuup/app"
zstd -dc "$BUNDLE" | tar -C "$ROOT/opt/zuup/app" --transform 's|^app/|./|' -xf -
[[ -f "$ROOT/opt/zuup/app/seed.sql" ]] || { echo "[zuup-os] bundle missing seed.sql" >&2; exit 1; }
# Assert the exact paths the systemd units start in/exec — not just seed.sql.
for need in app/edge/private/edge-server app/terminal/server.js \
            app/admin/private/centre-admin/server.js; do
  [[ -e "$ROOT/opt/zuup/$need" ]] \
    || { echo "[zuup-os] bundle layout broken: /opt/zuup/$need missing" >&2; exit 1; }
done

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
# §11.2 answer-sealing key — the PUBLIC half only. Assert it exists rather than
# letting the image ship without it: a missing key is invisible until a
# candidate tries to submit, and then the whole answer pipeline is dead.
HQ_PUB="${ZUUP_HQ_PUBLIC_PEM:-$ZOS/../hq-demo-key/hq-demo-public.pem}"
[[ -f "$HQ_PUB" ]] || {
  cat >&2 <<EOF
[zuup-os] stage 25: sealing key not found at $HQ_PUB
          The keypair is gitignored; generate it on the HOST first (the repo
          mounts read-only here, so this stage cannot create it):
              node private/hq-demo-key/ensure-keys.mjs
          It is also generated automatically by build-artifacts.sh.
EOF
  exit 1
}
grep -q 'BEGIN PUBLIC KEY' "$HQ_PUB" \
  || { echo "[zuup-os] stage 25: $HQ_PUB is not an SPKI PUBLIC key — a centre must never carry a private key (INV-6)" >&2; exit 1; }
inst 0644 "$HQ_PUB"                             opt/zuup/hq-public.pem
# Static surfaces the proxy serves off the image itself, so they answer while
# the Node services are still booting: the operator role chooser, the "centre
# starting" page the proxy substitutes for a dead upstream, and the liveness
# beacon the kiosk's diagnostic page probes.
for f in index.html starting.html up.js; do
  inst 0644 "$AIO/www/$f" "opt/zuup/www/$f"
done
for u in zuup-db zuup-edge zuup-portal-terminal zuup-portal-admin zuup-proxy; do
  inst 0644 "$AIO/$u.service" "etc/systemd/system/$u.service"
done
# kiosk drop-in: point Firefox at the local proxy + wait for the stack
inst 0644 "$AIO/kiosk-allinone.conf" etc/systemd/system/zuup-kiosk.service.d/allinone.conf

# First-boot commissioning: this laptop registers its own stations, daemon key
# and measurements with the on-board Edge (see zuup-commission.sh for why an
# all-in-one is the one image allowed to do that).
inst 0755 "$ZOS/boot/attest/zuup-commission.sh"      usr/lib/zuup/zuup-commission.sh
inst 0644 "$ZOS/boot/attest/zuup-commission.service" etc/systemd/system/zuup-commission.service

# Stage 20's DEV drop-in stubs attestation out with /bin/true, which is right
# for the QEMU smoke image (no TPM, no Edge). The all-in-one HAS an Edge and may
# have a TPM, so it runs the real check — after commissioning, so there is a
# registry row to check against.
#
# FailureAction is cleared deliberately. The script now separates a FAILED
# attestation (halts on every variant — the boot chain is not the one we signed)
# from an ABSENT one (no TPM, or not yet commissioned), which on this variant is
# reported and survived. A machine that powers itself off during a first flash
# tells whoever flashed it nothing, and on real hardware that flash may be the
# only one you get.
mkdir -p "$ROOT/etc/systemd/system/zuup-attest.service.d"
cat > "$ROOT/etc/systemd/system/zuup-attest.service.d/allinone.conf" <<'EOF'
[Unit]
After=zuup-commission.service
Wants=zuup-commission.service

[Service]
ExecStart=
ExecStart=/usr/lib/zuup/zuup-attest.sh
Environment=ZUUP_EDGE_URL=http://edge.local
FailureAction=none
EOF

# ── 5. edge.local → loopback, and the invigilator terminal identity ────────
# Append the host alias without clobbering whatever stage 20 wrote.
grep -q 'edge.local' "$ROOT/etc/hosts" 2>/dev/null || \
  printf '127.0.0.1\tedge.local\n' >> "$ROOT/etc/hosts"
# No identity is baked in. zuup-commission.service generates this machine's
# stations on first boot and writes the real ids here and into
# /run/zuup/terminal-roles.json — so the identity belongs to the hardware that
# holds the keys, rather than being a constant shared by every image ever built
# from this tree.
printf 'REPLACE-AT-FIRST-BOOT\n' > "$ROOT/etc/zuup/terminal-id"
# Runtime marker (stage 20 wrote `dev`): this image DOES carry a centre, so a
# terminal that reaches none has a stack failure, not a missing appliance.
printf 'allinone\n' > "$ROOT/etc/zuup/image-variant"

# ── 6. unprivileged service account for the node apps + Caddy ──────────────
chroot "$ROOT" useradd --system --no-create-home --shell /usr/sbin/nologin zuup-app 2>/dev/null || true

# ── 7. enable the app layer in the session target ──────────────────────────
systemctl --root="$ROOT" enable \
  zuup-db.service zuup-edge.service \
  zuup-portal-terminal.service zuup-portal-admin.service zuup-proxy.service \
  zuup-commission.service >/dev/null 2>&1 || true

# ── 8. refuse to ship an image that cannot boot ────────────────────────────
#
# Everything below is a file the first-boot path reads. A missing one does not
# fail the build, it fails the LAPTOP — after a flash, with no console, and the
# only diagnosis being a kiosk that never appears. Flashing is the expensive
# step, so the cheap check goes here.
echo "[zuup-os] stage 25: verifying the first-boot path…"
missing=0
require() { # path  what-it-does
  if [[ ! -e "$ROOT/$1" ]]; then
    echo "[zuup-os]   MISSING $1 — $2" >&2
    missing=1
  fi
}
require usr/lib/zuup/zuup-commission.sh          "first-boot commissioning: no stations, no login, kiosk lands on /locked"
require usr/lib/zuup/zuup-attest.sh              "boot attestation"
require usr/lib/zuup/zuup-kiosk-launch.sh        "the kiosk launcher: no Firefox at all"
require etc/systemd/system/zuup-commission.service     "commissioning never runs"
require etc/systemd/system/zuup-kiosk.service.d/allinone.conf "kiosk would not open the role chooser"
require etc/systemd/system/zuup-attest.service.d/allinone.conf "attestation would stay stubbed out"
require opt/zuup/www/index.html                  "the operator role chooser"
require opt/zuup/www/starting.html               "the page the proxy shows while services boot"
require opt/zuup/app/edge                        "the Centre Edge"
require opt/zuup/app/terminal                    "the exam-terminal portal"
require opt/zuup/app/admin                       "the Centre Admin portal"
require opt/zuup/app/seed.sql                    "the baked schema the tmpfs database restores"
require opt/zuup/hq-public.pem                   "the §11 sealing key: candidates could not submit"

# The commissioning script talks to the Edge and reads the TPM through these.
for tool in curl openssl python3; do
  chroot "$ROOT" sh -c "command -v $tool" >/dev/null 2>&1 || {
    echo "[zuup-os]   MISSING $tool — first-boot commissioning cannot run" >&2
    missing=1
  }
done

# The baked schema must not be older than the code that will query it.
#
# seed.sql is the device's entire database — restored into tmpfs at boot and
# never migrated. A dump captured from a database that missed a migration
# produces an image that boots perfectly and then answers HTTP 500 to anything
# touching the new columns. That is exactly what shipped once: build-artifacts.sh
# ran migrations from a stale `edge-init` image, the dump stopped at 002, and the
# laptop could not commission a single station. The bundle is built separately
# from the image, possibly days apart, so the check belongs on both sides of that
# gap — this is the last one before a flash.
SEED="$ROOT/opt/zuup/app/seed.sql"
MIGRATIONS="$ZOS/../edge-server/migrations"
if [[ -f "$SEED" && -d "$MIGRATIONS" ]]; then
  ledger="$(awk '/^COPY public\._migrations /{f=1;next} f&&/^\\\.$/{f=0} f{print $1}' "$SEED")"
  for m in "$MIGRATIONS"/*.sql; do
    [[ -f "$m" ]] || continue     # never fail the build on an unmatched glob
    base="$(basename "$m")"
    grep -qxF "$base" <<<"$ledger" || {
      echo "[zuup-os]   STALE SCHEMA: seed.sql was dumped without $base" >&2
      echo "[zuup-os]   → rebuild the bundle: bash private/all-in-one/build-artifacts.sh" >&2
      missing=1
    }
  done
elif [[ ! -d "$MIGRATIONS" ]]; then
  # Not fatal: the check needs the repo, and a bundle-only rebuild may not have
  # it. Say so rather than passing silently, which is the habit that produced
  # the stale image in the first place.
  echo "[zuup-os]   NOTE: $MIGRATIONS not readable — baked schema NOT verified" >&2
fi

# The all-in-one must NOT carry a baked identity: it commissions its own, and a
# leftover constant would make every image built from this tree the same machine.
if grep -qE '^[0-9a-f]{8}-' "$ROOT/etc/zuup/terminal-id" 2>/dev/null; then
  echo "[zuup-os]   /etc/zuup/terminal-id holds a baked UUID — the all-in-one must commission itself" >&2
  missing=1
fi

[[ "$missing" -eq 0 ]] || {
  echo "[zuup-os] stage 25 FAILED: the image would boot without a working first-boot path." >&2
  exit 1
}
echo "[zuup-os] stage 25:   first-boot path complete"

BYTES=$(du -sb "$ROOT/opt/zuup" | awk '{print $1}')
echo "[zuup-os] stage 25: all-in-one app layer staged (/opt/zuup = $(numfmt --to=iec "$BYTES"))"
