# ZUUP-OS Threat Model & Verification Ledger

This document is the Phase 12 sign-off (spec §17). It restates the adversaries
and the ten invariants, then — crucially — maps **each invariant and each attack
row to its actual proof**: either a *runnable, passing test* (with file + test
name) or an *authored OS artifact* (with file) that enforces it on the build/boot
host. Where something is authored-not-executed, this document says so plainly.

## Verification posture (read this first)

The system splits cleanly into two halves:

- **Control-plane + answer-pipeline** (the Edge server, the four portals, the
  envelope/Merkle/HQ-vault code) is **TypeScript/Node, runnable and tested here.**
  Its invariants — INV-4,5,6,7,8,9 and the double-assignment race — are proven by
  the `edge-server` test suite that runs in CI and locally against a dockerised
  Postgres.
- **The OS image** (kernel, rootfs, Secure Boot, nftables, AppArmor, seccomp,
  Tetragon, WireGuard, PXE) — INV-1,2,3 and the physical/boot attack rows — is
  **authored as build-host artifacts in `../`.** They are not run on the
  developer workstation (they operate on kernels, block devices, and firewall
  tables; running them directly on Windows would be meaningless or destructive).
  They ARE now executable, reproducibly and safely, through the containerised
  pipeline in `../image-build/`: every heavy step runs inside a pinned Docker
  build host that mounts the repo read-only and writes only to `out/`, never
  touching the host's disks, firmware, or bootloader. The pipeline emits a real,
  Secure-Boot-signed `zuup-os.img` and a QEMU/OVMF+swtpm smoke boot asserts the
  boot-chain invariants (verity open → switch_root → fail-closed session).

This division is deliberate and is the project's safety boundary: the OS
invariants are *defined* by the authored artifacts, *built* by the container
pipeline, and *finally* validated on real terminal hardware at commissioning.

### What the container pipeline proves vs. what still needs hardware

| Proven by `image-build/` (Linux/Docker) | Still requires real terminal hardware |
|---|---|
| kernel builds with lockdown/verity/nftables, no modules, < 15 MB | measured boot into a discrete TPM 2.0 (golden PCRs) |
| rootfs has the closed process set, no setuid, default = locked session | Secure Boot db enrolled in real UEFI; USB/tamper-mesh physical tests |
| dm-verity squashfs seals; a flipped byte fails `veritysetup open` | fingerprint reader + UVC liveness against live spoofs (§8.3) |
| signed UKI; QEMU boot reaches the Gate (dev) / fails closed (prod) | 100-terminal PXE boot < 30 s at a real centre (Phase 11 scale) |

## Role tiering — where each role authenticates (and why it matters)

A role's login location is a security decision, not a UX one: it determines what
network the credential surface is exposed on. The rule is **only the HQ tier
touches the public internet; every centre-scoped role authenticates on the
centre LAN against the Centre Edge.**

| Role | Login surface | Network | Rationale |
|---|---|---|---|
| **System Admin** (tier-0) | **public website** (`private/system-admin`, HQ) | internet, behind the HSM | nationwide oversight + the only decrypt boundary; lives at HQ by definition |
| **Centre Admin** (tier-1) | **the OS software** — `ADMIN_STATION` ZUUP-OS terminal, Centre Admin portal served by the Edge at `/admin/` | **centre LAN only** | its match-all login *needs* the bound LAN IP + TPM + on-device face/fingerprint; INV-3 means the centre has no internet during an exam, so a public page would be both unreachable and a new attack surface |
| **Invigilator** | exam-terminal Gate on an `INVIGILATOR_STATION` | centre LAN only | same hardware-bound match-all |
| **Candidate** | exam-terminal Gate on a `CANDIDATE_SEAT` | centre LAN only | roll+DOB, terminal-bound (INV-5) |

The kiosk launcher (`security/kiosk/zuup-kiosk-launch.sh`) enforces this on the
image: it reads the terminal's Edge-reported capability and opens exactly one
surface — `ADMIN_STATION → /admin/`, invigilator/candidate stations → the Gate,
anything else → the fail-closed `/locked` wall. A Centre Admin credential
surface therefore **cannot** appear on a candidate seat or on the public web.

## Adversaries (spec §2.1)

| Adversary | Capability | Primary defence | Proof |
|---|---|---|---|
| Candidate at the seat | smuggled USB/phone/earpiece, another's roll/DOB | no USB-storage/BT/audio drivers; terminal-bound; on-device proctoring | `kernel/zuup.config` (authored); INV-5 test (runnable) |
| Rogue invigilator | wants a session without authorisation | face+fp+IP+TPM match-all + live one-time code | INV-4 test (runnable) |
| Malicious centre staff | wants to read/alter answers | sealed to System Admin key; centre keyless; hash-chained logs | INV-6/INV-9 tests (runnable) |
| LAN attacker | ARP/DNS spoof, MitM, rogue DHCP/PXE | WireGuard mTLS; nftables drop; signed PXE | `security/nftables.conf`, `network/` (authored) |
| Tamper/hardware | keylogger, disk swap | virtual keyboard; RAM-only; Secure Boot; TPM | `boot/`, `rootfs/` (authored) |
| Supply-chain | doctored image/paper | Secure Boot signature; on-chain questions-root | `boot/secureboot` (authored); chain-bridge (runnable) |

## The ten invariants → their proof

| Inv | Statement | Proof kind | Where |
|---|---|---|---|
| INV-1 | `remount,rw /` fails | authored + **built** | `boot/initramfs/init` (verity open, ro squashfs), `rootfs/overlay.fstab`, `kernel/zuup.config`; sealed by `image-build/30-make-image.sh` (dm-verity squashfs) |
| INV-2 | power-off → forensic zero | authored + **built** | `boot/initramfs/init` + `rootfs/overlay.fstab` (all writes tmpfs); `image-build/40-qemu-smoke.sh` boots with no persistent writable medium |
| INV-3 | no internet from terminal/Edge | authored + **built** | `security/nftables.conf` + `security/systemd/zuup-firewall.service` (drop before link-up), `network/wireguard`, `network/pxe/dnsmasq.conf`; firewall+wg units enabled into the image by `image-build/20-stage-rootfs.sh` |
| INV-4 | identity intersection (match-all) | **runnable** | `src/test/match-all.test.ts` (8 deny paths), `src/test/integration/cascade.test.ts` |
| INV-5 | terminal binding (roll↔seat) | **runnable** | `cascade.test.ts` (foreign roll denied), `http.ts` `/candidate/login` |
| INV-6 | centre is blind (no key) | **runnable** | `src/test/integration/rbac.test.ts`, `src/test/envelope.test.ts`, `answer-pipeline.test.ts`, `hq-vault.test.ts`, `sysadmin-vault-compat.test.ts` (portal decrypt boundary) |
| INV-7 | one ACTIVE Centre Admin | **runnable** | `src/test/integration/db.test.ts` (partial unique index), `system-admin.test.ts` (2nd CA activation → 409) |
| INV-8 | single-use, time-boxed codes | **runnable** | `src/test/one-time-code.test.ts`, `cascade.test.ts` + `system-admin.test.ts` (replay denied at both tiers) |
| INV-9 | tamper-evidence (chain breaks) | **runnable** | `src/test/merkle-chain.test.ts`, `db.test.ts` (audit), `answer-pipeline.test.ts`, `hq-vault.test.ts` |
| INV-10 | fail-closed gate | **runnable (browser-verified)** | `exam-terminal/app/page.tsx` health-wall; Edge `/api/health` |

## Attack matrix → result + proof (spec §17.1)

| # | Attack | Expected result | Proof |
|---|---|---|---|
| 1 | BadUSB / storage | no mount, no exec | authored: `kernel/zuup.config` (no `USB_STORAGE`), `security/usbguard/rules.conf` (port-pinned allow-list), `security/apparmor` |
| 2 | keyboard escape | blocked at compositor + logind | authored: `security/kiosk/zuup-kiosk.service` (Cage, `TTYVTDisallocate`), `security/systemd/logind.conf.d-zuup.conf` (`NAutoVTs=0`) |
| 3 | screen capture / overlay | single surface only | authored: Cage single-`wl_surface` (§7.4) |
| 4 | LAN MitM / rogue PXE | WG mTLS rejects; unsigned PXE fails | authored: `network/wireguard`, `boot/secureboot` |
| 5 | internet exfiltration | all fail | authored: `security/nftables.conf` |
| 6 | Firefox RCE | contained to tmpfs, killed | authored: `apparmor/usr.bin.firefox`, `seccomp/firefox.json`, `tetragon` |
| 7 | foreign roll at bound seat | rejected | **runnable**: `cascade.test.ts` (INV-5) |
| 8 | DOB brute force | Argon2id + 3-strike lock | **runnable**: `http.ts` rate-limit; `lib/dob.ts` (Argon2id) |
| 9 | impostor invigilator | denied (match-all) | **runnable**: `match-all.test.ts` (INV-4) |
| 10 | replay an approval code | rejected + incident | **runnable**: `one-time-code.test.ts` (INV-8) |
| 11 | two centre admins | blocked by unique index | **runnable**: `db.test.ts` (INV-7) |
| 12 | centre reads answers | fails — no key | **runnable**: `rbac.test.ts`, `answer-pipeline.test.ts` (INV-6) |
| 13 | tamper a stored answer leaf | chain breaks, anchor mismatch | **runnable**: `answer-pipeline.test.ts`, `hq-vault.test.ts` (INV-9) |
| 14 | forensic recovery | zero bytes | authored: `rootfs/overlay.fstab` (INV-2) |
| 15 | rootkit / unsigned module | Secure Boot + `MODULE_SIG_FORCE` reject | authored: `kernel/zuup.config`, `boot/secureboot/{make-keys,sign-image,enroll-keys}.sh` (UKI binds kernel+initrd+verity hash) |
| 16 | biometric spoof | liveness rejects | authored: `biometric/zuup-biometricd.py` (liveness floor 0.80 before any score; fail-closed on missing model/camera); threshold in `match-all.ts` |
| 17 | enclosure tamper | TPM zeroisation, breach screen | authored: `boot/secureboot/README.md` (dedicated HW) |
| 21 | tampered image at boot | Edge denies; terminal powers off | authored: `boot/attest/zuup-attest.sh` (TPM quote → `/api/terminal/attest`, HALT on deny/unreachable); **runnable** server half: `repo.attestTerminal` in `cascade.test.ts` |
| 18 | Edge offline at gate | fail-closed | **runnable (browser-verified)**: gate health-wall (INV-10) |
| 19 | clock/time-lock spoof | paper stays sealed | authored + runnable: drand T₀ in `question-crypto.ts` |
| 20 | double-assignment race | distinct seats | **runnable**: `db.test.ts` (`FOR UPDATE SKIP LOCKED`) |
| 22 | tampered rootfs byte | boot HALTs at verity | **built**: `image-build/30` seals dm-verity; `boot/initramfs/init` opens with `--panic-on-corruption`; a flipped byte → I/O error → poweroff (verified by re-hashing in `image-build`'s assembly self-test) |
| 23 | unsigned/edited UKI | UEFI refuses to boot | **built**: `boot/secureboot/sign-image.sh` sbsigns the UKI + `sbverify`; OVMF Secure Boot vars reject an unsigned image (`image-build/40` optional SB mode) |

## Residual risk

- Rows enforced **only** by authored OS artifacts (1–6,14–17) are validated on
  the build host + hardware, not in this repo's automated loop. They MUST be
  re-run on the target image before any production deployment (see
  `DEPLOYMENT_GUIDE.md` → "Pre-deployment gate").
- Biometric false-accept/reject rates depend on the deployed models and readers;
  the match-all thresholds (`τ_face=0.82`, vendor fp score) are policy and must be
  re-validated against the field model set per §8.1.
- The HQ HSM is modelled in software (`hq/vault.ts`) for testability; in
  production the System Admin private key never leaves the HSM (§18.2).
