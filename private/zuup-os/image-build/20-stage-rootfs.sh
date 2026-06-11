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
[[ "${1:-}" == "--dev" || "${ZUUP_DEV:-0}" == "1" ]] && DEV=1

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
# Face verification backend: ZUUP_FACE=cv pulls the real OpenCV (YuNet+SFace)
# engine — python3-opencv + the two ONNX models — so face check works on any
# commodity webcam with no vendor SDK. It is opt-in because opencv + the 37 MB
# SFace model materially enlarge the image (the budget is raised to match).
FACE="${ZUUP_FACE:-cv}"
[[ "${1:-}" == "--no-face" ]] && FACE=none

PKGS="systemd,systemd-sysv,udev,dbus,libpam-systemd,\
cage,seatd,fonts-dejavu-core,${BROWSER_PKG},\
wireguard-tools,nftables,iproute2,usbguard,\
apparmor,apparmor-profiles,libpam-apparmor,\
tpm2-tools,\
python3,python3-yaml,python3-numpy,python3-pil,\
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

echo "[zuup-os] mmdebstrap $SUITE → $ROOT (this pulls the userland)…"
mmdebstrap --variant=minbase \
  --include="$PKGS" \
  --aptopt='Apt::Install-Recommends "false"' \
  --customize-hook='chroot "$1" systemctl disable getty@tty1.service >/dev/null 2>&1 || true' \
  "$SUITE" "$ROOT" "$MIRROR"

inst() { install -D -m "$1" "$2" "$ROOT/$3"; }   # mode src dest(relative)

# ── 2. terminal identity + ZUUP config tree ────────────────────────────────
mkdir -p "$ROOT/etc/zuup"
inst 0644 "$ZOS/security/nftables.conf"               etc/zuup/nftables.conf
inst 0644 "$ZOS/security/seccomp/firefox.json"        etc/zuup/firefox-seccomp.json
# per-terminal identity + WireGuard config are BAKED PER TERMINAL at
# provisioning; ship inert placeholders so the units have a target path.
printf 'REPLACE-AT-PROVISIONING\n' > "$ROOT/etc/zuup/terminal-id"
inst 0600 "$ZOS/network/wireguard/wg0.conf.template"  etc/zuup/wg0.conf

# ── 3. systemd units (network/session chain + workloads) ───────────────────
for u in security/systemd/zuup-firewall.service \
         security/systemd/zuup-wireguard.service \
         security/systemd/zuup-network.target \
         security/systemd/zuup-session.target \
         security/systemd/zuup-heartbeatd.service \
         biometric/zuup-biometric.service \
         boot/attest/zuup-attest.service \
         security/kiosk/zuup-kiosk.service; do
  inst 0644 "$ZOS/$u" "etc/systemd/system/$(basename "$u")"
done

# ── 4. daemons + scripts ───────────────────────────────────────────────────
inst 0755 "$ZOS/security/systemd/zuup-heartbeatd.sh"  usr/lib/zuup/zuup-heartbeatd.sh
inst 0755 "$ZOS/security/kiosk/zuup-kiosk-launch.sh"  usr/lib/zuup/zuup-kiosk-launch.sh
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
  fetch_model() { # url  dest  sha256(optional)
    local url="$1" dest="$2" want="${3:-}"
    curl -fL --retry 3 --proto '=https' -o "$dest" "$url"
    local got; got="$(sha256sum "$dest" | awk '{print $1}')"
    if [[ -n "$want" && "$got" != "$want" ]]; then
      echo "[zuup-os] FAIL: $(basename "$dest") sha256 $got != pinned $want" >&2; exit 1
    fi
    echo "[zuup-os]   $(basename "$dest")  sha256=$got${want:+ (pinned OK)}"
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
inst 0644 "$ZOS/security/apparmor/usr.bin.firefox"             etc/apparmor.d/usr.bin.firefox
inst 0644 "$ZOS/security/usbguard/rules.conf"                  etc/usbguard/rules.conf
inst 0644 "$ZOS/security/usbguard/usbguard-daemon.conf"        etc/usbguard/usbguard-daemon.conf
inst 0644 "$ZOS/rootfs/overlay.fstab"                          etc/fstab

# ── 6. service accounts (no shell, no home, no login) ──────────────────────
chroot_run() { systemd-nspawn -q -D "$ROOT" --pipe "$@"; }
for acct in zuup-bio zuup-hb; do
  chroot "$ROOT" useradd --system --no-create-home --shell /usr/sbin/nologin "$acct" 2>/dev/null || true
done

# ── 7. enable the unit graph + lock the default target (offline) ───────────
systemctl --root="$ROOT" enable \
  zuup-firewall.service zuup-wireguard.service \
  zuup-attest.service zuup-biometric.service \
  zuup-heartbeatd.service zuup-kiosk.service usbguard.service apparmor.service >/dev/null 2>&1 || true
systemctl --root="$ROOT" set-default zuup-session.target >/dev/null

# enforce: there is no path to a login prompt or multi-user surface
chroot "$ROOT" systemctl mask getty.target getty@.service serial-getty@.service \
  multi-user.target graphical.target rescue.service emergency.service \
  systemd-logind.service >/dev/null 2>&1 || true

# ── 8. brand + strip ───────────────────────────────────────────────────────
cat > "$ROOT/usr/lib/os-release" <<EOF
NAME="ZUUP-OS"
PRETTY_NAME="ZUUP-OS Examination Terminal$([[ $DEV == 1 ]] && echo ' (DEV)')"
ID=zuup-os
VERSION_ID=2.0
VARIANT="$([[ $DEV == 1 ]] && echo dev || echo production)"
EOF
ln -sf ../usr/lib/os-release "$ROOT/etc/os-release"

# §7.3: no package manager, no compiler, no editor, no rescue tooling ships.
chroot "$ROOT" bash -c 'apt-get -y purge apt apt-utils >/dev/null 2>&1 || true; \
  dpkg --purge --force-all dpkg >/dev/null 2>&1 || true' || true
rm -rf "$ROOT"/usr/bin/{apt,apt-get,apt-cache,dpkg,dpkg-deb,perl*} \
       "$ROOT"/var/lib/apt "$ROOT"/var/cache/apt "$ROOT"/usr/share/{doc,man,locale} 2>/dev/null || true

# §7.3: no setuid binaries (stage 30's build-image.sh re-asserts and FAILS hard).
echo "[zuup-os] neutralising setuid bits…"
find "$ROOT" -xdev -perm -4000 -type f -print -exec chmod u-s {} + || true
find "$ROOT" -xdev -perm -2000 -type f -exec chmod g-s {} + || true

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

BYTES=$(du -sb "$ROOT" | awk '{print $1}')
echo "[zuup-os] rootfs staged: $ROOT ($(numfmt --to=iec "$BYTES")), variant=$([[ $DEV == 1 ]] && echo dev || echo production)"
echo "$([[ $DEV == 1 ]] && echo dev || echo production)" > "$BUILD/.rootfs-variant"
