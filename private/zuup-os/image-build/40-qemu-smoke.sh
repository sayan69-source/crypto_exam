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
# ── Why a production run boots TWICE ────────────────────────────────────────
#
# A production image is `console=null` by design, so its serial log is
# legitimately EMPTY and the only signal left is "QEMU exited 0 and no kiosk
# appeared". That cannot tell a good boot that halted at attestation from an
# initramfs verity failure that powered off — both are a clean exit on an empty
# log. Every production SMOKE PASS before 2026-08-21 was that weak, and it hid
# two real defects until someone re-signed the image by hand to watch it.
#
# So a production run now does an OBSERVED boot first: the SAME bzImage,
# initramfs and verity root hash, re-signed with a serial console attached and
# laid into a throwaway disk, booted, and asserted marker by marker —
#   verity opens → switch_root → PID 1 → identity → firewall → survey sees the
#   TPM → fail-closed, no login surface, machine powers itself off.
# The observed UKI's cmdline is diffed against the shipped one so the run cannot
# quietly drift from what a terminal will actually execute. Only then is the
# real, silent, shipped image booted for the exit-code check.
#
#   40-qemu-smoke.sh                 # auto: DEV→GATE, PROD→FAILCLOSED
#   40-qemu-smoke.sh --goal gate
#   40-qemu-smoke.sh --goal failclosed
#   40-qemu-smoke.sh --observe-only  # observed boot only (what diag-boot.sh did)
#   40-qemu-smoke.sh --skip-observe  # shipped-image boot only (pre-2026-08-21)
set -euo pipefail
[[ "$(uname -s)" == "Linux" ]] || { echo "[zuup-os] Linux host/container only (use docker-build.sh 40)"; exit 0; }

HERE="$(cd "$(dirname "$0")" && pwd)"
ZOS="${ZUUP_OS_DIR:-$(cd "$HERE/.." && pwd)}"
BUILD="${BUILD:-/build}"
IMG="$BUILD/zuup-os.img"
# TCG (no KVM in the builder container) runs ~7-10x slower than host speed;
# the dev image reaches the kiosk at ~90 guest-seconds, so 180s of wall clock
# never even left the initramfs. 900s observes the kiosk long enough to prove
# it STAYS up (the crash-loop check needs post-start runway).
TIMEOUT="${ZUUP_SMOKE_TIMEOUT:-900}"
# The observed production boot ends at the fail-closed poweroff (~30 guest-s),
# so it needs far less runway than the dev kiosk watch.
OBSERVE_TIMEOUT="${ZUUP_OBSERVE_TIMEOUT:-420}"
VARIANT="$(cat "$BUILD/.rootfs-variant" 2>/dev/null || echo production)"

GOAL=""; DO_OBSERVE=auto; DO_SHIPPED=1
while (($#)); do
  case "$1" in
    --goal) GOAL="$2"; shift 2;;
    --observe-only) DO_OBSERVE=1; DO_SHIPPED=0; shift;;
    --skip-observe) DO_OBSERVE=0; shift;;
    *) shift;;
  esac
done
[[ -n "$GOAL" ]] || { [[ "$VARIANT" == dev ]] && GOAL=gate || GOAL=failclosed; }
# A dev image already prints its whole boot to the serial console, so an
# observed pass would just duplicate the shipped one. Only silent images need it.
[[ "$DO_OBSERVE" == auto ]] && { [[ "$GOAL" == failclosed ]] && DO_OBSERVE=1 || DO_OBSERVE=0; }

[[ -f "$IMG" ]] || { echo "[zuup-os] $IMG missing — run stages 00–30 first" >&2; exit 1; }
command -v qemu-system-x86_64 >/dev/null || { echo "[zuup-os] need qemu-system-x86 (builder container has it)" >&2; exit 1; }

# locate OVMF (Debian: /usr/share/OVMF/OVMF_{CODE,VARS}_4M.fd)
# `|| true` is load-bearing under `set -o pipefail`: only one of each pair of
# filenames exists, so `ls a b` always reports failure and would otherwise kill
# the script with no message at all.
OVMF_CODE=$(ls /usr/share/OVMF/OVMF_CODE_4M.fd /usr/share/OVMF/OVMF_CODE.fd 2>/dev/null | head -1 || true)
OVMF_VARS_SRC=$(ls /usr/share/OVMF/OVMF_VARS_4M.fd /usr/share/OVMF/OVMF_VARS.fd 2>/dev/null | head -1 || true)
[[ -n "$OVMF_CODE" && -n "$OVMF_VARS_SRC" ]] || { echo "[zuup-os] OVMF firmware not found" >&2; exit 1; }

pass() { echo "[zuup-os] SMOKE PASS — $1"; exit 0; }
fail() { echo "[zuup-os] SMOKE FAIL — $1" >&2; exit 1; }
strip_ansi() { sed -E 's/\x1b\[[0-9;:]*m//g'; }

# ── one QEMU boot: virtual TPM 2.0, UEFI, serial → $2 ───────────────────────
#
# The TPM is not optional even for a boot nobody is attesting: zuup-survey reads
# it to decide the machine's maximum role, so a run without one silently
# exercises the "no TPM 2.0 → CANDIDATE_SEAT" branch instead of the path a real
# terminal takes. The hand-run diagnostic boot of 2026-08-17 had no TPM and
# reported `tpm=none` for exactly that reason.
boot_qemu() {
  local img="$1" serial="$2" budget="$3" tag="$4"
  local tpmdir="$BUILD/swtpm-$tag" vars="$BUILD/ovmf_vars-$tag.fd"
  rm -rf "$tpmdir"; mkdir -p "$tpmdir"
  cp "$OVMF_VARS_SRC" "$vars"
  swtpm socket --tpm2 --tpmstate dir="$tpmdir" --ctrl type=unixio,path="$tpmdir/sock" --flags startup-clear &
  local swtpm_pid=$!
  sleep 1
  : > "$serial"
  # Headless but WITH a virtio-GPU: -nodefaults strips the default display
  # adapter, and the kiosk compositor (Cage) needs a DRM node to open. A
  # virtio-gpu-pci + the in-kernel DRM_VIRTIO_GPU driver give it /dev/dri/card0
  # while -display none keeps it windowless. `-no-reboot` turns the fail-closed
  # poweroff into a clean QEMU exit we can assert on.
  set +e
  timeout "$budget" qemu-system-x86_64 \
    -machine q35,smm=on -m 2048 -no-reboot -display none \
    -drive if=pflash,format=raw,unit=0,readonly=on,file="$OVMF_CODE" \
    -drive if=pflash,format=raw,unit=1,file="$vars" \
    -chardev socket,id=chrtpm,path="$tpmdir/sock" \
    -tpmdev emulator,id=tpm0,chardev=chrtpm -device tpm-tis,tpmdev=tpm0 \
    -drive file="$img",format=raw,if=virtio \
    -netdev user,id=n0 -device virtio-net-pci,netdev=n0 \
    -device virtio-gpu-pci \
    -serial file:"$serial" -no-user-config -nodefaults \
    >/dev/null 2>&1
  QEMU_RC=$?
  set -e
  kill "$swtpm_pid" 2>/dev/null || true
  wait "$swtpm_pid" 2>/dev/null || true
}

# ════════════════════════════════════════════════════════════════════════════
# Phase A — the OBSERVED boot (silent images only)
# ════════════════════════════════════════════════════════════════════════════
OBS_SERIAL="$BUILD/observed-serial.log"

observed_boot() {
  local sq="$BUILD/zuup-root.squashfs"
  local vt="$BUILD/zuup-root.squashfs.verity"
  local rh="$BUILD/zuup-root.squashfs.roothash"
  local kern="$BUILD/bzImage" initrd="$BUILD/zuup-initramfs.cpio.gz"
  local f
  for f in "$sq" "$vt" "$rh" "$kern" "$initrd"; do
    [[ -f "$f" ]] || fail "observed boot needs $f from stage 30 (run stage 30 before 40)"
  done

  # Stage 30 generates an ephemeral pair into $BUILD/keys when the authority's
  # HSM key is absent, and signs the shipped image with it. Re-sign with
  # whatever signed the image, or the observed boot is a different chain.
  if [[ -z "${ZUUP_DB_KEY:-}" || -z "${ZUUP_DB_CRT:-}" ]]; then
    [[ -f "$BUILD/keys/db.key" && -f "$BUILD/keys/db.crt" ]] \
      || fail "no signing key: set ZUUP_DB_KEY/ZUUP_DB_CRT (the pair stage 30 used)"
    export ZUUP_DB_KEY="$BUILD/keys/db.key" ZUUP_DB_CRT="$BUILD/keys/db.crt"
  fi

  echo "[zuup-os] re-signing the shipped kernel/initrd/roothash with a console…"
  # ukify writes its intermediate into the CWD and the repo mounts read-only.
  cd "$BUILD"
  OUT="$BUILD/zuup-observed.efi" ZUUP_CONSOLE="ttyS0,115200" \
    bash "$ZOS/boot/secureboot/sign-image.sh" "$kern" "$initrd" "$rh" | tail -1

  # The observed cmdline must be the shipped cmdline with ONLY the console
  # policy swapped. Anything else means this boot is not the boot a terminal
  # will do, and the whole exercise is theatre.
  local shipped="$BUILD/zuup.efi.signed.cmdline" a b
  if [[ -f "$shipped" ]]; then
    a="$(sed -E 's/ console=.*$//' "$shipped")"
    b="$(sed -E 's/ console=.*$//' "$BUILD/zuup-observed.efi.cmdline")"
    if [[ "$a" != "$b" ]]; then
      echo "  shipped : $a" >&2
      echo "  observed: $b" >&2
      fail "observed cmdline differs from the shipped one outside the console policy"
    fi
    echo "[zuup-os] cmdline matches the shipped UKI (console policy aside)"
  else
    echo "[zuup-os] warning: no $shipped to diff against" >&2
  fi

  echo "[zuup-os] assembling a throwaway disk around the SAME rootfs…"
  local uki="$BUILD/zuup-observed.efi" img="$BUILD/zuup-observed.img" esp="$BUILD/observed-esp.img"
  local esp_bytes sq_bytes vt_bytes start total
  align() { echo $(( ( ($1 + 1048575) / 1048576 ) * 1048576 )); }
  esp_bytes=$(align $(( $(stat -c%s "$uki") + 8*1048576 )) )
  (( esp_bytes < 48*1048576 )) && esp_bytes=$(( 48*1048576 ))
  sq_bytes=$(align "$(stat -c%s "$sq")"); vt_bytes=$(align "$(stat -c%s "$vt")")
  start=1048576
  total=$(( start + esp_bytes + sq_bytes + vt_bytes + 1048576 ))
  rm -f "$img"; truncate -s "$total" "$img"

  rm -f "$esp"; truncate -s "$esp_bytes" "$esp"
  mkfs.fat -F32 -n ZUUPESP "$esp" >/dev/null
  mmd -i "$esp" ::/EFI ::/EFI/BOOT
  mcopy -i "$esp" "$uki" ::/EFI/BOOT/BOOTX64.EFI

  sfdisk --quiet --label gpt "$img" <<PARTS
start=$((start/512)), size=$((esp_bytes/512)), type=U, name="EFI System"
start=$(((start+esp_bytes)/512)), size=$((sq_bytes/512)), type=0FC63DAF-8483-4772-8E79-3D69D8477DE4, name="zuup-root"
start=$(((start+esp_bytes+sq_bytes)/512)), size=$((vt_bytes/512)), type=0FC63DAF-8483-4772-8E79-3D69D8477DE4, name="zuup-hash"
PARTS
  dd if="$esp" of="$img" bs=1M seek=$((start/1048576)) conv=notrunc status=none
  dd if="$sq"  of="$img" bs=1M seek=$(((start+esp_bytes)/1048576)) conv=notrunc status=none
  dd if="$vt"  of="$img" bs=1M seek=$(((start+esp_bytes+sq_bytes)/1048576)) conv=notrunc status=none

  echo "[zuup-os] booting the observed image (${OBSERVE_TIMEOUT}s budget)…"
  boot_qemu "$img" "$OBS_SERIAL" "$OBSERVE_TIMEOUT" observed
  echo "[zuup-os] observed boot: qemu rc=$QEMU_RC, $(wc -c < "$OBS_SERIAL") bytes of serial"
}

assert_observed() {
  local rc=$QEMU_RC label pattern survey
  echo "── observed boot markers ──────────────────────────────────"
  grep -aE "device-mapper: verity|Welcome to ZUUP-OS|zuup-(identity|firewall|survey|attest|wireguard)|Dependency failed|Powering off" \
    "$OBS_SERIAL" | strip_ansi | tail -20 || true
  echo "───────────────────────────────────────────────────────────"

  [[ -s "$OBS_SERIAL" ]] || fail "observed boot produced NO serial output — the UKI never ran (firmware rejected it, or virtio never attached)"

  # ── match against a SANITISED copy, not the raw log ──────────────────────
  #
  # systemd colourises its own output, so the banner arrives as
  #   ESC[0;1;39mWelcome to ESC[0mESC[1mZUUP-OS Examination TerminalESC[0m
  # and a plain /Welcome to ZUUP-OS/ never matches: the escape run sits in the
  # middle of the phrase. That failed a boot which had in fact switch_rooted
  # perfectly and gone on to run every unit — the checker reported the one thing
  # that had definitely worked as the thing that broke. Carriage returns go too;
  # the console emits CRLF, so patterns behave differently here than in a file
  # anyone reads.
  OBS_PLAIN="$OBS_SERIAL.plain"
  strip_ansi < "$OBS_SERIAL" | tr -d '\r' > "$OBS_PLAIN"

  # Ordered as the boot executes, so the first failure names the stage that
  # broke rather than the symptom three stages later.
  while IFS='|' read -r label pattern; do
    [[ -z "$label" ]] && continue
    grep -aqE "$pattern" "$OBS_PLAIN" \
      || fail "observed boot never got past: $label  (expected /$pattern/ in $OBS_SERIAL)"
    printf '  [ok] %s\n' "$label"
  done <<'MARKERS'
kernel started|Linux version [0-9]
kernel locked down|Kernel is locked down
dm-verity opened the root|device-mapper: verity: sha256
switch_root into the verity root|Welcome to ZUUP-OS
systemd took PID 1|systemd\[1\]:
identity read the signed cmdline|Finished zuup-identity\.service|zuup-identity:
firewall ruleset loaded|Finished zuup-firewall\.service
hardware survey ran|zuup-survey: firmware=
MARKERS

  # The survey is the one place the boot reports what it found. A production
  # terminal MUST see a TPM 2.0 — without one it demotes itself to a candidate
  # seat and no staff can ever log in. A run whose TPM did not attach is not a
  # run that proves anything about the production path.
  survey="$(grep -aoE 'zuup-survey: firmware=[^\r]*' "$OBS_PLAIN" | strip_ansi | head -1)"
  echo "  -> $survey"
  grep -aqE 'zuup-survey: firmware=UEFI' "$OBS_PLAIN" \
    || fail "survey did not see UEFI firmware — the observed boot was not the UEFI path"
  grep -aqE 'zuup-survey: .*tpm=(2\.0|20|yes)' "$OBS_PLAIN" \
    || fail "survey reported no TPM 2.0 — swtpm did not attach, so this run cannot speak for the production path"

  # Fail-closed. An unprovisioned image has no WireGuard identity, so the tunnel
  # must fail, the network target must not be reached, and everything gated on
  # it must be REFUSED rather than started anyway.
  grep -aqE "Dependency failed for zuup-(session|kiosk)|ZUUP-ATTEST HALT|refusing to open the Gate" "$OBS_PLAIN" \
    || fail "no fail-closed evidence: the session path neither halted nor was refused"
  printf '  [ok] %s\n' "session path refused (fail-closed)"

  # …and it must fail closed WITHOUT ever offering a surface.
  #
  # The pattern has to name a surface that CAME UP, not any line containing the
  # word. A bare /getty/ matched `systemd-getty-g (97) used greatest stack
  # depth` — a kernel accounting message about the generator, which runs on
  # every boot and creates nothing — so a correctly fail-closed boot was
  # reported as having offered a login. Worse, the evidence printed alongside
  # the failure was the `Dependency failed for zuup-kiosk` lines, i.e. the proof
  # that it had NOT.
  #
  # So: a unit that reached Started/Reached target, an actual getty unit, a
  # login prompt, or a shell prompt. "Starting" is deliberately absent — systemd
  # prints it before a job that may still be refused.
  SURFACE='(Started|Reached target)[^|]*([Gg]etty|locked examination surface|[Ee]xamination session)|getty@tty[0-9]+\.service: (Started|Succeeded)|login:|sh-[0-9]\.[0-9]#'
  if grep -aqE "$SURFACE" "$OBS_PLAIN"; then
    grep -aE "$SURFACE" "$OBS_PLAIN" | head -5 >&2
    fail "a login/kiosk surface appeared on an unattested terminal — NOT fail-closed"
  fi
  printf '  [ok] %s\n' "no shell, login or kiosk surface appeared"

  # …and it must actually STOP, rather than sitting at the gate forever.
  [[ $rc -eq 124 ]] && fail "observed boot HUNG (timeout) instead of powering off — a terminal stuck at the gate is not fail-closed"
  grep -aqE "Powering off|Reached target .*[Pp]ower-?[Oo]ff|System is powering down" "$OBS_PLAIN" \
    || fail "no poweroff observed (qemu rc=$rc) — the gate did not halt the machine"
  printf '  [ok] %s\n' "machine powered itself off"

  echo "[zuup-os] OBSERVED BOOT OK — the production chain was watched end to end."
}

if (( DO_OBSERVE )); then
  echo "══ phase A: observed production boot ══"
  observed_boot
  assert_observed
  cp -f "$OBS_SERIAL" /dist/ 2>/dev/null || true
fi

(( DO_SHIPPED )) || pass "observed boot only (--observe-only)"

# ════════════════════════════════════════════════════════════════════════════
# Phase B — the SHIPPED image, exactly as it will be flashed
# ════════════════════════════════════════════════════════════════════════════
(( DO_OBSERVE )) && { echo; echo "══ phase B: the shipped image ══"; }
SERIAL="$BUILD/smoke-serial.log"
echo "[zuup-os] booting $VARIANT image in QEMU (goal=$GOAL, ${TIMEOUT}s budget)…"
boot_qemu "$IMG" "$SERIAL" "$TIMEOUT" shipped

echo "── serial markers ─────────────────────────────────────────"
grep -aE "ZUUP|verity|switch_root|systemd\[1\]|Reached target|HALT|poweroff" "$SERIAL" | tail -25 || true
echo "───────────────────────────────────────────────────────────"

have() { grep -aqE "$1" "$SERIAL"; }
fail() { echo "[zuup-os] SMOKE FAIL — $1 (full log: $SERIAL)" >&2; exit 1; }

# Boot integrity: verity must open and hand off to PID 1. HOW we observe that
# depends on the console policy baked into the signed UKI:
#   • gate (dev image)      → console=ttyS0, so the serial log MUST show the
#                             kernel banner / systemd; an empty log is a real
#                             boot failure.
#   • failclosed (prod)     → console=null by design (a real terminal shows
#                             nothing, ever), so the serial log is legitimately
#                             empty. Here the integrity signal is QEMU's own
#                             exit: `-no-reboot` turns the attestation poweroff
#                             into a clean exit 0, which can only happen if the
#                             kernel booted, verity opened, systemd ran, and the
#                             fail-closed path executed. A timeout (RC 124) or a
#                             non-zero exit with an empty log = never booted.
#                             Phase A is what turns that inference into an
#                             observation.
if [[ "$GOAL" == gate ]] || grep -aqE "Linux version|systemd\[1\]" "$SERIAL"; then
  have "Linux version|systemd\[1\]" || fail "kernel/PID1 never started (UKI or virtio issue)"
elif [[ "$QEMU_RC" -ne 0 ]]; then
  fail "silent (console=null) image did not cleanly power off — RC=$QEMU_RC (never booted, or hung instead of failing closed)"
fi

# A dependency/unit failure anywhere on the session path is a HARD fail. This
# must be checked BEFORE the success patterns: the failure lines themselves
# contain unit names ("Dependency failed for zuup-kiosk…"), so a naive
# substring match on the unit name would otherwise read a failure as a pass.
# Only the DEV goal treats these as fatal — on a production image the refusal of
# the session path IS the expected outcome, and phase A asserts it positively.
if [[ "$GOAL" == gate ]] && grep -aqE "Dependency failed for (zuup-session|zuup-kiosk|zuup-network)|Failed to start zuup-(firewall|wireguard|kiosk)" "$SERIAL"; then
  echo "── failing units ──" >&2
  grep -aE "Dependency failed|Failed to start zuup" "$SERIAL" | strip_ansi | sort -u >&2
  fail "a unit on the session path failed (see above)"
fi

# "Started zuup-kiosk…" is printed for Type=simple the moment the fork
# succeeds — BEFORE the exec inside the sandbox can fail — so a kiosk that
# crash-loops right after starting (the 226/NAMESPACE class of bug) would
# otherwise sail past the positive-start match below. A namespace failure is
# always a config defect; a climbing restart counter means the surface never
# stayed up. Two restarts are tolerated (first-boot DRM/seat races heal).
if grep -aqE "zuup-kiosk\.service: Failed (to set up mount namespacing|at step NAMESPACE)" "$SERIAL" \
   || grep -aqE "zuup-kiosk\.service: Scheduled restart job, restart counter is at ([3-9]|[0-9]{2,})" "$SERIAL"; then
  echo "── kiosk crash-loop evidence ──" >&2
  grep -aE "zuup-kiosk\.service: (Failed|Main process exited|Scheduled restart)" "$SERIAL" \
    | strip_ansi | sort -u | head -8 >&2
  fail "zuup-kiosk started but did not STAY up (crash-loop)"
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
      if have "getty|login:|sh-[0-9]\.[0-9]#|/bin/sh"; then
        fail "a shell/login surface appeared — NOT fail-closed"
      fi
      if (( DO_OBSERVE )); then
        pass "PROD image failed CLOSED, and its boot chain was OBSERVED end to end"
      fi
      pass "PROD image failed CLOSED (no attestation → poweroff, no login surface)"
    fi
    fail "expected a fail-closed halt; none observed"
    ;;
  *) fail "unknown goal '$GOAL'";;
esac
