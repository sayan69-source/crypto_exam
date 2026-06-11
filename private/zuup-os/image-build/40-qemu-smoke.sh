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

# Headless but WITH a virtio-GPU: -nodefaults strips the default display
# adapter, and the kiosk compositor (Cage) needs a DRM node to open. A
# virtio-gpu-pci + the in-kernel DRM_VIRTIO_GPU driver give it /dev/dri/card0
# while -display none keeps it windowless. Serial → log; no KVM (TCG) so this
# runs in a plain container. `-no-reboot` turns the fail-closed poweroff into a
# clean QEMU exit we can assert on.
set +e
timeout "$TIMEOUT" qemu-system-x86_64 \
  -machine q35,smm=on -m 2048 -no-reboot -display none \
  -drive if=pflash,format=raw,unit=0,readonly=on,file="$OVMF_CODE" \
  -drive if=pflash,format=raw,unit=1,file="$VARS" \
  -chardev socket,id=chrtpm,path="$SOCK" \
  -tpmdev emulator,id=tpm0,chardev=chrtpm -device tpm-tis,tpmdev=tpm0 \
  -drive file="$IMG",format=raw,if=virtio \
  -netdev user,id=n0 -device virtio-net-pci,netdev=n0 \
  -device virtio-gpu-pci \
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

# A dependency/unit failure anywhere on the session path is a HARD fail. This
# must be checked BEFORE the success patterns: the failure lines themselves
# contain unit names ("Dependency failed for zuup-kiosk…"), so a naive
# substring match on the unit name would otherwise read a failure as a pass.
if grep -aqE "Dependency failed for (zuup-session|zuup-kiosk|zuup-network)|Failed to start zuup-(firewall|wireguard|kiosk)" "$SERIAL"; then
  echo "── failing units ──" >&2
  grep -aE "Dependency failed|Failed to start zuup" "$SERIAL" | sed -E 's/\x1b\[[0-9;:]*m//g' | sort -u >&2
  fail "a unit on the session path failed (see above)"
fi

case "$GOAL" in
  gate)
    # Require a POSITIVE start — and match systemd's console text, which prints
    # the unit DESCRIPTION, not the unit id ("Reached target ZUUP-OS locked
    # examination session", "Started ZUUP-OS locked examination surface").
    if have "Reached target .*[Ee]xamination session|Started .*locked examination surface"; then
      pass "DEV image reached zuup-session.target (Gate surface launched)"
    fi
    fail "zuup-session.target never reached a Started/Reached state"
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
