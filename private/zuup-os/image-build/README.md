# ZUUP-OS image build pipeline

This directory turns the authored ZUUP-OS artifacts (`../kernel`, `../rootfs`,
`../security`, `../boot`, `../biometric`, `../network`) into a **real, bootable,
Secure-Boot-signed examination-terminal image** — `out/zuup-os.img`.

It is the executable counterpart of the rest of `zuup-os/`, which holds the
configuration and the per-stage scripts. Those scripts each carry a Linux
host-guard so they are safe no-ops on a developer workstation; **inside the
builder container the guards pass and the scripts run for real.**

## Safety model (why this can't hurt your machine)

Everything heavy runs inside the `zuup-os-builder` Docker container. The
container mounts the repository **read-only**; intermediate build state lives
in the `zuup-os-build` named volume (a Linux ext4 filesystem inside Docker's
VM — required, because the kernel tree has case-colliding paths that NTFS
would silently merge), and only final artifacts are exported to `./out`.
It never touches the host's disks, bootloader, or UEFI firmware. The pipeline
also assembles the GPT disk image **unprivileged** — no loop devices, no
`mount`, no root on the host (`sfdisk` + `mtools` + `dd` into a plain file).

The output is just a *file*. Turning it into a running OS is a separate,
deliberate act you control: boot it in QEMU (stage 40) or `dd` it to a USB
stick for a **dedicated exam terminal** — never this workstation.

## Quick start

```bash
# from Windows/macOS/Linux with Docker (Docker Desktop WSL2 backend on Windows):
cd private/zuup-os/image-build
./docker-build.sh -- --dev     # dev image that boots the Login Gate in QEMU
./docker-build.sh              # production image (fail-closed, no rescue path)
```

On a dedicated Linux build host you can skip Docker and run the stages directly:

```bash
BUILD=$PWD/out ./build-all.sh
```

## Stages

| Stage | Script | Produces | Asserts |
|---|---|---|---|
| 00 | `00-fetch-kernel.sh` | verified `linux-$KVER` source | PGP-WKD **or** pinned SHA-256 (`§7.2`) |
| 10 | `10-build-kernel.sh` | `bzImage` + merged `kernel.config` | < 15 MB; lockdown/verity/nftables kept; **no modules** |
| 20 | `20-stage-rootfs.sh` | hardened `rootfs/` | closed process set; no setuid; default = `zuup-session.target` |
| 30 | `30-make-image.sh` | `zuup-os.img` (signed UKI + verity squashfs) | UKI sbverify; squashfs < 300 MB |
| 40 | `40-qemu-smoke.sh` | `smoke-serial.log` + verdict | DEV→reaches Gate; PROD→fails closed |

`./docker-build.sh 10` runs one stage; `./build-all.sh -- --dev` forwards flags.

## Production signing keys (do this for real deployments)

The Secure Boot key hierarchy is generated **once**, offline, by the authored
ceremony script `../boot/secureboot/make-keys.sh` (RSA-4096 PK/KEK/db; private
halves go straight into an HSM). Then point the build at the db key:

```bash
ZUUP_DB_KEY="pkcs11:object=zuup-db;type=private"   # HSM handle
ZUUP_DB_CRT=/secure/db.crt \
  ./docker-build.sh
```

Without those, stage 30 generates **ephemeral DEV keys** under `out/keys` and
prints a loud warning — fine for QEMU, **never enrol them on real firmware.**
Enrolment of the real PK/KEK/db into each terminal's UEFI happens at centre
commissioning via `../boot/secureboot/enroll-keys.sh`.

## Booting it on a real (spare) laptop — the safe procedure

The right way to first touch hardware: a machine with **no data you care about**.
The image runs entirely from the stick + RAM; it does not touch the laptop's
internal disk unless you deliberately `dd` it there.

1. **Write the image to a pendrive** (≥ 1 GB). From Windows use Rufus or
   balenaEtcher and point them at `out/zuup-os.img` — both only list removable
   drives, which removes the classic wrong-disk `dd` risk. From Linux:
   `sudo dd if=zuup-os.img of=/dev/sdX bs=4M oflag=direct status=progress`
   (triple-check `/dev/sdX` is the stick: `lsblk`).
2. **Boot the spare laptop from USB** (F12/F10/Esc boot menu). With the
   ephemeral **dev keys**, disable Secure Boot in firmware first — only the
   real ceremony keys (`make-keys.sh` + `enroll-keys.sh`) make SB enforcement
   meaningful. Wired Ethernet only by design: the kernel has **no Wi-Fi**.
3. **Expect, by variant:**
   - `--dev` image → boots to the **Login Gate** (shows "Centre offline" until
     an Edge is reachable — that wall is INV-10 working, not a bug).
   - production image → **powers itself off** unless a provisioned Edge
     attests it. That is the fail-closed design proving itself.
4. To reach a live Gate, run the Edge stack on another machine on the same
   LAN and provision `/etc/zuup/{terminal-id,wg0.conf}` (next section).

The laptop's internal Linux/Windows stays intact: remove the stick, reboot,
and the machine is exactly as before — ZUUP-OS keeps every write in RAM.

## Per-terminal provisioning (the last mile)

The image is identical across a fleet; two things are baked **per terminal**
at provisioning, then the UKI is re-signed for that unit:

- `/etc/zuup/terminal-id` — the UUID the Edge knows (attestation + heartbeat).
- `/etc/zuup/wg0.conf` — that terminal's WireGuard keys + the centre Edge peer
  (`../network/wireguard/wg0.conf.template`).

The terminal's golden PCR set is registered with the Edge so boot-time
attestation (`../boot/attest`) can pass. See `../docs/DEPLOYMENT_GUIDE.md`.

## Tunables

| Env | Default | Meaning |
|---|---|---|
| `KVER` | `6.6.52` | mainline kernel version to build |
| `ZUUP_KERNEL_SHA256` | — | pin the source hash (preferred on air-gapped hosts) |
| `ZUUP_DB_KEY` / `ZUUP_DB_CRT` | ephemeral dev | Secure Boot db signing key (HSM) |
| `ZUUP_BROWSER_PKG` | `firefox-esr` | the locked kiosk browser package |
| `ZUUP_SUITE` | `trixie` | Debian suite for the rootfs |
| `ZUUP_SMOKE_TIMEOUT` | `180` | QEMU smoke-boot budget (seconds) |
