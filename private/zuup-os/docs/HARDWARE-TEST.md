# Testing a production terminal on real hardware

For the spare laptop. Written to be followed at the machine, in order, with the
expected screen at each step and what it means when you get a different one.

> **The spare laptop will be wiped.** ZUUP-OS is written to the whole USB stick,
> not installed — but you will be changing that machine's UEFI settings, and one
> optional step (§6) replaces its Secure Boot keys. Nothing is written to its
> internal disk by ZUUP-OS itself. Do not use a machine you care about.

---

## 0. What you need

| | |
|---|---|
| Spare laptop | UEFI, x86-64. TPM 2.0 if you want to test attestation — most machines from ~2017 have one |
| USB stick | 1 GB or larger, **contents destroyed** |
| This machine | to build and to run the Edge |
| Both on one network | the laptop must be able to reach this machine |

**Check the TPM first**, because it changes what you can test. On the spare
laptop's existing OS:

- Windows: `Win+R` → `tpm.msc`. Look for "The TPM is ready for use" and
  Specification Version **2.0**.
- Linux: `ls /dev/tpmrm0`

No TPM 2.0 is fine — you can still test everything up to attestation, and the
terminal will correctly refuse every privileged login. That refusal is itself a
result worth having.

---

## 1. Build the image (this machine)

Already done, but to rebuild:

```bash
cd private/zuup-os/image-build
ZUUP_OUT="$PWD/out-prod" ZUUP_DB_KEY=/dist/keys/db.key ZUUP_DB_CRT=/dist/keys/db.crt bash docker-build.sh
```

You should end with `out-prod/zuup-os.img` at roughly 512 MB.

**Size is the quickest sanity check.** ~512 MB is the production image. ~745 MB
is the all-in-one demo. If you flash the wrong one you will be testing the image
that has attestation switched off, which is the thing this exercise exists to
stop doing.

---

## 2. Write it to the stick

**Windows** — [Rufus](https://rufus.ie):

1. Select `out-prod/zuup-os.img`
2. Rufus will ask ISO vs DD — choose **DD Image mode**. This is a whole-disk
   image; ISO mode will produce something that does not boot.
3. Write.

**Linux/macOS:**

```bash
sudo dd if=out-prod/zuup-os.img of=/dev/sdX bs=4M oflag=direct status=progress
```

Check `/dev/sdX` twice. `dd` will overwrite whatever you name.

---

## 3. Set up the laptop's firmware

Reboot into UEFI setup (usually F2, F10, F12 or Del at power-on):

- **Disable Secure Boot** for the first test. The image is signed with the
  validation key from this build, which the laptop's firmware has never heard
  of — leaving Secure Boot on means the firmware refuses to boot it, which looks
  identical to a broken image. §6 turns it back on properly.
- **Disable "fast boot"** if present, so USB is enumerated early.
- Boot order: USB first, or use the one-time boot menu.

---

## 4. First boot — expect it to power off

Boot the stick. **The screen will stay black and the machine will power off
after about 30 seconds. That is a pass.**

Production images run `console=null` — a terminal shows the candidate nothing,
ever. And this stick carries no terminal identity yet, so:

```
zuup-identity : no zuup.terminal_id — this image has not been provisioned
zuup-firewall : loads, fully closed
zuup-wireguard: fails (no config) → poweroff
```

That is the fail-closed path working. An unprovisioned terminal must not present
a surface.

**How to read what actually happened**, since the screen tells you nothing:

| What you see | What it means |
|---|---|
| Black screen, powers off in ~30 s | Correct. Booted, found no identity, went dark |
| Powers off in under 5 s | Firmware never booted the image. Check DD mode, check Secure Boot is off |
| Hangs indefinitely, no power off | Boot stalled. Most likely verity could not find the root — see below |
| Firmware error / "no bootable device" | The stick was written in ISO mode, or the ESP is not being seen |

If you want to actually watch it, connect a USB-serial adapter, or use the
diagnostic console build:

```bash
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$(pwd -W):/zuup:ro" -v zuup-os-build:/build \
  -v "$(cd private/zuup-os/image-build/out-prod && pwd -W):/dist" \
  zuup-os-builder /dist/diag-boot.sh
```

That re-signs the same kernel and rootfs with a serial console and boots it in
QEMU, so you can see the whole sequence. It is how the two defects fixed on
2026-08-17 were found.

---

## 5. Provision the stick, then boot again

This is the real test. Now the terminal has an identity.

### 5a. Start the Edge on this machine

```bash
cd private/edge-server
docker compose up -d
DATABASE_URL="postgres://zuup:zuup@127.0.0.1:5433/zuup_edge" npm run migrate
```

Find this machine's LAN address (`ipconfig` on Windows) — call it `10.0.0.5` or
whatever it actually is. The laptop must be able to reach it.

### 5b. Generate the centre's secrets

```bash
bash private/zuup-os/tools/gen-centre-secrets.sh \
    --out ./centre-test --centre-id $(uuidgen)
```

Edit `centre-test/centre.conf`:

```
EDGE_LAN_IP=<this machine's LAN address>
EDGE_TUNNEL_IP=10.9.0.1
TUNNEL_SUBNET=10.9.0
CENTRE_NAME="Test Centre"
HQ_ENDPOINTS=203.0.113.10:443     # a placeholder unless testing admin egress
```

### 5c. Provision one terminal

```bash
export ZUUP_DB_KEY=$PWD/private/zuup-os/image-build/out-prod/keys/db.key
export ZUUP_DB_CRT=$PWD/private/zuup-os/image-build/out-prod/keys/db.crt

bash private/zuup-os/tools/provision-terminal.sh \
    --centre-config ./centre-test/centre.conf \
    --capability INVIGILATOR_STATION --seat INV-1 \
    --build private/zuup-os/image-build/out-prod
```

Copy onto the stick's ESP (the FAT partition, visible in Explorer/Finder):

- `provisioned/INV-1/BOOTX64.EFI` → `/EFI/BOOT/BOOTX64.EFI` (replace)
- `provisioned/INV-1/wg0.conf` → `/zuup/wg0.conf` (create the `zuup` folder)

### 5d. Boot again

Now expect: the tunnel comes up, attestation is attempted, the Edge has no
commissioning record for this terminal, and it goes dark again — but for a
**different reason**, which the Edge will tell you:

```bash
docker exec -it edge-server-postgres-1 psql -U zuup -d zuup_edge \
  -c "select action, target, details from secure_audit_log order by id desc limit 5;"
```

`TERMINAL_ATTESTATION_DENIED` with `NO_ATTESTATION_KEY_REGISTERED` means the
whole chain worked: the terminal booted, raised its tunnel, reached your Edge and
was correctly refused because nobody has enrolled it.

**That single audit row is the most valuable result of this entire exercise.** It
proves the network path, the firewall, the identity mechanism and the attestation
handshake all work on real hardware.

---

## 6. Enrolment — only if the laptop has a TPM 2.0

Re-sign with enrolment enabled, boot once, and the machine writes its own
attestation key and measurements to its stick:

```bash
bash private/zuup-os/tools/provision-terminal.sh \
    --centre-config ./centre-test/centre.conf \
    --capability INVIGILATOR_STATION --seat INV-1 \
    --terminal-id <the same id as before> \
    --build private/zuup-os/image-build/out-prod
# then append ` zuup.enrol=1` to that terminal's cmdline and re-sign
```

Boot it. It captures the AK and PCRs, writes `/zuup/enrolment.json` to the ESP,
and powers off. Bring the stick back:

```bash
bash private/zuup-os/tools/collect-enrolment.sh \
    --stick /path/to/mounted/esp \
    --out provisioned/INV-1/registry.json \
    --bundle centre-bundle.json
```

Then POST `centre-bundle.json` to `/api/provisioning/ingest` with the
`x-provisioning-key` header, re-sign the stick **without** `zuup.enrol=1`, and
boot a third time. This time attestation should pass and the kiosk should appear.

**Enabling Secure Boot properly** (optional, and it is a commitment — enrolling
custom keys can make the machine refuse to boot its original OS):
`boot/secureboot/make-keys.sh` then `enroll-keys.sh`, then rebuild with those
keys instead of the validation pair.

---

## What I most want to know

In rough order of value, because each answers something no amount of testing on
my side can:

1. **Does it power off at ~30 s on the unprovisioned boot?** Confirms the
   production boot chain runs on real firmware — verity opening against a real
   disk rather than a virtio device is the step most likely to behave differently
   from QEMU.
2. **Does the `TERMINAL_ATTESTATION_DENIED` row appear after §5?** Confirms
   DHCP, the LAN interface, the rewritten firewall and the WireGuard handshake —
   the exact path whose three separate bugs I fixed but have never seen work.
3. **Does the laptop have a TPM 2.0, and does `tpm2_createak` succeed?** No real
   TPM has ever produced a quote for this verifier. The parser is pinned to the
   spec and thoroughly tested against synthetic quotes; agreement with the byte
   layout a real chip emits is genuinely unverified.
4. **Does the screen come up at all after enrolment** — does Cage start, is there
   a keyboard, does Firefox render the Gate? The all-in-one got here, but on
   different kernel settings.

If something fails, the useful artifacts are: the serial console if you have an
adapter, the last 20 rows of `secure_audit_log`, and how long the machine took
to power off. Those three between them locate almost any failure.
