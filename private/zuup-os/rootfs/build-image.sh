#!/usr/bin/env bash
# ZUUP-OS image builder (spec §7.3, §7.1, Phase 11).
#
# Assembles the minimal userland into a SquashFS, computes the dm-verity tree,
# and signs the result with the Secure Boot key. Run ONLY on the air-gapped
# Linux build host. The guard makes accidental execution here a no-op.
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]] || ! command -v mksquashfs >/dev/null 2>&1; then
  cat <<'EOF'
[zuup-os] Linux-build-host artifact; not running here. On the build host it would:
   1. stage a minimal userland (systemd, cage, firefox-esr, wireguard, TF Lite,
      biometric/proctor/heartbeat daemons) — NO shells, NO package managers,
      NO compilers (§7.3).
   2. assert there are no setuid binaries:  find rootfs -perm -4000 -> must be empty
   3. mksquashfs rootfs zuup-root.squashfs -comp xz -noappend
   4. veritysetup format zuup-root.squashfs zuup-root.verity  (record root hash)
   5. sign the root hash + kernel with the Secure Boot key (boot/secureboot)
   6. assert image < 300 MB (§19)
   Nothing was changed on this machine.
EOF
  exit 0
fi

ROOTFS="${1:?usage: build-image.sh <staged-rootfs-dir>}"
OUT="${OUT:-zuup-root.squashfs}"

# INV-3 of the image checklist: no setuid binaries ship.
if [[ -n "$(find "$ROOTFS" -perm -4000 -type f 2>/dev/null)" ]]; then
  echo "[zuup-os] FAIL: setuid binary found in rootfs (§7.3 forbids)" >&2
  find "$ROOTFS" -perm -4000 -type f >&2
  exit 1
fi

mksquashfs "$ROOTFS" "$OUT" -comp xz -noappend -no-xattrs
veritysetup format "$OUT" "${OUT}.verity" | tee "${OUT}.roothash"

SIZE=$(stat -c%s "$OUT")
if (( SIZE > 300 * 1024 * 1024 )); then
  echo "[zuup-os] FAIL: image ${SIZE}B exceeds 300 MB budget (§19)" >&2
  exit 1
fi
echo "[zuup-os] image OK: ${SIZE} bytes; verity root hash in ${OUT}.roothash"
echo "[zuup-os] next: sign with boot/secureboot/sign-image.sh"
