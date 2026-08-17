#!/usr/bin/env bash
# ZUUP-OS HQ egress window (spec §6) — the ADMIN_STATION's uplink, and only
# while no paper is in flight.
#
# The centre has exactly one machine that is ever allowed to reach the outside
# world: the Centre Admin station. It pulls the provisioning bundle before exam
# day (§12) and forwards the sealed answer ledger afterwards (§13.4), and it can
# read neither — it is a courier carrying envelopes addressed to HQ.
#
# This daemon owns the WHEN of that. The WHERE is not its business and it cannot
# influence it: the destinations live in the `hq_dest` set inside the signed,
# read-only image, written at provisioning and only into an ADMIN_STATION image.
# So the worst this program can do, if it were wrong in every direction at once,
# is let the admin station talk to HQ at a moment it should not have — never to
# anywhere else, and never from any other terminal.
#
# Fail-closed in every direction: an unreachable Edge, an unparseable answer, a
# denial, or an unhandled error all end with the window SHUT. The only path that
# opens it is an explicit `"open":true` from the Edge, which the Edge refuses
# while any exam at this centre still has an open window or a candidate sitting
# at a seat that has not submitted.
set -euo pipefail

# ── host guard ──────────────────────────────────────────────────────────────
if [[ "$(uname -s)" != "Linux" ]]; then
  cat <<'EOF'
[zuup-os] Terminal-image artifact (needs Linux + nft); not running here.
          On an ADMIN_STATION it would poll the Edge for the centre's egress
          state and add or flush a single `accept` in the `hq_window` chain.
          Nothing was changed here.
EOF
  exit 0
fi

EDGE="${ZUUP_EDGE_URL:-http://edge.local:4000}"
# /run first: that is where zuup-identity.service publishes the id parsed out of
# the signed cmdline, and where the all-in-one's self-commissioning writes.
# /etc/zuup/terminal-id is the image placeholder and only ever a fallback.
ID_FILE="${ZUUP_TERMINAL_ID_FILE:-}"
if [[ -z "$ID_FILE" ]]; then
  for c in /run/zuup-identity/terminal-id /etc/zuup/terminal-id; do
    [[ -r "$c" ]] && { ID_FILE="$c"; break; }
  done
  ID_FILE="${ID_FILE:-/etc/zuup/terminal-id}"
fi
INTERVAL="${ZUUP_EGRESS_INTERVAL:-30}"
NFT="${ZUUP_NFT:-/usr/sbin/nft}"

log() {
  echo "zuup-egress: $*" | systemd-cat -t zuup-egress -p "${2:-info}" || true
}

# ── shut the window, and mean it ────────────────────────────────────────────
# Flushing the chain is what "closed" IS — the base output chain jumps here and
# falls through to its log+drop when there is nothing to match. Called on every
# exit path, including signals, so a daemon that dies never leaves the uplink up.
close_window() {
  "$NFT" flush chain inet zuup hq_window 2>/dev/null || true
}
trap 'close_window; exit 0' TERM INT
trap 'close_window' EXIT

# Start shut regardless of what any previous boot or crash left behind.
close_window

# ── is this machine even eligible? ──────────────────────────────────────────
# Two independent reasons to exit rather than poll forever, and both are normal
# rather than errors: this is the same unit on every image, and on most of them
# it has nothing to do.
if [[ ! -r "$ID_FILE" ]]; then
  log "no terminal identity — this machine is not commissioned; the window stays shut."
  exit 0
fi
TERMINAL_ID="$(tr -d ' \n' < "$ID_FILE")"
if [[ ! "$TERMINAL_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
  log "terminal identity is a placeholder — the window stays shut."
  exit 0
fi

# The decisive check, and the cheap one: if this image carries no HQ
# destination, there is no window to open onto. That is the case for every
# candidate seat and every invigilator station, by construction — `hq_dest` is
# written at provisioning only into an ADMIN_STATION image, and /etc is on the
# read-only dm-verity root, so nothing at runtime can add one.
if ! "$NFT" list set inet zuup hq_dest 2>/dev/null | grep -q 'elements'; then
  log "no HQ destination in this image — not an egress-capable station. Exiting."
  exit 0
fi

log "ADMIN_STATION egress supervisor started; polling $EDGE every ${INTERVAL}s (window currently SHUT)."

OPEN=0
while true; do
  # `--fail` so an HTTP denial is a curl failure rather than a body we might
  # misread; an empty RESP then falls through to the close branch below.
  RESP="$(curl --silent --fail --max-time 8 \
            "$EDGE/api/terminal/${TERMINAL_ID}/egress" 2>/dev/null || true)"

  # Decide on an explicit `"open":true`. Anything else — a denial, an empty
  # body, a timeout, a field that moved — closes. There is no parse failure that
  # results in an open uplink.
  WANT=0
  case "$RESP" in
    *'"open":true'*) WANT=1 ;;
  esac

  if [[ "$WANT" == 1 && "$OPEN" == 0 ]]; then
    if "$NFT" add rule inet zuup hq_window accept 2>/dev/null; then
      OPEN=1
      log "egress window OPEN — no paper in flight; the Centre Admin may reach HQ."
    else
      log "could not open the window (nft refused) — staying shut." warning
    fi
  elif [[ "$WANT" == 0 && "$OPEN" == 1 ]]; then
    close_window
    OPEN=0
    # Say WHY on the way down: an operator watching a transfer die mid-upload
    # needs to know a paper went live, not just that the link dropped.
    REASON="$(printf '%s' "$RESP" | sed -n 's/.*"reason":"\([A-Z_]*\)".*/\1/p' | head -1)"
    log "egress window SHUT${REASON:+ ($REASON)} — a paper is in flight or the Edge did not answer."
  fi

  sleep "$INTERVAL"
done
