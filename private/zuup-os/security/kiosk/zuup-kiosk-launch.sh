#!/bin/sh
# ZUUP-OS kiosk launcher (spec §7.4/§7.6) — chooses the ONE surface this
# terminal is allowed to present, by its Edge-reported capability, then hands
# the only display seat to Cage+Firefox locked at that URL.
#
# This is what makes the role tiering physical: a CANDIDATE_SEAT can never open
# the Centre Admin portal and an ADMIN_STATION never opens the candidate seat —
# the capability is provisioned in the signed image + the Edge registry, not
# chosen by whoever sits down. Deny-by-default: anything unexpected loads the
# fail-closed /locked wall, never a shell or a different role.
#
# Tiering (answers "where does each role log in"):
#   ADMIN_STATION        → /admin/  Centre Admin portal  (centre-admin, LAN-only)
#   INVIGILATOR_STATION  → /        exam-terminal Gate → invigilator login
#   CANDIDATE_SEAT       → /        exam-terminal Gate → candidate seat
#   (System Admin is NOT here — it is the HQ public-website tier, off the LAN.)
set -eu

EDGE="${ZUUP_EDGE_URL:-https://edge.local}"
ID_FILE="/etc/zuup/terminal-id"
FIREFOX="${ZUUP_FIREFOX:-/usr/lib/firefox/firefox}"
launch() { exec /usr/bin/cage -d -- "$FIREFOX" --kiosk "$1"; }

# No identity baked in → fail closed, never guess a role.
[ -r "$ID_FILE" ] || { echo "zuup-kiosk: no terminal id" >/dev/kmsg 2>/dev/null || true; launch "$EDGE/locked"; }
TID="$(tr -d ' \n' < "$ID_FILE")"

# Ask the Edge what this terminal is. A failure here is also fail-closed: the
# Login Gate itself shows the INV-10 "centre offline" wall, so /locked is safe.
CAP="$(curl -fsS --max-time 8 "$EDGE/api/terminal/$TID/capability" 2>/dev/null \
        | sed -n 's/.*"capability":"\([A-Z_]*\)".*/\1/p')"

case "$CAP" in
  ADMIN_STATION)       launch "$EDGE/admin/" ;;
  INVIGILATOR_STATION) launch "$EDGE/" ;;
  CANDIDATE_SEAT)      launch "$EDGE/" ;;
  *)                   launch "$EDGE/locked" ;;
esac
