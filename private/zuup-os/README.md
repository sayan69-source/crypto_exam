# ZUUP-OS — Immutable Examination Terminal OS (build artifacts)

This directory holds the **build specification and configuration artifacts** for
the ZUUP-OS locked terminal image (spec §§6–7, §11 hardware trust). It implements
phases 2–7 and 11 of `../zuup_os_implementation_plan.md`.

## How this gets built (safely) — `image-build/`

Every script in this tree targets a **Linux build host** and operates on kernels,
block devices, bootloaders, Secure Boot keys, and firewall tables. Running any of
it *directly* on the developer workstation (Windows) would be meaningless at best
and destructive at worst — so each script carries a **host guard** that makes
accidental direct execution a no-op.

To actually produce the image without that risk, use the containerised pipeline:

```bash
cd image-build
./docker-build.sh -- --dev     # dev image; QEMU-boots to the Login Gate
./docker-build.sh              # production image; fail-closed, no rescue path
```

Everything heavy runs inside a pinned `zuup-os-builder` container that mounts
this repo **read-only** and writes **only** to `image-build/out/`. It never
touches the host's disks, firmware, or bootloader, and assembles the GPT image
**unprivileged** (no loop mounts, no root). The output, `out/zuup-os.img`, is a
real Secure-Boot-signed UKI + dm-verity SquashFS you boot in QEMU (stage 40) or
`dd` to a **dedicated exam terminal** — never this machine. See
[`image-build/README.md`](image-build/README.md).

The runnable, tested control plane (Edge server, portals, answer pipeline) lives
in `../edge-server`, `../exam-terminal`, `../centre-admin`, `../system-admin`.

## Layout (maps to spec §14)

```
zuup-os/
├── kernel/        §7.2  hardened kernel config + build driver
├── rootfs/        §7.3  SquashFS + dm-verity + OverlayFS→tmpfs
├── security/
│   ├── apparmor/  §7.5  browser confinement (attachment asserted at build)
│   ├── kiosk/     §7.4  Cage + locked Firefox unit (carries the seccomp filter)
│   ├── systemd/   §6, §7.4  firewall/wireguard/network/session units, logind +
│   │                        sysctl lockdown, heartbeat, HQ egress supervisor
│   ├── usbguard/  §7.2  port-pinned USB allow-list (BadUSB row 1)
│   ├── nftables.conf   §6.3 default-drop, one pinned peer
│   └── nftables.d/     §6.3 provisioning drop-ins (Edge peer, HQ destinations)
├── network/       §6.4  WireGuard (image-baked) + LAN .network + PXE serving
├── boot/
│   ├── secureboot/ §7.1  key ceremony, UKI signing, UEFI enrolment
│   ├── initramfs/  §7.3  /init: dm-verity open → tmpfs overlays → switch_root
│   └── attest/     §7.1  boot-time TPM quote → Edge; HALT on deny
├── biometric/     §8    zuup-biometricd (TF Lite face + liveness, fp SDK shim)
├── image-build/   §11   containerised pipeline → real bootable zuup-os.img
│                        (Dockerfile + 00→40 stages + QEMU/OVMF smoke boot)
└── docs/          §12, §17, §18  threat model, deployment, DPDP compliance
```

### Boot/runtime dependency chain (what guarantees the order)

```
zuup-firewall.service (default-drop, before any interface)
   └─ zuup-wireguard.service (wg0 to the Edge — the only route)
        └─ zuup-network.target
             ├─ zuup-attest.service   (TPM quote → Edge; poweroff on deny)
             ├─ zuup-biometric.service (loopback scores; RAM-only buffers)
             ├─ zuup-heartbeatd.service (seat health → invigilator grid)
             └─ zuup-kiosk.service    (Cage→Firefox Gate; After= attest+biometric)
                  └─ zuup-session.target (the image's default target — nothing else)
```

## The ten invariants this image enforces (spec §2.2)

| | Invariant | Where enforced in this tree |
|---|---|---|
| INV-1 | Root FS is read-only | `rootfs/` (SquashFS + dm-verity) |
| INV-2 | Power-off → forensic zero | `rootfs/overlay.fstab` (all writes tmpfs) |
| INV-3 | Zero internet at the centre | `security/nftables.conf` + `network/wireguard` |
| INV-4 | Multi-factor, hardware-bound login | `boot/` (TPM attest) + `biometric/` + Edge |
| INV-10 | Fail-closed gate | served by the Edge; image has no fallback path |

The answer-secrecy invariants (INV-6/7/8/9) live in the Edge + pipeline code, not
in the OS image, and are proven by the test suites there.
