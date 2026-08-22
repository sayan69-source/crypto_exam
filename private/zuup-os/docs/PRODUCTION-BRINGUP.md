# Production bring-up

How an exam centre goes from bare hardware to terminals that can run a paper.

This is the path that did not exist. Until now the only image anyone could build
and boot was the all-in-one, which takes the **development** path in full —
`--allinone` sets `DEV=1`, and the dev drop-ins replace both `zuup-wireguard`
and `zuup-attest` with `/bin/true`. The machine that has booted is one with
attestation switched off. Everything below is the other path.

Read [THREAT_MODEL.md](THREAT_MODEL.md) for what each step is defending.

---

## 0. Once per authority — the Secure Boot key hierarchy

```bash
boot/secureboot/make-keys.sh ./keys      # offline ceremony machine only
```

Private halves go straight to an HSM. `db.key`/`db.crt` become `ZUUP_DB_KEY` and
`ZUUP_DB_CRT` for every build and every provisioning run after this.

This key is the root of the whole §7.1 argument. A terminal's identity, its
capability and therefore whether it may touch the internet all live on the
signed kernel cmdline — which means they are only as trustworthy as this key.
`30-make-image.sh` now **refuses** to produce a production image without it
rather than silently generating a throwaway pair.

## 1. Once per centre — secrets

```bash
tools/gen-centre-secrets.sh --out /secure/centre-021 --centre-id <uuid>
```

Writes the token, bind, node-signing and provisioning secrets, the Edge's
WireGuard identity, the centre preshared key, and `centre.conf` — the fragment
provisioning reads. Fill in `CENTRE_NAME` and `HQ_ENDPOINTS` before continuing.

`HQ_ENDPOINTS` is consumed by exactly one terminal: the admin station. Nothing
else in the centre is given an address it could reach.

These replace the fixed `1111…aa` / `2222…bb` / `3333…cc` values committed in
the all-in-one unit file. Install them on the Edge as systemd credentials, not
`Environment=` — the drop-in the tool emits does this, and explicitly clears the
old values, because a drop-in adds to `Environment=` rather than replacing it.

## 2. Once per release — the fleet image

```bash
bash image-build/docker-build.sh          # no --dev, no --allinone
bash image-build/docker-build.sh -- --usb-boot   # …if terminals boot from a stick
```

`--usb-boot` compiles USB mass-storage back in, which §7.2 otherwise leaves out
("no exfil medium") because a production terminal is expected to boot by PXE or
from an internal disk. A laptop estate booting from sticks needs the driver for
the stick. The flag is explicit, loud during the build, recorded in the image at
`/etc/zuup/kernel-relaxations`, and stage 20 refuses to pair a production rootfs
with a USB-capable kernel that nobody asked for. See
[MULTI-LAPTOP-BRINGUP.md](MULTI-LAPTOP-BRINGUP.md).

The rootfs is built **once** and is byte-identical across the estate. The build
now asserts its own posture and fails if any development relaxation survived:
no dev drop-ins, port-pinned USBGuard rules, no login surface, no
self-commissioning script, `image-variant` reading `production`, and
`CONFIG_USB_STORAGE` compiled **out**.

## 3. Per terminal — provision

```bash
tools/provision-terminal.sh \
    --centre-config /secure/centre-021/centre.conf \
    --capability CANDIDATE_SEAT --seat A-01
```

Produces, per machine, only two small artifacts — the 700 MB rootfs is never
rebuilt:

| Artifact | Goes to |
|---|---|
| `BOOTX64.EFI` | the stick's `/EFI/BOOT/BOOTX64.EFI` |
| `wg0.conf` | the stick's ESP as `/zuup/wg0.conf`, mode 0600 |
| `registry.json` | merged into the centre's provisioning bundle |

Identity rides on the **signed cmdline** (`zuup.terminal_id`, `zuup.capability`,
`zuup.seat`, `zuup.edge`, and for the admin station `zuup.hq`). That is the
mechanism behind the internet guarantee: turning a candidate seat into an
egress-capable admin station requires the authority's signing key, not a text
editor. An attacker holding the stick can rewrite the ESP freely; the firmware
then refuses to boot what they wrote.

## 4. Per terminal — enrol, on the bench

Two things exist only once the physical machine has booted this exact image on
its own firmware: the TPM attestation key, and the measurements. Re-sign the
stick with `zuup.enrol=1`, boot it once on its own hardware, and it will capture
both and power off.

```bash
tools/collect-enrolment.sh --stick /mnt/esp \
    --out provisioned/A-01/registry.json \
    --bundle centre-021-bundle.json
```

The AK is persisted **inside the TPM** at a fixed handle, not as a context file
— on a read-only root with a tmpfs `/run`, a file would not survive a power
cycle and the terminal would generate a different key every boot.

Enrolment is deliberately physical rather than networked: registering an
attestation key over the LAN needs a channel the terminal can authenticate with,
which is exactly what is being established. The trust anchor is the operator in
the room.

Then re-sign the stick **without** `zuup.enrol=1` before it goes to a hall.

## 5. Per centre — ingest

```
POST /api/provisioning/ingest       x-provisioning-key: <edge-provisioning-key>
                                    x-hq-signature: <ed25519 over the bundle>
```

Terminals, candidates, staff and the sealed question bundles. After this the
centre runs entirely offline.

The bundle must carry HQ's signature whenever the Edge has
`HQ_PROVISIONING_PUBKEY` set, and a production Edge always does. The transport
credential proves the caller holds this centre's key; the signature proves HQ
wrote what they are carrying. That distinction matters here because the caller
is normally not a person but the courier below, whose credential sits in
plaintext on a USB stick.

## 6. Per centre — the uplink

The admin station is the only machine in the hall with a route off the LAN, and
nobody is logged into it. `zuup-hqsync.timer` runs the courier every 15 minutes;
each run pulls this centre's bundle from the public platform into the Edge, then
offers the Edge's sealed answer ledger back to HQ.

```
GET  <hq>/api/v1/centre-sync/hello     x-centre-id / x-centre-key
GET  <hq>/api/v1/centre-sync/bundle    →  POST <edge>/api/provisioning/ingest
POST <edge>/api/courier/ledger/export  →  POST <hq>/api/v1/centre-sync/ledger
```

Three things have to be in `centre.conf` before the admin station is
provisioned:

| Key | What it is | Where it comes from |
|---|---|---|
| `HQ_BASE_URL` | the platform, as a name — what TLS is verified against | the deployment |
| `HQ_ENDPOINTS` | the addresses the firewall pins | blank: resolved at provisioning |
| `HQ_CENTRE_KEY` | this centre's credential at HQ | `POST /api/v1/centre-sync/centres/<id>/key` (tier-0), shown once |

**There is no DNS on a terminal, and this is where that becomes concrete.**
`provision-terminal.sh` resolves `HQ_BASE_URL` on the provisioning host and
freezes the addresses onto the signed cmdline as `zuup.hq`, while the hostname
travels separately as `zuup.hq_url`. The courier then calls
`curl --resolve host:port:ip` — TLS authenticates the NAME, the connection is
pinned to an ADDRESS the authority signed, and nothing on the exam VLAN gets a
say in either. The consequence to plan for: a platform behind a CDN or an
elastic address will move, and the admin station must be re-provisioned when it
does. Put a fixed address in front of HQ if that is unacceptable.

What the courier can and cannot do, precisely: it carries an HQ-signed bundle it
cannot forge, and sealed envelopes it cannot open (every record is ciphertext
under a data key wrapped to the System Admin's HSM). It cannot choose its
moment either — `zuup-egressd` holds the firewall shut, and the Edge's export
refuses, until the exam window has closed and every present candidate has
submitted.

---

## What each terminal can reach

| Capability | Edge | Internet |
|---|---|---|
| `CANDIDATE_SEAT` | tunnel only | **never** — no HQ destination exists in its image |
| `INVIGILATOR_STATION` | tunnel only | **never** — same |
| `ADMIN_STATION` | tunnel | pinned HQ endpoints, and only while no paper is in flight |

The admin station's traffic is entirely the courier's: `/api/v1/centre-sync/*`
on the platform named by `zuup.hq_url`, over TLS, to the addresses in `zuup.hq`.

Two independent mechanisms, and it is worth keeping them apart:

- **Where** — the `hq_dest` set. Written by `zuup-identity.service` only when the
  signed cmdline says `ADMIN_STATION`. On a seat the set is empty, so there is
  no destination a window could open onto.
- **When** — the `hq_window` chain, empty at every boot. `zuup-egressd` adds a
  single `accept` only while the Edge reports the centre clear, and the Edge
  reports clear only when no exam has an open window or a candidate at a seat
  who has not submitted.

Worst case for a fully compromised admin station: it can talk to HQ, and nowhere
else.

---

## Still open

- **No REAL hardware has run this path.** The production image builds (512 MB)
  and boots: a console-enabled diagnostic build of the same kernel, initramfs
  and root hash was watched through UEFI → dm-verity → systemd → identity →
  firewall → fail-closed poweroff. That is QEMU, not a laptop, and it is not a
  TPM. See [HARDWARE-TEST.md](HARDWARE-TEST.md).
- **Stage 40's `SMOKE PASS` is nearly blind on a production image.** Production
  is `console=null`, so its pass condition reduces to "QEMU exited 0 and no
  kiosk appeared" — which cannot distinguish a good boot that halted at
  attestation from an initramfs verity failure that powered off. Use
  `image-build/diag-boot.sh` when you need to actually see a boot; it is what found
  the two defects fixed on 2026-08-17.
- **The WireGuard private key is plaintext on the ESP**, which is FAT and outside
  dm-verity. Stealing a stick gets LAN access as that terminal — not an exam,
  which additionally needs a TPM quote from a key that cannot leave that chip.
  Sealing it to the TPM closes this and is the next step.
- **PCR 4 is not predicted.** It is the firmware's Authenticode measurement of
  the UKI and depends on how a given firmware walks the PE image; capture it
  from a reference machine of each hardware model. PCR 11 *is* predicted, per
  terminal, and carried through `predicted_pcr` (migration 006) into
  `verifyQuote`, where it outranks the enrolment-observed value.

---

## Testing on real hardware

[HARDWARE-TEST.md](HARDWARE-TEST.md) is the step-by-step for a spare laptop:
what to expect on screen at each boot (mostly nothing — production is
`console=null`), how to tell a correct fail-closed poweroff from a boot that
never happened, and which single audit row proves the whole network path works.
