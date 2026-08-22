#!/usr/bin/env bash
# Assemble the CENTRE EDGE's WireGuard configuration from the terminals that
# have been provisioned (spec §6.4).
#
# ── What was missing ────────────────────────────────────────────────────────
#
# Every terminal got a `wg0.conf` naming the Edge as its single peer. Nothing
# ever produced the other half. The Edge had no interface address, no listening
# port, no private key in a config file and — decisively — no `[Peer]` stanza
# for any terminal, so a handshake from a correctly provisioned seat arrived at
# a host with no idea who was calling and was dropped.
#
# On a terminal that failure is not subtle and not diagnosable from the screen:
# `zuup-wireguard.service` exits non-zero, `zuup-network.target` fails,
# attestation and the kiosk are refused by dependency, and the machine powers
# itself off. Three laptops in a row doing that looks like a broken image.
#
# So this reads the centre config and every provisioned terminal's registry
# record, and writes the Edge's `wg0.conf` with one peer per terminal.
#
# ASSEMBLED, not appended: re-running after provisioning a fourth seat rewrites
# the file from what exists on disk, so re-provisioning a terminal replaces its
# peer instead of leaving a stale key that still authenticates.
set -euo pipefail

die() { echo "[edge-wg] FAIL: $*" >&2; exit 1; }
note() { echo "[edge-wg] $*"; }

usage() {
  cat <<'EOF'
usage: build-edge-wg.sh --centre-config FILE --provisioned DIR [--out FILE]

  --centre-config FILE   the centre's centre.conf (from gen-centre-secrets.sh)
  --provisioned DIR      the directory holding <SEAT>/registry.json
  --key FILE             the Edge's WireGuard PRIVATE key
                         (default: <centre-config dir>/wg-edge.key)
  --out FILE             where to write (default: <provisioned>/../edge/wg0.conf)

Install the result on the Edge appliance as /etc/wireguard/wg0.conf (0600) and
bring it up with `wg-quick up wg0`.
EOF
  exit 1
}

CFG=""; PROV=""; OUT=""; KEYFILE=""
while (($#)); do
  case "$1" in
    --centre-config) CFG="${2:?}"; shift 2 ;;
    --provisioned) PROV="${2:?}"; shift 2 ;;
    --out) OUT="${2:?}"; shift 2 ;;
    --key) KEYFILE="${2:?}"; shift 2 ;;
    -h|--help) usage ;;
    *) die "unknown argument $1" ;;
  esac
done

[[ -n "$CFG"  ]] || usage
[[ -r "$CFG"  ]] || die "cannot read centre config $CFG"
[[ -n "$PROV" ]] || usage
[[ -d "$PROV" ]] || die "no provisioned directory at $PROV"

# shellcheck disable=SC1090
source "$CFG"
CFG_DIR="$(cd "$(dirname "$CFG")" && pwd)"
KEYFILE="${KEYFILE:-$CFG_DIR/wg-edge.key}"
OUT="${OUT:-$(cd "$PROV/.." && pwd)/edge/wg0.conf}"

[[ -r "$KEYFILE" ]] || die "no Edge private key at $KEYFILE (gen-centre-secrets.sh writes wg-edge.key)"
[[ -n "${EDGE_TUNNEL_IP:-}" ]] || die "EDGE_TUNNEL_IP missing from the centre config"
[[ -n "${CENTRE_PRESHARED_KEY:-}" ]] || die "CENTRE_PRESHARED_KEY missing from the centre config"

mkdir -p "$(dirname "$OUT")"

# ── the peers ───────────────────────────────────────────────────────────────
#
# Read from registry.json rather than from each terminal's wg0.conf: the
# registry is what the Edge ingests, so a peer here and an identity there cannot
# disagree. `bound_ip` is the terminal's tunnel address and becomes its
# AllowedIPs — a /32, so a terminal that stole another's key still cannot send
# from another's address.
PEERS=""
COUNT=0
for reg in "$PROV"/*/registry.json; do
  [[ -r "$reg" ]] || continue
  seat="$(basename "$(dirname "$reg")")"
  pub="$(sed -n 's/.*"wg_pubkey"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$reg" | head -1)"
  ip="$(sed -n 's/.*"bound_ip"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$reg" | head -1)"
  cap="$(sed -n 's/.*"capability"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$reg" | head -1)"

  if [[ -z "$pub" || -z "$ip" ]]; then
    note "WARNING: $seat has no wg_pubkey or bound_ip in its registry — skipped."
    continue
  fi

  PEERS+="
# ${seat} — ${cap:-unknown}
[Peer]
PublicKey    = ${pub}
PresharedKey = ${CENTRE_PRESHARED_KEY}
AllowedIPs   = ${ip}/32
"
  COUNT=$(( COUNT + 1 ))
  note "peer ${seat} (${cap:-unknown}) → ${ip}"
done

(( COUNT > 0 )) || die "no provisioned terminals found under $PROV — run provision-terminal.sh first"

OLD_UMASK="$(umask)"; umask 077
cat > "$OUT" <<EOF
# ZUUP-OS Centre Edge — WireGuard server config (§6.4).
#
# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) from ${COUNT} provisioned terminal(s).
# Regenerate with tools/build-edge-wg.sh after provisioning any new seat; the
# file is assembled from the registry, never appended to, so a re-provisioned
# terminal replaces its own peer rather than leaving a stale key that still
# authenticates.
#
# Install as /etc/wireguard/wg0.conf (0600 root:root) on the Edge, then:
#     wg-quick up wg0
#     systemctl enable wg-quick@wg0     # to survive a reboot
#
# The Edge must also be reachable at ${EDGE_LAN_IP:-<EDGE_LAN_IP>}:51820 on the exam
# VLAN — that is the address every terminal's cmdline was signed with, so a host
# firewall on the Edge has to allow inbound UDP 51820.

[Interface]
Address    = ${EDGE_TUNNEL_IP}/24
ListenPort = 51820
PrivateKey = $(cat "$KEYFILE")
${PEERS}
EOF
umask "$OLD_UMASK"
chmod 0600 "$OUT"

cat <<EOF

  wrote       ${OUT}  (0600, ${COUNT} peer(s))
  edge tunnel ${EDGE_TUNNEL_IP}/24 on UDP 51820
  lan address ${EDGE_LAN_IP:-<set EDGE_LAN_IP in centre.conf>}  ← terminals send their handshake here

  ON THE EDGE APPLIANCE
    install -m 0600 ${OUT} /etc/wireguard/wg0.conf
    wg-quick up wg0
    wg show                       # each terminal appears after its first boot

  A terminal whose handshake never completes powers itself off by design, so if
  a seat goes dark check \`wg show\` here FIRST — an empty peer list means this
  file was never installed, and a peer with no handshake means the terminal
  cannot reach ${EDGE_LAN_IP:-this host} on UDP 51820.
EOF
