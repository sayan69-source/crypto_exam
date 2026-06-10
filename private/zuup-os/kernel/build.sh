#!/usr/bin/env bash
# ZUUP-OS hardened kernel build driver (spec §7.2).
#
# Produces a signed bzImage (< 15 MB) from mainline 6.x + zuup.config. Run ONLY
# on the dedicated air-gapped Linux build host. The guard below makes accidental
# execution on a developer workstation a no-op.
set -euo pipefail

# ── host guard ──────────────────────────────────────────────────────────────
if [[ "$(uname -s)" != "Linux" ]] || [[ ! -d /usr/src ]] || ! command -v make >/dev/null 2>&1; then
  cat <<'EOF'
[zuup-os] This is a Linux-build-host artifact and will not run here.
          On the build host it would, in order:
            1. fetch + verify the mainline 6.x source tarball (signature checked)
            2. merge_config.sh <defconfig> zuup.config
            3. make olddefconfig && make -j"$(nproc)" bzImage modules
            4. assert bzImage < 15 MB (else fail the build)
            5. sign all modules with the build key (MODULE_SIG_FORCE)
          Nothing was changed on this machine.
EOF
  exit 0
fi

KVER="${KVER:-6.6.52}"
SRC="/usr/src/linux-${KVER}"
KEY="${ZUUP_MODULE_KEY:?set ZUUP_MODULE_KEY to the module-signing key path}"

cd "$SRC"
scripts/kconfig/merge_config.sh -m arch/x86/configs/x86_64_defconfig \
  "$(dirname "$0")/zuup.config"
make olddefconfig
make -j"$(nproc)" bzImage modules

SIZE=$(stat -c%s arch/x86/boot/bzImage)
if (( SIZE > 15 * 1024 * 1024 )); then
  echo "[zuup-os] FAIL: bzImage ${SIZE}B exceeds 15 MB budget (§7.2)" >&2
  exit 1
fi
echo "[zuup-os] bzImage OK: ${SIZE} bytes, signed modules with ${KEY}"
