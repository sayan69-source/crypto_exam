#!/usr/bin/env bash
# ZUUP-OS seat heartbeat (spec §10.2) — feeds the invigilator seat map's
# health column. Every 15 s, POST this terminal's liveness to the Edge over
# the tunnel. Read-only telemetry: it carries the terminal id and a status
# string, never user data. If the Edge is unreachable the seat simply ages
# into UNKNOWN on the dashboard — the heartbeat never gates anything
# (attestation and the Gate's own fail-closed probe do that).
set -euo pipefail

# ── host guard ──────────────────────────────────────────────────────────────
if [[ "$(uname -s)" != "Linux" ]] || [[ ! -r /etc/zuup/terminal-id ]]; then
  echo "[zuup-os] Terminal-image artifact; not running here. On a terminal it"
  echo "          would POST {terminalId, status:'OK'} to the Edge every 15 s."
  exit 0
fi

EDGE="${ZUUP_EDGE_URL:-http://edge.local:4000}"
TERMINAL_ID="$(tr -d ' \n' < /etc/zuup/terminal-id)"
INTERVAL="${ZUUP_HEARTBEAT_INTERVAL:-15}"

while true; do
  curl --silent --fail --max-time 5 \
    --header 'content-type: application/json' \
    --data "{\"terminalId\":\"${TERMINAL_ID}\",\"status\":\"OK\"}" \
    "$EDGE/api/terminal/heartbeat" >/dev/null \
    || echo "heartbeat missed" | systemd-cat -t zuup-heartbeat -p warning || true
  sleep "$INTERVAL"
done
