#!/usr/bin/env bash
# ZUUP-OS initramfs assembler (spec §7.3) — produces the cpio.gz that ships
# INSIDE the signed UKI (sign-image.sh). Deliberately tiny: busybox (static),
# veritysetup, the /init script, and nothing else — no shells on the final
# rootfs means the initramfs is the only place busybox ever exists, and it is
# discarded at switch_root.
#
# veritysetup may be a static binary OR a normal distro binary: when it is
# dynamically linked, its shared libraries + ELF loader are bundled alongside
# it (same trust level — every byte still ends up under the UKI signature).
set -euo pipefail

# ── host guard ──────────────────────────────────────────────────────────────
if [[ "$(uname -s)" != "Linux" ]] || ! command -v cpio >/dev/null 2>&1; then
  cat <<'EOF'
[zuup-os] Build-host artifact; not running here. On the build host it would:
            1. stage busybox.static + veritysetup (libs auto-bundled if dynamic)
            2. install boot/initramfs/init as /init (0755, root:root)
            3. create the static /dev nodes (console, kmsg, ram0, ram1)
            4. cpio -H newc | gzip -9 → zuup-initramfs.cpio.gz
            5. assert the archive is < 8 MB
          Nothing was changed on this machine.
EOF
  exit 0
fi

BUSYBOX="${1:?usage: mkinitramfs.sh <busybox.static> <veritysetup>}"
VERITYSETUP="${2:?missing veritysetup}"
OUT="${OUT:-zuup-initramfs.cpio.gz}"
HERE="$(cd "$(dirname "$0")" && pwd)"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE"/{bin,sbin,dev,proc,sys,newroot}
install -m 0755 "$BUSYBOX"     "$STAGE/bin/busybox"
install -m 0755 "$VERITYSETUP" "$STAGE/sbin/veritysetup"
install -m 0755 "$HERE/init"   "$STAGE/init"
ln -s busybox "$STAGE/bin/sh"

# busybox must be static — a dynamic busybox means a broken rescue-free boot.
if ldd "$BUSYBOX" 2>/dev/null | grep -q "=>"; then
  echo "[zuup-os] FAIL: $BUSYBOX is dynamically linked; need busybox.static" >&2
  exit 1
fi

# Bundle veritysetup's shared objects AND its ELF interpreter (ld-linux) when it
# is not static. ldd resolution happens HERE on the verified build host; the
# copied bytes are sealed by the UKI signature like everything else.
#
# Harvest every absolute path token ldd prints — this catches both the resolved
# libraries (the "=> /path" column) and the loader line ("/lib64/ld-linux…"),
# WITHOUT depending on awk's \s (Debian's mawk doesn't support it; that gap is
# exactly what previously dropped the loader and broke the exec).
if ldd "$VERITYSETUP" 2>/dev/null | grep -q "=>"; then
  copied=0
  while read -r lib; do
    [[ -f "$lib" ]] || continue
    mkdir -p "$STAGE$(dirname "$lib")"
    cp -L "$lib" "$STAGE$lib"
    copied=$((copied + 1))
  done < <(ldd "$VERITYSETUP" | grep -oE '/[A-Za-z0-9_./+-]+\.so[A-Za-z0-9_./+-]*|/[A-Za-z0-9_./+-]*ld-[A-Za-z0-9_./+-]+' | sort -u)
  # The loader is mandatory — without it the dynamic binary cannot exec at all.
  # (find, not a glob: a non-matching shell glob would pass through literally and
  # make the check spuriously "fail" even when the loader was copied fine.)
  if [[ -z "$(find "$STAGE" -name 'ld-*' -type f -print -quit)" ]]; then
    echo "[zuup-os] FAIL: ELF interpreter (ld-*) not bundled for $VERITYSETUP" >&2
    exit 1
  fi
  echo "[zuup-os] bundled $copied shared objects + loader for veritysetup"
fi

# static device nodes — no udev in the initramfs
mknod -m 600 "$STAGE/dev/console" c 5 1
mknod -m 600 "$STAGE/dev/kmsg"    c 1 11
mknod -m 600 "$STAGE/dev/ram0"    b 1 0
mknod -m 600 "$STAGE/dev/ram1"    b 1 1

( cd "$STAGE" && find . -print0 | cpio --null -o -H newc | gzip -9 ) > "$OUT"

SIZE=$(stat -c%s "$OUT")
if (( SIZE > 8 * 1024 * 1024 )); then
  echo "[zuup-os] FAIL: initramfs ${SIZE}B exceeds 8 MB budget" >&2
  exit 1
fi
echo "[zuup-os] initramfs OK: ${SIZE} bytes → feed to secureboot/sign-image.sh"
