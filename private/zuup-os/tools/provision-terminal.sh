#!/usr/bin/env bash
# ZUUP-OS terminal provisioning (spec §7.1, §12) — turn one fleet image into one
# commissioned terminal.
#
# ── What was missing ────────────────────────────────────────────────────────
#
# `services/provisioning.ts` has always known how to INGEST a terminal registry:
# id, seat, capability, WireGuard public key, bound address, golden PCRs, the
# TPM attestation key and the biometric daemon key. Nothing anywhere PRODUCED
# those values. The image shipped `/etc/zuup/terminal-id` reading
# REPLACE-AT-PROVISIONING and `wg0.conf` full of `{{TERMINAL_PRIVATE_KEY}}`
# placeholders, and the only code that ever filled a registry row was the
# all-in-one's self-commissioning — which is explicitly forbidden in production.
# An estate that cannot be commissioned cannot boot. This is that tool.
#
# ── The shape, and why ──────────────────────────────────────────────────────
#
# The rootfs is built ONCE and is byte-identical across the whole fleet: same
# squashfs, same verity tree, same root hash. Per terminal this script produces
# only two small things:
#
#   1. a re-signed Unified Kernel Image (~15 MB) whose cmdline carries this
#      machine's identity — id, capability, seat, its Edge, and for the single
#      admin station its HQ endpoints;
#   2. a WireGuard config holding this machine's private key.
#
# Identity on the signed cmdline is the load-bearing choice. It means changing a
# terminal's capability — turning a candidate seat into an admin station with an
# internet uplink — requires the exam authority's Secure Boot signing key. An
# attacker who holds the USB stick can rewrite the ESP freely; the firmware then
# refuses to boot what they wrote.
#
# ── What this script deliberately cannot do ─────────────────────────────────
#
# It cannot produce the TPM attestation key or the golden PCRs. Those are
# properties of the physical machine and only exist once that machine has booted
# this exact image on its own firmware. They are captured separately, on the
# provisioning bench, by `zuup.enrol=1` (see security/systemd/zuup-enrol.sh) and
# merged with `tools/collect-enrolment.sh`. The registry record emitted here has
# `ak_pubkey_pem: null` and `golden_pcr: null` until that has happened, and the
# Edge refuses every privileged login on such a terminal — NO_ATTESTATION_KEY_
# REGISTERED — rather than treating an unmeasured machine as trusted.
#
# ── Residual risk, stated ───────────────────────────────────────────────────
#
# The WireGuard private key is a plaintext file on the ESP, which is FAT and not
# covered by dm-verity. Someone who steals a terminal's stick can therefore join
# the centre VLAN as that terminal. That gets them a LAN address and the ability
# to talk to the Edge; it does not get them an exam. Every privileged login also
# requires a TPM quote signed by an attestation key that cannot leave that
# machine's chip, a biometric envelope signed by that machine's daemon key, the
# bound source address, and an approval from the tier above. Sealing the key to
# the TPM would close even this and is the right next step where the fleet's
# TPMs support it; it is not done here because it cannot be tested without the
# hardware.
set -euo pipefail

die() { echo "[provision] FAIL: $*" >&2; exit 1; }
note() { echo "[provision] $*"; }

# ── host guard ──────────────────────────────────────────────────────────────
if [[ "$(uname -s)" != "Linux" ]] || ! command -v sbsign >/dev/null 2>&1; then
  cat <<'EOF'
[provision] Build-host artifact (needs Linux + systemd-ukify + sbsigntools +
            wireguard-tools); not running here. On the provisioning host it
            would, per terminal:
              1. mint a UUID and a WireGuard keypair
              2. compose the identity cmdline and re-sign a per-terminal UKI
              3. write wg0.conf + the ESP payload for that machine
              4. append a registry record to the centre's provisioning bundle
            Nothing was changed on this machine.
EOF
  exit 0
fi

usage() {
  cat <<'EOF'
usage: provision-terminal.sh --capability ROLE --seat NO [options]

Required (or set in the centre config file):
  --capability ROLE      CANDIDATE_SEAT | INVIGILATOR_STATION | ADMIN_STATION
  --seat NO              seat label, e.g. A-01 / INV-1 / ADM-1
  --centre-config FILE   the centre's provisioning parameters (see below)

Optional:
  --build DIR            fleet build artifacts   (default: ./build)
  --out DIR              where to write          (default: ./provisioned)
  --terminal-id UUID     reuse an id instead of minting one (re-provisioning)
  --tunnel-ip IP         override the auto-allocated tunnel address
  --predict-pcr          arm the authority-computed PCR 11 for this terminal.
                         OFF by default: the boot phase the quote is taken in is
                         unconfirmed on hardware, and a wrong phase denies every
                         terminal. Turn on once one real enrolment agrees.
  --enrol                sign an ENROLMENT stick: the machine captures its TPM
                         attestation key and golden PCRs to its own ESP, then
                         powers off. Re-sign WITHOUT this before it goes to a
                         hall — an enrolment stick powers off on every boot.

The centre config is a shell fragment:

  CENTRE_ID=8f14e45f-ceea-467a-9f9a-1a2b3c4d5e6f
  CENTRE_NAME="Kolkata North 021"
  EDGE_LAN_IP=10.0.0.1            # what the terminal sends its handshake to
  EDGE_TUNNEL_IP=10.9.0.1         # the Edge inside the tunnel
  EDGE_PUBLIC_KEY=<wg pubkey>
  CENTRE_PRESHARED_KEY=<wg psk>
  TUNNEL_SUBNET=10.9.0            # terminals get .10 upwards
  HQ_ENDPOINTS=203.0.113.10:443   # comma-separated. ADMIN_STATION only.
EOF
  exit 1
}

BUILD_DIR="./build"; OUT_DIR="./provisioned"; CFG=""
CAPABILITY=""; SEAT=""; TERMINAL_ID=""; TUNNEL_IP=""; ENROL=0; PREDICT_PCR=0
while (($#)); do
  case "$1" in
    --capability) CAPABILITY="${2:?}"; shift 2 ;;
    --seat) SEAT="${2:?}"; shift 2 ;;
    --centre-config) CFG="${2:?}"; shift 2 ;;
    --build) BUILD_DIR="${2:?}"; shift 2 ;;
    --out) OUT_DIR="${2:?}"; shift 2 ;;
    --terminal-id) TERMINAL_ID="${2:?}"; shift 2 ;;
    --enrol|--enroll) ENROL=1; shift ;;
    --predict-pcr) PREDICT_PCR=1; shift ;;
    --tunnel-ip) TUNNEL_IP="${2:?}"; shift 2 ;;
    -h|--help) usage ;;
    *) die "unknown argument $1" ;;
  esac
done

[[ -n "$CFG" ]] || die "--centre-config is required"
[[ -r "$CFG" ]] || die "cannot read centre config $CFG"
# shellcheck disable=SC1090
source "$CFG"

case "$CAPABILITY" in
  CANDIDATE_SEAT|INVIGILATOR_STATION|ADMIN_STATION) ;;
  *) die "--capability must be CANDIDATE_SEAT, INVIGILATOR_STATION or ADMIN_STATION (got '${CAPABILITY}')" ;;
esac
[[ -n "$SEAT" ]] || die "--seat is required"

for v in CENTRE_ID EDGE_LAN_IP EDGE_TUNNEL_IP EDGE_PUBLIC_KEY CENTRE_PRESHARED_KEY TUNNEL_SUBNET; do
  [[ -n "${!v:-}" ]] || die "$v is not set in $CFG"
done

# ── the signing key is the whole trust anchor; refuse to fake one ───────────
#
# 30-make-image.sh generates ephemeral DEV Secure Boot keys when none are set,
# which is right for a build you are going to boot in QEMU and wrong for a
# terminal that will sit in an exam hall. There is no equivalent fallback here:
# a UKI signed with a throwaway key is a terminal whose identity anyone can
# forge, and producing one silently is exactly the class of mistake this whole
# rewrite is about.
[[ -n "${ZUUP_DB_KEY:-}" && -n "${ZUUP_DB_CRT:-}" ]] \
  || die "ZUUP_DB_KEY and ZUUP_DB_CRT must point at the authority's Secure Boot
        signing key (HSM PKCS#11 URI or key path). Provisioning refuses to mint
        a terminal identity under an ephemeral key."

BZIMAGE="$BUILD_DIR/bzImage"
INITRD="$BUILD_DIR/zuup-initramfs.cpio.gz"
ROOTHASH_FILE="$BUILD_DIR/zuup-root.squashfs.roothash"
for f in "$BZIMAGE" "$INITRD" "$ROOTHASH_FILE"; do
  [[ -r "$f" ]] || die "missing fleet artifact $f — run image-build/build-all.sh first"
done

command -v wg >/dev/null || die "wireguard-tools (wg) is required to mint the terminal keypair"

TERMINAL_ID="${TERMINAL_ID:-$(cat /proc/sys/kernel/random/uuid)}"
[[ "$TERMINAL_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] \
  || die "--terminal-id must be a UUID"

DEST="$OUT_DIR/$SEAT"
mkdir -p "$DEST"

# ── 1. this terminal's WireGuard identity ───────────────────────────────────
# umask before generation, not chmod after: a private key that exists as 0644
# for even an instant on a shared provisioning host is a private key that was
# readable.
OLD_UMASK="$(umask)"; umask 077
WG_PRIV="$(wg genkey)"
WG_PUB="$(printf '%s' "$WG_PRIV" | wg pubkey)"

# Tunnel address allocation. Deterministic from the seat where possible so a
# re-provisioned terminal keeps its address (and therefore its `bound_ip`
# registry row) instead of drifting to a new one and failing the §8.2 IP clause.
if [[ -z "$TUNNEL_IP" ]]; then
  OCTET=$(( 10 + ( $(printf '%s' "$SEAT" | cksum | cut -d' ' -f1) % 200 ) ))
  TUNNEL_IP="${TUNNEL_SUBNET}.${OCTET}"
fi

sed -e "s|{{TERMINAL_PRIVATE_KEY}}|${WG_PRIV}|" \
    -e "s|{{TERMINAL_TUNNEL_IP}}|${TUNNEL_IP}|" \
    -e "s|{{EDGE_TUNNEL_IP}}|${EDGE_TUNNEL_IP}|" \
    -e "s|{{EDGE_PUBLIC_KEY}}|${EDGE_PUBLIC_KEY}|" \
    -e "s|{{CENTRE_PRESHARED_KEY}}|${CENTRE_PRESHARED_KEY}|" \
    -e "s|{{EDGE_LAN_IP}}|${EDGE_LAN_IP}|" \
    "$(dirname "$0")/../network/wireguard/wg0.conf.template" > "$DEST/wg0.conf"
grep -q '{{' "$DEST/wg0.conf" && die "wg0.conf still has unsubstituted placeholders — check the centre config"
umask "$OLD_UMASK"

# ── 2. the identity cmdline, and the per-terminal signed UKI ────────────────
EXTRA="zuup.terminal_id=${TERMINAL_ID} zuup.capability=${CAPABILITY} zuup.seat=${SEAT}"
EXTRA+=" zuup.edge=${EDGE_TUNNEL_IP} zuup.centre=${CENTRE_ID}"
# HQ endpoints go on the cmdline ONLY for the admin station. zuup-identity.sh
# refuses them on any other capability too — belt and braces, because this is
# the one parameter that decides whether a machine can reach the internet.
# The enrolment boot (§7.1). zuup-enrol.sh is inert on every image unless it
# finds this on the cmdline, so the flag is what turns an ordinary stick into a
# one-shot capture run — and, because the cmdline is inside the signed UKI, an
# enrolment stick cannot be forged into existence by editing the ESP either.
if [[ "$ENROL" == 1 ]]; then
  EXTRA+=" zuup.enrol=1"
  note "ENROLMENT stick: this terminal will capture its AK + PCRs and power off."
fi

if [[ "$CAPABILITY" == "ADMIN_STATION" ]]; then
  [[ -n "${HQ_ENDPOINTS:-}" ]] || die "ADMIN_STATION needs HQ_ENDPOINTS in the centre config"
  EXTRA+=" zuup.hq=${HQ_ENDPOINTS}"
elif [[ -n "${HQ_ENDPOINTS:-}" ]]; then
  note "capability is ${CAPABILITY} — HQ endpoints deliberately NOT placed on this terminal's cmdline."
fi

note "signing a per-terminal UKI for ${SEAT} (${CAPABILITY})…"
OUT="$DEST/BOOTX64.EFI" ZUUP_EXTRA_CMDLINE="$EXTRA" \
  bash "$(dirname "$0")/../boot/secureboot/sign-image.sh" \
    "$BZIMAGE" "$INITRD" "$ROOTHASH_FILE" >/dev/null

[[ -s "$DEST/BOOTX64.EFI" ]] || die "the signer produced no UKI"

# ── 2b. predict this terminal's image-determined measurement ────────────────
#
# systemd-stub measures the UKI's kernel, initrd and cmdline sections into
# PCR 11, and `systemd-measure calculate` reproduces that arithmetic from the
# same inputs — so the expected value can be derived here, from the artifact
# just signed, without the machine ever booting.
#
# That is what makes it worth having. A golden PCR captured at enrolment only
# proves a terminal boots what it booted then; if it was already compromised at
# that moment, the compromise becomes its golden set forever. A value the
# AUTHORITY computed from a signed artifact cannot be vouched for by the machine
# it is checking. See `fleetPcr` in edge-server/src/lib/tpm-quote.ts.
#
# It is per terminal because the cmdline is per terminal — this machine's id,
# capability and seat are inside the measured section. That is also why the
# image build does not publish one fleet-wide value: there isn't one.
# systemd-measure is NOT on PATH on Debian — it ships as
# /usr/lib/systemd/systemd-measure. A bare `command -v` therefore reported it
# missing on a machine that has it, so every terminal silently lost its
# predicted PCR and fell back to enrolment-observed values only. That is exactly
# the trust-on-first-use hole the prediction exists to close, failing open and
# saying so in a warning nobody would connect to the cause.
MEASURE=""
for c in systemd-measure /usr/lib/systemd/systemd-measure /lib/systemd/systemd-measure; do
  if command -v "$c" >/dev/null 2>&1 || [[ -x "$c" ]]; then MEASURE="$c"; break; fi
done

PREDICTED="null"
if [[ -n "$MEASURE" && -r "$DEST/BOOTX64.EFI.cmdline" ]]; then
  # --cmdline takes a PATH, not the cmdline text. Passing "$(cat …)" made
  # systemd-measure try to open a 433-character filename and fail, which the
  # pipeline then swallowed.
  #
  # `|| true` is load-bearing under `set -o pipefail`: without it a failing
  # systemd-measure takes the whole script down AFTER the UKI is signed and
  # BEFORE registry.json is written, leaving a provisioned stick with no
  # registry record and no error naming the cause.
  #
  # And the value is chosen by PHASE, which is the part that matters. PCR 11 is
  # EXTENDED at each boot-phase transition, so `systemd-measure calculate` emits
  # a different digest for <enter-initrd>, <…:leave-initrd>, <…:sysinit>,
  # <…:ready> and so on. Taking the first (which is what `head -1` did) pins the
  # initrd-entry value, while zuup-attest.sh quotes long afterwards — every
  # terminal in the estate would fail attestation on exam morning against a
  # number that was never wrong, just measured at the wrong moment.
  PHASES="$("$MEASURE" calculate \
              --linux="$BZIMAGE" --initrd="$INITRD" \
              --cmdline="$DEST/BOOTX64.EFI.cmdline" 2>/dev/null || true)"
  PCR11="$(printf '%s' "$PHASES" \
           | sed -n 's/^11:sha256=\([0-9a-f]\{64\}\).*/\1/p' | tail -1 || true)"
  if [[ -n "${PCR11:-}" ]]; then
    # OFF unless --predict-pcr is passed, and that default is deliberate.
    #
    # Which phase is current when zuup-attest.sh takes its quote has never been
    # observed on hardware. If the guess is wrong, the Edge denies EVERY
    # terminal — a worse outcome than falling back to enrolment-observed values,
    # which are merely weaker. So the arithmetic runs, the answer is reported,
    # and it is not armed until one real terminal has confirmed which phase its
    # quote lands in. Compare the value here against that machine's PCR 11 in
    # its enrolment.json; when they match, provision with --predict-pcr.
    if [[ "$PREDICT_PCR" == 1 ]]; then
      PREDICTED="{\"11\": \"$PCR11\"}"
      note "predicted PCR 11 (final phase) = ${PCR11:0:16}… — ARMED"
    else
      note "predicted PCR 11 (final phase) = ${PCR11:0:16}…"
      note "  not armed: pass --predict-pcr once a real terminal's enrolment confirms"
      note "  this is the phase its quote is taken in. A wrong phase denies the estate."
    fi
  else
    note "WARNING: systemd-measure returned no PCR 11; this terminal will fall back"
    note "         to enrolment-observed values only (trust-on-first-use)."
  fi
else
  note "WARNING: systemd-measure unavailable — no predicted measurement for this"
  note "         terminal. Attestation will compare against enrolment-observed"
  note "         values only, which cannot detect a compromised enrolment."
fi

# ── 3. the registry record for the provisioning bundle ──────────────────────
# `bound_ip` is the tunnel address, because that is what the Edge sees as the
# socket's source once the tunnel is up — the same value the §8.2 IP clause and
# `requestIsFromTerminal` compare against.
cat > "$DEST/registry.json" <<EOF
{
  "id": "${TERMINAL_ID}",
  "seat_no": "${SEAT}",
  "capability": "${CAPABILITY}",
  "wg_pubkey": "${WG_PUB}",
  "bound_ip": "${TUNNEL_IP}",
  "golden_pcr": null,
  "predicted_pcr": ${PREDICTED},
  "ak_pubkey_pem": null,
  "bio_pubkey_pem": null
}
EOF

cat <<EOF

  terminal    ${TERMINAL_ID}
  seat        ${SEAT}  (${CAPABILITY})
  tunnel      ${TUNNEL_IP}  →  edge ${EDGE_TUNNEL_IP} via ${EDGE_LAN_IP}:51820
  wg pubkey   ${WG_PUB}
  egress      $( [[ "$CAPABILITY" == "ADMIN_STATION" ]] && echo "HQ ${HQ_ENDPOINTS} (window still gated by the Edge)" || echo "none — no HQ destination exists on this machine" )

  written to  ${DEST}/
    BOOTX64.EFI    → the stick's /EFI/BOOT/BOOTX64.EFI
    wg0.conf       → the stick's ESP as /zuup/wg0.conf   (mode 0600)
    registry.json  → merge into the centre bundle

  NEXT: this terminal has no attestation key and no golden PCRs yet, so every
  privileged login on it will deny. Re-run this command with --enrol, boot the
  stick once on its own hardware to capture them, then collect-enrolment.sh.
EOF
