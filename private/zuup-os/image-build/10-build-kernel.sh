#!/usr/bin/env bash
# Stage 10 — compile the hardened kernel (spec §7.2) from the verified source
# of stage 00:  x86_64_defconfig  ⊕  kernel/zuup.config  ⊕  configs/image.config
#
# Outputs: $BUILD/bzImage (asserted < 15 MB) + $BUILD/kernel.config (the exact
# merged configuration, kept for the release record).
set -euo pipefail
[[ "$(uname -s)" == "Linux" ]] || { echo "[zuup-os] Linux build host only (use docker-build.sh)"; exit 0; }

BUILD="${BUILD:-/build}"
KVER="${KVER:-6.6.52}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ZUUP_OS_DIR="${ZUUP_OS_DIR:-$(cd "$HERE/.." && pwd)}"
SRC="$BUILD/src/linux-$KVER"

# Dev images may add boot relaxations (e.g. USB-stick boot for laptop demos);
# a production build never receives --dev, so those relaxations can't ship.
DEV=0
for a in "$@"; do [ "$a" = "--dev" ] && DEV=1; done

[[ -d "$SRC" ]] || { echo "[zuup-os] kernel source missing — run stage 00 first" >&2; exit 1; }
cd "$SRC"

# The repo mounts read-only; merge fragments from staging copies in $BUILD.
FRAGS="$BUILD/kconfig"
mkdir -p "$FRAGS"
cp "$ZUUP_OS_DIR/kernel/zuup.config"             "$FRAGS/zuup.config"
cp "$HERE/configs/image.config"                  "$FRAGS/image.config"

# DEV ONLY: allow Linux to read the rootfs off a USB stick so the image boots on
# a demo/dev laptop. Production keeps USB storage OFF (image.config: "no exfil
# medium") and boots via PXE-into-RAM or an internal disk — this fragment is
# never merged into a production image.
EXTRA_FRAGS=""
if [[ $DEV == 1 ]]; then
  cat > "$FRAGS/dev.config" <<'EOF'
CONFIG_USB_STORAGE=y
CONFIG_USB_UAS=y
EOF
  EXTRA_FRAGS="$FRAGS/dev.config"
  echo "[zuup-os] DEV: USB mass-storage ENABLED for laptop/USB boot (never in production)"
fi

echo "[zuup-os] merging configs (defconfig ⊕ zuup.config ⊕ image.config${EXTRA_FRAGS:+ ⊕ dev.config})…"
make mrproper >/dev/null
scripts/kconfig/merge_config.sh -m arch/x86/configs/x86_64_defconfig \
  "$FRAGS/zuup.config" "$FRAGS/image.config" $EXTRA_FRAGS >/dev/null
make olddefconfig >/dev/null

# In dev, confirm the USB-boot relaxation actually survived dependency resolution.
if [[ $DEV == 1 ]]; then
  grep -q "^CONFIG_USB_STORAGE=y" .config || { echo "[zuup-os] FAIL: USB_STORAGE missing in dev build" >&2; exit 1; }
fi

# Refuse to build if a security-critical option was dropped by Kconfig
# dependency resolution — silent loss here would silently weaken the image.
for opt in CONFIG_SECURITY_LOCKDOWN_LSM=y CONFIG_DM_VERITY=y CONFIG_SQUASHFS=y \
           CONFIG_NF_TABLES=y CONFIG_EFI_STUB=y CONFIG_SECURITY_APPARMOR=y; do
  grep -q "^$opt" .config || { echo "[zuup-os] FAIL: $opt lost in merge" >&2; exit 1; }
done
grep -q "^CONFIG_MODULES=y" .config && { echo "[zuup-os] FAIL: modules re-enabled" >&2; exit 1; }

echo "[zuup-os] compiling bzImage with $(nproc) jobs (this is the long step)…"
make -j"$(nproc)" bzImage

SIZE=$(stat -c%s arch/x86/boot/bzImage)
if (( SIZE > 15 * 1024 * 1024 )); then
  echo "[zuup-os] FAIL: bzImage ${SIZE}B exceeds the 15 MB budget (§7.2)" >&2
  exit 1
fi

install -m 0644 arch/x86/boot/bzImage "$BUILD/bzImage"
install -m 0644 .config               "$BUILD/kernel.config"
echo "[zuup-os] kernel OK: $BUILD/bzImage (${SIZE} bytes, modules: none possible)"
