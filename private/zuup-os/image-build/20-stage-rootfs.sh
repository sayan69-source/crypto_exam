#!/usr/bin/env bash
# Stage 20 — stage the minimal examination userland (spec §7.3, §7.4, §7.5).
#
# Builds a Debian-based rootfs with mmdebstrap (fully unprivileged — no root,
# no loop mounts), installs ONLY the closed process set, drops in every ZUUP
# artifact (systemd units, firewall, biometric daemon, attestation, USBGuard,
# AppArmor, sysctl/logind lockdown), enables the fail-closed unit chain, and
# strips everything that does not belong on a locked terminal. The result is
# handed to stage 30 to become the read-only verity SquashFS.
#
#   20-stage-rootfs.sh            # production rootfs (fail-closed, no rescue)
#   20-stage-rootfs.sh --dev      # + DEV drop-ins so it boots the Gate w/o an Edge
set -euo pipefail
[[ "$(uname -s)" == "Linux" ]] || { echo "[zuup-os] Linux build host only (use docker-build.sh)"; exit 0; }

BUILD="${BUILD:-/build}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ZOS="${ZUUP_OS_DIR:-$(cd "$HERE/.." && pwd)}"
ROOT="$BUILD/rootfs"
SUITE="${ZUUP_SUITE:-trixie}"
MIRROR="${ZUUP_MIRROR:-http://deb.debian.org/debian}"
BROWSER_PKG="${ZUUP_BROWSER_PKG:-firefox-esr}"

DEV=0
ALLINONE=0
for a in "$@"; do
  case "$a" in
    --dev)      DEV=1 ;;
    --allinone) ALLINONE=1; DEV=1 ;;  # the all-in-one bundles its own Edge, so
  esac                                # it takes the DEV boot path (no remote
done                                  # WireGuard peer / TPM-attested Edge).
[[ "${ZUUP_DEV:-0}" == "1" ]] && DEV=1
[[ "${ZUUP_ALLINONE:-0}" == "1" ]] && { ALLINONE=1; DEV=1; }

command -v mmdebstrap >/dev/null || { echo "[zuup-os] need mmdebstrap (use the builder container)" >&2; exit 1; }

rm -rf "$ROOT"; mkdir -p "$ROOT"

# ── 1. minimal userland: the closed process set + nothing speculative ──────
#   systemd/udev/dbus  : init + device + bus
#   cage/seatd         : single-surface Wayland compositor (§7.4)
#   $BROWSER_PKG       : the locked exam browser the kiosk launches
#   wireguard/nftables : the only route + default-drop firewall (§6)
#   usbguard/apparmor  : runtime device + MAC allow-lists (§7.5)
#   tpm2-tools         : boot attestation (§7.1)
#   python3 + numpy/pil/yaml : the biometric daemon (§8) + attest PCR parse
#   python3-cryptography : the daemon signs every score it emits (§8.4). Without
#                      it the daemon refuses to start, because an unsigned score
#                      is a number the browser could have typed.
# Face verification backend: ZUUP_FACE=cv pulls the real OpenCV (YuNet+SFace)
# engine — python3-opencv + the two ONNX models — so face check works on any
# commodity webcam with no vendor SDK. It is opt-in because opencv + the 37 MB
# SFace model materially enlarge the image (the budget is raised to match).
FACE="${ZUUP_FACE:-cv}"
[[ "${1:-}" == "--no-face" ]] && FACE=none

#   libgl1-mesa-dri    : the DRI/llvmpipe drivers wlroots' EGL renderer binds to
#   xkb-data           : the XKB keymap database cage compiles a keymap from.
#                      Without it the Wayland seat advertises no keyboard and
#                      every key on the machine is dead — while cage starts, the
#                      screen paints and the pointer still works, so nothing in
#                      the boot log or the journal looks wrong.
#                      It arrives transitively today (verified in a shipped
#                      image: xkb-data installed, 571 files under
#                      /usr/share/X11). Named explicitly anyway, because that is
#                      a dependency of a dependency and the failure it causes is
#                      both total and silent — too expensive to leave to chance
#                      on an image whose only feedback channel is a kiosk.
#                      NOT the cause of any observed fault; do not read it as one.
PKGS="systemd,systemd-sysv,udev,dbus,libpam-systemd,\
cage,seatd,xkb-data,libgl1-mesa-dri,fonts-dejavu-core,${BROWSER_PKG},\
wireguard-tools,nftables,iproute2,usbguard,\
apparmor,apparmor-profiles,libpam-apparmor,\
tpm2-tools,\
python3,python3-yaml,python3-numpy,python3-pil,python3-cryptography,\
curl,ca-certificates,kmod,util-linux"
if [[ "$FACE" == "cv" ]]; then
  PKGS="$PKGS,python3-opencv"
  # opencv + SFace need headroom over the §19 target. Stages are separate
  # processes, so the raised ceiling must travel via a state file (stage 30
  # reads it) — an env export would die with this process.
  echo "${ZUUP_IMAGE_MAX_MB:-600}" > "$BUILD/.image-max-mb"
else
  rm -f "$BUILD/.image-max-mb"
fi

# ── all-in-one demo: fold the whole centre stack into the terminal ─────────
# Adds PostgreSQL to the closed userland (Node + Caddy arrive as pinned
# binaries in stage 25), raises the size ceiling for the bundled apps, and
# leaves a marker stage 25 keys off. This NEVER touches the production variant.
if [[ "$ALLINONE" == 1 ]]; then
  PKGS="$PKGS,postgresql"
  echo "${ZUUP_IMAGE_MAX_MB:-1600}" > "$BUILD/.image-max-mb"
  : > "$BUILD/.allinone"
else
  rm -f "$BUILD/.allinone"
fi

echo "[zuup-os] mmdebstrap $SUITE → $ROOT (this pulls the userland)…"
mmdebstrap --variant=minbase \
  --include="$PKGS" \
  --aptopt='Apt::Install-Recommends "false"' \
  --customize-hook='chroot "$1" systemctl disable getty@tty1.service >/dev/null 2>&1 || true' \
  "$SUITE" "$ROOT" "$MIRROR"

inst() { install -D -m "$1" "$2" "$ROOT/$3"; }   # mode src dest(relative)

# ── the input path, asserted rather than assumed ───────────────────────────
# A kiosk that renders but cannot be typed into is not a degraded exam terminal,
# it is a useless one — and it looks completely healthy from the boot log, the
# journal and the screen. The pieces are cheap to check and each has a distinct
# failure mode that only shows up with a person sitting in front of it.
#
# All three were present in the last image built before this check existed, so
# it is a guard against regression, not a fix for a known fault.
for p in \
  "usr/share/X11/xkb/rules/evdev:the XKB keymap — cage compiles no keymap, so the seat has NO keyboard" \
  "usr/bin/cage:the compositor" \
  "usr/sbin/seatd:the seat manager that hands cage the DRM display and input devices"
do
  path="${p%%:*}"; what="${p#*:}"
  [[ -e "$ROOT/$path" ]] || {
    echo "[zuup-os] FAIL: /$path missing — $what" >&2
    exit 1
  }
done
echo "[zuup-os] input path present (xkb keymap, cage, seatd)"

# ── 2. terminal identity + ZUUP config tree ────────────────────────────────
mkdir -p "$ROOT/etc/zuup"
inst 0644 "$ZOS/security/nftables.conf"               etc/zuup/nftables.conf
# NOTE: there is no seccomp file to install. security/seccomp/firefox.json used
# to land at /etc/zuup/firefox-seccomp.json, where nothing read it —
# `SystemCallFilter=` takes systemd syscall-set names, never a path to an OCI
# seccomp document. Its kill list now lives in zuup-kiosk.service, which is a
# filter the kernel actually installs. See that unit for the full reasoning.
# The firewall drop-in directory. 00-defaults.nft adds no rule; it exists so the
# `include "…/nftables.d/*.nft"` glob always matches, because nft treats a glob
# with no matches as a load error and a failed load powers the terminal off.
# Provisioning adds 10-edge-peer.nft here (every terminal) and 20-hq-egress.nft
# (ADMIN_STATION only) — see tools/provision-terminal.sh.
for f in "$ZOS"/security/nftables.d/*.nft; do
  inst 0644 "$f" "etc/zuup/nftables.d/$(basename "$f")"
done
# The wired LAN link. Nothing configured the network at all before this: the
# image carried a WireGuard unit, a firewall and an attestation client, and no
# `.network` unit — so on a production terminal the interface never came up.
inst 0644 "$ZOS/network/systemd/zuup-lan.network"     etc/systemd/network/10-zuup-lan.network
# per-terminal identity + WireGuard config are BAKED PER TERMINAL at
# provisioning; ship inert placeholders so the units have a target path.
printf 'REPLACE-AT-PROVISIONING\n' > "$ROOT/etc/zuup/terminal-id"
inst 0600 "$ZOS/network/wireguard/wg0.conf.template"  etc/zuup/wg0.conf

# ── 3. systemd units (network/session chain + workloads) ───────────────────
for u in security/systemd/zuup-identity.service \
         security/systemd/zuup-firewall.service \
         security/systemd/zuup-wireguard.service \
         security/systemd/zuup-network.target \
         security/systemd/zuup-session.target \
         security/systemd/zuup-heartbeatd.service \
         security/systemd/zuup-egressd.service \
         security/systemd/zuup-hqsync.service \
         security/systemd/zuup-hqsync.timer \
         security/systemd/zuup-enrol.service \
         security/systemd/zuup-survey.service \
         biometric/zuup-biometric.service \
         boot/attest/zuup-attest.service \
         security/kiosk/zuup-kiosk.service; do
  inst 0644 "$ZOS/$u" "etc/systemd/system/$(basename "$u")"
done

# ── 4. daemons + scripts ───────────────────────────────────────────────────
inst 0755 "$ZOS/security/systemd/zuup-heartbeatd.sh"  usr/lib/zuup/zuup-heartbeatd.sh
inst 0755 "$ZOS/security/systemd/zuup-egressd.sh"     usr/lib/zuup/zuup-egressd.sh
inst 0755 "$ZOS/security/systemd/zuup-hqsync.sh"      usr/lib/zuup/zuup-hqsync.sh
inst 0755 "$ZOS/security/systemd/zuup-identity.sh"    usr/lib/zuup/zuup-identity.sh
inst 0755 "$ZOS/security/systemd/zuup-enrol.sh"       usr/lib/zuup/zuup-enrol.sh
inst 0755 "$ZOS/security/systemd/zuup-survey.sh"      usr/lib/zuup/zuup-survey.sh
inst 0755 "$ZOS/security/kiosk/zuup-kiosk-launch.sh"  usr/lib/zuup/zuup-kiosk-launch.sh
# The launcher's last-resort surface: a local page naming why no centre was
# reached. Without it a terminal that cannot find its Edge shows Firefox's own
# "Server not found", which is indistinguishable from a broken image and cannot
# be triaged on a machine with no shell.
inst 0644 "$ZOS/security/kiosk/no-centre.html"        usr/share/zuup/kiosk/no-centre.html
inst 0755 "$ZOS/boot/attest/zuup-attest.sh"           usr/lib/zuup/zuup-attest.sh
inst 0755 "$ZOS/biometric/zuup-biometricd.py"         usr/lib/zuup/zuup-biometricd.py
inst 0755 "$ZOS/biometric/face_engine_cv.py"          usr/lib/zuup/face_engine_cv.py
mkdir -p "$ROOT/usr/share/zuup/models"

# ── 4b. face models (§8.1) — real OpenCV Zoo ONNX, openly licensed ─────────
# YuNet (detect+landmarks) + SFace (128-D embedding). Pinned by SHA-256; a
# mismatch fails the build (no silently-swapped model ships in a signed image).
if [[ "$FACE" == "cv" ]]; then
  echo "[zuup-os] fetching face models (YuNet + SFace) into the image…"
  ZOO="https://github.com/opencv/opencv_zoo/raw/main/models"
  # Cached OUTSIDE $ROOT, which stage 20 deletes on every run. These two files
  # are ~40 MB of immutable, SHA-pinned data fetched from the internet at the END
  # of a ~50-minute debootstrap — so a network blip here costs the whole stage.
  # It cost exactly that once: `curl: (56) unexpected eof`, after mmdebstrap had
  # succeeded. The cache lives in the build volume; /dist lets the host seed it.
  CACHE="${ZUUP_MODEL_CACHE:-$BUILD/cache/models}"
  mkdir -p "$CACHE"
  fetch_model() { # url  dest  sha256(optional)
    local url="$1" dest="$2" want="${3:-}" name; name="$(basename "$dest")"
    local cached="$CACHE/$name"

    # A pinned artefact is interchangeable with any copy that hashes the same,
    # so any local copy that verifies is as good as a download.
    for src in "$cached" "/dist/models/$name"; do
      if [[ -f "$src" && -n "$want" && "$(sha256sum "$src" | awk '{print $1}')" == "$want" ]]; then
        install -D -m 0644 "$src" "$dest"
        echo "[zuup-os]   $name  (from $(dirname "$src"), sha256 pinned OK)"
        return 0
      fi
    done

    # --retry alone does NOT cover curl's transport errors — 56 is exactly the
    # class it ignores, which is why `--retry 3` retried nothing. -C - resumes a
    # partial file rather than starting the 37 MB again.
    curl -fL --proto '=https' \
         --retry 5 --retry-delay 3 --retry-all-errors \
         --connect-timeout 20 --speed-time 60 --speed-limit 1024 \
         -C - -o "$cached" "$url" || {
      echo "[zuup-os] FAIL: could not fetch $name — $url" >&2
      echo "[zuup-os]   the build host needs HTTPS to github.com, or seed the file" >&2
      echo "[zuup-os]   yourself at out/models/$name and re-run this stage." >&2
      rm -f "$cached"
      exit 1
    }
    local got; got="$(sha256sum "$cached" | awk '{print $1}')"
    if [[ -n "$want" && "$got" != "$want" ]]; then
      # Never leave a bad file in the cache — the next run would trust its size
      # and resume onto it.
      rm -f "$cached"
      echo "[zuup-os] FAIL: $name sha256 $got != pinned $want" >&2; exit 1
    fi
    install -D -m 0644 "$cached" "$dest"
    echo "[zuup-os]   $name  sha256=$got${want:+ (pinned OK)}"
  }
  # Pins recorded from the verified 2026-06-11 fetch; override only with intent.
  fetch_model "$ZOO/face_detection_yunet/face_detection_yunet_2023mar.onnx" \
    "$ROOT/usr/share/zuup/models/face_detection_yunet_2023mar.onnx" \
    "${ZUUP_YUNET_SHA256:-8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4}"
  fetch_model "$ZOO/face_recognition_sface/face_recognition_sface_2021dec.onnx" \
    "$ROOT/usr/share/zuup/models/face_recognition_sface_2021dec.onnx" \
    "${ZUUP_SFACE_SHA256:-0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79}"
fi

# ── 5. host hardening: sysctl, logind, AppArmor, USBGuard ──────────────────
inst 0644 "$ZOS/security/systemd/sysctl.d-99-zuup.conf"        etc/sysctl.d/99-zuup.conf
inst 0644 "$ZOS/security/systemd/logind.conf.d-zuup.conf"      etc/systemd/logind.conf.d/zuup.conf
inst 0644 "$ZOS/security/apparmor/zuup-firefox"                 etc/apparmor.d/zuup-firefox

# ── AppArmor has to attach to the browser this image ACTUALLY installs ──────
#
# The profile named /usr/lib/firefox/firefox while the image installed
# firefox-esr at /usr/lib/firefox-esr/firefox-esr. AppArmor attaches by resolved
# executable path, so it attached to nothing: every image ever built ran the
# kiosk browser unconfined while THREAT_MODEL.md credited AppArmor with
# containing a Firefox RCE. A path inside a policy file is a claim about another
# package's layout, and it has to be checked against the layout that landed.
FF_REAL=""
for c in "$ROOT/usr/lib/firefox-esr/firefox-esr" "$ROOT/usr/lib/firefox/firefox" \
         "$ROOT/usr/lib/firefox-esr/firefox"     "$ROOT/usr/lib/firefox/firefox-esr"; do
  [[ -x "$c" ]] && { FF_REAL="${c#"$ROOT"}"; break; }
done
[[ -n "$FF_REAL" ]] || {
  echo "[zuup-os] FAIL: no browser binary under /usr/lib/firefox* — the zuup-firefox" >&2
  echo "[zuup-os]       profile could attach to nothing and the kiosk would run" >&2
  echo "[zuup-os]       unconfined. Installed browser package: $BROWSER_PKG" >&2
  exit 1
}
# The same set of paths the profile's brace glob expands to. Spelled out rather
# than globbed so this check cannot drift from the policy silently.
case "$FF_REAL" in
  /usr/lib/firefox/firefox|/usr/lib/firefox/firefox-esr|\
  /usr/lib/firefox-esr/firefox|/usr/lib/firefox-esr/firefox-esr) : ;;
  *)
    echo "[zuup-os] FAIL: browser at $FF_REAL is not matched by the zuup-firefox" >&2
    echo "[zuup-os]       attachment /usr/lib/firefox{,-esr}/firefox{,-esr}" >&2
    exit 1 ;;
esac
# The launcher execs THIS path, so the binary that runs is the binary the
# profile confines — no symlink in /usr/bin to reason about.
printf '%s\n' "$FF_REAL" > "$ROOT/etc/zuup/browser-path"
echo "[zuup-os] AppArmor profile zuup-firefox attaches to $FF_REAL"
# USB device allow-list. The production rules pin every allowed device to the
# port it was commissioned on; on a dev/all-in-one laptop those ports name
# nothing, so the implicit block target takes EVERY USB device — including a
# keyboard plugged in to diagnose a machine whose keys are not working. The dev
# variant allows HID, capture and hubs on any port and still blocks storage and
# network adapters. See rules-dev.conf for the full reasoning.
if [[ $DEV == 1 ]]; then
  inst 0644 "$ZOS/security/usbguard/rules-dev.conf"           etc/usbguard/rules.conf
else
  inst 0644 "$ZOS/security/usbguard/rules.conf"               etc/usbguard/rules.conf
fi
inst 0644 "$ZOS/security/usbguard/usbguard-daemon.conf"        etc/usbguard/usbguard-daemon.conf
inst 0644 "$ZOS/rootfs/overlay.fstab"                          etc/fstab

# ── 6. service accounts (no shell, no home, no login) ──────────────────────
chroot_run() { systemd-nspawn -q -D "$ROOT" --pipe "$@"; }
for acct in zuup-bio zuup-hb; do
  chroot "$ROOT" useradd --system --no-create-home --shell /usr/sbin/nologin "$acct" 2>/dev/null || true
done

# ── 7. enable the unit graph + lock the default target (offline) ───────────
# Enabled ONE AT A TIME, and asserted. This was a single `systemctl enable a b
# c … >/dev/null 2>&1 || true`, which reports success no matter what happens: a
# unit with no [Install] section, a misspelled name, or a file that never got
# installed all produce a green build and an image missing that unit — on a
# machine whose only feedback channel is a kiosk browser.
UNITS=(seatd.service systemd-networkd.service
       zuup-identity.service zuup-firewall.service zuup-wireguard.service
       zuup-attest.service zuup-biometric.service
       zuup-heartbeatd.service zuup-egressd.service zuup-enrol.service
       zuup-hqsync.timer
       zuup-survey.service
       zuup-kiosk.service usbguard.service apparmor.service)
for u in "${UNITS[@]}"; do
  systemctl --root="$ROOT" enable "$u" >/dev/null 2>&1 \
    || { echo "[zuup-os] FAIL: could not enable $u" >&2; exit 1; }
done
echo "[zuup-os] unit graph enabled (${#UNITS[@]} units, each asserted)"

# systemd-networkd's [Install] is WantedBy=multi-user.target, and step 7 masks
# that target — so enabling it alone would create a symlink nothing ever pulls
# and the link would never come up. zuup-network.target Wants= it explicitly;
# this drop-in bounds the wait-online step so a hall with one unplugged terminal
# cannot hold that machine at a 120 s default before the Gate appears.
mkdir -p "$ROOT/etc/systemd/system/systemd-networkd-wait-online.service.d"
cat > "$ROOT/etc/systemd/system/systemd-networkd-wait-online.service.d/zuup.conf" <<'EOF'
# ZUUP-OS: bound the wait, and settle for any link being up. A terminal has one
# wired NIC; --any avoids waiting on interfaces that will never be configured.
[Service]
ExecStart=
ExecStart=/usr/lib/systemd/systemd-networkd-wait-online --any --timeout=30
EOF

systemctl --root="$ROOT" set-default zuup-session.target >/dev/null

# enforce: there is no path to a login prompt or multi-user surface
chroot "$ROOT" systemctl mask getty.target getty@.service serial-getty@.service \
  multi-user.target graphical.target rescue.service emergency.service \
  systemd-logind.service >/dev/null 2>&1 || true

# systemd-networkd-persistent-storage wants to write lease state under /var/lib,
# which is on the read-only verity root — it fails on every boot and prints
# [FAILED] on the console of a machine that is working perfectly. Observed in
# the production boot transcript. There is nothing to persist here: the whole
# image is RAM-only by design (INV-2), and a terminal that remembered its last
# lease would be remembering something.
chroot "$ROOT" systemctl mask systemd-networkd-persistent-storage.service >/dev/null 2>&1 || true

# ── 8. brand + strip ───────────────────────────────────────────────────────
cat > "$ROOT/usr/lib/os-release" <<EOF
NAME="ZUUP-OS"
PRETTY_NAME="ZUUP-OS Examination Terminal$([[ $DEV == 1 ]] && echo ' (DEV)')"
ID=zuup-os
VERSION_ID=2.0
VARIANT="$([[ $DEV == 1 ]] && echo dev || echo production)"
EOF
ln -sf ../usr/lib/os-release "$ROOT/etc/os-release"

# A one-word variant marker the RUNTIME can read. os-release only distinguishes
# dev from production, but the thing an operator needs to know when a terminal
# reaches no centre is whether this image was ever supposed to carry one — a
# thin image looking for an Edge appliance that isn't there looks identical to a
# broken all-in-one. Stage 25 overwrites this with `allinone`.
printf '%s\n' "$([[ $DEV == 1 ]] && echo dev || echo production)" > "$ROOT/etc/zuup/image-variant"

# §7.3: no package manager, no compiler, no editor, no rescue tooling ships.
chroot "$ROOT" bash -c 'apt-get -y purge apt apt-utils >/dev/null 2>&1 || true; \
  dpkg --purge --force-all dpkg >/dev/null 2>&1 || true' || true
rm -rf "$ROOT"/usr/bin/{apt,apt-get,apt-cache,dpkg,dpkg-deb,perl*} \
       "$ROOT"/var/lib/apt "$ROOT"/var/cache/apt "$ROOT"/usr/share/{doc,man,locale} 2>/dev/null || true

# §7.3 (defence-in-depth): remove the interactive identity / session-entry tools
# the Debian base drags in. The login/getty/rescue *units* are already masked
# (step 7) and 0 setuid binaries remain, but an immutable exam terminal has no
# legitimate reason to switch user or open a session, so the BINARIES go too —
# closing the gap between the "no login surface" claim and reality (shadow ships
# su/login/passwd; util-linux ships agetty/nsenter). Kept on purpose: /bin/sh
# (dash) for unit scripts, bash for zuup-attest + zuup-heartbeatd, runuser +
# nologin for the service accounts and the all-in-one db unit.
echo "[zuup-os] removing interactive/escalation binaries (su/login/agetty/…)…"
rm -f "$ROOT"/usr/bin/{su,newgrp,chsh,chfn,passwd,nsenter,chage,expiry,gpasswd,sg,setpriv} \
      "$ROOT"/usr/bin/login "$ROOT"/usr/sbin/agetty "$ROOT"/sbin/agetty 2>/dev/null || true
# Remove the now-orphaned PAM stanzas too: with the binaries gone nothing
# consults them, but a locked image should carry no auth policy for logins
# that cannot happen.
rm -f "$ROOT"/etc/pam.d/{su,su-l,login,passwd,chsh,chfn,newgrp} 2>/dev/null || true

# §7.3: no setuid binaries (stage 30's build-image.sh re-asserts and FAILS hard).
echo "[zuup-os] neutralising setuid bits…"
find "$ROOT" -xdev -perm -4000 -type f -print -exec chmod u-s {} + || true
find "$ROOT" -xdev -perm -2000 -type f -exec chmod g-s {} + || true

# Enforce the removal: a build that still ships a session/identity tool FAILS,
# same discipline as the setuid assert — the claim must be true, not aspirational.
for b in su login agetty newgrp nsenter passwd; do
  for d in usr/bin usr/sbin sbin bin; do
    [[ -e "$ROOT/$d/$b" ]] && { echo "[zuup-os] FAIL: /$d/$b survived the §7.3 strip" >&2; exit 1; }
  done
done
echo "[zuup-os] §7.3 login-surface strip verified (no su/login/agetty/newgrp/nsenter/passwd)"

# ── 9. DEV ONLY: drop-ins so the image boots the Gate without a real Edge ───
# These NEVER touch the production variant. They relax exactly two fail-closed
# gates (WireGuard peer + Edge attestation) so a developer can boot the Login
# Gate in QEMU. The dev os-release VARIANT=dev and a distinct UKI keep it
# unmistakable; a production terminal's Secure Boot db would not sign it.
if [[ $DEV == 1 ]]; then
  echo "[zuup-os] applying DEV drop-ins (non-production boot path)…"
  mkdir -p "$ROOT/etc/systemd/system/zuup-wireguard.service.d" \
           "$ROOT/etc/systemd/system/zuup-attest.service.d"
  cat > "$ROOT/etc/systemd/system/zuup-wireguard.service.d/dev.conf" <<'EOF'
# DEV ONLY — QEMU user-net is the "tunnel"; skip wg-quick (no real peer/keys).
[Service]
ExecStart=
ExecStart=/bin/true
ExecStop=
EOF
  cat > "$ROOT/etc/systemd/system/zuup-attest.service.d/dev.conf" <<'EOF'
# DEV ONLY — no TPM/Edge in the smoke VM; treat attestation as satisfied so the
# Gate renders. Production keeps zuup-attest.sh, which poweroffs on any failure.
[Service]
ExecStart=
ExecStart=/bin/true
EOF
  printf '00000000-0000-0000-0000-0000000000de\n' > "$ROOT/etc/zuup/terminal-id"
fi

# ── 10. PRODUCTION ASSERTS — a production image must be unable to ship a
#        development relaxation ─────────────────────────────────────────────
#
# Every relaxation in this file is guarded by `if [[ $DEV == 1 ]]`, which is
# correct and was never the problem. The problem is that `--allinone` sets
# DEV=1 (line ~29), so the ONE image that has ever been built and booted took
# the development path in full — WireGuard and attestation replaced with
# /bin/true, USB storage compiled in, the permissive USBGuard rules, a
# placeholder terminal id — while being described everywhere as the product.
#
# Nobody was going to notice that by reading, so the build asserts it instead.
# A production run now FAILS rather than quietly producing a demo wearing the
# word "production".
if [[ $DEV == 0 ]]; then
  echo "[zuup-os] asserting production posture…"
  fail_prod() { echo "[zuup-os] FAIL (production assert): $*" >&2; exit 1; }

  # The two fail-closed gates the dev drop-ins neutralise.
  for d in zuup-wireguard.service.d zuup-attest.service.d; do
    [[ -e "$ROOT/etc/systemd/system/$d" ]] && fail_prod "$d drop-in present — that is the DEV override of a fail-closed gate"
  done

  # The permissive USB rules allow HID on any port; production pins every device
  # to the port it was commissioned on.
  grep -q 'via-port' "$ROOT/etc/usbguard/rules.conf" \
    || fail_prod "USBGuard rules are not port-pinned — this looks like rules-dev.conf"

  # A login surface. §7.3 strips these and step 8 already asserts it; repeated
  # here because the whole point of this block is that production is checked as
  # a whole rather than trusting each earlier step's own guard.
  for b in su login agetty passwd nsenter; do
    [[ -e "$ROOT/usr/bin/$b" || -e "$ROOT/usr/sbin/$b" ]] && fail_prod "/usr/*/bin/$b survived — production ships no login surface"
  done

  # The variant marker the RUNTIME keys off. zuup-attest.sh halts on a failed
  # attestation only when it reads `production` here; a mislabelled image is one
  # that reports its own denials as survivable.
  [[ "$(cat "$ROOT/etc/zuup/image-variant")" == "production" ]] \
    || fail_prod "image-variant is not 'production'"

  # Self-commissioning must not exist on a production image at all: it is the
  # trust-on-first-use path, and its presence is what would let a terminal
  # register its own measurements as golden.
  [[ -e "$ROOT/usr/lib/zuup/zuup-commission.sh" ]] \
    && fail_prod "zuup-commission.sh is present — self-commissioning is all-in-one only"

  echo "[zuup-os] production posture OK (no dev drop-ins, port-pinned USB, no login surface, no self-commissioning)"
fi

BYTES=$(du -sb "$ROOT" | awk '{print $1}')
echo "[zuup-os] rootfs staged: $ROOT ($(numfmt --to=iec "$BYTES")), variant=$([[ $DEV == 1 ]] && echo dev || echo production)"
echo "$([[ $DEV == 1 ]] && echo dev || echo production)" > "$BUILD/.rootfs-variant"
