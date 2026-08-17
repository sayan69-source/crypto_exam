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
  # systemd logs to KMSG, not the console: with multiple console= devices
  # (serial for the QEMU smoke scraper + tty0 for a dev laptop's screen) only
  # the LAST one is /dev/console, so log_target=console would make the boot
  # transcript invisible on the others. kmsg lines are broadcast by the kernel
  # to every registered console. printk.devkmsg=on stops PID1's burst of unit
  # messages being rate-limit dropped. Dev/test builds only — production is
  # console=null and logs nothing anywhere.
  CONSOLE_ARGS="console=${CONSOLE} loglevel=7 systemd.show_status=1 systemd.log_level=info systemd.log_target=kmsg printk.devkmsg=on"
fi

# Per-terminal identity (§7.1), appended by tools/provision-terminal.sh.
#
# `zuup.terminal_id`, `zuup.capability`, `zuup.seat`, `zuup.edge` and (admin
# only) `zuup.hq` ride HERE, inside the UKI, because the UKI is what sbsign
# covers. That makes the cmdline authenticated storage: a terminal's capability
# — and therefore whether it may reach the internet at all — cannot be changed
# without the authority's Secure Boot signing key, no matter what an attacker
# does to the USB stick. It also keeps the rootfs byte-identical across the
# fleet, so provisioning re-signs ~15 MB per machine instead of rebuilding a
# 700 MB squashfs and verity tree per seat.
#
# Nothing secret goes here: /proc/cmdline is world-readable. The WireGuard
# private key stays a file on the ESP.
EXTRA="${ZUUP_EXTRA_CMDLINE:-}"

# The locked cmdline (§7.2): verity-rooted rootfs, kernel lockdown.
#
# `systemd.gpt_auto=0` is DO-NO-HARM, and it is not optional.
#
# systemd's GPT auto-generator discovers root, /home, /srv and swap partitions
# by their GPT type GUIDs on every attached disk and generates mount units for
# them. On a terminal booted from a USB stick, every attached disk includes the
# HOST MACHINE'S INTERNAL DRIVE — so the default behaviour is to find a
# stranger's Windows or Linux install and mount it, and to activate their swap.
# That writes to a disk this image has no business touching, on a machine
# borrowed for an exam.
#
# The rest of the isolation follows from the image rather than from a flag:
# nothing else in fstab names a physical device, no automounter is installed,
# and the root is a verity squashfs opened by hash. This closes the one path
# that would have mounted a host disk without anybody asking for it.
CMDLINE="zuup.roothash=${ROOTHASH} lockdown=confidentiality module.sig_enforce=1 \
systemd.gpt_auto=0 \
slab_nomerge init_on_alloc=1 init_on_free=1 page_alloc.shuffle=1 randomize_kstack_offset=on \
${CONSOLE_ARGS}${EXTRA:+ $EXTRA}"

# Record the exact cmdline next to the UKI. Stage 30 needs it verbatim to
# predict PCR 11 with `systemd-measure calculate` — systemd-stub measures the
# cmdline section, so a reconstruction that differs by one space predicts a
# digest no terminal will ever produce, and the whole estate fails attestation.
printf '%s' "$CMDLINE" > "${OUT}.cmdline"

# The unsigned intermediate goes to a TEMP DIR, not the working directory.
#
# ukify writes its output relative to cwd, so this script silently required the
# caller to be somewhere writable. 30-make-image.sh happens to `cd "$BUILD"`
# first and never noticed; tools/provision-terminal.sh does not, and inside the
# builder container the cwd is the read-only repo mount — so per-terminal
# provisioning died with `OSError: Read-only file system: 'zuup.efi'` from
# inside pefile, several frames below anything that names the real cause.
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

ukify build \
  --linux "$KERNEL" \
  --initrd "$INITRD" \
  --cmdline "$CMDLINE" \
  --output "$WORK/zuup.efi"

sbsign --key "$DB_KEY" --cert "$DB_CRT" --output "$OUT" "$WORK/zuup.efi"
sbverify --cert "$DB_CRT" "$OUT"

echo "[zuup-os] signed UKI OK: $OUT (verity root ${ROOTHASH:0:16}…)"
echo "[zuup-os] next: place $OUT + the squashfs on the Edge PXE share (network/pxe)"
