# ZUUP-OS all-in-one — the whole offline centre on one host

This is the **proving ground** for the single-USB demo. It runs exactly the four
processes the bundled image will run, behind one origin, so the kiosk's
`https://edge.local/` contract is reproduced verbatim on a developer machine
(and tested in Docker before it is ever baked into the OS rootfs).

```
            proxy (Caddy) :8080      ← the single origin the kiosk loads
              ├── /api/*   → edge            Fastify §13 API
              ├── /admin/* → centre-admin     Next, built with basePath /admin
              └── /*       → exam-terminal     Next: Login Gate, seats, /locked
            postgres                  ← centre-scoped DB, seeded with students
```

Everything is published **only** to `127.0.0.1`, mirroring the air-gapped exam
VLAN (§6): no service is reachable from any external interface.

## Run it

```bash
docker compose -f private/all-in-one/docker-compose.yml up --build
```

First run applies the 3 migrations and seeds the demo centre (idempotent). Then
open the kiosk's view by provisioning the browser as one of the seeded
terminals (on real hardware the id is baked into the signed image; here it comes
from `?terminal=`):

| Role                 | Terminal id (seed)                       | URL |
|----------------------|------------------------------------------|-----|
| Invigilator station  | `55555555-5555-5555-5555-555555555555`   | http://localhost:8080/?terminal=55555555-5555-5555-5555-555555555555 |
| Candidate seat       | `77777777-7777-7777-7777-777777777777`   | http://localhost:8080/?terminal=77777777-7777-7777-7777-777777777777 |
| Centre Admin portal  | station `22222222-…-222222222222`        | http://localhost:8080/admin/ |

The seed creates the centre **DL-IITD** with 1 active Centre Admin, 14 active
invigilators (2 pending), **487 candidates** (461 marked PRESENT), free/assigned
seats, and a real sealed NEET paper. The invigilator console shows the roster
for one-by-one check-in; the admin portal shows live counts, the approval queue,
and the blind-courier ledger.

Demo login probes are pre-filled in each portal (the bound station id + LAN IP),
standing in for the on-device biometric + TPM capture.

## How this maps to the bundled image

The artifacts proven here are exactly what gets baked into the ZUUP-OS rootfs in
the all-in-one image variant:

- **edge** → a `zuup-edge.service` running the same Fastify server, with a local
  PostgreSQL (`zuup-edge-db.service`) seeded at first boot.
- **exam-terminal** + **centre-admin** → their Next standalone bundles, served by
  `zuup-portal-*.service`.
- **proxy** → the same routing, so the kiosk launcher can keep pointing at
  `edge.local` — which now resolves to localhost on the device.

What is **not** yet wired (tracked, app-layer only): the System-Admin sealing
public key (`SYSTEM_ADMIN_PUBLIC_KEY_PEM`) is unset, so the candidate
answer-submit pipeline returns `SEALING_KEY_NOT_PROVISIONED`. Roster, check-in,
seat assignment, counts, approvals and the blind-courier ledger all work without
it.
