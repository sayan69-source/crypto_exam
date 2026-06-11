#!/usr/bin/env bash
# ZUUP-OS image signer (spec §7.1, Phase 11) — the step build-image.sh hands to.
#
# Assembles and signs the ONE bootable object a terminal will accept: a Unified
# Kernel Image (UKI) that binds kernel + initramfs + cmdline together, where
# the cmdline carries the dm-verity ROOT HASH of the SquashFS. Because the
# root hash is inside the signed UKI, changing a single byte of the rootfs
# breaks the verity tree, and changing the recorded hash breaks the UKI
# signature: the chain UEFI→UKI→verity→squashfs is closed end to end.
#
# Run ONLY on the air-gapped build host, with the db key in the HSM.
set -euo pipefail

# ── host guard ──────────────────────────────────────────────────────────────
if [[ "$(uname -s)" != "Linux" ]] || ! command -v sbsign >/dev/null 2>&1; then
  cat <<'EOF'
[zuup-os] Build-host artifact (needs Linux + sbsigntools/systemd-ukify); not running here.
          On the build host it would, in order:
            1. read the verity root hash produced by rootfs/build-image.sh
            2. compose the locked kernel cmdline (verity hash, lockdown, quiet)
            3. ukify: kernel + initramfs + cmdline + os-release → zuup.efi
            4. sbsign zuup.efi with the db key (HSM) → zuup.efi.signed
            5. sbverify against db.crt (fail the build on any mismatch)
            6. emit the PXE payload: zuup.efi.signed + zuup-root.squashfs
          Nothing was changed on this machine.
EOF
  exit 0
fi

KERNEL="${1:?usage: sign-image.sh <bzImage> <initramfs.cpio.gz> <squashfs.roothash>}"
INITRD="${2:?missing initramfs}"
ROOTHASH_FILE="${3:?missing .roothash file from build-image.sh}"
DB_KEY="${ZUUP_DB_KEY:?set ZUUP_DB_KEY (HSM PKCS#11 URI or key path)}"
DB_CRT="${ZUUP_DB_CRT:?set ZUUP_DB_CRT (db.crt path)}"
OUT="${OUT:-zuup.efi.signed}"

ROOTHASH="$(grep -Eo '[0-9a-f]{64}' "$ROOTHASH_FILE" | head -1)"
[[ -n "$ROOTHASH" ]] || { echo "[zuup-os] FAIL: no root hash in $ROOTHASH_FILE" >&2; exit 1; }

# Console policy: production is SILENT (console=null — a terminal shows no
# kernel text, ever). A dev/test build may route the console to serial via
# ZUUP_CONSOLE=ttyS0,115200 so QEMU smoke boots are observable; the variable
# has no effect on production builds, which never set it.
CONSOLE="${ZUUP_CONSOLE:-null}"
if [[ "$CONSOLE" == "null" ]]; then
  CONSOLE_ARGS="console=null quiet loglevel=0"
else
  CONSOLE_ARGS="console=${CONSOLE} loglevel=7 systemd.show_status=1 systemd.log_level=info systemd.log_target=console"
fi

# The locked cmdline (§7.2): verity-rooted rootfs, kernel lockdown.
CMDLINE="zuup.roothash=${ROOTHASH} lockdown=confidentiality module.sig_enforce=1 \
slab_nomerge init_on_alloc=1 init_on_free=1 page_alloc.shuffle=1 randomize_kstack_offset=on \
${CONSOLE_ARGS}"

ukify build \
  --linux "$KERNEL" \
  --initrd "$INITRD" \
  --cmdline "$CMDLINE" \
  --output zuup.efi

sbsign --key "$DB_KEY" --cert "$DB_CRT" --output "$OUT" zuup.efi
sbverify --cert "$DB_CRT" "$OUT"

echo "[zuup-os] signed UKI OK: $OUT (verity root ${ROOTHASH:0:16}…)"
echo "[zuup-os] next: place $OUT + the squashfs on the Edge PXE share (network/pxe)"
