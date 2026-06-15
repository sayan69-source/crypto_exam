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
    └── zuup-kiosk.service     Cage+Firefox → http://edge.local/?terminal=<id>
```

`edge.local` resolves to `127.0.0.1` (`/etc/hosts`), so the kiosk launcher needs
no change — it loads one origin exactly as it would a real Centre Edge.

### Persists nothing (INV-2)

The root is read-only dm-verity. PostgreSQL's data dir lives in `/run` (tmpfs):
`initdb` + restore of the baked `seed.sql` happen at **every boot**, and the DB
evaporates at power-off. No seeding/Argon work runs on the device — the demo
centre (487 candidates, 461 present, sealed NEET paper) is captured once at
build time and only *restored* on the device.

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

The terminal boots as the seeded **INVIGILATOR_STATION**
(`55555555-…-555555555555`): the Login Gate enables the invigilator console —
the 487-candidate roster, one-by-one check-in, and seat assignment. Re-image
with a different baked `terminal-id` (stage 25, step 5) to demo another role.

## Notes / known gaps

- Built on Windows via `docker-build.sh` (Docker Desktop); **boot-tested only on
  the device** — like the rest of the OS layer.
- Pinned binaries (sha256-pinned in stage 25, fail-the-build on mismatch): Node
  `v24.14.0`, Caddy `2.8.4`. To bump, override the version AND its hash:
  `ZUUP_NODE_VER`+`ZUUP_NODE_SHA256`, `ZUUP_CADDY_VER`+`ZUUP_CADDY_SHA256`.
- `SYSTEM_ADMIN_PUBLIC_KEY_PEM` is unset, so the candidate answer-submit pipeline
  returns `SEALING_KEY_NOT_PROVISIONED`. Roster, check-in, seat assignment,
  counts, approvals and the blind-courier ledger all work without it.
