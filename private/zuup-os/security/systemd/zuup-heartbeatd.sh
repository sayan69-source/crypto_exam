#!/usr/bin/env bash
# ZUUP-OS seat heartbeat (spec §10.2) — feeds the invigilator seat map's
# health column. Every 15 s, POST this terminal's liveness to the Edge over
# the tunnel. Read-only telemetry: it carries the terminal id and a status
# string, never user data. If the Edge is unreachable the seat simply ages
# into UNKNOWN on the dashboard — the heartbeat never gates anything
# (attestation and the Gate's own fail-closed probe do that).
set -euo pipefail

# Where this machine's identity lives, most-specific first.
#
#   /run/zuup-identity/  published at boot — by zuup-identity.service from the
#                        signed cmdline (production), or by zuup-commission.sh
#                        (all-in-one). This is the real answer on any machine
#                        that has one.
#   /etc/zuup/           the image's baked placeholder. Only ever correct on an
#                        image someone built a per-terminal rootfs for, which
#                        production does not do — so it is the fallback, not the
#                        first choice. Reading it first is how a commissioned
#                        machine came to report itself as REPLACE-AT-PROVISIONING.
resolve_identity() {
  local f
  for f in /run/zuup-identity/terminal-id /etc/zuup/terminal-id; do
    [[ -r "$f" ]] || continue
    local v; v="$(tr -d ' \n' < "$f")"
    [[ "$v" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] \
      && { printf '%s' "$v"; return 0; }
  done
  return 1
}

# ── host guard ──────────────────────────────────────────────────────────────
if [[ "$(uname -s)" != "Linux" ]]; then
  echo "[zuup-os] Terminal-image artifact; not running here. On a terminal it"
  echo "          would POST {terminalId, status:'OK'} to the Edge every 15 s."
  exit 0
fi

EDGE="${ZUUP_EDGE_URL:-http://edge.local:4000}"
INTERVAL="${ZUUP_HEARTBEAT_INTERVAL:-15}"

# WAIT for an identity rather than giving up on the first look.
#
# On the all-in-one the identity does not exist at boot: /etc/zuup/terminal-id
# reads REPLACE-AT-FIRST-BOOT and the real UUID only appears once
# zuup-commission.sh has registered this machine's stations. Nothing orders this
# unit after that, so exiting on a first miss would leave the seat map's health
# column permanently blank on exactly the image most likely to be demonstrated.
#
# Bounded, because a machine that is genuinely unprovisioned should stop rather
# than poll forever — and it stops quietly, since having no identity is a normal
# state for hardware nobody has commissioned, not a fault worth logging every
# fifteen seconds.
TERMINAL_ID=""
for _ in $(seq 1 60); do
  TERMINAL_ID="$(resolve_identity || true)"
  [[ -n "$TERMINAL_ID" ]] && break
  sleep 5
done
if [[ -z "$TERMINAL_ID" ]]; then
  echo "no terminal identity after 5 minutes — this machine is not commissioned; nothing to report" \
    | systemd-cat -t zuup-heartbeat -p info || true
  exit 0
fi

while true; do
  curl --silent --fail --max-time 5 \
    --header 'content-type: application/json' \
    --data "{\"terminalId\":\"${TERMINAL_ID}\",\"status\":\"OK\"}" \
    "$EDGE/api/terminal/heartbeat" >/dev/null \
    || echo "heartbeat missed" | systemd-cat -t zuup-heartbeat -p warning || true
  sleep "$INTERVAL"
done
