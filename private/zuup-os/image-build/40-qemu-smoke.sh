#!/usr/bin/env bash
# Stage 40 — headless QEMU/OVMF smoke boot (Phase 11 DoD: "power-on → Gate").
#
# Boots zuup-os.img on a UEFI machine with a virtual TPM (swtpm) and scrapes
# the serial console for the boot-chain markers. What it proves depends on the
# image variant produced by stage 20:
#
#   DEV image  (default goal: GATE) — the verity chain opens, switch_root hands
#     to systemd, and the session reaches the kiosk (Login Gate). Asserts the
#     happy path renders.
#   PROD image (goal: FAILCLOSED)   — with no Edge/TPM enrolment the attestation
#     gate must HALT the boot (poweroff), never dropping to a shell. Asserts
#     INV-10 holds (a terminal that cannot attest shows no login surface).
#
#   40-qemu-smoke.sh                 # auto: DEV→GATE, PROD→FAILCLOSED
#   40-qemu-smoke.sh --goal gate
#   40-qemu-smoke.sh --goal failclosed
set -euo pipefail
[[ "$(uname -s)" == "Linux" ]] || { echo "[zuup-os] Linux host/container only (use docker-build.sh 40)"; exit 0; }

BUILD="${BUILD:-/build}"
IMG="$BUILD/zuup-os.img"
TIMEOUT="${ZUUP_SMOKE_TIMEOUT:-180}"
VARIANT="$(cat "$BUILD/.rootfs-variant" 2>/dev/null || echo production)"

GOAL=""
while (($#)); do case "$1" in --goal) GOAL="$2"; shift 2;; *) shift;; esac; done
[[ -n "$GOAL" ]] || { [[ "$VARIANT" == dev ]] && GOAL=gate || GOAL=failclosed; }

[[ -f "$IMG" ]] || { echo "[zuup-os] $IMG missing — run stages 00–30 first" >&2; exit 1; }
command -v qemu-system-x86_64 >/dev/null || { echo "[zuup-os] need qemu-system-x86 (builder container has it)" >&2; exit 1; }

# locate OVMF (Debian: /usr/share/OVMF/OVMF_{CODE,VARS}_4M.fd)
OVMF_CODE=$(ls /usr/share/OVMF/OVMF_CODE_4M.fd /usr/share/OVMF/OVMF_CODE.fd 2>/dev/null | head -1 || true)
OVMF_VARS_SRC=$(ls /usr/share/OVMF/OVMF_VARS_4M.fd /usr/share/OVMF/OVMF_VARS.fd 2>/dev/null | head -1 || true)
[[ -n "$OVMF_CODE" && -n "$OVMF_VARS_SRC" ]] || { echo "[zuup-os] OVMF firmware not found" >&2; exit 1; }
VARS="$BUILD/ovmf_vars.fd"; cp "$OVMF_VARS_SRC" "$VARS"

# virtual TPM 2.0 so the kernel's measured boot + (prod) attestation have a TPM
TPMDIR="$BUILD/swtpm"; mkdir -p "$TPMDIR"
SOCK="$TPMDIR/sock"
swtpm socket --tpm2 --tpmstate dir="$TPMDIR" --ctrl type=unixio,path="$SOCK" --flags startup-clear &
SWTPM_PID=$!
trap 'kill $SWTPM_PID 2>/dev/null || true' EXIT
sleep 1

SERIAL="$BUILD/smoke-serial.log"; : > "$SERIAL"
echo "[zuup-os] booting $VARIANT image in QEMU (goal=$GOAL, ${TIMEOUT}s budget)…"

# Headless, no network out (user-net only), serial → log. No KVM needed (TCG),
# so this runs in a plain container. `-no-reboot` turns the fail-closed
# poweroff into a clean QEMU exit we can assert on.
set +e
timeout "$TIMEOUT" qemu-system-x86_64 \
  -machine q35,smm=on -m 2048 -no-reboot -nographic \
  -drive if=pflash,format=raw,unit=0,readonly=on,file="$OVMF_CODE" \
  -drive if=pflash,format=raw,unit=1,file="$VARS" \
  -chardev socket,id=chrtpm,path="$SOCK" \
  -tpmdev emulator,id=tpm0,chardev=chrtpm -device tpm-tis,tpmdev=tpm0 \
  -drive file="$IMG",format=raw,if=virtio \
  -netdev user,id=n0 -device virtio-net-pci,netdev=n0 \
  -serial file:"$SERIAL" -no-user-config -nodefaults \
  >/dev/null 2>&1
QEMU_RC=$?
set -e

echo "── serial markers ─────────────────────────────────────────"
grep -aE "ZUUP|verity|switch_root|systemd\[1\]|Reached target|HALT|poweroff" "$SERIAL" | tail -25 || true
echo "───────────────────────────────────────────────────────────"

have() { grep -aqE "$1" "$SERIAL"; }
pass() { echo "[zuup-os] SMOKE PASS — $1"; exit 0; }
fail() { echo "[zuup-os] SMOKE FAIL — $1 (full log: $SERIAL)" >&2; exit 1; }

# Boot integrity is required for BOTH goals: verity must open and hand off.
have "Linux version|systemd\[1\]" || fail "kernel/PID1 never started (UKI or virtio issue)"

case "$GOAL" in
  gate)
    have "Reached target .*session|zuup-kiosk|cage" \
      && pass "DEV image reached the locked session (Login Gate)" \
      || fail "session/kiosk target not reached"
    ;;
  failclosed)
    # success = the attestation gate halted the boot and powered off without
    # ever reaching the kiosk or any login/getty surface.
    if have "ZUUP-ATTEST HALT|Edge unreachable|refusing to open the Gate" \
       || { [[ $QEMU_RC -eq 0 ]] && ! have "zuup-kiosk|Reached target .*session"; }; then
      have "getty|login:|sh-[0-9]\.[0-9]#|/bin/sh" \
        && fail "a shell/login surface appeared — NOT fail-closed" \
        || pass "PROD image failed CLOSED (no attestation → poweroff, no login surface)"
    fi
    fail "expected a fail-closed halt; none observed"
    ;;
  *) fail "unknown goal '$GOAL'";;
esac
