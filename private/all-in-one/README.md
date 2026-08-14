# ZUUP-OS all-in-one — the whole offline centre on one host

This is the **proving ground** for the single-USB demo. It runs exactly the four
processes the bundled image will run, behind one origin, so the kiosk's
`https://edge.local/` contract is reproduced verbatim on a developer machine
(and tested in Docker before it is ever baked into the OS rootfs).

```
            proxy (Caddy) :8080      ← the single origin the kiosk loads
              ├── /api/*   → edge            Fastify §13 API
              ├── /kiosk/* → static           role chooser + liveness beacon
              ├── /admin/* → centre-admin     Next, built with basePath /admin
              └── /*       → exam-terminal     Next: Login Gate, seats, /locked
            postgres                  ← centre-scoped DB, commissioned from a bundle
```

`/kiosk/*` is served straight from `../zuup-os/security/allinone/www` — the same
files the OS image bakes into `/opt/zuup/www`, mounted rather than copied so the
two cannot drift. Any upstream that is not listening yet gets that directory's
`starting.html` instead of a bare 502, which is what keeps the kiosk off an
error page it can never retry out of.

Everything is published **only** to `127.0.0.1`, mirroring the air-gapped exam
VLAN (§6): no service is reachable from any external interface.

## Run it

```bash
docker compose -f private/all-in-one/docker-compose.yml up --build
```

First run applies the migrations and then commissions the centre from **your**
provisioning bundle, mounted at `private/all-in-one/provisioning/centre-bundle.json`
(git-ignored). There is no built-in data and no fallback: without a bundle,
`edge-init` exits non-zero and the Edge comes up empty. An empty centre denies
every login, which is the correct state for a machine nobody has commissioned.

```bash
node private/edge-server/src/provision.ts --schema     # the bundle shape
```

| Surface | URL |
|---|---|
| Role chooser (what the USB boots into) | http://localhost:8080/kiosk/ |
| Login Gate / candidate seat | http://localhost:8080/ |
| Centre Admin portal | http://localhost:8080/admin/ |

Everything is published **only** to `127.0.0.1`, mirroring the air-gapped exam
VLAN (§6): no service is reachable from any external interface.

### What this host CANNOT do, and why that is correct

**No one can log in here.** A container has no TPM, no camera and no fingerprint
reader, and the login gate no longer accepts a substitute for any of them:

- the TPM factor needs a quote signed by the Attestation Key registered for that
  terminal, over a nonce the Edge just issued;
- the face and fingerprint factors need an envelope signed by that terminal's
  `zuup-biometricd` key;
- the terminal's identity comes from `/etc/zuup/terminal-id` inside the signed
  image — there is no `?terminal=<uuid>`, no localStorage, and no field to type
  one into.

This image previously shipped `NEXT_PUBLIC_SIMULATE_BIOMETRICS=true` so a
container could walk through a login with stand-in scores of 0.95/0.91. That
switch is gone. A score this stack can invent is a score an attacker can invent,
and a demo that logs in without hardware is a demo of something that is not the
product.

What the proving ground still proves, and what it was actually for: that the
four processes come up behind one origin, that the Caddy contract the kiosk
depends on holds, that the migrations and the provisioning path apply cleanly,
and that the Edge answers §13 with the right denials. Drive the full cascade —
attestation, signed capture, check-in, seating, sealed submission — with
`src/test/integration/cascade.test.ts` against a real Postgres; it commissions a
station with generated keys and exercises every step, including the ones no
container can perform.

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
