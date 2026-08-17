#!/usr/bin/env bash
# ZUUP-OS hardware survey — what protections does THIS machine actually offer,
# and therefore what is it allowed to be?
#
# ── Why this exists ─────────────────────────────────────────────────────────
#
# An Indian exam centre is not a fleet. It is whatever is in the room: a few
# machines bought this year and forty bought over a decade, Dell and HP and
# Samsung and assembled boxes, some with TPM 2.0 and Secure Boot, many with
# neither. A terminal OS that only runs on the new ones is a terminal OS that
# does not run.
#
# The wrong answer is to lower the security bar until everything passes. The
# right one is to MEASURE what each machine can offer and let that decide what
# the machine is permitted to do — so a centre knows, before exam day, which
# boxes can hold a staff station and which can only ever be candidate seats.
#
# That split already exists in the Edge and is not invented here:
#
#   staff (ADMIN_STATION, INVIGILATOR_STATION)
#       must pass the §8.2 match-all rule, which includes a TPM quote. No TPM,
#       no staff login — the Edge denies it, always, on any variant.
#
#   CANDIDATE_SEAT
#       needs no TPM. A candidate authenticates with a seat binding an
#       invigilator created on an ATTESTED station, plus roll and date of birth,
#       plus biometrics. The trust flows through the invigilator's machine, not
#       through the seat's firmware.
#
# So an eleven-year-old laptop with no TPM and no Secure Boot is a perfectly
# legitimate candidate seat, and never a staff station. This script is what
# makes that determination visible instead of leaving an operator to discover it
# when a login fails on exam morning.
#
# ── It changes nothing ──────────────────────────────────────────────────────
#
# Read-only in every direction. It writes one JSON file to a tmpfs. It does not
# touch the internal disk, does not write an EFI variable, does not install a
# bootloader and does not modify firmware settings. See DO-NO-HARM in
# docs/HARDWARE-COMPATIBILITY.md.
set -euo pipefail

IDENTITY_DIR="${ZUUP_IDENTITY_DIR:-/run/zuup-identity}"
OUT="${ZUUP_SURVEY_FILE:-$IDENTITY_DIR/boot-capability.json}"

log() {
  echo "zuup-survey: $*" | systemd-cat -t zuup-survey -p info 2>/dev/null || true
  echo "zuup-survey: $*" > /dev/kmsg 2>/dev/null || true
}

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "[zuup-os] Terminal-image artifact; not running here."
  exit 0
fi

mkdir -p "$IDENTITY_DIR"

# ── firmware: UEFI or legacy BIOS ───────────────────────────────────────────
FIRMWARE="BIOS"
[[ -d /sys/firmware/efi ]] && FIRMWARE="UEFI"

# ── Secure Boot ─────────────────────────────────────────────────────────────
#
# The SecureBoot EFI variable is 5 bytes: a 4-byte attribute header then one
# byte of value. Reading it is safe — efivarfs is mounted READ-ONLY on this
# image precisely so that nothing here, or anywhere else, can write NVRAM.
SECUREBOOT="unavailable"
if [[ "$FIRMWARE" == "UEFI" ]]; then
  SB=/sys/firmware/efi/efivars/SecureBoot-8be4df61-93ca-11d2-aa0d-00e098032b8c
  if [[ -r "$SB" ]]; then
    case "$(od -An -tu1 -j4 -N1 "$SB" 2>/dev/null | tr -d ' ')" in
      1) SECUREBOOT="enabled" ;;
      0) SECUREBOOT="disabled" ;;
      *) SECUREBOOT="unknown" ;;
    esac
  else
    SECUREBOOT="unreadable"
  fi
fi

# ── TPM ─────────────────────────────────────────────────────────────────────
# The decisive one. TPM 2.0 is what separates a machine that can hold a staff
# station from one that cannot, and 1.2 does not count — the quote format the
# Edge verifies is 2.0 only.
TPM="none"
if [[ -e /dev/tpmrm0 ]]; then
  TPM="2.0"
elif [[ -e /dev/tpm0 ]]; then
  # /dev/tpm0 without the resource manager is usually 1.2, but check rather than
  # guess: some 2.0 chips appear this way when the RM is unavailable.
  ver="$(cat /sys/class/tpm/tpm0/tpm_version_major 2>/dev/null || echo '')"
  [[ "$ver" == "2" ]] && TPM="2.0-no-rm" || TPM="1.2"
fi

# ── what this machine may therefore be ──────────────────────────────────────
if [[ "$TPM" == "2.0" ]]; then
  MAX_ROLE="ADMIN_STATION"
  WHY="TPM 2.0 present: this machine can produce the quote a staff login requires."
else
  MAX_ROLE="CANDIDATE_SEAT"
  WHY="No usable TPM 2.0: staff logins need a quote, so this machine can only be a candidate seat."
fi

# Egress is stricter than staff login, and deliberately so. The HQ uplink is the
# one capability where a forged cmdline would matter — at anything below Secure
# Boot the identity on the cmdline is not authenticated by the firmware, so a
# stolen stick could relabel a seat as an admin station. The Edge refuses egress
# without a fresh quote regardless; this records WHY for the operator's benefit.
EGRESS_OK=false
if [[ "$TPM" == "2.0" && "$SECUREBOOT" == "enabled" ]]; then
  EGRESS_OK=true
fi

# ── inventory, for the centre's planning ────────────────────────────────────
MEM_MB=$(( $(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null || echo 0) / 1024 ))
CPU="$(sed -n 's/^model name[[:space:]]*: //p' /proc/cpuinfo 2>/dev/null | head -1)"
GPU="$(ls /sys/class/drm/ 2>/dev/null | grep -m1 '^card[0-9]' || echo none)"
KBD=false
grep -q 'Handlers=.*kbd' /proc/bus/input/devices 2>/dev/null && KBD=true
NET="$(ls /sys/class/net 2>/dev/null | grep -vE '^(lo|wg0)$' | head -3 | tr '\n' ' ')"

python3 - "$FIRMWARE" "$SECUREBOOT" "$TPM" "$MAX_ROLE" "$WHY" "$EGRESS_OK" \
         "$MEM_MB" "$CPU" "$GPU" "$KBD" "$NET" > "$OUT.tmp" <<'PY'
import json, sys
f, sb, tpm, role, why, egress, mem, cpu, gpu, kbd, net = sys.argv[1:12]
print(json.dumps({
    "firmware": f,
    "secure_boot": sb,
    "tpm": tpm,
    "max_role": role,
    "max_role_reason": why,
    "egress_capable": egress == "true",
    "memory_mb": int(mem),
    "cpu": cpu or "unknown",
    "gpu": gpu,
    "keyboard_detected": kbd == "true",
    "network_interfaces": net.split(),
}, indent=2))
PY
mv "$OUT.tmp" "$OUT"
chmod 0644 "$OUT"

log "firmware=$FIRMWARE secureboot=$SECUREBOOT tpm=$TPM ram=${MEM_MB}MB kbd=$KBD net=${NET:-none}"
log "MAX ROLE: $MAX_ROLE — $WHY"
[[ "$EGRESS_OK" == true ]] || log "HQ egress NOT available on this machine (needs TPM 2.0 + Secure Boot)."
