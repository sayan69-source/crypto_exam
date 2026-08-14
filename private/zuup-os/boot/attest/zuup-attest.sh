#!/usr/bin/env bash
# ZUUP-OS boot-time remote attestation (spec §7.1) — runs on EVERY boot,
# after the WireGuard link is up and BEFORE the kiosk (the Login Gate) may
# start.
#
# Two legs, because one is not attestation:
#
#   1. POST /api/terminal/attest/challenge {terminalId}          → nonce
#   2. tpm2_quote over the golden PCR set, signed by this machine's restricted
#      Attestation Key, with the nonce as qualifying data
#      POST /api/terminal/attest {terminalId,nonce,quote,signature,pcrs} → {ok}
#
# The previous version sent a JSON dump of the PCR VALUES and the Edge compared
# it to the stored golden set. PCR values are not secret — every correctly-built
# terminal in the estate has the same ones — so any machine that had ever seen a
# good set could present it for any terminal id, from anywhere, at any time. A
# TPM signature over a fresh nonce is what turns "these are the right
# measurements" into "THIS machine measured them JUST NOW".
#
# FAIL-CLOSED in every direction (INV-10): a mismatch, an unknown terminal, an
# unreachable Edge, a missing TPM or a missing AK all end in poweroff. A
# terminal that cannot prove its boot chain never shows a login surface.
set -euo pipefail

# ── host guard ──────────────────────────────────────────────────────────────
# Note the ORDER: a real terminal with no tpm2-tools and no TPM must reach the
# variant-aware path below, not this early exit. This branch is for running the
# script off-hardware (a developer machine, a build host).
if [[ "$(uname -s)" != "Linux" ]]; then
  cat <<'EOF'
[zuup-os] Terminal-image artifact (needs Linux + tpm2-tools + a TPM); not running here.
          On a terminal it would: take a nonce from the Edge → tpm2_quote PCRs
          0,4,7,8,9,14 signed by the AK → POST quote+signature+PCRs → HALT unless
          the Edge answers {"ok":true}. Nothing was changed here.
EOF
  exit 0
fi

EDGE="${ZUUP_EDGE_URL:-http://edge.local:4000}"
VARIANT_FILE="/etc/zuup/image-variant"

# Identity material lives in one of two places, and the BAKED one always wins:
#
#   /etc/zuup/…            written into the signed image by an authority that
#                          commissioned this machine (production).
#   /run/zuup-identity/…   written by the machine itself at first boot, on the
#                          all-in-one variant only. /etc is on the read-only
#                          verity root, so a self-commissioning machine has
#                          nowhere else to put it.
first_existing() {
  for candidate in "$@"; do
    [[ -n "$candidate" && -r "$candidate" ]] && { printf '%s' "$candidate"; return 0; }
  done
  printf '%s' "$1"
}

# For the identity the file must not merely EXIST but contain a real id: the
# image ships `/etc/zuup/terminal-id` holding a placeholder, and taking that in
# preference to the commissioned id next door would make a commissioned machine
# report itself as uncommissioned.
first_identity() {
  for candidate in "$@"; do
    [[ -n "$candidate" && -r "$candidate" ]] || continue
    local value
    value="$(tr -d ' \n' < "$candidate")"
    [[ "$value" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] \
      && { printf '%s' "$candidate"; return 0; }
  done
  printf '%s' "$1"
}
ID_FILE="$(first_identity "${ZUUP_TERMINAL_ID_FILE:-}" /etc/zuup/terminal-id /run/zuup-identity/terminal-id)"
# The Attestation Key context, created at commissioning with `tpm2_createak`.
# The private half lives in the TPM and cannot be exported; only the public half
# was registered with the Edge (terminals.ak_pubkey_pem).
AK_CTX="$(first_existing "${ZUUP_AK_CTX:-}" /etc/zuup/ak.ctx /run/zuup-identity/ak.ctx)"
PCR_LIST="sha256:0,4,7,8,9,14"   # firmware, kernel, secure-boot state, GRUB/UKI stages
WORK="$(mktemp -d /run/zuup-attest.XXXXXX)"   # tmpfs: nothing lands on disk
trap 'rm -rf "$WORK"' EXIT

VARIANT=unknown
[[ -r "$VARIANT_FILE" ]] && VARIANT="$(tr -d ' \n' < "$VARIANT_FILE")"

note() {
  echo "zuup-attest: $1" | systemd-cat -t zuup-attest -p warning || true
  echo "zuup-attest: $1" > /dev/kmsg 2>/dev/null || true
}

# A boot chain that FAILED to verify. The image is not the image we signed, or
# the machine is not the machine we registered. Always fatal, every variant.
halt() {
  echo "ZUUP-ATTEST HALT: $1" | systemd-cat -t zuup-attest -p emerg || true
  systemctl poweroff --force
  exit 1
}

# A machine that was never COMMISSIONED, or has no TPM at all. This is not a
# failed attestation — it is the absence of one, and the two must not share an
# outcome.
#
# On production it is still fatal: a terminal nobody registered has no business
# rendering a Gate. Anywhere else it is reported and the boot continues, because
# powering off tells whoever just flashed the machine nothing at all, and on
# real hardware you may only get to flash it once. The Gate that follows is
# itself fail-closed — with no attestation on record, every privileged login
# denies with TPM_ATTESTATION_INVALID and says so on screen.
uncommissioned() {
  if [[ "$VARIANT" == "production" ]]; then
    halt "$1"
  fi
  note "$1 — continuing on variant=$VARIANT; every privileged login will deny (no attestation on record)."
  exit 0
}

# No tpm2-tools / no TPM device. On production that is a machine that cannot
# prove anything and must not run; elsewhere it is a laptop without a TPM 2.0,
# which can still serve the portals and simply never satisfies the TPM clause.
if ! command -v tpm2_quote >/dev/null 2>&1 || [[ ! -e /dev/tpmrm0 ]]; then
  uncommissioned "no TPM 2.0 available on this machine"
fi

[[ -r "$ID_FILE" ]] || uncommissioned "no terminal identity in the image"
TERMINAL_ID="$(tr -d ' \n' < "$ID_FILE")"
[[ "$TERMINAL_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] \
  || uncommissioned "terminal identity is a placeholder ('${TERMINAL_ID}') — this machine was never commissioned"
[[ -r "$AK_CTX" ]] || uncommissioned "no attestation key context ($AK_CTX) — terminal not commissioned"

# ── leg 1: a nonce the Edge chose ───────────────────────────────────────────
NONCE=""
for i in 1 2 3; do
  RESP="$(curl --silent --fail --max-time 10 \
            --header 'content-type: application/json' \
            --data "{\"terminalId\":\"$TERMINAL_ID\"}" \
            "$EDGE/api/terminal/attest/challenge" || true)"
  NONCE="$(printf '%s' "$RESP" | sed -n 's/.*"nonce":"\([0-9a-f]*\)".*/\1/p')"
  [[ -n "$NONCE" ]] && break
  sleep 5
done
# An Edge that never answered has not denied anything — it has said nothing. On
# production that is still fatal (no attestation, no power). On a laptop whose
# own Edge is still finishing its tmpfs database restore, powering off would be
# a race turned into a brick.
if [[ -z "$NONCE" ]]; then
  if [[ "$VARIANT" == "production" ]]; then
    halt "Edge unreachable — refusing to open the Gate without attestation"
  fi
  note "Edge unreachable at $EDGE — continuing on variant=$VARIANT; privileged logins will deny."
  exit 0
fi

# ── leg 2: quote the PCRs, with the nonce as qualifying data ────────────────
# -q binds the nonce INTO the signed structure (TPM2B_DATA extraData): this is
# what makes yesterday's quote worthless today.
# -f plain emits the bare signature the Edge verifies against the registered AK.
tpm2_quote \
  --key-context "$AK_CTX" \
  --pcr-list "$PCR_LIST" \
  --qualification "$NONCE" \
  --message "$WORK/quote.msg" \
  --signature "$WORK/quote.sig" \
  --format plain \
  --hash-algorithm sha256 >/dev/null 2>&1 || halt "TPM refused to produce a quote"

# The readable PCR values, as {"0":"<hex>",…}. The Edge re-hashes these and
# checks the result against the digest inside the signed quote, so a doctored
# list here fails rather than being believed.
PCR_JSON="$(tpm2_pcrread "$PCR_LIST" 2>/dev/null | python3 -c '
import sys, json, yaml
doc = yaml.safe_load(sys.stdin) or {}
bank = doc.get("sha256", {})
print(json.dumps({str(k): format(v, "064x") if isinstance(v, int) else str(v)
                  for k, v in bank.items()}, sort_keys=True))' 2>/dev/null)"
[[ -n "$PCR_JSON" && "$PCR_JSON" != "{}" ]] || halt "TPM unreadable"

QUOTE_HEX="$(xxd -p -c 0 "$WORK/quote.msg")"
SIG_HEX="$(xxd -p -c 0 "$WORK/quote.sig")"

BODY="$(printf '{"terminalId":"%s","nonce":"%s","quote":"%s","signature":"%s","pcrs":%s}' \
          "$TERMINAL_ID" "$NONCE" "$QUOTE_HEX" "$SIG_HEX" "$PCR_JSON")"
printf '%s' "$BODY" > "$WORK/body.json"

# One attempt: the nonce is one-shot, so a retry would need a fresh challenge.
RESP="$(curl --silent --max-time 10 \
          --header 'content-type: application/json' \
          --data "@$WORK/body.json" "$EDGE/api/terminal/attest" || true)"

if [[ "$RESP" == *'"ok":true'* ]]; then
  echo "attestation OK" | systemd-cat -t zuup-attest -p info
  exit 0
fi

# The Edge names the exact clause that failed; carry it into the journal, since
# an operator standing at a powered-off machine has nothing else to go on.
FAILURES="$(printf '%s' "$RESP" | sed -n 's/.*"failures":\[\([^]]*\)\].*/\1/p')"

# Distinguish "this machine is not registered" from "this machine's boot chain
# does not match". The first is an administrative gap; the second is the exact
# thing attestation exists to catch, and it halts on every variant.
case "$RESP" in
  *UNKNOWN_TERMINAL*|*NO_GOLDEN_PCR_REGISTERED*|*NO_ATTESTATION_KEY_REGISTERED*)
    uncommissioned "the Edge has no commissioning record for this terminal (${FAILURES:-unknown})"
    ;;
esac
halt "Edge DENIED this boot: ${FAILURES:-no response}"
