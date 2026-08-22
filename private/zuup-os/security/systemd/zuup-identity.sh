#!/usr/bin/env bash
# ZUUP-OS per-terminal identity (spec §7.1) — turn the SIGNED kernel cmdline
# into this machine's identity, before anything that depends on it starts.
#
# ── Why identity travels on the cmdline ─────────────────────────────────────
#
# A production terminal has to know four things nobody can let it guess: which
# terminal it is, what it is allowed to be, which Edge is its centre, and (for
# the one admin station) which HQ endpoints exist. Those differ per machine,
# and the obvious place — a file in /etc — is inside the dm-verity squashfs,
# which means a per-terminal rootfs, a per-terminal verity tree and a
# per-terminal 700 MB image. For a hall of 500 seats that is a non-starter, and
# it is why `/etc/zuup/terminal-id` shipped reading REPLACE-AT-PROVISIONING and
# no tool ever replaced it.
#
# The Unified Kernel Image already binds kernel + initrd + cmdline under one
# sbsign signature. So the cmdline is authenticated storage that costs ~15 MB to
# re-sign per terminal while the rootfs stays byte-identical across the entire
# fleet. Provisioning re-signs one UKI per machine (tools/provision-terminal.sh)
# and the squashfs is built once.
#
# What that buys, precisely: changing a terminal's capability — turning a
# candidate seat into an admin station with an HQ uplink — requires the exam
# authority's Secure Boot signing key. An attacker holding the USB stick can
# rewrite anything on the ESP they like; the firmware then refuses to boot it.
#
# The WireGuard private key is deliberately NOT here: /proc/cmdline is readable
# by every process on the machine. It stays a file on the ESP. See the residual
# note in tools/provision-terminal.sh about what that key alone does and does
# not get an attacker.
set -euo pipefail

IDENTITY_DIR="${ZUUP_IDENTITY_DIR:-/run/zuup-identity}"
NFT_DIR="$IDENTITY_DIR/nftables.d"
CMDLINE_FILE="${ZUUP_CMDLINE_FILE:-/proc/cmdline}"
VARIANT_FILE=/etc/zuup/image-variant

log() {
  echo "zuup-identity: $*" | systemd-cat -t zuup-identity -p "${2:-info}" || true
  echo "zuup-identity: $*" > /dev/kmsg 2>/dev/null || true
}

# ── host guard ──────────────────────────────────────────────────────────────
if [[ "$(uname -s)" != "Linux" ]]; then
  cat <<'EOF'
[zuup-os] Terminal-image artifact (needs Linux); not running here.
          On a terminal it would read zuup.* from the signed kernel cmdline and
          write this machine's identity + firewall drop-ins to /run.
          Nothing was changed here.
EOF
  exit 0
fi

VARIANT=unknown
[[ -r "$VARIANT_FILE" ]] && VARIANT="$(tr -d ' \n' < "$VARIANT_FILE")"

# The all-in-one commissions ITSELF into the same directory (zuup-commission.sh)
# and must not be overwritten by a cmdline that carries no zuup.* parameters.
# Exiting here rather than writing empty files is what keeps the two paths from
# fighting over one tmpfs.
if [[ "$VARIANT" == "allinone" ]]; then
  log "variant=allinone — identity comes from first-boot commissioning, not the cmdline."
  exit 0
fi

# ── parse the signed cmdline ────────────────────────────────────────────────
TERMINAL_ID=""; CAPABILITY=""; SEAT=""; EDGE_IP=""; HQ_LIST=""; CENTRE=""; HQ_URL=""
for arg in $(cat "$CMDLINE_FILE"); do
  case "$arg" in
    zuup.terminal_id=*) TERMINAL_ID="${arg#zuup.terminal_id=}" ;;
    zuup.capability=*)  CAPABILITY="${arg#zuup.capability=}" ;;
    zuup.seat=*)        SEAT="${arg#zuup.seat=}" ;;
    zuup.edge=*)        EDGE_IP="${arg#zuup.edge=}" ;;
    zuup.hq=*)          HQ_LIST="${arg#zuup.hq=}" ;;
    # The public platform's base URL, e.g. https://exam.example.gov.in.
    # Carried SEPARATELY from zuup.hq because the two say different things:
    # zuup.hq is the address the firewall pins, this is the name TLS is
    # verified against. The courier joins them with `curl --resolve` and so
    # never resolves anything.
    zuup.hq_url=*)      HQ_URL="${arg#zuup.hq_url=}" ;;
    zuup.centre=*)      CENTRE="${arg#zuup.centre=}" ;;
  esac
done

mkdir -p "$IDENTITY_DIR" "$NFT_DIR"
chmod 0755 "$IDENTITY_DIR" "$NFT_DIR"

# An unprovisioned image is a normal state, not a fault: it is what comes off
# the build before any terminal has been commissioned. Say so and leave every
# set empty — the firewall's default drop then denies everything, the Gate has
# no identity to offer, and the machine is inert rather than half-configured.
if [[ -z "$TERMINAL_ID" ]]; then
  log "no zuup.terminal_id on the cmdline — this image has not been provisioned. \
Firewall stays fully closed and no station identity is published."
  exit 0
fi

if [[ ! "$TERMINAL_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
  # Refuse rather than publish a malformed id. Everything downstream treats the
  # identity file as authoritative, and a half-valid one is harder to diagnose
  # than none at all.
  log "zuup.terminal_id is not a UUID ('${TERMINAL_ID}') — refusing to publish it." err
  exit 0
fi

case "$CAPABILITY" in
  CANDIDATE_SEAT|INVIGILATOR_STATION|ADMIN_STATION) ;;
  *)
    log "zuup.capability='${CAPABILITY}' is not a known capability — refusing." err
    exit 0 ;;
esac

# ── the cmdline is only trustworthy if something VERIFIED it ────────────────
#
# Everything above treats the kernel cmdline as authenticated storage, and on a
# UEFI machine with Secure Boot on it is: the cmdline lives inside the UKI, the
# UKI is sbsigned, and firmware refuses to boot an unsigned one. That is what
# makes "changing a terminal's capability requires the authority's signing key"
# true.
#
# On a legacy BIOS there is no Secure Boot and no signature check at all. The
# image ships a BIOS path so it can run on the older half of an Indian exam
# centre — but on that path anyone holding the stick can edit the loader config
# and write `zuup.capability=ADMIN_STATION zuup.hq=...`. Honouring it would hand
# them the one station permitted to reach the internet.
#
# So the privileged capabilities are gated on a VERIFIED boot rather than on a
# claimed one. A machine that cannot prove its boot chain gets the role that
# needs no such proof: a candidate seat, whose trust flows from the invigilator's
# attested station and the candidate's own credentials, not from its firmware.
firmware_is_verified() {
  # No EFI at all → legacy BIOS → nothing verified this cmdline.
  [[ -d /sys/firmware/efi ]] || return 1
  # SecureBoot EFI variable: 4 bytes of attributes, then one byte, 1 = enabled.
  local var
  var="$(printf '%s' /sys/firmware/efi/efivars/SecureBoot-8be4df61-93ca-11d2-aa0d-00e098032b8c)"
  [[ -r "$var" ]] || return 1
  local val
  val="$(od -An -tu1 -j4 -N1 "$var" 2>/dev/null | tr -dc '0-9')"
  [[ "$val" == "1" ]]
}

if firmware_is_verified; then
  BOOT_TRUST="secureboot"
else
  BOOT_TRUST="unverified"
  if [[ "$CAPABILITY" != "CANDIDATE_SEAT" ]]; then
    log "boot chain is NOT verified (no UEFI Secure Boot) — refusing the requested ${CAPABILITY} and running as CANDIDATE_SEAT. On this firmware the cmdline is not signed, so a capability read from it proves nothing." warning
    CAPABILITY="CANDIDATE_SEAT"
  fi
  # Belt and braces: even if the capability above were somehow honoured, an
  # unverified boot must never carry HQ destinations — nor the URL a courier
  # would aim at them.
  HQ_LIST=""
  HQ_URL=""
fi
printf '%s
' "$BOOT_TRUST" > "$IDENTITY_DIR/boot-trust"

printf '%s\n' "$TERMINAL_ID" > "$IDENTITY_DIR/terminal-id"
printf '%s\n' "$CAPABILITY"  > "$IDENTITY_DIR/capability"
[[ -n "$SEAT"   ]] && printf '%s\n' "$SEAT"   > "$IDENTITY_DIR/seat-no"
[[ -n "$CENTRE" ]] && printf '%s\n' "$CENTRE" > "$IDENTITY_DIR/centre-id"
chmod 0644 "$IDENTITY_DIR"/* 2>/dev/null || true

# ── the Edge peer: every terminal gets exactly one ──────────────────────────
# Without this element the firewall permits no WireGuard at all, so a typo here
# is a terminal that cannot reach its centre — which is the correct failure.
if [[ -n "$EDGE_IP" ]]; then
  if [[ "$EDGE_IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
    printf 'add element inet zuup edge_lan { %s }\n' "$EDGE_IP" > "$NFT_DIR/10-edge-peer.nft"
    log "edge peer pinned to $EDGE_IP"
  else
    log "zuup.edge='${EDGE_IP}' is not an IPv4 address — no peer pinned, the tunnel cannot open." err
  fi
else
  log "no zuup.edge on the cmdline — no WireGuard peer is permitted." warning
fi

# ── HQ egress: ADMIN_STATION only, and the check is on the SIGNED value ─────
#
# This is the single line that decides whether a machine can reach the internet.
# It reads the capability parsed out of the signed cmdline, not a file anyone
# could have written, so producing an egress-capable terminal requires the
# authority's signing key rather than a text editor.
if [[ "$CAPABILITY" == "ADMIN_STATION" && -n "$HQ_LIST" ]]; then
  ELEMENTS=""
  IFS=',' read -ra ENTRIES <<< "$HQ_LIST"
  for e in "${ENTRIES[@]}"; do
    host="${e%%:*}"; port="${e##*:}"
    [[ "$host" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || { log "HQ entry '$e' is not ip:port — skipped." warning; continue; }
    [[ "$port" =~ ^[0-9]+$ ]] && (( port > 0 && port < 65536 )) || { log "HQ entry '$e' has a bad port — skipped." warning; continue; }
    ELEMENTS="${ELEMENTS:+$ELEMENTS, }${host} . ${port}"
  done
  if [[ -n "$ELEMENTS" ]]; then
    printf 'add element inet zuup hq_dest { %s }\n' "$ELEMENTS" > "$NFT_DIR/20-hq-egress.nft"
    log "ADMIN_STATION: HQ destinations pinned ($ELEMENTS). The window itself stays SHUT until zuup-egressd opens it."

    # ── the courier's half: a name, bound to those same addresses ──────────
    #
    # There is no resolver on this machine and there must not be one: DNS is an
    # unauthenticated answer from the network about where HQ lives, and this
    # image's entire argument is that the network cannot move a terminal. So
    # the hostname and the address are supplied separately by the authority,
    # both inside the signed cmdline, and joined here into the `--resolve`
    # lines the courier hands curl. TLS then authenticates the NAME while the
    # connection is pinned to the ADDRESS, and neither comes from the wire.
    if [[ -n "$HQ_URL" ]]; then
      if [[ "$HQ_URL" =~ ^https://[A-Za-z0-9._-]+(:[0-9]+)?/?$ ]]; then
        HQ_URL="${HQ_URL%/}"
        printf '%s\n' "$HQ_URL" > "$IDENTITY_DIR/hq-url"
        hostport="${HQ_URL#https://}"
        host="${hostport%%:*}"
        urlport="${hostport#"$host"}"; urlport="${urlport#:}"
        : > "$IDENTITY_DIR/hq-resolve"
        for e in "${ENTRIES[@]}"; do
          ip="${e%%:*}"
          [[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || continue
          # An HQ entry on a port the URL does not name would produce a
          # --resolve line curl never consults; pin the URL's port instead so
          # the two halves cannot disagree silently.
          printf '%s:%s:%s\n' "$host" "${urlport:-443}" "$ip" >> "$IDENTITY_DIR/hq-resolve"
        done
        log "HQ endpoint published for the courier: $HQ_URL -> $(tr '\n' ' ' < "$IDENTITY_DIR/hq-resolve")"

        # ── and a way for a packet to actually GET there ──────────────────
        #
        # The firewall permitting a destination is not the same as the kernel
        # having a route to it, and this is where that gap bit: zuup-lan.network
        # takes an address from DHCP and refuses the lease's gateway and routes
        # outright (UseGateway=no, UseRoutes=no), so a terminal has NO default
        # route by design. On a candidate seat that is the whole point — there is
        # nowhere off-link for a packet to go. On the admin station it meant the
        # uplink could never work: `hq_dest` accepted the packet and the routing
        # table had nowhere to send it, so every courier run failed to connect
        # against a firewall that was open.
        #
        # The fix is deliberately NOT to accept the default route. That would
        # hand this machine the whole internet and leave nftables as the only
        # thing between an exam hall and the outside — one layer where §6.2 asks
        # for four. Instead each pinned HQ address gets its own /32 route via the
        # lease's gateway, written as a networkd drop-in before the link is
        # configured. The routing table then contains exactly the destinations
        # the authority signed, and nothing else is reachable even if the
        # firewall were flushed.
        #
        # `Gateway=_dhcp4` is systemd's own way of saying "the router from the
        # lease", which is the only way to express this: the gateway is not known
        # until DHCP completes, and this unit runs long before that.
        # mkdir -p creates /run/systemd/network too, which may not exist yet:
        # this unit runs before networkd, and networkd is not what creates it.
        ROUTE_DIR=/run/systemd/network/10-zuup-lan.network.d
        if mkdir -p "$ROUTE_DIR" 2>/dev/null; then
          {
            echo "# Written at boot by zuup-identity.sh from the signed cmdline."
            echo "# Host routes to the pinned HQ endpoints only — never a default route."
            while IFS= read -r line; do
              ip="${line##*:}"
              [[ -n "$ip" ]] || continue
              printf '[Route]\nDestination=%s/32\nGateway=_dhcp4\n\n' "$ip"
            done < "$IDENTITY_DIR/hq-resolve"
          } > "$ROUTE_DIR/10-hq-routes.conf"
          log "HQ host routes staged for networkd ($(grep -c '^Destination=' "$ROUTE_DIR/10-hq-routes.conf") destination(s), via the DHCP gateway)"
        else
          log "could not stage HQ routes in /run/systemd/network — the uplink will have no route." err
        fi
      else
        # Refused rather than trimmed. `http://` would carry this centre's
        # credential in clear text across the internet, and a URL with a path
        # would silently break every endpoint the courier appends.
        log "zuup.hq_url='${HQ_URL}' is not a bare https://host[:port] — refusing it; the courier will not run." err
      fi
    else
      log "ADMIN_STATION has HQ addresses but no zuup.hq_url — the firewall is open to HQ and nothing knows how to talk to it." warning
    fi
  else
    log "zuup.hq had no usable entries — this admin station has no HQ destination." err
  fi
elif [[ -n "$HQ_LIST" ]]; then
  # Loud, because it means a provisioning run put an HQ list on a machine that
  # is not allowed one. Nothing is written; the seat stays internet-less.
  log "zuup.hq present on a ${CAPABILITY} — IGNORED. Only an ADMIN_STATION may egress." err
fi

# ── key material from the ESP ───────────────────────────────────────────────
#
# Two files cannot live on the cmdline and cannot live in the squashfs either:
#
#   wg0.conf               contains this terminal's WireGuard PRIVATE key, and
#                          /proc/cmdline is world-readable.
#   biometric-attest.key   the Ed25519 key the capture daemon signs scores with.
#                          Its public half is registered at enrolment, so it has
#                          to be the SAME key on every boot — generating a fresh
#                          one per boot (which is what the all-in-one does, and
#                          gets away with only because it re-registers itself
#                          every time) would make every signed score unverifiable
#                          against the registry on a production terminal.
#
# Both are written to the ESP by provisioning. The ESP is FAT and outside
# dm-verity, so this is where an attacker with the physical stick gets leverage
# — see the residual note in tools/provision-terminal.sh for exactly how much
# that is and is not worth to them.
#
# Mounted READ-ONLY and unmounted immediately: the material is copied into the
# /run tmpfs and the partition is not left attached during an exam. INV-2 still
# holds for everything the machine PRODUCES; this is material it was given.
load_esp_material() {
  local esp dev mnt
  # Inside IDENTITY_DIR on purpose: the unit runs with ProtectSystem=strict and
  # ReadWritePaths=/run/zuup-identity, so this is the only place it may create a
  # mount point at all.
  mnt="$IDENTITY_DIR/.esp"
  mkdir -p "$mnt"

  # This unit runs early — before network-pre.target — so udev may not have
  # finished creating /dev/disk/by-*/ yet, and on real hardware a USB stick can
  # take seconds to enumerate after the controller comes up. The initramfs
  # already learned this the hard way and retries for ~20 s before giving up;
  # the same is needed here, or a terminal that is merely slow to enumerate its
  # own stick boots with no WireGuard key and no biometric key and reports it as
  # a provisioning fault.
  local waited=0
  while (( waited < 20 )); do
    for dev in /dev/disk/by-label/ZUUPESP "/dev/disk/by-partlabel/EFI System"; do
      [[ -e "$dev" ]] || continue
      if mount -t vfat -o ro,nosuid,nodev,noexec "$dev" "$mnt" 2>/dev/null; then
        esp="$dev"
        break 2
      fi
    done
    sleep 1
    waited=$(( waited + 1 ))
  done
  (( waited > 0 )) && [[ -n "${esp:-}" ]] && log "ESP appeared after ${waited}s"
  if [[ -z "${esp:-}" ]]; then
    log "no ESP found by label — WireGuard and biometric key material unavailable." err
    rmdir "$mnt" 2>/dev/null || true
    return 1
  fi

  if [[ -r "$mnt/zuup/wg0.conf" ]]; then
    install -m 0600 "$mnt/zuup/wg0.conf" "$IDENTITY_DIR/wg0.conf"
    log "WireGuard config loaded from the ESP"
  else
    log "no /zuup/wg0.conf on the ESP — the tunnel cannot come up." err
  fi

  # ── the courier's two credentials ─────────────────────────────────────
  #
  # Loaded only on an ADMIN_STATION — and the capability was already demoted to
  # CANDIDATE_SEAT above if the boot could not be verified, so an unsigned BIOS
  # boot never reaches this branch. They are the centre's credential at HQ and
  # at its own Edge: transport secrets, not keys to anything. HQ's signature is
  # what the Edge actually trusts a bundle on, and every answer that leaves is
  # ciphertext wrapped to the HSM.
  if [[ "$CAPABILITY" == "ADMIN_STATION" ]]; then
    for pair in "hq-centre.key:the HQ uplink credential" "edge-provisioning.key:the Edge write credential"; do
      f="${pair%%:*}"; what="${pair#*:}"
      if [[ -r "$mnt/zuup/$f" ]]; then
        install -m 0600 "$mnt/zuup/$f" "$IDENTITY_DIR/$f"
        log "$what loaded from the ESP"
      else
        log "no /zuup/$f on the ESP — $what is missing, so the courier will not run." warning
      fi
    done
  fi

  if [[ -r "$mnt/zuup/biometric-attest.key" ]]; then
    install -m 0640 "$mnt/zuup/biometric-attest.key" "$IDENTITY_DIR/biometric-attest.key"
    # The daemon runs as zuup-bio and must be able to read it; nobody else may.
    chgrp zuup-bio "$IDENTITY_DIR/biometric-attest.key" 2>/dev/null || true
    log "biometric attestation key loaded from the ESP"
  else
    log "no biometric key on the ESP — this station cannot serve capture scores." warning
  fi

  umount "$mnt" 2>/dev/null || true
  rmdir "$mnt" 2>/dev/null || true
}
load_esp_material || true

log "identity published: ${CAPABILITY} ${SEAT:-(no seat)} ${TERMINAL_ID}"
