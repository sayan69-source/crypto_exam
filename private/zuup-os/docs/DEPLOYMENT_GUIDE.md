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

Commissioning is not paperwork: it is the step that produces every fact the
login gate later checks. A terminal that skips it cannot attest, so it halts at
boot and nobody can log in on it — by design.

1. **Per terminal**, on the machine itself, create the two key pairs and write
   the identity:
   ```sh
   echo "$TERMINAL_UUID" > /etc/zuup/terminal-id       # baked into the signed image
   tpm2_createek  -c /etc/zuup/ek.ctx
   tpm2_createak  -C /etc/zuup/ek.ctx -c /etc/zuup/ak.ctx -u /etc/zuup/ak.pub
   tpm2_print -t TPM2B_PUBLIC /etc/zuup/ak.pub          # export the PUBLIC half as PEM
   # the biometric daemon's signing key (public half is registered, private stays here)
   openssl genpkey -algorithm ed25519 -out /etc/zuup/biometric-attest.key
   openssl pkey -in /etc/zuup/biometric-attest.key -pubout -out /etc/zuup/biometric-attest.pub
   chmod 600 /etc/zuup/biometric-attest.key
   ```
   Record the golden PCR set from a known-good boot of the signed image:
   `tpm2_pcrread sha256:0,4,7,8,9,14`.

2. **Build the centre's provisioning bundle** — terminals (with `golden_pcr`,
   `ak_pubkey_pem`, `bio_pubkey_pem`, `wg_pubkey`, `bound_ip`), staff,
   candidates, and the sealed question bundle. The exact shape:
   ```sh
   node private/edge-server/src/provision.ts --schema
   ```
   Only PUBLIC key material appears in it; the Edge never holds a private key.

3. Provision the Centre Edge appliance on the exam VLAN, apply the §12
   migrations, then commission it from the bundle:
   ```sh
   DATABASE_URL=postgres://… npm run migrate -w edge-server
   DATABASE_URL=postgres://… node private/edge-server/src/provision.ts centre.json
   ```
   The same rows arrive over the HQ link via `POST /api/provisioning/ingest`;
   this is the offline door to the same room. `provision.ts` warns loudly about
   any terminal it wrote without a golden PCR set or attestation key, because
   those machines will halt at boot.

4. Activate the centre's single Centre Admin via the System Admin portal
   (one-time code + a fingerprint re-supplied at their bound station, §9.3).
   INV-7 enforces exactly one.

5. Stand up PXE on the Edge (`network/pxe/dnsmasq.conf`); patch out the LAN
   switch's WAN uplink.

## 4. Boot the terminals (Phase 11)

- Power on → PXE chainloads the **signed** image into RAM → measured boot extends
  PCRs → the terminal takes a nonce (`POST /api/terminal/attest/challenge`) and
  submits a TPM quote over it (`POST /api/terminal/attest`) → on a verifying
  signature over the golden PCRs, the Login Gate renders. Target: power-on →
  Gate < 30 s.
- A mismatched/edited image fails Secure Boot or the quote check and never
  reaches the Gate (fail-closed). The Edge answers with the exact clause that
  failed (`PCR_4_MISMATCH`, `QUOTE_SIGNATURE_INVALID`, …) and
  `zuup-attest.sh` writes it to the journal before powering off — an operator
  standing at a dark machine has nothing else to go on.

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
- [ ] Runtime: AppArmor enforcing AND attached (`aa-status` names the running
      browser, not just the profile); systemd seccomp filter on the kiosk unit.
- [ ] INV-3: a candidate seat and an invigilator station reach nothing but the
      Edge. The ADMIN_STATION reaches the pinned HQ endpoints and nothing else,
      and only while `zuup-egressd` reports the window open.

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
