# First boot on real hardware (all-in-one image)

Written for the case where reflashing is expensive: what the machine does on its
own, what you should see, and how to read it when you do not — without a second
install.

## Build

```bash
docker compose -f private/all-in-one/docker-compose.yml up --build   # optional: verify the stack
bash private/all-in-one/build-artifacts.sh                           # → out/zuup-app-bundle.tar.zst
bash private/zuup-os/image-build/docker-build.sh -- --allinone       # → out/zuup-os.img
```

Stage 25 now **fails the build** if anything the first-boot path reads is
missing — the commissioning script and unit, the kiosk launcher and its
drop-ins, the role chooser, the three apps, the baked schema, the sealing key,
and `curl`/`openssl`/`python3`. A build that finishes is an image whose boot
path is complete. That check is there because flashing is the expensive step and
a missing unit is otherwise only discoverable on the laptop.

Write it with Rufus in **DD mode** (it is a whole-disk image, not an ISO). Check
the size before you flash: the all-in-one is ~1.0–1.4 GB. ~500–550 MB means you
built the thin `--dev` image, which carries no centre at all and will show
"no centre reachable".

## What the machine does on its own

No fixture data ships in the image any more. The laptop commissions **itself**:

1. `zuup-db` — PostgreSQL in tmpfs, baked schema restored. Nothing on disk.
2. `zuup-edge` — the Centre Edge on :4000, behind Caddy on :80.
3. `zuup-commission` — generates this machine's biometric signing key, creates a
   TPM Attestation Key **if the laptop has a TPM 2.0**, reads its own PCRs, and
   registers three stations (`ADM-1`, `INV-1`, `A-01`) with its own Edge.
   Everything it writes lands on `/run/zuup-identity` (RAM — `/etc` is read-only
   verity), so it re-commissions on every boot.
4. `zuup-attest` — takes a nonce and submits a signed TPM quote. No TPM, or no
   registry row yet, is **reported and survived** on this variant; a quote that
   FAILS still halts, on every variant.
5. `zuup-kiosk` — waits for the origin to answer, then Cage + Firefox in kiosk
   mode at `http://edge.local/kiosk/`.

Expect **90–240 s** on a 2011-era laptop. `starting.html` refreshes itself in
the meantime; a blank or error screen is not an expected state.

## What you should see

The role chooser, listing the stations this machine actually commissioned:

| Card | Opens | Then |
|---|---|---|
| **Centre Invigilator** | `/?role=INVIGILATOR_STATION` | Login Gate → invigilator login + registration |
| **Centre Admin** | `/admin/` | Centre Admin login + registration (§10.1) |
| **Candidate seat** | `/?role=CANDIDATE_SEAT` | waits for an invigilator to assign it |

Reaching both login screens is the milestone. **Completing** a login needs
hardware the machine may not have — the Gate says which pieces are missing
before you press anything (no TPM, no camera, no reader, nobody enrolled yet).
That panel is the diagnosis; read it rather than pressing buttons.

`Alt`+`Home` returns to the chooser from any surface.

## Reading a failure without reflashing

Boot messages go to `/dev/kmsg`, and dev/all-in-one images register `console=tty0`,
so they appear on the laptop's own screen. Every stage names itself:

| On screen | Means | Do |
|---|---|---|
| `zuup-commission: no TPM 2.0 on this machine` | expected on old hardware | nothing — the TPM factor is simply unavailable |
| `zuup-commission: ERROR: the Edge never answered` | the Edge or database did not start | check `zuup-db` / `zuup-edge` in the journal |
| `zuup-attest: … continuing on variant=allinone` | not attested; not a failure | expected without a TPM |
| `ZUUP-ATTEST HALT: Edge DENIED this boot` | the boot chain does not match | this one is real — the image is not what was measured |
| Chooser says *no commissioned identity* | commissioning has not finished | it retries every 3 s; if it persists, `journalctl -u zuup-commission` |
| Kiosk shows *no centre reachable* | the origin never answered in 240 s | `systemctl status zuup-proxy zuup-edge` |

Nothing in this path powers the machine off except a genuinely failed
attestation. That is deliberate: a machine that switches itself off during a
first flash tells you nothing, and you may only get one flash.

## What is deliberately still impossible here

- **Logging in without hardware.** The face and fingerprint factors need scores
  signed by the on-device daemon; the TPM factor needs a real quote. There is no
  simulation switch left in the image, in the Docker stack, or in the code.
- **Choosing a station.** The chooser only offers identities this machine holds;
  there is no field to type a terminal id into and no `?terminal=` parameter.
- **Mistaking this for production.** Stations commissioned this way are stamped
  `FIRST_BOOT`, and both the chooser and the Gate say so: their golden
  measurements are the machine's own, so attestation proves the software has not
  changed since first boot — not that an authority approved it. A production
  terminal is registered by an authority before it is ever powered on
  (see `DEPLOYMENT_GUIDE.md` §3), and the flag that permits self-commissioning
  is forced off whenever the Edge runs in production.
