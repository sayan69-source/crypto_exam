#!/usr/bin/env bash
# ZUUP-OS image pipeline orchestrator (Phase 11). Runs INSIDE the builder
# container (docker-build.sh) or directly on a dedicated Linux build host.
#
#   build-all.sh                # all stages, production image
#   build-all.sh 20             # a single stage
#   build-all.sh -- --dev       # also emit the dev-console UKI + dev disk image
#
# Stages (each is restartable; artifacts land under $BUILD):
#   00  fetch + verify the mainline kernel source        (00-fetch-kernel.sh)
#   10  compile the hardened kernel per §7.2             (10-build-kernel.sh)
#   20  stage the minimal rootfs userland per §7.3       (20-stage-rootfs.sh)
#   30  squashfs + dm-verity + initramfs + signed UKI
#       + UEFI disk image, all unprivileged              (30-make-image.sh)
#   40  QEMU/OVMF + swtpm fail-closed smoke boot         (40-qemu-smoke.sh)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
export BUILD="${BUILD:-/build}"
export ZUUP_OS_DIR="$(cd "$HERE/.." && pwd)"

# ── host guard: a Linux build environment, never the dev workstation ───────
if [[ "$(uname -s)" != "Linux" ]]; then
  cat <<'EOF'
[zuup-os] build-all.sh only runs on a Linux build host or inside the builder
          container. From Windows/macOS use:  ./docker-build.sh
          Nothing was changed on this machine.
EOF
  exit 0
fi
mkdir -p "$BUILD"
[[ -w "$BUILD" ]] || { echo "[zuup-os] $BUILD not writable" >&2; exit 1; }

STAGES=()
EXTRA=()
while (($#)); do
  case "$1" in
    00|10|20|30|40) STAGES+=("$1") ;;
    --) shift; EXTRA=("$@"); break ;;
    *) EXTRA+=("$1") ;;
  esac
  shift
done
((${#STAGES[@]})) || STAGES=(00 10 20 30 40)

for s in "${STAGES[@]}"; do
  script="$HERE/${s}-"*.sh
  script=$(ls $script)
  echo
  echo "════════════════════════════ stage $s ════════════════════════════"
  bash "$script" "${EXTRA[@]}"
done

# ── final manifest: every artifact, hashed, for the release record ─────────
if [[ -f "$BUILD/zuup-os.img" ]]; then
  ( cd "$BUILD" && sha256sum zuup-os.img zuup.efi.signed zuup-root.squashfs \
      zuup-root.squashfs.verity zuup-initramfs.cpio.gz bzImage 2>/dev/null \
      | tee zuup-os.manifest.sha256 )
  echo
  echo "[zuup-os] PIPELINE COMPLETE → $BUILD/zuup-os.img"
  echo "[zuup-os] manifest: $BUILD/zuup-os.manifest.sha256"
fi
