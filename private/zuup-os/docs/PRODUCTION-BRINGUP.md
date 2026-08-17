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
```

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
```

Terminals, candidates, staff and the sealed question bundles. After this the
centre runs entirely offline.

---

## What each terminal can reach

| Capability | Edge | Internet |
|---|---|---|
| `CANDIDATE_SEAT` | tunnel only | **never** — no HQ destination exists in its image |
| `INVIGILATOR_STATION` | tunnel only | **never** — same |
| `ADMIN_STATION` | tunnel | pinned HQ endpoints, and only while no paper is in flight |

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
