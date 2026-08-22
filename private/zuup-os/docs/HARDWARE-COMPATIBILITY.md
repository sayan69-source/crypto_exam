# Running on whatever the centre actually has

An Indian exam centre is not a fleet. It is whatever is in the room: a few
machines bought this year and forty bought over a decade, Dell and HP and
Samsung and assembled boxes, some with TPM 2.0 and Secure Boot, most with
neither.

Two wrong answers, and the one this image takes instead.

- **Wrong: require modern hardware.** A terminal OS that only runs on machines
  from 2018 onward is a terminal OS that does not run.
- **Wrong: lower the bar until everything passes.** If a machine with no TPM is
  allowed to do everything a machine with a TPM can, the TPM was never doing
  anything.
- **This image: measure what each machine offers, and let that decide what the
  machine is allowed to be.**

---

## The asymmetry that makes this work

It is already in the Edge, and it is not a concession invented for old hardware.

| | What authenticates it | Needs a TPM? |
|---|---|---|
| **ADMIN_STATION**<br>**INVIGILATOR_STATION** | the §8.2 match-all rule: face + fingerprint + bound IP + **TPM quote** + a timed challenge | **Yes** |
| **CANDIDATE_SEAT** | a seat binding an invigilator created *on an attested station*, plus roll + date of birth + biometrics | **No** |

A candidate's trust flows through the invigilator's machine, not through the
seat's firmware. So the seat does not need to prove anything about its own boot
chain — and an eleven-year-old laptop with no TPM and no Secure Boot is a
perfectly legitimate candidate seat.

This maps onto a real centre almost exactly: a handful of good machines for
staff, many old machines for candidates.

## What each machine is allowed to be

`zuup-survey.service` runs on **every** boot, including before the machine has
been provisioned, and writes `/run/zuup-identity/boot-capability.json`:

```json
{ "firmware": "UEFI", "secure_boot": "disabled", "tpm": "none",
  "max_role": "CANDIDATE_SEAT",
  "max_role_reason": "No usable TPM 2.0: staff logins need a quote, so this
                      machine can only be a candidate seat.",
  "egress_capable": false, "memory_mb": 3892, "keyboard_detected": true }
```

| Machine has | May be | HQ internet |
|---|---|---|
| TPM 2.0 + Secure Boot | any role | yes (admin station, window still gated by the Edge) |
| TPM 2.0, no Secure Boot | staff or seat | no |
| No TPM 2.0 | candidate seat only | no |

Egress is stricter than staff login on purpose. Terminal identity and capability
ride on the kernel cmdline, and the cmdline is only *authenticated* when Secure
Boot verified the UKI. Below that, someone holding the stick could relabel a
candidate seat as an admin station — so the internet capability requires the one
tier where that claim cannot be forged.

**None of this is enforced by the survey.** The survey reports; the Edge decides,
from a TPM quote it verified itself. A machine that lies in this file gains
nothing.

---

## DO NO HARM

The centre's machines are borrowed. ZUUP-OS boots from the USB stick and is
required to leave the host exactly as it found it.

| Risk | What stops it |
|---|---|
| Mounting the host's Windows/Linux partitions | `systemd.gpt_auto=0` on the signed cmdline. systemd's GPT auto-generator otherwise discovers root/home/swap by GPT type GUID **on every attached disk** and generates mount units — including for the host's internal drive |
| Activating the host's swap | same flag |
| Writing EFI variables / bricking NVRAM | `efivarfs` mounted **read-only** (`rootfs/overlay.fstab`). Samsung laptops of the 2011–2012 generation were bricked by exactly this; the kernel has guarded it since 3.x, but the mount option costs nothing and the failure is unrecoverable |
| Installing a bootloader | nothing in the image writes to any disk. The stick is written on YOUR machine with `dd`/Rufus; the terminal never modifies itself |
| Changing firmware settings | never done programmatically. Boot order is changed by a human in the firmware menu and can be changed back |
| Leaving data behind | every writable path is tmpfs (INV-2). Power off and it is gone — there is no persistent writable medium in the trust path |

The one thing you do change by hand is the boot order (or you use the one-time
boot menu, which changes nothing at all). Prefer the boot menu — usually F12,
F10 or Esc at power-on.

---

## Hardware the kernel covers

Already built in, from `x86_64_defconfig` plus the ZUUP fragments:

- **Input**: PS/2 (`i8042`, `atkbd`, `psmouse`) for old laptops, and USB HID
- **USB**: xHCI, EHCI, **OHCI and UHCI** — the last two matter on pre-2010 boxes
- **Graphics**: Intel `i915`; `simpledrm`/`simplefb` over the UEFI framebuffer as
  a vendor-neutral fallback, which is what lets the kiosk run on a machine whose
  GPU has no in-kernel driver
- **Network**: Intel (`e1000`, `e1000e`, `igb`, `igc`), Realtek (`r8169`,
  `8139too`), Broadcom (`tg3`, `bnx2`), Atheros (`atl1c`, `atl1e`), Marvell
  (`sky2`), nVidia (`forcedeth`), VIA (`via-rhine`, `via-velocity`) and JMicron
  (`jme`). Breadth is deliberate here: a terminal with no driver for its NIC has
  no link, so WireGuard never handshakes and the machine powers itself off — on a
  borrowed laptop that is indistinguishable from a broken image, and it cannot be
  diagnosed from a screen with no shell.
- **USB Ethernet**: `ax88179_178a`, `asix`, `rtl8152`, `cdc_ether`, `cdc_ncm`,
  `rndis_host` — for a laptop with no port, or one whose built-in NIC is not
  covered above. A dongle at each end and an ordinary lead is also the only
  "USB cable" that networks two laptops: neither has a device-side controller,
  so a host-to-host USB link is not possible.
- **No Wi-Fi, no Bluetooth** — deliberate, and not a compatibility gap. §6.2's
  isolation is partly structural: a driver that does not exist cannot associate
  with an access point. There is also no `wpa_supplicant` and no
  `/usr/lib/firmware` in the rootfs, so this cannot be undone at runtime either.

### Known gaps, honestly

- **Legacy BIOS-only machines do not boot this image.** It is UEFI-only: a signed
  UKI at `/EFI/BOOT/BOOTX64.EFI` on a GPT disk. There is no MBR bootloader and no
  CSM path. Roughly, machines older than ~2011 are affected, and some 2011–2012
  models shipped BIOS-only. **This is the single biggest compatibility gap** and
  closing it means adding a BIOS boot path — which also means those machines get
  no Secure Boot, so they would be candidate-seat-only by the table above.
- **AMD and NVIDIA discrete graphics** have no in-kernel driver here
  (`amdgpu`/`radeon`/`nouveau` are off to hold the 15 MB bzImage budget). Such
  machines fall back to the UEFI framebuffer via `simpledrm`, which works but is
  unaccelerated. Add the driver per hardware batch if a centre needs it.
- **Apple hardware** is untested. Intel Macs expose UEFI and should boot, but
  Apple's firmware has its own quirks around removable media and does not
  advertise a TPM — so a Mac would be candidate-seat-only regardless.

---

## Check a machine before you carry a stick to it

On the machine's existing Linux install, three commands settle everything:

```bash
[ -d /sys/firmware/efi ] && echo "UEFI — will boot" || echo "BIOS only — will NOT boot"
ls /sys/class/tpm/ 2>/dev/null && cat /sys/class/tpm/tpm0/tpm_version_major 2>/dev/null
mokutil --sb-state 2>/dev/null || echo "no Secure Boot support"
```

On Windows: `msinfo32` reports "BIOS Mode: UEFI or Legacy" and "Secure Boot
State"; `tpm.msc` reports the TPM version.

Read the result against the table above and you know, before booting anything,
whether that machine can be a staff station, a candidate seat, or nothing at all.
