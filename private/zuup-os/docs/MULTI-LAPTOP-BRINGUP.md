# Running a centre on real laptops

Three or more machines, one role each, one exam, and an uplink to the public
platform. This is the practical companion to [PRODUCTION-BRINGUP.md](PRODUCTION-BRINGUP.md)
(what the mechanisms are) and [HARDWARE-TEST.md](HARDWARE-TEST.md) (one machine,
in detail).

Read the two "it will not work unless" sections first. Both are design
decisions, not bugs, and both will otherwise cost you an afternoon.

---

## The shape of it

```
   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
   │  A-01       │   │  INV-1      │   │  ADM-1      │
   │ CANDIDATE   │   │ INVIGILATOR │   │ ADMIN       │
   │ _SEAT       │   │ _STATION    │   │ _STATION    │
   └──────┬──────┘   └──────┬──────┘   └──────┬──────┘
          │ WireGuard       │                 │  WireGuard
          └─────────────────┴────────┬────────┘
                                     │
                          ┌──────────┴──────────┐        the ONLY machine
                          │   Centre Edge       │        with a route off
                          │   (a 4th machine)   │        the LAN is ADM-1,
                          │   Postgres + Edge   │        and only to the
                          └─────────────────────┘        pinned HQ addresses
                                     │
                            ordinary Ethernet
                                     │
                              switch or router  ── internet ──▶ the platform
```

Every laptop boots the **same image** from its own USB stick. What differs is
the stick's `BOOTX64.EFI`, whose signed cmdline carries the machine's identity,
its seat and its capability. Nothing on the running machine can change that.

---

## It will not work unless: Secure Boot, on the admin station

`zuup-identity.sh` refuses a privileged capability on a boot it cannot verify.
No UEFI Secure Boot means the cmdline is unsigned, which means a capability read
from it proves nothing — so `ADMIN_STATION` and `INVIGILATOR_STATION` are
**demoted to `CANDIDATE_SEAT` and the HQ endpoints are dropped**.

That is correct behaviour and it is also the most likely reason your admin
station has no uplink. You have three options:

1. **Enrol the authority key** into that laptop's firmware (Setup Mode →
   `boot/secureboot/enroll-keys.sh`, PK last). The proper path; also the one
   most consumer firmware makes fiddly.
2. **Use a machine whose firmware already trusts the key** you signed with.
3. **Accept the demotion for the seats and pick one machine to do properly.**
   Candidate seats do not need a verified boot — their trust comes from the
   invigilator's attested station and the candidate's own credentials.

Check which happened, on the machine, without a shell:

```
/run/zuup-identity/boot-trust     → "secureboot" or "unverified"
/run/zuup-identity/capability     → what it actually became
```

<<<<<<< HEAD
## It will not work unless: a TPM, on the two stations

Attestation is not optional on a production image. A machine that cannot produce
a TPM 2.0 quote **powers itself off about thirty seconds into its first boot**,
and because production is `console=null` it does so in silence.

TPM 2.0 did not ship on laptops before roughly 2016, and where it does exist the
firmware usually leaves it off. Look in the BIOS for **Intel PTT** (Platform
Trust Technology) or **AMD fTPM** — that is a firmware TPM and it counts.

This image is built with `--untrusted-seats`, which softens exactly one case:

| Role | No TPM 2.0 |
|---|---|
| `CANDIDATE_SEAT` | boots, and is refused every privileged login |
| `INVIGILATOR_STATION` | halts |
| `ADMIN_STATION` | halts |

That is the same argument the image already makes when it demotes an unverified
BIOS boot to a seat: a seat's trust comes from the invigilator's attested station
and the candidate's own credentials, not from its own firmware. The machines that
admit people, and the one machine that reaches the internet, still have to prove
their boot chain. Build without the flag and every machine must have a TPM.

**When a machine does halt, it now says why.** The reason is written to the
stick's ESP before the power goes, so you can pull it and read it anywhere:

```
/zuup/last-halt.txt        on the ESP — reason, capability, boot trust, time
```

Without that file a laptop switching itself off looks identical to a bad flash,
a dead battery or a broken image, and there is no shell to ask.

=======
>>>>>>> d0ce5ef (feat(hardware): make a real laptop estate boot, and give the admin station a route)
## It will not work unless: a cable

There is **no Wi-Fi**. Not partially — the image has no wireless driver, no
`wpa_supplicant` and no firmware tree at all. A terminal joins the exam VLAN by
cable or it does not join.

What works:

| | |
|---|---|
| Built-in Ethernet | Intel, Realtek, Broadcom, Atheros, Marvell, VIA, JMicron are compiled in |
| **USB Ethernet dongle** | AX88179, AX8817x, RTL8152, CDC-ECM/NCM, RNDIS — compiled in |
| A cheap switch, or your router | any |

What does not:

- **A USB-to-USB cable between two laptops.** This is worth stating plainly
  because it is a reasonable thing to assume: two ordinary laptops cannot be
  networked over a USB lead. Neither has a USB *device* controller, so neither
  can be the peripheral. The "USB cable" that works is a dongle at each end and
  ordinary Ethernet between them.
- Wi-Fi, tethering, and anything else that needs a driver plus firmware.

---

## 1. Build the image

```bash
cd private/zuup-os/image-build
ZUUP_OUT=$PWD/out-production \
ZUUP_DB_KEY=/zuup/private/zuup-os/image-build/out-prod/keys/db.key \
ZUUP_DB_CRT=/zuup/private/zuup-os/image-build/out-prod/keys/db.crt \
<<<<<<< HEAD
  ./docker-build.sh -- --usb-boot --untrusted-seats
```

`--untrusted-seats` lets a candidate seat with no TPM 2.0 boot; see above for
exactly what it does and does not concede. Drop it and every machine needs a TPM.

=======
  ./docker-build.sh -- --usb-boot
```

>>>>>>> d0ce5ef (feat(hardware): make a real laptop estate boot, and give the admin station a route)
`--usb-boot` is required for laptops. Production normally compiles USB
mass-storage **out** — §7.2's "no exfil medium" — and boots from PXE or an
internal disk. A laptop booting from a stick needs the driver for the stick, so
the flag compiles it back in, says so loudly during the build, and records it in
the image at `/etc/zuup/kernel-relaxations`. USBGuard's port-pinned allow-list is
then the only control on what may attach.

The build refuses to pair a production rootfs with a USB-capable kernel unless
you asked for it. That check exists because it already happened silently once: a
cached `--dev` kernel was reused by a later production run and nothing said so.

## 2. Where the Edge lives

The Edge is not one of the three laptops. It is a fourth machine — your
workstation is fine — running Postgres and the Edge server, with:

- a **fixed address on the LAN** that matches `EDGE_LAN_IP` in `centre.conf`;
- **WireGuard listening on 51820**, holding one `[Peer]` per terminal;
- **no need for internet** of its own.

Generate the Edge's side after provisioning the terminals:

```bash
bash private/zuup-os/tools/build-edge-wg.sh \
    --centre-config out-production/centre/centre.conf \
    --provisioned  out-production/provisioned
```

That reads every `provisioned/<SEAT>/registry.json` and writes an Edge `wg0.conf`
with a peer per terminal. It is assembled, not appended: re-run it after adding a
seat. On Linux install it as `/etc/wireguard/wg0.conf` and `wg-quick up wg0`; on
Windows, import the file in the WireGuard client.

Without this the terminals' handshakes arrive at a host that has never heard of
them, `zuup-wireguard.service` fails, and all three laptops power themselves off
in a way that looks exactly like a broken image.

## 3. The LAN, and how the admin station reaches the internet

Use your ordinary router as the exam LAN for a test run: it hands out DHCP and
has a route to the internet. The terminals take **only an address** from that
lease — `zuup-lan.network` refuses the gateway, the routes, DNS and NTP, so a
candidate seat ends up with an address and nowhere to go.

The admin station is the exception, and narrowly: `zuup-identity.sh` writes a
networkd drop-in with one **host route per pinned HQ address**, via the lease's
gateway. Its routing table therefore contains the platform's two addresses and
no default route — so even with the firewall flushed, that machine cannot reach
anything else on the internet.

Confirm on the machine:

```
ip route            # expect: the LAN subnet, plus <hq-ip>/32 via <router>. NO default.
```

## 4. Provision one stick per laptop

```bash
cd private/zuup-os
for spec in "ADMIN_STATION ADM-1" "INVIGILATOR_STATION INV-1" "CANDIDATE_SEAT A-01"; do
  set -- $spec
  ZUUP_OUT=$PWD/image-build/out-production \
    bash tools/provision-in-container.sh terminal --capability "$1" --seat "$2"
done
```

Then per stick: `dd` the image, and copy that seat's files onto the ESP —
`BOOTX64.EFI` to `/EFI/BOOT/BOOTX64.EFI`, `wg0.conf` to `/zuup/wg0.conf`, and for
the admin station `hq-centre.key` and `edge-provisioning.key` alongside. The two
credentials are **not** inside the signed UKI, so one minted later can simply be
dropped in — no re-signing.

Getting at the ESP on Windows needs `diskpart`; the steps are in
[HARDWARE-TEST.md](HARDWARE-TEST.md) §5c.

## 5. Set the clocks

<<<<<<< HEAD
A terminal has no NTP — the DHCP lease's NTP server is refused along with its
gateway and DNS — and TLS to the platform will not validate against a clock that
is years out. On the second-hand machines a centre actually fields, a flat CMOS
battery means the firmware says 1970, and the only symptom is that the courier
reports HQ as unreachable while everything else looks healthy.

The image now ships a clock epoch stamped at build time, so systemd drags a
stuck clock forward to release day at boot. That covers the dead battery. It
cannot move a clock **backwards**, so a firmware clock set to some year in the
future is still yours to fix.
=======
A terminal has no NTP — the DHCP lease's NTP server is refused like everything
else — and TLS to the platform will not validate against a clock that is years
out. The image bumps a stuck clock forward to its own build time, which covers a
dead CMOS battery, but not a firmware clock set to the wrong year.
>>>>>>> d0ce5ef (feat(hardware): make a real laptop estate boot, and give the admin station a route)

Set the BIOS clock roughly right on each laptop before you start. "Roughly" is
enough: certificates are valid for months.

## 6. What each machine should do

| Machine | Expected first boot |
|---|---|
| Any, unprovisioned | identity says "not provisioned", firewall stays shut, powers off |
<<<<<<< HEAD
| Any, no TPM, not a seat | powers off; `/zuup/last-halt.txt` on the ESP says why |
=======
>>>>>>> d0ce5ef (feat(hardware): make a real laptop estate boot, and give the admin station a route)
| Candidate seat | tunnel up → attestation attempted → denied (`NO_ATTESTATION_KEY_REGISTERED`) until enrolled |
| Invigilator | same, plus the console once enrolled |
| Admin station | the above, plus `zuup-hqsync` on a 15-minute timer |

`TERMINAL_ATTESTATION_DENIED / NO_ATTESTATION_KEY_REGISTERED` in the Edge's audit
log is a **success** for a first boot: the machine booted, raised its tunnel,
reached the Edge and was correctly refused because nobody has enrolled it yet.
Enrolment is §6 of HARDWARE-TEST.md.

## 7. The uplink, once

On the admin station:

```
journalctl -t zuup-hqsync -b
```

| Line | Meaning |
|---|---|
| `capability=… only an ADMIN_STATION carries traffic` | wrong stick, or Secure Boot demoted it |
| `no zuup.hq_url on the signed cmdline` | provisioned without `HQ_BASE_URL` |
| `no hq-centre.key on the ESP` | mint one and drop it on the stick |
| `HQ not reachable` | the window is shut (normal), or no route — check `ip route` |
| `bundle ingested into the Edge` | the inbound half works |
| `N sealed record(s) delivered to HQ` | results left the centre |

---

## Honest limits of this configuration

- **A `--usb-boot` image is not the §7.2 posture.** USB storage is a driver
  again. Use PXE or an internal disk for a real estate.
<<<<<<< HEAD
- **Attestation needs a TPM 2.0**, and without `--untrusted-seats` a machine
  that has none does not boot at all — it powers off, silently. With the flag,
  only candidate seats are excused; the reason is on the stick either way.
=======
- **Attestation needs a TPM 2.0.** Laptops older than roughly 2016 mostly have
  none; those machines can boot and be seats, but cannot be enrolled, so
  privileged logins on them will always deny.
>>>>>>> d0ce5ef (feat(hardware): make a real laptop estate boot, and give the admin station a route)
- **A BIOS-booted machine is a candidate seat, whatever its stick says.**
- **Nothing here has run on real hardware yet.** The production chain has been
  watched end to end in QEMU with a virtual TPM, and the uplink's TLS has been
  verified against the live platform from inside the shipped image's own trust
  store. That is not the same as a laptop.
