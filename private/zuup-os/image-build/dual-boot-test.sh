#!/usr/bin/env bash
# Boot the SAME image under both firmwares. Diagnostic; not part of the build.
#
#   MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/zuup:ro" \
#     -v zuup-os-build:/build -v "$(cd out-prod && pwd -W):/dist" \
#     zuup-os-builder /dist/dual-boot-test.sh
#
# Why this exists: "boots on any machine" is a claim about TWO firmwares, and
# stage 40 only ever exercises one. A UEFI-only regression in the hybrid MBR
# would leave the UEFI smoke test perfectly green while every legacy-BIOS
# machine in the estate silently fails to start.
#
# Production is console=null, so both paths are mute by design. The BIOS path
# reads syslinux.cfg from the FAT partition, which is NOT signed — so this test
# patches a console into it. That is convenient here and it is also precisely the
# tamper surface the capability gate in zuup-identity.sh exists to neutralise:
# anyone can rewrite this file, which is why a BIOS boot is never trusted with
# ADMIN_STATION.
set -euo pipefail

IMG_SRC="${1:-/build/zuup-os.img}"
[[ -r "$IMG_SRC" ]] || { echo "no image at $IMG_SRC" >&2; exit 1; }

OVMF_CODE=$(ls /usr/share/OVMF/OVMF_CODE_4M.fd /usr/share/OVMF/OVMF_CODE.fd 2>/dev/null | head -1 || true)
OVMF_VARS=$(ls /usr/share/OVMF/OVMF_VARS_4M.fd /usr/share/OVMF/OVMF_VARS.fd 2>/dev/null | head -1 || true)

echo "=== image layout ==="
fdisk -l "$IMG_SRC" 2>/dev/null | sed -n '1,20p'
echo
echo "=== MBR slot 1 (must be bootable 0x0c for BIOS) ==="
python3 - "$IMG_SRC" <<'PYX'
import sys, struct
f = open(sys.argv[1], "rb"); f.seek(446)
for i in range(2):
    boot, _, ptype, _, lba, cnt = struct.unpack("<B3sB3sII", f.read(16))
    print(f"  slot{i+1}: boot=0x{boot:02x} type=0x{ptype:02x} lba={lba} sectors={cnt}")
PYX

run_boot () {   # name  extra-qemu-args...
  local name="$1"; shift
  local work="/tmp/${name}.img" serial="/dist/boot-${name}.log"
  cp "$IMG_SRC" "$work"
  # Patch a console into the BIOS loader config so the run is observable.
  if [[ "$name" == "bios" ]]; then
    mcopy -i "$work"@@1048576 ::/syslinux/syslinux.cfg /tmp/scfg 2>/dev/null || true
    if [[ -s /tmp/scfg ]]; then
      sed -i 's/console=null quiet loglevel=0/console=ttyS0,115200 loglevel=7/' /tmp/scfg
      mcopy -o -i "$work"@@1048576 /tmp/scfg ::/syslinux/syslinux.cfg
    else
      echo "  (could not read syslinux.cfg — BIOS payload may be missing)" >&2
    fi
  fi
  rm -f "$serial"
  set +e
  timeout 240 qemu-system-x86_64 -machine q35,accel=tcg -m 2048 -smp 2 \
    -no-reboot -nographic -display none \
    -drive file="$work",format=raw,if=virtio \
    -serial file:"$serial" "$@"
  local rc=$?
  set -e
  echo "  qemu rc=$rc   serial=$(wc -c < "$serial" 2>/dev/null || echo 0) bytes"
}

echo
echo "=== BIOS (SeaBIOS — no pflash) ==="
run_boot bios

echo
echo "=== UEFI (OVMF) ==="
cp "$OVMF_VARS" /tmp/vars.fd
run_boot uefi \
  -drive if=pflash,format=raw,unit=0,readonly=on,file="$OVMF_CODE" \
  -drive if=pflash,format=raw,unit=1,file=/tmp/vars.fd
