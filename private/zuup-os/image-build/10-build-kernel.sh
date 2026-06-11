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

[[ -d "$SRC" ]] || { echo "[zuup-os] kernel source missing — run stage 00 first" >&2; exit 1; }
cd "$SRC"

# The repo mounts read-only; merge fragments from staging copies in $BUILD.
FRAGS="$BUILD/kconfig"
mkdir -p "$FRAGS"
cp "$ZUUP_OS_DIR/kernel/zuup.config"             "$FRAGS/zuup.config"
cp "$HERE/configs/image.config"                  "$FRAGS/image.config"

echo "[zuup-os] merging configs (defconfig ⊕ zuup.config ⊕ image.config)…"
make mrproper >/dev/null
scripts/kconfig/merge_config.sh -m arch/x86/configs/x86_64_defconfig \
  "$FRAGS/zuup.config" "$FRAGS/image.config" >/dev/null
make olddefconfig >/dev/null

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
