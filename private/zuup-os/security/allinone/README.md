# ZUUP-OS all-in-one image variant

A self-contained demo image: the same hardened, verity-sealed, Secure-Boot UKI
that boots on real hardware — but with the **entire centre stack folded in**, so
a single USB shows the real Invigilator + Centre-Admin portals with student data
instead of the "centre offline" wall. There is no second machine and no network.

This is a **demo variant only**. A production terminal stays thin and talks to a
separate, TPM-attested Edge appliance over WireGuard (§5/§6); none of this layer
is present in the production image. The variant takes the `--dev` boot path
(no remote WireGuard peer / TPM-attested Edge required).

## What boots

```
  systemd → zuup-session.target
    ├── zuup-db.service        initdb in tmpfs, restore the baked seed   (RAM only)
    ├── zuup-edge.service      Centre Edge API (Fastify §13)  127.0.0.1:4000
    ├── zuup-portal-terminal   exam-terminal (Next)           127.0.0.1:3000
    ├── zuup-portal-admin      centre-admin  (Next, /admin)   127.0.0.1:3002
    ├── zuup-proxy.service     Caddy single origin            edge.local:80
    └── zuup-kiosk.service     Cage+Firefox → http://edge.local/kiosk/
```

`edge.local` resolves to `127.0.0.1` (`/etc/hosts`), so the kiosk launcher needs
no change — it loads one origin exactly as it would a real Centre Edge.

## Coming up in the right order

Caddy binds `:80` within a second of boot. PostgreSQL has to be created in tmpfs
and seeded, the Edge has to migrate, and two Next servers have to start — up to
a couple of minutes on a laptop. Firefox **never retries a failed navigation**
and the kiosk has no reload control, so a browser launched into that gap used to
park on "Unable to connect" for the rest of the exam. Three things close it:

- The launcher **probes the origin before it starts the browser**
  (`ZUUP_KIOSK_READY_BUDGET`, 240 s here) instead of launching blind.
- The proxy answers **`www/starting.html`** for any upstream that is not
  listening yet (`handle_errors`), so the origin is never dead — that page shows
  which service is still coming up and reloads itself when the real one is
  ready.
- If the origin never answers at all, the kiosk shows a **local diagnostic page**
  (`../kiosk/no-centre.html`) naming the origin, the image variant and the
  terminal id, rather than a blank screen. It keeps probing `/kiosk/up.js` and
  hands over the moment the centre appears.

## The three operator roles on one machine

A production terminal is **one** role, fixed by the identity baked into its
signed image and confirmed by the Edge. This laptop is standing in for a whole
centre, so the all-in-one drop-in pins the kiosk to a role chooser
(`www/index.html`, served at `/kiosk/`) instead:

| Role | Station | Opens |
|---|---|---|
| Centre Invigilator | `INV-1` · `55555555-…-555555555555` | Gate → roster, check-in, seat assignment |
| Centre Admin | `ADM-1` · `22222222-…-222222222222` | `/admin/` → approvals, counts, ledger, egress |
| Candidate seat | `A-77` · `77777777-…-777777777777` | Gate → waits for assignment, then roll+DOB login |

The chooser **grants nothing**. It only selects which terminal identity the
browser presents; the Edge still answers with that terminal's capability and
each portal still runs its own match-all login against the seeded identity bound
to that station. Seat assignment is uniformly random (§9.6), so the chooser also
lists the seats that are **currently ASSIGNED** — reusing the invigilator's own
session token from the same tab, not a new unauthenticated endpoint — letting
you open whichever seat the console just handed out.

<kbd>Alt</kbd>+<kbd>Home</kbd> returns to the chooser from any surface (the
launcher sets it as the profile homepage); <kbd>Alt</kbd>+<kbd>←</kbd> goes back
one step. Neither the chooser nor this pinning exists in the production image —
`ZUUP_KIOSK_URL` is unset there and the capability lookup is the only router.

### Persists nothing (INV-2)

The root is read-only dm-verity. PostgreSQL's data dir lives in `/run` (tmpfs):
`initdb` + restore of the baked `seed.sql` happen at **every boot**, and the DB
evaporates at power-off. No schema or Argon work runs on the device — the schema
is captured once at build time and only *restored* here.

`seed.sql` is the **schema**, plus whatever an operator's provisioning bundle put
in it. With no bundle it is ~25 KB and contains no people, no terminals and no
paper: the machine commissions its own stations at first boot instead. It was
once ~329 KB, because the dump came from a Docker volume that had been alive
since June and still held the deleted demo seed — 487 users, 43 terminals — which
then shipped inside the image. `build-artifacts.sh` now starts from an empty
database and fails if an unprovisioned centre turns out to contain rows.

## Build it (3 steps)

```bash
# 1. Build + verify the app images in the Docker proving ground (optional but
#    recommended — it's the same bytes that ship).
docker compose -f private/all-in-one/docker-compose.yml up --build   # Ctrl-C when verified

# 2. Capture the app bundle (built artifacts + seeded SQL dump) → out/.
bash private/all-in-one/build-artifacts.sh

# 3. Build the all-in-one OS image (reads the bundle from out/, mounted at /dist).
bash private/zuup-os/image-build/docker-build.sh -- --allinone
#    → out/zuup-os.img   (variant=dev, ~1.0–1.4 GB)
```

Then write it to a stick and boot the laptop, exactly as before:

```bash
dd if=out/zuup-os.img of=/dev/sdX bs=4M oflag=direct
```

The terminal boots into the role chooser at `http://edge.local/kiosk/`. There is
no baked identity: `zuup-commission.service` registers this machine's own three
stations (`ADM-1`, `INV-1`, `A-01`) with its own Edge on first boot, and the
chooser lists what the machine actually holds — read from `/local/identity`, never
from the URL. Measured on the target laptop (2011 Samsung, no TPM 2.0): **53 s from
power to the chooser.** See `../../docs/FIRST-BOOT.md` for what each stage prints
and how to read a failure without reflashing.

To make the image behave like a production terminal instead — one role, no
chooser — drop `ZUUP_KIOSK_URL` from `kiosk-allinone.conf`; the launcher then
routes purely on the capability the Edge reports for the baked `terminal-id`.

## Notes / known gaps

- Built on Windows via `docker-build.sh` (Docker Desktop); **boot-tested only on
  the device** — like the rest of the OS layer.
- Pinned binaries (sha256-pinned in stage 25, fail-the-build on mismatch): Node
  `v24.14.0`, Caddy `2.8.4`. To bump, override the version AND its hash:
  `ZUUP_NODE_VER`+`ZUUP_NODE_SHA256`, `ZUUP_CADDY_VER`+`ZUUP_CADDY_SHA256`.
- `SYSTEM_ADMIN_PUBLIC_KEY_PEM` is unset, so the candidate answer-submit pipeline
  returns `SEALING_KEY_NOT_PROVISIONED`. Roster, check-in, seat assignment,
  counts, approvals and the blind-courier ledger all work without it.
