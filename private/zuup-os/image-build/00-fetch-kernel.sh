#!/usr/bin/env bash
# Stage 00 — fetch + verify the mainline kernel source (spec §7.2 step 1).
#
# Verification is fail-closed and offers two roots of trust:
#   a) PGP: kernel.org's signed sha256sums.asc, with the signing key fetched
#      over WKD from kernel.org (the documented kernel.org procedure), or
#   b) an operator-pinned hash via ZUUP_KERNEL_SHA256 (air-gapped hosts).
# If neither verification can complete, the stage FAILS unless the operator
# explicitly sets ZUUP_TRUST_CDN=1 (TLS-to-cdn.kernel.org only — discouraged,
# never for a release build).
set -euo pipefail
[[ "$(uname -s)" == "Linux" ]] || { echo "[zuup-os] Linux build host only (use docker-build.sh)"; exit 0; }

BUILD="${BUILD:-/build}"
KVER="${KVER:-6.6.52}"
# Known-good pin for the default KVER, recorded from a PGP-WKD-verified fetch
# (2026-06-11). Other versions still verify via sha256sums.asc + PGP; an
# explicit ZUUP_KERNEL_SHA256 always wins.
if [[ -z "${ZUUP_KERNEL_SHA256:-}" && "$KVER" == "6.6.52" ]]; then
  ZUUP_KERNEL_SHA256="1591ab348399d4aa53121158525056a69c8cf0fe0e90935b0095e9a58e37b4b8"
fi
MAJOR="v${KVER%%.*}.x"
CDN="https://cdn.kernel.org/pub/linux/kernel/${MAJOR}"
TARBALL="linux-${KVER}.tar.xz"
DEST="$BUILD/src"

mkdir -p "$DEST"
cd "$DEST"

if [[ -f "$TARBALL.verified" ]]; then
  echo "[zuup-os] $TARBALL already fetched + verified — skipping"
  exit 0
fi

echo "[zuup-os] fetching $TARBALL …"
curl -fL --proto '=https' -o "$TARBALL" "$CDN/$TARBALL"
curl -fL --proto '=https' -o sha256sums.asc "$CDN/sha256sums.asc" || true

ACTUAL=$(sha256sum "$TARBALL" | awk '{print $1}')
VERIFIED=""

# ── path b: operator-pinned hash wins outright ──────────────────────────────
if [[ -n "${ZUUP_KERNEL_SHA256:-}" ]]; then
  [[ "$ACTUAL" == "$ZUUP_KERNEL_SHA256" ]] \
    || { echo "[zuup-os] FAIL: sha256 mismatch vs ZUUP_KERNEL_SHA256 pin" >&2; exit 1; }
  VERIFIED="pinned-sha256"
# ── path a: kernel.org-signed checksum file ────────────────────────────────
elif [[ -s sha256sums.asc ]]; then
  EXPECTED=$(grep -E "  ${TARBALL}\$" sha256sums.asc | awk '{print $1}' | head -1)
  [[ -n "$EXPECTED" && "$ACTUAL" == "$EXPECTED" ]] \
    || { echo "[zuup-os] FAIL: sha256 mismatch vs sha256sums.asc" >&2; exit 1; }
  # bind the checksum file itself to kernel.org's autosigner key via WKD
  export GNUPGHOME="$(mktemp -d)"
  if gpg --quiet --auto-key-locate clear,wkd --locate-external-keys autosigner@kernel.org >/dev/null 2>&1 \
     && gpg --verify sha256sums.asc >/dev/null 2>&1; then
    VERIFIED="pgp-wkd"
  elif [[ "${ZUUP_TRUST_CDN:-0}" == "1" ]]; then
    echo "[zuup-os] WARNING: PGP unavailable; trusting TLS to cdn.kernel.org (ZUUP_TRUST_CDN=1)" >&2
    VERIFIED="tls-only"
  else
    echo "[zuup-os] FAIL: cannot PGP-verify sha256sums.asc and no ZUUP_KERNEL_SHA256 pin." >&2
    echo "          Set ZUUP_KERNEL_SHA256=<hash> (preferred) or ZUUP_TRUST_CDN=1." >&2
    exit 1
  fi
else
  echo "[zuup-os] FAIL: no checksum source. Set ZUUP_KERNEL_SHA256=<hash>." >&2
  exit 1
fi

echo "$ACTUAL  $TARBALL  ($VERIFIED)" > "$TARBALL.verified"
echo "[zuup-os] verified ($VERIFIED): $ACTUAL"

echo "[zuup-os] unpacking…"
tar -xJf "$TARBALL"
echo "[zuup-os] kernel source ready: $DEST/linux-$KVER"
