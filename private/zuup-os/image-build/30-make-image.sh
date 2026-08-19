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
BUILD_VARIANT="$(cat "$BUILD/.rootfs-variant" 2>/dev/null || echo production)"
if [[ -z "${ZUUP_DB_KEY:-}" || -z "${ZUUP_DB_CRT:-}" ]]; then
  # A production image signed with a throwaway key is a terminal whose boot
  # chain anyone can forge — and the whole §7.1 argument, from Secure Boot down
  # through the per-terminal identity on the signed cmdline, rests on that key
  # being the authority's. There is no warning strong enough for this; it has to
  # be a refusal.
  if [[ "$BUILD_VARIANT" == "production" ]]; then
    cat >&2 <<'EOF'
[zuup-os] FAIL: this is a PRODUCTION build and no Secure Boot signing key was given.

          Set ZUUP_DB_KEY and ZUUP_DB_CRT to the exam authority's db key (an HSM
          PKCS#11 URI, or a path on the offline key-ceremony host). Ephemeral DEV
          keys are generated only for dev/all-in-one builds, and a terminal that
          trusted one would accept a UKI signed by anybody.

          To produce a signable key hierarchy: boot/secureboot/make-keys.sh
EOF
    exit 1
  fi
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
# The BIOS path needs the kernel and initrd as SEPARATE files beside the UKI
# (syslinux cannot unpack a UKI), so the floor covers both payloads.
ESP_MIN=$(( 96*1048576 ))
(( ESP_BYTES < ESP_MIN )) && ESP_BYTES=$ESP_MIN
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

# ── the BIOS half of a dual-firmware image (§7.1a) ─────────────────────────
#
# An exam centre is not a fleet. It runs machines bought across a decade, and a
# good share of the older ones have no UEFI at all — on those, a UEFI-only image
# does not fail informatively, it simply never starts. So the same stick carries
# a legacy loader in the same FAT partition.
#
# What BIOS costs, stated plainly: there is no Secure Boot on this path, so
# nothing verifies the kernel, the initrd or the cmdline. An attacker holding the
# stick can edit syslinux.cfg. That is why zuup-identity.sh refuses ADMIN_STATION
# and drops zuup.hq unless it can confirm a Secure Boot verified boot — a
# BIOS-booted machine is a candidate seat and nothing more, whatever its cmdline
# claims. dm-verity still protects the rootfs; what is lost is the guarantee that
# the ROOT HASH itself was not swapped, which is precisely why the capability
# gate exists.
if command -v syslinux >/dev/null 2>&1; then
  echo "[zuup-os] adding the legacy-BIOS loader (syslinux) to the ESP…"
  mmd -i "$ESP" ::/syslinux
  mcopy -i "$ESP" "$BUILD/bzImage"                ::/syslinux/vmlinuz
  mcopy -i "$ESP" "$BUILD/zuup-initramfs.cpio.gz" ::/syslinux/initrd.img

  # The SAME cmdline the UKI carries, so both firmwares boot an identical system.
  # Read from the file the signer recorded rather than reconstructed here: a
  # cmdline that differs between the two paths is two different machines.
  BIOS_CMDLINE="$(cat "${UKI}.cmdline" 2>/dev/null || true)"
  [[ -n "$BIOS_CMDLINE" ]] || { echo "[zuup-os] FAIL: no recorded cmdline for the BIOS path" >&2; exit 1; }

  cat > "$BUILD/syslinux.cfg" <<SYSCFG
DEFAULT zuup
PROMPT 0
TIMEOUT 10
LABEL zuup
  LINUX /syslinux/vmlinuz
  INITRD /syslinux/initrd.img
  APPEND ${BIOS_CMDLINE}
SYSCFG
  mcopy -i "$ESP" "$BUILD/syslinux.cfg" ::/syslinux/syslinux.cfg

  # Install the FAT bootloader into the filesystem image itself.
  syslinux --install --directory /syslinux "$ESP"
else
  echo "[zuup-os] ⚠ syslinux absent — this image is UEFI-ONLY and will not boot" >&2
  echo "[zuup-os]   on a legacy-BIOS machine. Rebuild the builder container." >&2
fi

sfdisk --quiet --label gpt "$IMG" <<EOF
start=$((START/512)),       size=$((ESP_BYTES/512)), type=U,                                       name="EFI System"
start=$(((START+ESP_BYTES)/512)),          size=$((SQ_BYTES/512)), type=0FC63DAF-8483-4772-8E79-3D69D8477DE4, name="zuup-root"
start=$(((START+ESP_BYTES+SQ_BYTES)/512)), size=$((VT_BYTES/512)), type=0FC63DAF-8483-4772-8E79-3D69D8477DE4, name="zuup-hash"
EOF

dd if="$ESP" of="$IMG" bs=1M seek=$((START/1048576))                       conv=notrunc status=none
dd if="$SQ"  of="$IMG" bs=1M seek=$(((START+ESP_BYTES)/1048576))           conv=notrunc status=none
dd if="$VT"  of="$IMG" bs=1M seek=$(((START+ESP_BYTES+SQ_BYTES)/1048576))  conv=notrunc status=none
rm -f "$ESP"

# ── hybrid MBR: make ONE image bootable by both firmwares ──────────────────
#
# sfdisk wrote a GPT with a PROTECTIVE MBR — a single 0xEE entry whose entire
# purpose is to stop legacy tools touching the disk. A BIOS looks at that, finds
# nothing it recognises as bootable, and moves on. UEFI reads the GPT and is
# unaffected by what the MBR says.
#
# So the MBR is rewritten as a HYBRID: slot 1 becomes a real, bootable FAT32
# entry pointing at the ESP (which is where syslinux now lives), and the 0xEE
# protective entry moves to slot 2 so GPT-aware tools still see the disk is
# GPT-managed. The GPT itself is untouched, so the UEFI path is unchanged.
if command -v syslinux >/dev/null 2>&1; then
  MBR_BIN="$(ls /usr/lib/syslinux/mbr/mbr.bin /usr/lib/SYSLINUX/mbr.bin 2>/dev/null | head -1 || true)"
  if [[ -n "$MBR_BIN" ]]; then
    python3 - "$IMG" "$MBR_BIN" "$((START/512))" "$((ESP_BYTES/512))" <<'HYBRID'
import sys, struct
img, mbr_bin, esp_lba, esp_sectors = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])

def entry(boot, ptype, lba, count):
    # CHS is 0xFEFFFF ("use LBA") — every firmware that can boot a USB stick
    # reads LBA, and computing real CHS for a modern disk is meaningless.
    return struct.pack("<B3sB3sII", boot, b"þÿÿ", ptype, b"þÿÿ", lba, count)

with open(img, "r+b") as f:
    code = open(mbr_bin, "rb").read()[:440]
    f.seek(0); f.write(code)                       # boot code only; disk sig at 440 survives
    f.seek(446)
    f.write(entry(0x80, 0x0C, esp_lba, esp_sectors))   # bootable FAT32 → the ESP
    total = f.seek(0, 2) // 512
    f.seek(446 + 16)
    f.write(entry(0x00, 0xEE, 1, total - 1))           # protective, so GPT tools still behave
    f.seek(510); f.write(b"Uª")
print("[zuup-os] hybrid MBR written (slot1 bootable FAT32, slot2 0xEE protective)")
HYBRID
  else
    echo "[zuup-os] ⚠ syslinux mbr.bin not found — BIOS machines will not boot this image." >&2
  fi
fi

# ── 6. a note on the PCR reference (§7.1) ───────────────────────────────────
#
# No fleet-wide PCR reference is emitted here, and that is deliberate rather
# than an omission.
#
# The obvious move is to run `systemd-measure calculate` over this UKI and ship
# the resulting PCR 11 as "the value every terminal must report". It would be
# wrong. systemd-stub measures the UKI's cmdline SECTION into PCR 11, and
# provisioning gives every terminal its own cmdline — its id, its capability,
# its seat (tools/provision-terminal.sh). So PCR 11 differs per machine by
# construction, and PCR 4 (the firmware's measurement of the whole UKI) differs
# with it. A single value published from this stage would match the image
# nobody boots and deny the entire estate on exam morning.
#
# The prediction therefore belongs where the per-terminal UKI is produced, and
# that is where it happens: provision-terminal.sh runs systemd-measure against
# the exact cmdline it just signed and records the expected PCR 11 in that
# terminal's registry record. The property is preserved — the image-determined
# measurement is COMPUTED BY THE AUTHORITY from a signed artifact, never taken
# from what the machine reported about itself — and it is per terminal, which is
# what the boot chain actually produces.
#
# `EDGE_FLEET_PCR` on the Edge remains available for genuinely estate-uniform
# values, should a deployment ever ship one identical UKI to every seat.

VARIANT="$(cat "$BUILD/.rootfs-variant" 2>/dev/null || echo production)"
echo "[zuup-os] image OK: $IMG ($(numfmt --to=iec "$TOTAL"), variant=$VARIANT)"
echo "[zuup-os]   write to a terminal stick:  dd if=$IMG of=/dev/sdX bs=4M oflag=direct"
echo "[zuup-os]   or smoke-boot in QEMU:        ./40-qemu-smoke.sh"
