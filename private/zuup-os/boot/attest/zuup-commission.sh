#!/usr/bin/env bash
# ZUUP-OS first-boot commissioning — ALL-IN-ONE / DEV IMAGES ONLY.
#
# A production terminal is commissioned by an authority before it is ever
# powered on: someone records its golden PCRs, registers its Attestation Key and
# its biometric daemon key with the Edge, and writes its identity into the
# signed image. That is the whole basis of §7.1, and this script must never run
# on such a machine — it checks the image variant and exits if it is production.
#
# The all-in-one image is a different object. One laptop IS the centre: it runs
# the Edge, both portals and the terminal surface at once, so there is no
# separate authority that could have registered it beforehand. The choice is
# between shipping fixture rows inside the image — which is exactly how a demo
# seed becomes the thing a deployment runs on — or having the machine register
# the identity, keys and measurements it actually has. This is the second.
#
# What it creates: STATIONS, not people. Nobody gains access from this. Every
# identity that logs in still has to register at a station, be approved by the
# tier above it, and pass the full §8.2 match-all rule.
#
# Runs once per boot. The roles file on the identity tmpfs is the marker;
# the Edge independently refuses to re-commission an id it already knows, so a
# lost marker cannot re-key a machine.
set -euo pipefail

VARIANT_FILE=/etc/zuup/image-variant
# Everything this script produces lands on the /run/zuup-identity tmpfs
# (rootfs/overlay.fstab), NOT in /etc: the root filesystem is read-only squashfs
# behind dm-verity, so /etc/zuup cannot be written at runtime at all. RAM-only is
# also the right place for it — the keys die at power-off (INV-2) and the machine
# re-registers on the next boot, which matches the all-in-one's tmpfs database.
#
# NOT /run/zuup: the all-in-one's PostgreSQL claims that path as its own tmpfs,
# owned by postgres and mode 0750, which would hide the roles file from the
# portal services that have to read it.
IDENTITY_DIR="${ZUUP_IDENTITY_DIR:-/run/zuup-identity}"
STATE_DIR="${ZUUP_STATE_DIR:-$IDENTITY_DIR/state}"
ROLES_FILE="${ZUUP_ROLES_FILE:-$IDENTITY_DIR/terminal-roles.json}"
ID_FILE="${ZUUP_TERMINAL_ID_FILE:-$IDENTITY_DIR/terminal-id}"
BIO_KEY="${ZUUP_BIO_KEY:-$IDENTITY_DIR/biometric-attest.key}"
AK_CTX="${ZUUP_AK_CTX:-$IDENTITY_DIR/ak.ctx}"
EDGE="${ZUUP_EDGE_URL:-http://edge.local}"
PCR_LIST="sha256:0,4,7,8,9,14"
CENTRE_NAME="${ZUUP_CENTRE_NAME:-Self-commissioned centre}"

# STDERR for the journal, /dev/kmsg so it also lands on the laptop's screen (dev
# images register console=tty0).
#
# stderr, not stdout, and that is load-bearing: `commission_one` returns the new
# terminal id on stdout and is called inside `$( )`. A log line on stdout would
# be captured into the id, and the roles file would name stations like
# "zuup-commission: commissioned ADMIN_STATION…<uuid>" — which no lookup would
# ever match, on a machine that reported commissioning as successful.
log() {
  echo "zuup-commission: $*" >&2
  echo "zuup-commission: $*" > /dev/kmsg 2>/dev/null || true
}

VARIANT=unknown
[[ -r "$VARIANT_FILE" ]] && VARIANT="$(tr -d ' \n' < "$VARIANT_FILE")"
if [[ "$VARIANT" != "allinone" && "$VARIANT" != "dev" ]]; then
  log "variant=$VARIANT — first-boot commissioning is not available on this image."
  exit 0
fi

# ── host guard: this is a terminal-image artifact ───────────────────────────
if [[ "$(uname -s)" != "Linux" ]]; then
  cat <<'EOF'
[zuup-os] Terminal-image artifact (needs Linux); not running here.
          On the all-in-one it would: generate this machine's station
          identities and daemon key, read its own PCRs, register them with the
          on-board Edge, and write /run/zuup/terminal-roles.json. Nothing was
          changed here.
EOF
  exit 0
fi

if [[ -s "$ROLES_FILE" ]]; then
  log "already commissioned this boot ($ROLES_FILE) — nothing to do."
  exit 0
fi

mkdir -p "$IDENTITY_DIR" "$STATE_DIR" "$(dirname "$ROLES_FILE")"
chmod 0755 "$IDENTITY_DIR"
chmod 0700 "$STATE_DIR"

# ── the biometric daemon's signing key ──────────────────────────────────────
# One key for the machine: the daemon that owns the camera and the reader signs
# every score with it, and the Edge accepts scores only under it (§8.4).
BIO_PUB=""
if [[ ! -s "$BIO_KEY" ]]; then
  # A station without a daemon key cannot capture, and the Gate reports exactly
  # that rather than silently accepting an unsigned score.
  if openssl genpkey -algorithm ed25519 -out "$BIO_KEY" 2>/dev/null; then
    chmod 0640 "$BIO_KEY"
    chgrp zuup-bio "$BIO_KEY" 2>/dev/null || true
  else
    log "WARNING: cannot write $BIO_KEY — this station will not be able to capture biometrics."
  fi
fi
if [[ -s "$BIO_KEY" ]]; then
  BIO_PUB="$(openssl pkey -in "$BIO_KEY" -pubout 2>/dev/null || true)"
fi

# ── the TPM attestation key + this boot's measurements ──────────────────────
# Both are optional HERE and only here: a machine with no TPM 2.0 can still
# serve the portals, it simply cannot satisfy the TPM clause of the login rule.
# The Edge records exactly that, and the Gate says so on screen instead of
# denying with no explanation.
AK_PUB=""
GOLDEN_PCR="null"
if command -v tpm2_createak >/dev/null 2>&1 && [[ -e /dev/tpmrm0 ]]; then
  if tpm2_createek -c "$STATE_DIR/ek.ctx" >/dev/null 2>&1 &&
     tpm2_createak -C "$STATE_DIR/ek.ctx" -c "$AK_CTX" -u "$STATE_DIR/ak.pub" \
                   -f pem -n "$STATE_DIR/ak.name" >/dev/null 2>&1; then
    AK_PUB="$(cat "$STATE_DIR/ak.pub" 2>/dev/null || true)"
    GOLDEN_PCR="$(tpm2_pcrread "$PCR_LIST" 2>/dev/null | python3 -c '
import sys, json, yaml
doc = yaml.safe_load(sys.stdin) or {}
bank = doc.get("sha256", {})
print(json.dumps({str(k): format(v, "064x") if isinstance(v, int) else str(v)
                  for k, v in bank.items()}, sort_keys=True))' 2>/dev/null || echo null)"
    log "TPM present — AK created, golden PCRs taken from THIS boot."
  else
    log "WARNING: a TPM is present but the attestation key could not be created."
  fi
else
  log "NOTE: no TPM 2.0 on this machine — the TPM login factor will be unavailable."
fi

# ── say what happened, on the screen ────────────────────────────────────────
#
# This machine has no shell: §7.3 strips su/login/agetty, so there is no getty
# to read a journal on. If commissioning fails, "check the journal" is advice
# nobody can take — the only surface that can carry a diagnosis is the kiosk
# browser. So every outcome is written here, and the role chooser renders it.
STATUS_FILE="${ZUUP_STATUS_FILE:-$IDENTITY_DIR/commission-status.json}"
STATUS_STATE="RUNNING"
STATUS_DETAIL="starting"

write_status() {
  STATUS_STATE="$1"; STATUS_DETAIL="$2"
  python3 - "$STATUS_STATE" "$STATUS_DETAIL" "$AK_PUB" "$BIO_PUB" > "$STATUS_FILE.tmp" <<'PY'
import json, sys
state, detail, ak, bio = sys.argv[1:5]
print(json.dumps({
    "state": state,
    "detail": detail,
    "hasTpmKey": bool(ak.strip()),
    "hasBiometricKey": bool(bio.strip()),
}, indent=2))
PY
  mv "$STATUS_FILE.tmp" "$STATUS_FILE"
  chmod 0644 "$STATUS_FILE"
}
# A crash anywhere below still leaves a readable reason on the screen.
trap 'rc=$?; [[ "$STATUS_STATE" == "RUNNING" ]] && write_status FAILED "commissioning exited unexpectedly (rc=$rc) at line $LINENO"; exit $rc' EXIT

write_status RUNNING "waiting for the centre edge at $EDGE"

# ── wait for the on-board Edge ──────────────────────────────────────────────
EDGE_UP=0
for i in $(seq 1 60); do
  if curl -sf --max-time 3 "$EDGE/api/health" >/dev/null 2>&1; then EDGE_UP=1; break; fi
  sleep 2
done
if [[ "$EDGE_UP" -ne 1 ]]; then
  log "ERROR: the Edge never answered at $EDGE — cannot commission."
  write_status FAILED "the centre edge never answered at $EDGE after 120s — check zuup-edge and zuup-db"
  exit 1
fi

# ── register one station per role this laptop stands in for ─────────────────
# A real centre has these on separate machines; here they are three identities
# on one, which is what lets the operator open each surface in turn. Each is a
# genuine registry row with this machine's real keys and measurements.
# `commission_one` runs inside `$( )`, i.e. a SUBSHELL — a variable it assigns
# is gone the moment it returns, so the parent read an empty reason and reported
# "no response" for refusals the Edge had explained perfectly well. The error
# has to travel through the filesystem to survive the subshell.
ERROR_FILE="$STATE_DIR/last-error"
: > "$ERROR_FILE"
last_error() { cat "$ERROR_FILE" 2>/dev/null || true; }

commission_one() {
  local role="$1" seat="$2" uuid body resp code
  uuid="$(cat /proc/sys/kernel/random/uuid)"

  # The key material must be in the environment of the process that BUILDS the
  # body, not merely of the curl that posts it. It was only on the curl line, so
  # both keys serialised as null: the station registered with no biometric key,
  # and no capture could ever have been verified on it.
  body="$(ZUUP_AK_PUB="$AK_PUB" ZUUP_BIO_PUB="$BIO_PUB" \
          python3 - "$uuid" "$seat" "$role" "$CENTRE_NAME" "$GOLDEN_PCR" <<'PY'
import json, sys, os
uuid, seat, role, centre, golden = sys.argv[1:6]
print(json.dumps({
    "terminalId": uuid,
    "seatNo": seat,
    "capability": role,
    "centreName": centre,
    "wgPubkey": "self:" + uuid,
    "goldenPcr": json.loads(golden) if golden and golden != "null" else None,
    "akPubkeyPem": os.environ.get("ZUUP_AK_PUB") or None,
    "bioPubkeyPem": os.environ.get("ZUUP_BIO_PUB") or None,
}))
PY
)"

  # Decide on the HTTP STATUS, never on the shape of the body. The previous
  # check was `[[ "$resp" == *'"ok":true'* ]]`, which is a guess about another
  # program's whitespace: one space after the colon and a SUCCESSFUL
  # commissioning reads as a failure. That is not a thing to be clever about at
  # 3 a.m. on a machine with no shell.
  local out="$STATE_DIR/resp.$role.json"
  code="$(curl -s -o "$out" -w '%{http_code}' --max-time 10 \
            --header 'content-type: application/json' \
            --data "$body" "$EDGE/api/terminal/commission" || echo 000)"
  resp="$(cat "$out" 2>/dev/null || true)"
  rm -f "$out"

  if [[ "$code" == "200" ]]; then
    log "commissioned $role as $seat ($uuid)"
    printf '%s' "$uuid"
    return 0
  fi
  # The Edge names its own refusals; carry that word to the screen verbatim.
  #
  # And when it does NOT name one, carry whatever it did say. An unhandled
  # exception comes back as Fastify's `{"statusCode":500,"error":"Internal
  # Server Error","message":"…"}` — no `reason` field, so this used to reduce to
  # a bare "HTTP 500". The first boot on real hardware printed exactly that,
  # while the body on the wire read `column "commissioned_via" does not exist`:
  # the entire diagnosis, discarded one line before the screen. This machine has
  # no shell and may only be flashed once; whatever the Edge said is the only
  # evidence there is.
  local reason detail message
  reason="$(printf '%s' "$resp" | sed -n 's/.*"reason":"\([A-Z_]*\)".*/\1/p')"
  if [[ -z "$reason" ]]; then
    message="$(printf '%s' "$resp" \
                 | sed -n 's/.*"message":"\([^"]*\)".*/\1/p' | cut -c1-160)"
    reason="${message:-${resp:0:160}}"
  fi
  detail="$role: HTTP ${code}${reason:+ ($reason)}"
  printf '%s' "$detail" > "$ERROR_FILE"
  log "ERROR: $role could not be commissioned — $detail"
  return 1
}

# Each station is attempted independently. Aborting the whole run on the first
# failure left NO roles file and NO explanation, which is the difference between
# "the admin station is missing" and a blank chooser.
write_status RUNNING "registering this machine's stations"
ADMIN_ID="$(commission_one ADMIN_STATION ADM-1 || true)"
INVIG_ID="$(commission_one INVIGILATOR_STATION INV-1 || true)"
SEAT_ID="$(commission_one CANDIDATE_SEAT A-01 || true)"

if [[ -z "$ADMIN_ID$INVIG_ID$SEAT_ID" ]]; then
  write_status FAILED "the centre edge refused every station — $(last_error)"
  log "ERROR: no station could be commissioned — $(last_error)"
  exit 1
fi

# The terminal surface reads this to learn which identities this machine holds.
# The browser can then present any of THEM and nothing else — the list is the
# machine's, not the URL's.
# Only stations that actually registered are listed. A role entry whose id is
# empty would be a card that opens onto nothing.
python3 - "$ADMIN_ID" "$INVIG_ID" "$SEAT_ID" > "$ROLES_FILE" <<'PY'
import json, sys
admin, invig, seat = sys.argv[1:4]
wanted = [
    ("ADMIN_STATION", admin, "ADM-1"),
    ("INVIGILATOR_STATION", invig, "INV-1"),
    ("CANDIDATE_SEAT", seat, "A-01"),
]
print(json.dumps({
    "commissionedVia": "FIRST_BOOT",
    "roles": [
        {"role": r, "terminalId": t.strip(), "seatNo": s}
        for r, t, s in wanted if t.strip()
    ],
}, indent=2))
PY
chmod 0644 "$ROLES_FILE"

# The invigilator station is this machine's primary identity, so anything that
# asks "which terminal am I" without naming a role gets a real answer. Fall back
# to whichever station DID register, so a partial run still yields an identity.
printf '%s\n' "${INVIG_ID:-${ADMIN_ID:-$SEAT_ID}}" > "$ID_FILE"
chmod 0644 "$ID_FILE"

if [[ -n "$ADMIN_ID" && -n "$INVIG_ID" && -n "$SEAT_ID" ]]; then
  write_status OK "all three stations registered"
  log "first-boot commissioning complete — roles written to $ROLES_FILE"
else
  write_status PARTIAL "some stations did not register — $(last_error)"
  log "first-boot commissioning PARTIAL — $(last_error)"
fi
