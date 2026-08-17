#!/usr/bin/env bash
# Watch a PRODUCTION image boot. Diagnostic only — not part of the build.
#
#   MSYS_NO_PATHCONV=1 docker run --rm #     -v "$(pwd -W):/zuup:ro" -v zuup-os-build:/build #     -v "$(cd private/zuup-os/image-build/out-prod && pwd -W):/dist" #     zuup-os-builder /dist/diag-boot.sh
#
# (copy this file into the mounted output dir first; the builder's ENTRYPOINT is
# /bin/bash, so pass a script PATH and not `bash path`.)
#
# The production image is console=null by design, so its QEMU smoke log is
# legitimately empty and the smoke test falls back to "QEMU exited 0 and no
# kiosk appeared" as its fail-closed signal. That is sound as far as it goes,
# but it cannot tell a successful boot that halted at attestation from an
# initramfs verity failure that powered off — both are a clean exit on an empty
# log.
#
# This re-signs the SAME kernel, initramfs and verity root hash with a serial
# console attached, lays them into a throwaway disk image, and boots it, so the
# production boot chain can actually be WATCHED. Nothing here touches the
# shipped image or its manifest.
set -euo pipefail

export ZUUP_DB_KEY=/dist/keys/db.key ZUUP_DB_CRT=/dist/keys/db.crt
export ZUUP_CONSOLE="ttyS0,115200"

# ukify writes its intermediate `zuup.efi` into the CWD, and the repo mounts
# read-only — 30-make-image.sh does `cd "$BUILD"` for exactly this reason.
cd /build

echo "=== re-signing the production artifacts with a console ==="
OUT=/build/zuup-diag.efi bash /zuup/private/zuup-os/boot/secureboot/sign-image.sh \
  /build/bzImage /build/zuup-initramfs.cpio.gz /build/zuup-root.squashfs.roothash | tail -1
echo "--- cmdline ---"
cat /build/zuup-diag.efi.cmdline; echo; echo

echo "=== assembling a throwaway disk image around it ==="
SQ=/build/zuup-root.squashfs
VT=/build/zuup-root.squashfs.verity
UKI=/build/zuup-diag.efi
align() { echo $(( ( ($1 + 1048575) / 1048576 ) * 1048576 )); }
ESP_BYTES=$(align $(( $(stat -c%s "$UKI") + 8*1048576 )) )
(( ESP_BYTES < 48*1048576 )) && ESP_BYTES=$(( 48*1048576 ))
SQ_BYTES=$(align "$(stat -c%s "$SQ")"); VT_BYTES=$(align "$(stat -c%s "$VT")")
START=1048576
IMG=/build/zuup-diag.img
TOTAL=$(( START + ESP_BYTES + SQ_BYTES + VT_BYTES + 1048576 ))
rm -f "$IMG"; truncate -s "$TOTAL" "$IMG"

ESP=/build/diag-esp.img; rm -f "$ESP"; truncate -s "$ESP_BYTES" "$ESP"
mkfs.fat -F32 -n ZUUPESP "$ESP" >/dev/null
mmd -i "$ESP" ::/EFI ::/EFI/BOOT
mcopy -i "$ESP" "$UKI" ::/EFI/BOOT/BOOTX64.EFI

sfdisk --quiet --label gpt "$IMG" <<EOF
start=$((START/512)), size=$((ESP_BYTES/512)), type=U, name="EFI System"
start=$(((START+ESP_BYTES)/512)), size=$((SQ_BYTES/512)), type=0FC63DAF-8483-4772-8E79-3D69D8477DE4, name="zuup-root"
start=$(((START+ESP_BYTES+SQ_BYTES)/512)), size=$((VT_BYTES/512)), type=0FC63DAF-8483-4772-8E79-3D69D8477DE4, name="zuup-hash"
EOF
dd if="$ESP" of="$IMG" bs=1M seek=$((START/1048576)) conv=notrunc status=none
dd if="$SQ" of="$IMG" bs=1M seek=$(((START+ESP_BYTES)/1048576)) conv=notrunc status=none
dd if="$VT" of="$IMG" bs=1M seek=$(((START+ESP_BYTES+SQ_BYTES)/1048576)) conv=notrunc status=none

echo "=== booting it (300s budget) ==="
# Same firmware discovery the real smoke stage uses — Debian ships the 4M
# variants under either name depending on release.
# `|| true` is load-bearing under `set -o pipefail`: only one of each pair of
# filenames exists, so `ls a b` always reports failure and would kill the script
# with no message at all. The real smoke stage has the same guard.
OVMF_CODE=$(ls /usr/share/OVMF/OVMF_CODE_4M.fd /usr/share/OVMF/OVMF_CODE.fd 2>/dev/null | head -1 || true)
OVMF_VARS_SRC=$(ls /usr/share/OVMF/OVMF_VARS_4M.fd /usr/share/OVMF/OVMF_VARS.fd 2>/dev/null | head -1 || true)
[[ -n "$OVMF_CODE" && -n "$OVMF_VARS_SRC" ]] || { echo "OVMF firmware not found" >&2; exit 1; }
cp "$OVMF_VARS_SRC" /build/diag-vars.fd
SERIAL=/dist/diag-serial.log
rm -f "$SERIAL"
set +e
timeout 300 qemu-system-x86_64 \
  -machine q35,accel=tcg -m 2048 -smp 2 -no-reboot -nographic \
  -drive if=pflash,format=raw,unit=0,readonly=on,file="$OVMF_CODE" \
  -drive if=pflash,format=raw,unit=1,file=/build/diag-vars.fd \
  -drive file="$IMG",format=raw,if=virtio \
  -serial file:"$SERIAL" -display none
RC=$?
set -e
echo "qemu exit=$RC"
echo "=== serial log ($(wc -c < "$SERIAL") bytes) ==="
