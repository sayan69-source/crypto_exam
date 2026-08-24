#!/usr/bin/env bash
# Audit a BUILT image against the sources it claims to be made of, and against
# systemd itself. Diagnostic; not part of the build.
#
#   MSYS_NO_PATHCONV=1 docker run --rm #     -v "$(cd private/zuup-os && pwd -W):/zos:ro" -v zuup-os-build:/build #     --entrypoint /bin/bash zuup-os-builder /zos/image-build/audit-image.sh
#
# It answers two questions a build log cannot. Is the image actually made of the
# sources checked in right now — a rebase rewrites mtimes, so only content
# answers that — and does every unit in it parse and resolve on the machine that
# will run it, which is what catches a directive systemd would silently ignore.
set -uo pipefail
fail=0
note() { printf '  %-58s %s\n' "$1" "$2"; }

echo "unpacking the shipped root…"
unsquashfs -q -d /tmp/r -f /build/zuup-root.squashfs >/dev/null 2>&1
echo "  $(du -sh /tmp/r | cut -f1) unpacked"

echo
echo "════════ 1. does the image contain the sources that are checked in? ════════"
# Every file the build copies verbatim, compared by content rather than mtime —
# a rebase rewrites mtimes and would otherwise look like drift.
declare -A MAP=(
  [/zos/security/systemd/zuup-identity.sh]=usr/lib/zuup/zuup-identity.sh
  [/zos/security/systemd/zuup-hqsync.sh]=usr/lib/zuup/zuup-hqsync.sh
  [/zos/security/systemd/zuup-egressd.sh]=usr/lib/zuup/zuup-egressd.sh
  [/zos/security/systemd/zuup-heartbeatd.sh]=usr/lib/zuup/zuup-heartbeatd.sh
  [/zos/security/systemd/zuup-enrol.sh]=usr/lib/zuup/zuup-enrol.sh
  [/zos/security/systemd/zuup-survey.sh]=usr/lib/zuup/zuup-survey.sh
  [/zos/security/kiosk/zuup-kiosk-launch.sh]=usr/lib/zuup/zuup-kiosk-launch.sh
  [/zos/security/systemd/zuup-identity.service]=etc/systemd/system/zuup-identity.service
  [/zos/security/systemd/zuup-hqsync.service]=etc/systemd/system/zuup-hqsync.service
  [/zos/security/systemd/zuup-hqsync.timer]=etc/systemd/system/zuup-hqsync.timer
  [/zos/security/systemd/zuup-egressd.service]=etc/systemd/system/zuup-egressd.service
  [/zos/security/kiosk/zuup-kiosk.service]=etc/systemd/system/zuup-kiosk.service
  [/zos/security/nftables.conf]=etc/zuup/nftables.conf
  [/zos/network/systemd/zuup-lan.network]=etc/systemd/network/10-zuup-lan.network
  [/zos/security/usbguard/rules.conf]=etc/usbguard/rules.conf
)
for src in "${!MAP[@]}"; do
  dst="/tmp/r/${MAP[$src]}"
  name="$(basename "$src")"
  if [[ ! -r "$src" ]]; then note "$name" "SOURCE MISSING"; fail=1; continue; fi
  if [[ ! -r "$dst" ]]; then note "$name" "NOT IN IMAGE"; fail=1; continue; fi
  if [[ "$(sha256sum < "$src" | cut -d' ' -f1)" == "$(sha256sum < "$dst" | cut -d' ' -f1)" ]]; then
    note "$name" "matches"
  else
    note "$name" "DIFFERS — the image is stale"; fail=1
  fi
done

echo
echo "════════ 2. does every ZUUP unit parse and resolve? ════════"
# systemd-analyze verify against the real root: catches a directive systemd
# would silently ignore (the StartLimitIntervalSec-in-[Service] class of bug)
# and an ExecStart pointing at a path the image does not contain.
units=$(cd /tmp/r/etc/systemd/system && ls zuup-*.service zuup-*.timer zuup-*.target 2>/dev/null | tr '\n' ' ')
echo "  units: $units"
out=$(systemd-analyze verify --root=/tmp/r --recursive-errors=no $units 2>&1)
if [[ -n "$out" ]]; then
  echo "$out" | sed 's/^/    /'
  fail=1
else
  note "systemd-analyze verify" "clean"
fi

echo
echo "════════ 3. the enabled unit graph ════════"
for w in zuup-network.target.wants zuup-session.target.wants; do
  echo "  $w:"
  ls "/tmp/r/etc/systemd/system/$w" 2>/dev/null | sed 's/^/    /' || echo "    (missing)"
done
echo "  default.target -> $(readlink -f /tmp/r/etc/systemd/system/default.target 2>/dev/null | sed 's|/tmp/r||')"

echo
echo "════════ 4. production posture, re-checked in the artifact ════════"
note "image-variant" "$(cat /tmp/r/etc/zuup/image-variant)"
note "kernel-relaxations" "$(cat /tmp/r/etc/zuup/kernel-relaxations 2>/dev/null || echo '(none)')"
  note "seat-policy" "$(cat /tmp/r/etc/zuup/seat-policy 2>/dev/null || echo '(none — every terminal needs a TPM)')"
# A shell is NOT a login surface: /bin/sh runs every unit script and bash runs
# zuup-attest. What must not exist is a way to become a user — which is what the
# build's own posture assert covers, and is re-checked here in the artifact.
surface=""
for b in su login agetty getty passwd nsenter sudo; do
  [[ -e "/tmp/r/usr/bin/$b" || -e "/tmp/r/usr/sbin/$b" || -e "/tmp/r/bin/$b" || -e "/tmp/r/sbin/$b" ]] && surface="$surface $b"
done
if [[ -n "$surface" ]]; then note "login surface" "PRESENT:$surface — FAIL"; fail=1
else note "login surface" "none (sh/bash present, as the unit scripts require)"; fi
note "no dev drop-ins" "$(ls -d /tmp/r/etc/systemd/system/zuup-*.service.d 2>/dev/null | tr '\n' ' ' || echo 'none')"
note "self-commissioning absent" "$([[ -e /tmp/r/usr/lib/zuup/zuup-commission.sh ]] && echo 'PRESENT — FAIL' || echo 'yes')"
note "usbguard port-pinned" "$(grep -c 'via-port' /tmp/r/etc/usbguard/rules.conf) rules"
note "setuid binaries" "$(find /tmp/r -perm -4000 -type f 2>/dev/null | wc -l)"
note "CA bundle" "$(grep -c 'BEGIN CERTIFICATE' /tmp/r/etc/ssl/certs/ca-certificates.crt 2>/dev/null || echo 0) certs"
note "clock-epoch" "$(stat -c %y /tmp/r/usr/lib/clock-epoch 2>/dev/null | cut -d' ' -f1 || true)${_:+}$([[ -e /tmp/r/usr/lib/clock-epoch ]] || echo ABSENT)"

echo
[[ $fail == 0 ]] && echo "IMAGE AUDIT OK" || echo "IMAGE AUDIT FOUND PROBLEMS"
exit $fail
