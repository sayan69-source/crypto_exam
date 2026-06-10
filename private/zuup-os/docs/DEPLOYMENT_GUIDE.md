# ZUUP-OS Deployment Guide

How a release engineer turns this repo into running exam centres. Phases 11–12
of the spec. Everything in `zuup-os/` runs on a **dedicated, air-gapped Linux
build host** — never on a developer workstation.

## 0. Roles in the deployment

| Tier | Runs | Built from |
|---|---|---|
| Terminal (candidate/invigilator) | ZUUP-OS image, RAM-only, on the centre LAN | `zuup-os/` + `exam-terminal/` |
| Centre Admin station | ZUUP-OS image, admin surface | `zuup-os/` + `centre-admin/` |
| Centre Edge appliance | on-prem server on the exam VLAN | `edge-server/` (+ `docker-compose.yml`) |
| System Admin (HQ) | hardened HQ workstation + HSM | `public/frontend/app/admin` + `public/backend` (§13.5) |

## 1. Key ceremony (once, before any centre — §18.2)

1. Generate the **answer-decryption keypair inside the HQ HSM.** The private key
   never leaves the HSM. Export only the public key (SPKI PEM).
2. Generate the **Secure Boot key hierarchy** (PK/KEK/db) on an offline,
   HSM-backed host. These sign the kernel + image.
3. (Optional) Split HSM activation with Shamir's Secret Sharing so no single
   System Admin can unilaterally decrypt.
4. Publish the System Admin **public** key into the Edge config
   (`SYSTEM_ADMIN_PUBLIC_KEY_PEM`) and into the signed image. Terminals seal to
   it; only the HSM can open (INV-6).

## 2. Build the image (Linux build host)

```sh
# kernel — hardened, < 15 MB, signed modules
ZUUP_MODULE_KEY=/keys/module.pem  ./kernel/build.sh

# rootfs — minimal userland → SquashFS → dm-verity → assert no setuid, < 300 MB
./rootfs/build-image.sh /staging/rootfs

# sign the kernel + verity root hash with the Secure Boot key
./boot/secureboot/sign-image.sh zuup-root.squashfs zuup-root.roothash
```

Each script self-guards: on a non-Linux / toolless host it prints what it would
do and exits 0 without touching anything.

## 3. Commission a centre

1. Register the centre + its terminals with the System Admin: each terminal's
   WireGuard pubkey, TPM endorsement key hash, and **golden PCR set** go into the
   Edge terminal registry (`terminals.golden_pcr`, `terminals.wg_pubkey`).
2. Provision the Centre Edge appliance on the exam VLAN. Apply the §12 migrations:
   ```sh
   DATABASE_URL=postgres://… npm run migrate -w edge-server
   ```
3. Activate the centre's single Centre Admin via the System Admin portal
   (one-time code + fingerprint, §9.3). INV-7 enforces exactly one.
4. Stand up PXE on the Edge (`network/pxe/dnsmasq.conf`); patch out the LAN
   switch's WAN uplink.

## 4. Boot the terminals (Phase 11)

- Power on → PXE chainloads the **signed** image into RAM → measured boot extends
  PCRs → terminal attests to the Edge (`POST /api/terminal/attest`) → on match,
  the Login Gate renders. Target: power-on → Gate < 30 s.
- A mismatched/edited image fails Secure Boot or PCR attestation and never
  reaches the Gate (fail-closed).

## 5. Pre-deployment gate (must be green — spec §17.2)

Control-plane (runs in CI + locally):
```sh
npm run check:boundary                     # public/private boundary clean
npm test -w edge-server                    # unit (match-all, codes, merkle, seal-compat)
npm run db:up -w edge-server
DATABASE_URL=… npm run migrate -w edge-server
DATABASE_URL=… npm run test:db -w edge-server   # INV-5,6,7,9, cascade, pipeline, hq-vault
npm run db:down -w edge-server
```

OS image (build host + hardware, see `THREAT_MODEL.md` for the per-row mapping):
- [ ] Secure Boot enrolled; UEFI password; PXE-only boot.
- [ ] Kernel: `lockdown=confidentiality`, `MODULE_SIG_FORCE`, no Wi-Fi/BT/USB-storage/audio.
- [ ] Rootfs: SquashFS+dm-verity, tmpfs overlays, no shells, `find / -perm -4000` empty.
- [ ] Network: nftables default-drop, WireGuard-only, local resolver, no WAN.
- [ ] Display: Cage single-surface, locked Firefox policy, virtual keyboard.
- [ ] Runtime: AppArmor + seccomp + Tetragon enforcing; closed process set.
- [ ] INV-3 four-test suite fails to reach the internet from terminal AND Edge.

## 6. Answer egress (after the window)

1. Centre Admin exports the signed, ciphertext-only sync bundle
   (`POST /api/admin/ledger/export`) — SEALED→SYNCED.
2. Move it out-of-band to the System Admin (never a live terminal internet link).
3. HQ verifies node sig + re-walks the chain (`/api/v1/sys/ledger/ingest`),
   anchors the answer-root on Polygon (`/anchor`, no PII), then HSM-decrypts
   (`/decrypt`) into the System Admin store — the only place plaintext exists.

## 7. Teardown

```sh
npm run db:down -w edge-server   # drops the dev DB volume; binds 127.0.0.1 only
```
Power-off destroys 100% of terminal session state (INV-2) — there is nothing to
wipe on a terminal.
