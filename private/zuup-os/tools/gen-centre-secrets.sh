#!/usr/bin/env bash
# ZUUP-OS centre secret generation (spec §6, §9.8, §11.3) — mint one centre's
# real secrets and deliver them the way systemd expects secrets to be delivered.
#
# ── What this replaces ──────────────────────────────────────────────────────
#
# The all-in-one Edge unit carries these, in the file, in git:
#
#   EDGE_TOKEN_SECRET=1111…aa      the HMAC key for every privileged session
#   EDGE_BIND_SECRET=2222…bb       the seat-binding key
#   EDGE_NODE_SIGN_SEED=3333…cc    the centre's root-signing seed
#
# Those are fine for a demo and catastrophic anywhere else: the token secret
# alone forges a SYSTEM_ADMIN session at every centre that shares it, and the
# node seed forges the signature HQ uses to detect a tampered ledger. They are
# also identical across every deployment that ever copied that file.
#
# `config.ts` already refuses to start without real values in production (it
# throws rather than inventing an ephemeral key). What did not exist was
# anything that PRODUCES them, which is why the demo values were still there.
#
# ── Why systemd credentials rather than Environment= ────────────────────────
#
# `Environment=` puts a secret in the unit file, in `systemctl show`, and in
# /proc/<pid>/environ — readable by anything that can see the process. systemd
# credentials are passed through a private ramfs, mode 0400, visible only to the
# service, and never appear in the unit's own text. The Edge reads them via the
# `_FILE` convention config.ts already supports for PEMs; this writes the
# credential files and a drop-in that points at them.
set -euo pipefail

die() { echo "[secrets] FAIL: $*" >&2; exit 1; }

OUT=""; CENTRE_ID=""; FORCE=0
usage() {
  cat <<'EOF'
usage: gen-centre-secrets.sh --out DIR --centre-id UUID [--force]

Writes, for ONE centre:
  edge-token-secret       32 bytes, hex     session token HMAC (§9.8)
  edge-bind-secret        32 bytes, hex     seat bind tokens (§9.6)
  edge-node-sign-seed     32 bytes, hex     centre root signing (§11.3)
  edge-provisioning-key   32 bytes, hex     HQ -> Edge ingest shared secret (§12)
  wg-edge.key / .pub                        the Edge's WireGuard identity
  wg-centre.psk                             centre-wide WireGuard preshared key
  centre.conf                               the config fragment provision-terminal.sh reads
  zuup-edge-credentials.conf                systemd drop-in wiring them in

Everything is written 0600 into a directory this script creates 0700.
EOF
  exit 1
}
while (($#)); do
  case "$1" in
    --out) OUT="${2:?}"; shift 2 ;;
    --centre-id) CENTRE_ID="${2:?}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage ;;
    *) die "unknown argument $1" ;;
  esac
done
[[ -n "$OUT" && -n "$CENTRE_ID" ]] || usage
[[ "$CENTRE_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] \
  || die "--centre-id must be a UUID"
command -v openssl >/dev/null || die "openssl is required"

# Refuse to overwrite silently. Regenerating a centre's token secret invalidates
# every live session; regenerating the node seed makes every ledger HQ already
# holds unverifiable against the new key. Both are recoverable, neither should
# happen by accident.
if [[ -e "$OUT" && "$FORCE" != 1 ]]; then
  die "$OUT already exists. Re-running rotates this centre's keys and invalidates
        every session and every previously-exported ledger signature. Pass
        --force if that is genuinely what you mean."
fi

# umask BEFORE anything is created — a secret that is 0644 for an instant on a
# shared host has been readable.
umask 077
mkdir -p "$OUT"
chmod 0700 "$OUT"

hex32() { openssl rand -hex 32; }
for name in edge-token-secret edge-bind-secret edge-node-sign-seed edge-provisioning-key; do
  hex32 > "$OUT/$name"
  chmod 0600 "$OUT/$name"
done

# The Edge ingest secret is also handed to the admin station, so the courier can
# write the bundle it pulls from HQ into its own Edge. Read it back rather than
# regenerating: the two must be the same value or the station's every ingest is
# a 401 nobody would connect to this file.
PROV_KEY="$(cat "$OUT/edge-provisioning-key")"

# ── the Edge's WireGuard identity ───────────────────────────────────────────
if command -v wg >/dev/null 2>&1; then
  wg genkey > "$OUT/wg-edge.key"; chmod 0600 "$OUT/wg-edge.key"
  wg pubkey < "$OUT/wg-edge.key" > "$OUT/wg-edge.pub"
  wg genpsk > "$OUT/wg-centre.psk"; chmod 0600 "$OUT/wg-centre.psk"
  EDGE_PUB="$(cat "$OUT/wg-edge.pub")"
  PSK="$(cat "$OUT/wg-centre.psk")"
else
  echo "[secrets] wireguard-tools not present — skipping the WG identity." >&2
  echo "[secrets] Generate it on the Edge appliance and fill centre.conf by hand." >&2
  EDGE_PUB="REPLACE-WITH-EDGE-WG-PUBKEY"
  PSK="REPLACE-WITH-CENTRE-PRESHARED-KEY"
fi

# ── the fragment provision-terminal.sh consumes ─────────────────────────────
cat > "$OUT/centre.conf" <<EOF
# ZUUP-OS centre parameters — generated $(date -u +%Y-%m-%dT%H:%M:%SZ)
#
# Consumed by tools/provision-terminal.sh --centre-config. Contains the centre
# PRESHARED key, so this file is as sensitive as the directory around it.
CENTRE_ID=${CENTRE_ID}
CENTRE_NAME="REPLACE WITH THE CENTRE'S NAME"

# The address terminals send their WireGuard handshake to, and the Edge's
# address inside the tunnel. Must match network/pxe/dnsmasq.conf.
EDGE_LAN_IP=10.0.0.1
EDGE_TUNNEL_IP=10.9.0.1
TUNNEL_SUBNET=10.9.0

EDGE_PUBLIC_KEY=${EDGE_PUB}
CENTRE_PRESHARED_KEY=${PSK}

# ── the uplink, which exactly one terminal in the centre gets ─────────────
#
# HQ_BASE_URL is the public platform, as a NAME: it is what the courier verifies
# HQ's TLS certificate against and the origin it appends /api/v1/centre-sync/...
# to. Leave HQ_ENDPOINTS blank and provision-terminal.sh resolves that name ON
# THE PROVISIONING HOST and freezes the addresses into the signed cmdline —
# because a terminal has no resolver (§6.3 drops DNS) and must not take the exam
# hall's word for where HQ lives.
#
# Set HQ_ENDPOINTS by hand instead when HQ sits behind a fixed address you want
# pinned regardless of DNS. Either way these are ADMIN_STATION-only:
# provision-terminal.sh refuses to place them on another capability and
# zuup-identity.sh ignores them if they somehow arrive there.
HQ_BASE_URL=https://REPLACE-WITH-THE-PUBLIC-PLATFORM
HQ_ENDPOINTS=

# This centre's credential at HQ. Mint it as tier-0 with
#   POST /api/v1/centre-sync/centres/${CENTRE_ID}/key
# and paste the value here; HQ keeps only its hash and will not show it twice.
# provision-terminal.sh writes it to the admin station's ESP.
HQ_CENTRE_KEY=REPLACE-WITH-THE-CENTRE-SYNC-KEY

# The Edge write credential, repeated here so provision-terminal.sh can put it
# on the admin station's ESP: the courier writes the bundle it fetches into the
# Edge with it, and the Edge additionally requires HQ's signature on that bundle
# (HQ_PROVISIONING_PUBKEY) — so this key carries post and cannot write it.
EDGE_PROVISIONING_KEY=${PROV_KEY}
EOF
chmod 0600 "$OUT/centre.conf"

# ── the systemd drop-in ─────────────────────────────────────────────────────
cat > "$OUT/zuup-edge-credentials.conf" <<'EOF'
# ZUUP-OS Edge secrets, delivered as systemd credentials.
#
# Install as:
#   /etc/systemd/system/zuup-edge.service.d/credentials.conf
# with the four files below in /etc/zuup/secrets (0600 root:root, dir 0700).
#
# LoadCredential= copies each file into a per-service ramfs at
# $CREDENTIALS_DIRECTORY, mode 0400, owned by the service and invisible to every
# other process — unlike Environment=, which lands the value in the unit file,
# in `systemctl show`, and in /proc/<pid>/environ.
[Service]
LoadCredential=edge-token-secret:/etc/zuup/secrets/edge-token-secret
LoadCredential=edge-bind-secret:/etc/zuup/secrets/edge-bind-secret
LoadCredential=edge-node-sign-seed:/etc/zuup/secrets/edge-node-sign-seed
LoadCredential=edge-provisioning-key:/etc/zuup/secrets/edge-provisioning-key

# The demo values these replace were hardcoded in the unit and committed. Clear
# them explicitly: a drop-in ADDS to Environment=, it does not remove, so
# without these four lines the unit file's 1111…aa would still win.
Environment=EDGE_TOKEN_SECRET=
Environment=EDGE_BIND_SECRET=
Environment=EDGE_NODE_SIGN_SEED=
Environment=EDGE_PROVISIONING_KEY=

ExecStartPre=/bin/sh -c 'test -s "$CREDENTIALS_DIRECTORY/edge-token-secret" || { echo "edge credentials missing" >&2; exit 1; }'
EOF

cat <<EOF

  centre      ${CENTRE_ID}
  written to  ${OUT}/  (0700; every file 0600)

  ON THE EDGE APPLIANCE
    install -d -m 0700 /etc/zuup/secrets
    install -m 0600 ${OUT}/edge-*        /etc/zuup/secrets/
    install -D -m 0644 ${OUT}/zuup-edge-credentials.conf \\
        /etc/systemd/system/zuup-edge.service.d/credentials.conf

  ON THE PROVISIONING HOST
    tools/provision-terminal.sh --centre-config ${OUT}/centre.conf …

  Fill in CENTRE_NAME and HQ_ENDPOINTS in centre.conf before provisioning the
  admin station — it is the only terminal that gets an uplink, and it gets
  exactly the endpoints named there.

  This directory is now the centre's key material. It belongs on the offline
  provisioning host, backed up under the same controls as the Secure Boot key,
  and nowhere else. It must never be committed.
EOF
