#!/usr/bin/env bash
# Stage 30 — seal the rootfs and assemble the bootable image (spec §7.1/§7.3).
#
# Chains the three authored build artifacts (their Linux host-guards pass inside
# the builder container, so they run for real here):
#   rootfs/build-image.sh   → squashfs + dm-verity tree + root hash (<300 MB)
#   boot/initramfs/mkinitramfs.sh → tiny cpio.gz (busybox + veritysetup + /init)
#   boot/secureboot/sign-image.sh → ukify(kernel+initrd+cmdline) → sbsign UKI
# then lays the UKI (ESP) + squashfs (part 2) + verity tree (part 3) into a GPT
# disk image WITHOUT privilege — no loop devices, no mounts (mtools + sfdisk).
#
# Signing keys: production passes ZUUP_DB_KEY/ZUUP_DB_CRT (HSM). With neither
# set, ephemeral DEV Secure Boot keys are generated under $BUILD/keys and a
# loud warning is printed — those keys must NEVER enrol on a real terminal.
set -euo pipefail
[[ "$(uname -s)" == "Linux" ]] || { echo "[zuup-os] Linux build host only (use docker-build.sh)"; exit 0; }

BUILD="${BUILD:-/build}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ZOS="${ZUUP_OS_DIR:-$(cd "$HERE/.." && pwd)}"
ROOT="$BUILD/rootfs"
cd "$BUILD"

[[ -d "$ROOT" ]]       || { echo "[zuup-os] rootfs missing — run stage 20" >&2; exit 1; }
[[ -f "$BUILD/bzImage" ]] || { echo "[zuup-os] bzImage missing — run stage 10" >&2; exit 1; }

# ── 1. squashfs + dm-verity + root hash (the authored §7.3 sealer) ─────────
# A face-enabled rootfs (stage 20) raises the size ceiling via the state file.
if [[ -f "$BUILD/.image-max-mb" ]]; then
  export ZUUP_IMAGE_MAX_MB="$(cat "$BUILD/.image-max-mb")"
fi
echo "[zuup-os] sealing rootfs → squashfs + dm-verity (budget ${ZUUP_IMAGE_MAX_MB:-300} MB)…"
OUT="$BUILD/zuup-root.squashfs" bash "$ZOS/rootfs/build-image.sh" "$ROOT"
ROOTHASH_FILE="$BUILD/zuup-root.squashfs.roothash"
[[ -s "$ROOTHASH_FILE" ]] || { echo "[zuup-os] no roothash produced" >&2; exit 1; }

# ── 2. initramfs (busybox.static + veritysetup + the verity /init) ─────────
echo "[zuup-os] assembling initramfs…"
BBOX="$(command -v busybox)"          # busybox-static → /bin/busybox (static)
VSETUP="$(command -v veritysetup)"    # cryptsetup-bin → /sbin/veritysetup
OUT="$BUILD/zuup-initramfs.cpio.gz" bash "$ZOS/boot/initramfs/mkinitramfs.sh" "$BBOX" "$VSETUP"

# ── 3. Secure Boot signing keys (production HSM, else ephemeral DEV) ────────
if [[ -z "${ZUUP_DB_KEY:-}" || -z "${ZUUP_DB_CRT:-}" ]]; then
  echo "[zuup-os] ⚠ no ZUUP_DB_KEY/ZUUP_DB_CRT — generating EPHEMERAL DEV keys." >&2
  echo "[zuup-os] ⚠ DEV keys must NEVER be enrolled on real terminal firmware." >&2
  mkdir -p "$BUILD/keys"
  if [[ ! -f "$BUILD/keys/db.key" ]]; then
    openssl req -newkey rsa:4096 -nodes -keyout "$BUILD/keys/db.key" \
      -new -x509 -sha256 -days 30 -subj "/CN=ZUUP-OS DEV (DO NOT ENROL)/" \
      -out "$BUILD/keys/db.crt" 2>/dev/null
  fi
  export ZUUP_DB_KEY="$BUILD/keys/db.key" ZUUP_DB_CRT="$BUILD/keys/db.crt"
fi

# ── 4. UKI: kernel + initramfs + locked cmdline(verity hash), sbsigned ─────
# Dev images get an observable console; production stays console=null. Log to
# the laptop SCREEN (tty0) AND serial — tty0 listed last so it's the primary
# console, so a real machine with no serial port still shows the full boot
# sequence and any failure on its own display.
VARIANT="$(cat "$BUILD/.rootfs-variant" 2>/dev/null || echo production)"
if [[ "$VARIANT" == dev ]]; then
  export ZUUP_CONSOLE="${ZUUP_CONSOLE:-ttyS0,115200 console=tty0}"
fi
echo "[zuup-os] building + signing the Unified Kernel Image (variant=$VARIANT)…"
OUT="$BUILD/zuup.efi.signed" bash "$ZOS/boot/secureboot/sign-image.sh" \
  "$BUILD/bzImage" "$BUILD/zuup-initramfs.cpio.gz" "$ROOTHASH_FILE"
UKI="$BUILD/zuup.efi.signed"

# ── 5. assemble the GPT disk image — unprivileged (mtools + sfdisk + dd) ────
#   p1 ESP (FAT32, /EFI/BOOT/BOOTX64.EFI = the signed UKI)
#   p2 zuup-root  : the squashfs   (initramfs find_part 2)
#   p3 zuup-hash  : the verity tree (initramfs find_part 3)
echo "[zuup-os] assembling GPT image (no privilege, no loop mounts)…"
SQ="$BUILD/zuup-root.squashfs"; VT="$BUILD/zuup-root.squashfs.verity"
align() { echo $(( ( ($1 + 1048575) / 1048576 ) * 1048576 )); }   # → 1 MiB
# Floor the ESP at 48 MiB: enough FAT32 clusters to clear the spec minimum and
# leave room to drop in a per-terminal re-signed UKI at provisioning time.
ESP_BYTES=$(align $(( $(stat -c%s "$UKI") + 8*1048576 )) )
(( ESP_BYTES < 48*1048576 )) && ESP_BYTES=$(( 48*1048576 ))
SQ_BYTES=$(align $(stat -c%s "$SQ")); VT_BYTES=$(align $(stat -c%s "$VT"))
START=1048576
IMG="$BUILD/zuup-os.img"
TOTAL=$(( START + ESP_BYTES + SQ_BYTES + VT_BYTES + 1048576 ))
rm -f "$IMG"; truncate -s "$TOTAL" "$IMG"

# build the FAT ESP in a file, copy the UKI in, then place it into the image
ESP="$BUILD/esp.img"; rm -f "$ESP"; truncate -s "$ESP_BYTES" "$ESP"
mkfs.fat -F32 -n ZUUPESP "$ESP" >/dev/null
mmd   -i "$ESP" ::/EFI ::/EFI/BOOT
mcopy -i "$ESP" "$UKI" ::/EFI/BOOT/BOOTX64.EFI

sfdisk --quiet --label gpt "$IMG" <<EOF
start=$((START/512)),       size=$((ESP_BYTES/512)), type=U,                                       name="EFI System"
start=$(((START+ESP_BYTES)/512)),          size=$((SQ_BYTES/512)), type=0FC63DAF-8483-4772-8E79-3D69D8477DE4, name="zuup-root"
start=$(((START+ESP_BYTES+SQ_BYTES)/512)), size=$((VT_BYTES/512)), type=0FC63DAF-8483-4772-8E79-3D69D8477DE4, name="zuup-hash"
EOF

dd if="$ESP" of="$IMG" bs=1M seek=$((START/1048576))                       conv=notrunc status=none
dd if="$SQ"  of="$IMG" bs=1M seek=$(((START+ESP_BYTES)/1048576))           conv=notrunc status=none
dd if="$VT"  of="$IMG" bs=1M seek=$(((START+ESP_BYTES+SQ_BYTES)/1048576))  conv=notrunc status=none
rm -f "$ESP"

VARIANT="$(cat "$BUILD/.rootfs-variant" 2>/dev/null || echo production)"
echo "[zuup-os] image OK: $IMG ($(numfmt --to=iec "$TOTAL"), variant=$VARIANT)"
echo "[zuup-os]   write to a terminal stick:  dd if=$IMG of=/dev/sdX bs=4M oflag=direct"
echo "[zuup-os]   or smoke-boot in QEMU:        ./40-qemu-smoke.sh"
