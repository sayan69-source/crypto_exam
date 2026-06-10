# ZUUP-OS — Immutable Examination Terminal OS (build artifacts)

This directory holds the **build specification and configuration artifacts** for
the ZUUP-OS locked terminal image (spec §§6–7, §11 hardware trust). It implements
phases 2–7 and 11 of `../zuup_os_implementation_plan.md`.

## ⚠ These artifacts are authored, NOT executed here

Every script in this tree targets a **Linux build host** and operates on kernels,
block devices, bootloaders, Secure Boot keys, and firewall tables. Running any of
it on the developer workstation (Windows) would be meaningless at best and
destructive at worst. So, by deliberate policy:

- **Nothing in `zuup-os/` is run as part of the local build or test loop.** The
  runnable, tested parts of ZUUP-OS are the TypeScript Edge server, the portals,
  and the answer pipeline — see `../edge-server`, `../exam-terminal`,
  `../centre-admin`.
- Each shell script begins with a **host guard** that refuses to run unless it is
  on a Linux build host with the expected toolchain, and prints what it *would*
  do. This makes accidental execution a no-op.
- These files are the source of truth a release engineer uses on a dedicated,
  air-gapped Linux build server to produce the signed SquashFS image.

## Layout (maps to spec §14)

```
zuup-os/
├── kernel/        §7.2  hardened kernel config + build driver
├── rootfs/        §7.3  SquashFS + dm-verity + OverlayFS→tmpfs
├── security/
│   ├── apparmor/  §7.5  Firefox confinement
│   ├── seccomp/   §7.5  browser syscall allow-list
│   ├── tetragon/  §7.5  closed process set (kill on violation)
│   ├── kiosk/     §7.4  Cage + locked Firefox unit
│   ├── systemd/   §6, §7.4  firewall/wireguard/session units, logind + sysctl lockdown, heartbeat
│   ├── usbguard/  §7.2  port-pinned USB allow-list (BadUSB row 1)
│   └── nftables.conf  §6.3 default-drop
├── network/       §6.4  WireGuard (image-baked) + PXE serving
├── boot/
│   ├── secureboot/ §7.1  key ceremony, UKI signing, UEFI enrolment
│   ├── initramfs/  §7.3  /init: dm-verity open → tmpfs overlays → switch_root
│   └── attest/     §7.1  boot-time TPM quote → Edge; HALT on deny
├── biometric/     §8    zuup-biometricd (TF Lite face + liveness, fp SDK shim)
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
