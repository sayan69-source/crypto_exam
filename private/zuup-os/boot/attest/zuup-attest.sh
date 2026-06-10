#!/usr/bin/env bash
# ZUUP-OS boot-time remote attestation (spec §7.1) — runs on EVERY boot,
# after the WireGuard link is up and BEFORE the kiosk (the Login Gate) may
# start. Reads the measured-boot PCRs from the TPM 2.0 and submits them to
# the Edge, which compares against this terminal's golden set:
#
#     POST /api/terminal/attest {terminalId, pcr}  →  {ok: true|false}
#
# FAIL-CLOSED in every direction (INV-10): a mismatch, an unknown terminal,
# an unreachable Edge, or a missing TPM all end in poweroff. A terminal that
# cannot prove its boot chain never shows a login surface.
set -euo pipefail

# ── host guard ──────────────────────────────────────────────────────────────
if [[ "$(uname -s)" != "Linux" ]] || ! command -v tpm2_pcrread >/dev/null 2>&1; then
  cat <<'EOF'
[zuup-os] Terminal-image artifact (needs Linux + tpm2-tools + a TPM); not running here.
          On a terminal it would: read PCRs 0,4,7,8,9,14 → POST to the Edge →
          HALT unless the Edge answers {"ok":true}. Nothing was changed here.
EOF
  exit 0
fi

EDGE="${ZUUP_EDGE_URL:-http://edge.local:4000}"
ID_FILE="/etc/zuup/terminal-id"
PCRS="sha256:0,4,7,8,9,14"   # firmware, kernel, secure-boot state, GRUB/UKI stages

halt() {
  echo "ZUUP-ATTEST HALT: $1" | systemd-cat -t zuup-attest -p emerg || true
  systemctl poweroff --force
  exit 1
}

[[ -r "$ID_FILE" ]] || halt "no terminal identity in the image"
TERMINAL_ID="$(tr -d ' \n' < "$ID_FILE")"

# Read the measured PCR bank (tpm2_pcrread emits YAML; the Edge stores the
# golden set as the same JSON conversion). A read failure == no/tampered TPM.
PCR_JSON="$(tpm2_pcrread "$PCRS" 2>/dev/null | python3 -c '
import sys, json, yaml
print(json.dumps(yaml.safe_load(sys.stdin), sort_keys=True))' 2>/dev/null)"
[[ -n "$PCR_JSON" && "$PCR_JSON" != "null" ]] || halt "TPM unreadable"

BODY="$(printf '{"terminalId":"%s","pcr":%s}' "$TERMINAL_ID" "$PCR_JSON")"

# 3 attempts, 5 s apart — then fail closed. --fail makes 4xx/5xx an error.
for i in 1 2 3; do
  RESP="$(curl --silent --fail --max-time 10 \
            --header 'content-type: application/json' \
            --data "$BODY" "$EDGE/api/terminal/attest" || true)"
  if [[ "$RESP" == *'"ok":true'* ]]; then
    echo "attestation OK (attempt $i)" | systemd-cat -t zuup-attest -p info
    exit 0
  fi
  [[ "$RESP" == *'"ok":false'* ]] && halt "Edge DENIED this boot image (PCR mismatch)"
  sleep 5
done
halt "Edge unreachable — refusing to open the Gate without attestation"
