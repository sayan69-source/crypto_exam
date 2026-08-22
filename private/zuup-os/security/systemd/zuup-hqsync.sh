#!/usr/bin/env bash
# ZUUP-OS HQ courier (spec §12 in, §13.4 out) — the ADMIN_STATION's actual
# conversation with the public platform.
#
# ── What was missing ────────────────────────────────────────────────────────
#
# Everything around this existed. `zuup-identity` pinned the HQ destinations
# into `hq_dest`, `zuup-egressd` opened and shut the window over them, the Edge
# could ingest a provisioning bundle and export a sealed ledger, and the public
# site could build one and receive the other. Nothing ever carried a byte
# between them. A centre could be provisioned, sit an exam and seal every
# answer, and the papers stayed on a laptop in the hall.
#
# This is the courier. It runs on the one machine allowed out, and it does two
# things, both of which it could do blindfolded:
#
#   PULL   GET  <hq>/api/v1/centre-sync/bundle    → POST <edge>/api/provisioning/ingest
#   PUSH   POST <edge>/api/courier/ledger/export  → POST <hq>/api/v1/centre-sync/ledger
#
# ── Why it can be trusted with that, and what it cannot do ──────────────────
#
# It never holds a key that opens anything. Inbound, the bundle is signed by HQ
# and the Edge verifies that signature before it writes a row — so this program
# can drop a bundle or deliver one, and cannot write one. Outbound, every record
# is ciphertext under a data key wrapped to the System Admin's HSM, so the
# courier forwards envelopes it cannot open. Even the T₀ beacon that turns a
# sealed paper into a readable one is withheld by HQ until T₀ has passed.
#
# It also cannot choose its moment. The window it needs is opened by
# `zuup-egressd` only while the Edge reports no paper in flight, and the Edge's
# export refuses on the same condition — so a courier that ran at the wrong time
# reaches nothing and is refused by both ends.
#
# ── No DNS, on purpose ──────────────────────────────────────────────────────
#
# A terminal has no resolver: §6.3 drops UDP 53 and the firewall permits only
# the pinned `hq_dest` addresses. So the URL's host is never resolved. Every
# request is made with `curl --resolve host:port:ip`, using the address that
# provisioning put on the signed cmdline — the same address the firewall pins.
# TLS is still verified against the hostname, so the connection is authenticated
# by HQ's certificate AND pinned to an address the authority signed. A DNS
# answer cannot move this station, because nothing here asks one.
set -euo pipefail

IDENTITY_DIR="${ZUUP_IDENTITY_DIR:-/run/zuup-identity}"
EDGE="${ZUUP_EDGE_URL:-http://edge.local:4000}"
STATE_DIR="${ZUUP_HQSYNC_STATE:-/run/zuup-hqsync}"
CURL_TIMEOUT="${ZUUP_HQ_TIMEOUT:-45}"

log() {
  echo "zuup-hqsync: $*" | systemd-cat -t zuup-hqsync -p "${2:-info}" || true
  echo "zuup-hqsync: $*"
}

# ── host guard ──────────────────────────────────────────────────────────────
if [[ "$(uname -s)" != "Linux" ]]; then
  cat <<'EOF'
[zuup-os] Terminal-image artifact (needs Linux + curl); not running here.
          On an ADMIN_STATION it would pull this centre's provisioning bundle
          from HQ into the Edge, and push the Edge's sealed answer ledger back
          to HQ, while the egress window is open.
          Nothing was changed here.
EOF
  exit 0
fi

mkdir -p "$STATE_DIR"

# ── eligibility: this unit ships on every image and does nothing on most ────
CAPABILITY="$(cat "$IDENTITY_DIR/capability" 2>/dev/null || true)"
if [[ "$CAPABILITY" != "ADMIN_STATION" ]]; then
  log "capability=${CAPABILITY:-none} — only an ADMIN_STATION carries traffic to HQ. Nothing to do."
  exit 0
fi

HQ_URL="$(cat "$IDENTITY_DIR/hq-url" 2>/dev/null || true)"
HQ_RESOLVE="$(cat "$IDENTITY_DIR/hq-resolve" 2>/dev/null || true)"
CENTRE_ID="$(cat "$IDENTITY_DIR/centre-id" 2>/dev/null || true)"
HQ_KEY_FILE="$IDENTITY_DIR/hq-centre.key"
EDGE_KEY_FILE="$IDENTITY_DIR/edge-provisioning.key"

# Each of these is a provisioning fault with a different remedy, so each is
# named rather than folded into one "not configured".
[[ -n "$HQ_URL"    ]] || { log "no zuup.hq_url on the signed cmdline — this station was provisioned without an HQ address." err; exit 0; }
[[ -n "$CENTRE_ID" ]] || { log "no zuup.centre on the signed cmdline — HQ would not know which centre this is." err; exit 0; }
[[ -r "$HQ_KEY_FILE" ]] || { log "no hq-centre.key on the ESP — this station has no credential at HQ." err; exit 0; }
[[ -r "$EDGE_KEY_FILE" ]] || { log "no edge-provisioning.key on the ESP — this station cannot write to its own Edge." err; exit 0; }

HQ_KEY="$(tr -d ' \n' < "$HQ_KEY_FILE")"
EDGE_KEY="$(tr -d ' \n' < "$EDGE_KEY_FILE")"

# ── curl, pinned ────────────────────────────────────────────────────────────
#
# `--resolve` is repeated once per provisioned address, so a multi-homed HQ
# still works and curl fails over between them on its own. `--fail-with-body`
# rather than `--fail`: HQ's refusals carry a reason in the body and losing it
# turns every diagnosis into a bare exit code.
CURL_RESOLVE=()
if [[ -n "$HQ_RESOLVE" ]]; then
  while read -r entry; do
    [[ -n "$entry" ]] && CURL_RESOLVE+=(--resolve "$entry")
  done <<< "$HQ_RESOLVE"
fi

hq_curl() {
  curl --silent --show-error --fail-with-body \
       --max-time "$CURL_TIMEOUT" \
       --proto '=https' --tlsv1.2 \
       "${CURL_RESOLVE[@]+"${CURL_RESOLVE[@]}"}" \
       -H "x-centre-id: ${CENTRE_ID}" \
       -H "x-centre-key: ${HQ_KEY}" \
       "$@"
}

edge_curl() {
  curl --silent --show-error --fail-with-body \
       --max-time "$CURL_TIMEOUT" \
       -H "x-provisioning-key: ${EDGE_KEY}" \
       "$@"
}

# Pull one JSON field without a JSON parser in the image beyond python3, which
# is already there for the biometric daemon. `json.load` on a stream keeps a
# 40 MB bundle out of a shell variable.
jfield() { python3 -c '
import json,sys
doc = json.load(sys.stdin)
for k in sys.argv[1].split("."):
    if isinstance(doc, dict):
        doc = doc.get(k)
    else:
        doc = None
print("" if doc is None else (doc if isinstance(doc, str) else json.dumps(doc)))
' "$1" 2>/dev/null || true; }

# ── 1. reachable at all? ────────────────────────────────────────────────────
HELLO="$STATE_DIR/hello.json"
if ! hq_curl -o "$HELLO" "${HQ_URL%/}/api/v1/centre-sync/hello"; then
  # Overwhelmingly the ordinary case, not a fault: the egress window is shut
  # for all but a few minutes of a centre's week.
  log "HQ not reachable (window shut, or no uplink). Will try again on the next tick."
  exit 0
fi
log "HQ reachable as centre ${CENTRE_ID}; available: $(jfield available < "$HELLO")"

# ── 2. PULL — this centre's bundle, into the Edge ───────────────────────────
#
# Every run, not once: candidates are added, staff are approved, and a paper's
# T₀ beacon appears in the bundle only after T₀ has passed. Ingest is idempotent
# on the Edge (§12), so re-delivering an unchanged bundle costs a write and
# changes nothing.
BUNDLE="$STATE_DIR/bundle.json"
PAYLOAD="$STATE_DIR/bundle-payload.json"
if hq_curl -o "$BUNDLE" "${HQ_URL%/}/api/v1/centre-sync/bundle"; then
  SIG="$(jfield signature < "$BUNDLE")"
  # Split the envelope: the Edge is posted the `bundle` object verbatim, and
  # HQ's signature covers exactly those canonical bytes. Re-serialising with
  # python's default separators would change the bytes and break the signature,
  # so this writes compact, sorted JSON — the same canonical form both ends sign.
  if python3 -c '
import json,sys
doc = json.load(open(sys.argv[1], encoding="utf-8"))
b = doc.get("bundle")
if b is None:
    sys.exit(3)
with open(sys.argv[2], "w", encoding="utf-8") as f:
    json.dump(b, f, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
' "$BUNDLE" "$PAYLOAD"; then
    RESP="$STATE_DIR/ingest-response.json"
    if edge_curl -o "$RESP" -X POST \
         -H "content-type: application/json" \
         ${SIG:+-H "x-hq-signature: ${SIG}"} \
         --data-binary "@$PAYLOAD" \
         "${EDGE%/}/api/provisioning/ingest"; then
      log "bundle ingested into the Edge: $(tr -d '\n' < "$RESP" | head -c 300)"
    else
      # Named loudly: an Edge that refuses the bundle is the difference between
      # a centre that can run tomorrow's paper and one that cannot, and the
      # reason is in that body (HQ_SIGNATURE_INVALID, BAD_PROVISIONING_KEY, …).
      log "Edge REFUSED the provisioning bundle: $(tr -d '\n' < "$RESP" 2>/dev/null | head -c 300)" err
    fi
  else
    log "HQ returned no bundle object — nothing ingested." warning
  fi
else
  log "could not pull the bundle from HQ: $(tr -d '\n' < "$BUNDLE" 2>/dev/null | head -c 200)" warning
fi

# ── 3. PUSH — sealed answers, out ───────────────────────────────────────────
#
# The Edge decides what may leave. This asks what is waiting, and for each exam
# whose gate is already open it takes the bundle and forwards it. An exam that
# is still running answers `mayExport:false` and is skipped in silence — that is
# the normal state during a paper, not an error.
STATE="$STATE_DIR/courier-state.json"
if ! edge_curl -o "$STATE" "${EDGE%/}/api/courier/state"; then
  log "Edge did not answer the courier state query: $(tr -d '\n' < "$STATE" 2>/dev/null | head -c 200)" warning
  exit 0
fi

EXAMS="$(python3 -c '
import json,sys
doc = json.load(open(sys.argv[1], encoding="utf-8"))
for e in doc.get("exams", []):
    if e.get("mayExport") and e.get("unsynced", 0) > 0:
        print(e["examId"], e.get("unsynced", 0))
' "$STATE" 2>/dev/null || true)"

if [[ -z "$EXAMS" ]]; then
  log "nothing sealed is waiting to leave (or every paper is still in flight)."
  exit 0
fi

while read -r EXAM_ID COUNT; do
  [[ -n "$EXAM_ID" ]] || continue
  EXPORT="$STATE_DIR/export-${EXAM_ID}.json"
  LEDGER="$STATE_DIR/ledger-${EXAM_ID}.json"

  if ! edge_curl -o "$EXPORT" -X POST \
        -H "content-type: application/json" \
        --data "{\"examId\":\"${EXAM_ID}\"}" \
        "${EDGE%/}/api/courier/ledger/export"; then
    log "exam ${EXAM_ID}: Edge refused the export: $(tr -d '\n' < "$EXPORT" 2>/dev/null | head -c 200)" warning
    continue
  fi

  # The Edge marks the records SYNCED as it exports them, so the bundle in hand
  # is the ONLY copy of that hand-off. If the POST to HQ fails, the bundle is
  # kept in /run and retried on the next tick rather than dropped — and /run is
  # a tmpfs, so a power cut before HQ acknowledges loses it. Say so plainly:
  # recovery is a Centre Admin re-export from the console, which is why the
  # console route still exists alongside this one.
  if ! python3 -c '
import json,sys
doc = json.load(open(sys.argv[1], encoding="utf-8"))
b = doc.get("bundle")
if not b:
    sys.exit(3)
with open(sys.argv[2], "w", encoding="utf-8") as f:
    json.dump(b, f, separators=(",", ":"), ensure_ascii=False)
' "$EXPORT" "$LEDGER"; then
    log "exam ${EXAM_ID}: the Edge had nothing sealed to export after all."
    continue
  fi

  RESP="$STATE_DIR/deliver-${EXAM_ID}.json"
  if hq_curl -o "$RESP" -X POST \
       -H "content-type: application/json" \
       --data-binary "@$LEDGER" \
       "${HQ_URL%/}/api/v1/centre-sync/ledger"; then
    log "exam ${EXAM_ID}: ${COUNT} sealed record(s) delivered to HQ: $(tr -d '\n' < "$RESP" | head -c 300)"
    rm -f "$LEDGER" "$EXPORT"
  else
    log "exam ${EXAM_ID}: HQ REFUSED the sealed ledger: $(tr -d '\n' < "$RESP" 2>/dev/null | head -c 300). The bundle is held at ${LEDGER} and retried next tick." err
  fi
done <<< "$EXAMS"

log "courier run complete."
