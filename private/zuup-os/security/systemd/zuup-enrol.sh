#!/usr/bin/env bash
# ZUUP-OS enrolment boot (spec §7.1) — capture the two things only the physical
# machine can produce, then power off.
#
# Runs on ONE boot, on the provisioning bench, when `zuup.enrol=1` is on the
# signed cmdline. It is not part of any normal boot and does nothing at all
# without that parameter.
#
# ── What it captures, and why it has to be here ─────────────────────────────
#
# tools/provision-terminal.sh can mint an identity, a WireGuard keypair and a
# signed UKI on the build host. It cannot produce:
#
#   the TPM Attestation Key   its private half is created inside this chip and
#                             cannot be exported. Only this machine can make it.
#   the golden PCR values     the measurements this firmware, running this
#                             image, actually produces. Only this machine,
#                             running this exact image, can measure them.
#
# So the registry row provisioning emits has `ak_pubkey_pem: null` and
# `golden_pcr: null`, and until they are filled the Edge denies every privileged
# login on that terminal with NO_ATTESTATION_KEY_REGISTERED. This is the step
# that fills them.
#
# ── Why the answer goes to the ESP and not over the network ─────────────────
#
# Registering an attestation key over the LAN needs a channel the terminal can
# authenticate with, which it does not have yet — that is precisely what is
# being established. Any shared secret it could carry would have to sit on the
# cmdline or the ESP, where the attacker being defended against already is.
#
# So enrolment is PHYSICAL: this writes to the machine's own stick, the operator
# carries the stick back to the provisioning host, and `collect-enrolment.sh`
# merges it. The trust anchor is the operator standing in the room, which is
# what it should be for the one step that decides which machines are terminals.
#
# The AK is persisted INSIDE the TPM at a fixed handle rather than as a context
# file: a context is meaningless on a machine with no writable root, and
# regenerating the AK each boot would produce a different key every time — which
# is the bug the all-in-one only survives because it re-registers itself on
# every boot.
set -euo pipefail

IDENTITY_DIR="${ZUUP_IDENTITY_DIR:-/run/zuup-identity}"
CMDLINE_FILE="${ZUUP_CMDLINE_FILE:-/proc/cmdline}"
# Persistent handle for the AK. In the owner hierarchy's persistent range;
# 0x81010001 is conventionally the EK, so the AK sits one above it.
AK_HANDLE="${ZUUP_AK_HANDLE:-0x81010002}"
PCR_LIST="${ZUUP_PCR_LIST:-sha256:0,4,7,11}"

say() {
  echo "zuup-enrol: $*" | systemd-cat -t zuup-enrol -p "${2:-info}" || true
  echo "zuup-enrol: $*" > /dev/kmsg 2>/dev/null || true
  echo "zuup-enrol: $*" > /dev/console 2>/dev/null || true
}

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "[zuup-os] Terminal-image artifact; not running here."
  exit 0
fi

grep -qw 'zuup.enrol=1' "$CMDLINE_FILE" 2>/dev/null || exit 0

say "ENROLMENT BOOT — capturing this machine's attestation key and measurements."

TERMINAL_ID=""
[[ -r "$IDENTITY_DIR/terminal-id" ]] && TERMINAL_ID="$(tr -d ' \n' < "$IDENTITY_DIR/terminal-id")"
[[ -n "$TERMINAL_ID" ]] || {
  say "no identity published — provision this stick before enrolling it." err
  sleep 30; systemctl poweroff --force; exit 1
}

WORK="$(mktemp -d "$IDENTITY_DIR/enrol.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# ── 1. the TPM attestation key ──────────────────────────────────────────────
AK_PEM=""; GOLDEN="null"
if command -v tpm2_createak >/dev/null 2>&1 && [[ -e /dev/tpmrm0 ]]; then
  # Evict anything already at the handle so re-enrolling a machine is possible
  # (a returned terminal, a re-imaged one). Failure here is fine — usually it
  # just means nothing was there.
  tpm2_evictcontrol -C o -c "$AK_HANDLE" >/dev/null 2>&1 || true

  if tpm2_createek -c "$WORK/ek.ctx" >/dev/null 2>&1 &&
     tpm2_createak -C "$WORK/ek.ctx" -c "$WORK/ak.ctx" -u "$WORK/ak.pub" \
                   -f pem -n "$WORK/ak.name" >/dev/null 2>&1 &&
     tpm2_evictcontrol -C o -c "$WORK/ak.ctx" "$AK_HANDLE" >/dev/null 2>&1; then
    AK_PEM="$(cat "$WORK/ak.pub" 2>/dev/null || true)"
    say "attestation key created and persisted at $AK_HANDLE"
  else
    say "a TPM is present but the attestation key could not be created/persisted." err
  fi

  GOLDEN="$(tpm2_pcrread "$PCR_LIST" 2>/dev/null | python3 -c '
import sys, json, yaml
doc = yaml.safe_load(sys.stdin) or {}
bank = doc.get("sha256", {})
print(json.dumps({str(k): format(v, "064x") if isinstance(v, int) else str(v)
                  for k, v in bank.items()}, sort_keys=True))' 2>/dev/null || echo null)"
else
  say "NO TPM 2.0 on this machine. It can serve portals but can never satisfy the
       TPM clause of the login rule, so no privileged login will succeed on it." err
fi

# ── 2. the biometric daemon's signing key ───────────────────────────────────
# Created here rather than at each boot so the public half registered now stays
# valid for the life of the terminal.
BIO_PEM=""
OLD_UMASK="$(umask)"; umask 077
if openssl genpkey -algorithm ed25519 -out "$WORK/biometric-attest.key" 2>/dev/null; then
  BIO_PEM="$(openssl pkey -in "$WORK/biometric-attest.key" -pubout 2>/dev/null || true)"
  say "biometric attestation key generated"
else
  say "could not generate the biometric key — this station will not capture." err
fi
umask "$OLD_UMASK"

# ── 3. write the answer back to the stick ───────────────────────────────────
MNT="$IDENTITY_DIR/.esp-rw"
mkdir -p "$MNT"
ESP=""
for dev in /dev/disk/by-label/ZUUPESP "/dev/disk/by-partlabel/EFI System"; do
  [[ -e "$dev" ]] || continue
  mount -t vfat -o rw,nosuid,nodev,noexec "$dev" "$MNT" 2>/dev/null && { ESP="$dev"; break; }
done
[[ -n "$ESP" ]] || { say "no writable ESP found — nothing captured." err; sleep 30; systemctl poweroff --force; exit 1; }

mkdir -p "$MNT/zuup"
[[ -n "$BIO_PEM" ]] && install -m 0600 "$WORK/biometric-attest.key" "$MNT/zuup/biometric-attest.key"

AK_PEM="$AK_PEM" BIO_PEM="$BIO_PEM" python3 - "$TERMINAL_ID" "$GOLDEN" "$AK_HANDLE" \
  > "$MNT/zuup/enrolment.json" <<'PY'
import json, os, sys
terminal_id, golden, handle = sys.argv[1:4]
print(json.dumps({
    "terminal_id": terminal_id,
    "ak_handle": handle,
    "ak_pubkey_pem": os.environ.get("AK_PEM") or None,
    "bio_pubkey_pem": os.environ.get("BIO_PEM") or None,
    "golden_pcr": json.loads(golden) if golden and golden != "null" else None,
}, indent=2))
PY

sync
umount "$MNT" 2>/dev/null || true
rmdir "$MNT" 2>/dev/null || true

say "ENROLMENT COMPLETE for $TERMINAL_ID."
say "Take this stick back to the provisioning host and run:"
say "  tools/collect-enrolment.sh --stick /path/to/esp --out provisioned/<seat>/registry.json"
say "Then re-sign this stick's UKI WITHOUT zuup.enrol=1 before it goes to a hall."
sleep 20
systemctl poweroff --force
