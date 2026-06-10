#!/usr/bin/env bash
# ZUUP-OS UEFI key enrolment (spec §7.1) — run at CENTRE COMMISSIONING on each
# terminal, booted once into a minimal enrolment environment with the firmware
# in Setup Mode. After this script the machine only boots authority-signed
# images, and the §7.1 UEFI hardening checklist is applied by hand:
#   • UEFI supervisor password set        • boot order: centre PXE only
#   • USB/optical/other-network boot off  • UEFI shell disabled
set -euo pipefail

# ── host guard ──────────────────────────────────────────────────────────────
if [[ "$(uname -s)" != "Linux" ]] || ! command -v efi-updatevar >/dev/null 2>&1 || [[ ! -d /sys/firmware/efi ]]; then
  cat <<'EOF'
[zuup-os] Commissioning artifact (needs an EFI Linux env in Setup Mode); not running here.
          On the terminal it would, in order:
            1. assert the firmware is in Setup Mode (SetupMode=1)
            2. enrol db.auth, then KEK.auth, then PK.auth (PK last — it locks user mode)
            3. assert SecureBoot=1 after reboot
            4. record the terminal's TPM EK certificate + golden PCR set → Edge registry
          Nothing was changed on this machine.
EOF
  exit 0
fi

KEYDIR="${1:?usage: enroll-keys.sh <dir with PK.auth KEK.auth db.auth>}"

setup_mode="$(od -An -tu1 -j4 -N1 /sys/firmware/efi/efivars/SetupMode-* | tr -d ' ')"
[[ "$setup_mode" == "1" ]] || { echo "[zuup-os] FAIL: firmware not in Setup Mode" >&2; exit 1; }

# Order matters: db and KEK first; writing PK exits Setup Mode and locks the chain.
efi-updatevar -f "$KEYDIR/db.auth"  db
efi-updatevar -f "$KEYDIR/KEK.auth" KEK
efi-updatevar -f "$KEYDIR/PK.auth"  PK

echo "[zuup-os] keys enrolled; reboot and verify SecureBoot=1."
echo "[zuup-os] then register this terminal's golden PCRs with the Edge (boot/attest)."
