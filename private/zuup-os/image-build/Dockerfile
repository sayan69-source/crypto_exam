# ZUUP-OS build-host container (spec §7, Phase 11).
#
# A pinned, disposable Linux build host: every tool the image pipeline needs,
# nothing from the developer's machine. The container only ever writes inside
# /build (a bind-mounted output directory) — it cannot touch the host's disks,
# firmware, or boot configuration. That is the safety boundary that lets the
# pipeline run from a Windows/macOS workstation at all (via docker-build.sh).
#
#   docker build -t zuup-os-builder -f Dockerfile .
#
# Debian trixie: first stable release whose systemd ships `ukify` (UKI
# assembly) in the systemd-ukify package.
FROM debian:trixie-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    # ── kernel compile (§7.2) ────────────────────────────────────────────
    build-essential bc bison flex libssl-dev libelf-dev kmod \
    cpio xz-utils zstd \
    # ── source fetch + verification ──────────────────────────────────────
    curl ca-certificates gnupg dirmngr \
    # ── rootfs staging (§7.3) ────────────────────────────────────────────
    mmdebstrap squashfs-tools \
    # ── dm-verity + initramfs ────────────────────────────────────────────
    cryptsetup-bin busybox-static \
    # ── UKI assembly + Secure Boot signing (§7.1) ────────────────────────
    systemd-ukify systemd-boot-efi sbsigntool efitools uuid-runtime \
    # ── unprivileged disk assembly (no loop devices, no mounts) ──────────
    mtools dosfstools fdisk jq \
    # ── QEMU smoke boot (40-qemu-smoke.sh) ───────────────────────────────
    qemu-system-x86 ovmf swtpm \
    && rm -rf /var/lib/apt/lists/*

# The repo is bind-mounted read-only at /zuup; all artifacts land in /build.
WORKDIR /zuup/private/zuup-os/image-build
ENTRYPOINT ["/bin/bash"]
