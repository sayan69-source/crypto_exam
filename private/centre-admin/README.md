# Centre Admin Portal (`private/centre-admin`)

Tier-1 surface from the spec (§10.3). Runs on an **ADMIN_STATION** kiosk inside
a centre, on the centre LAN, **no internet**.

## What it does

- Dashboard: invigilator + candidate **counts for THIS centre only**.
- Approvals: surface pending invigilator registrations, issue the one-time code
  (shown only here), and toggle *Authorise & bind fingerprint* (§9.2, §9.4).
- Blind courier: list held answer bundles as **hashes only** and export the
  signed encrypted sync bundle for HQ.

## What it can NEVER do (enforced, INV-6)

- **Decrypt or read any answer** — it holds no private key.
- See any other centre, exam content, or scores.
- Reach the internet, or approve another Centre Admin.

## Boundary

This portal imports shared **presentational** components from `@zuup/exam-ui`
only. It must never import `public/**` runtime code (enforced by
`npm run check:boundary` at the repo root). All data comes from the Centre Edge
Server over the WireGuard tunnel (Phase 9 wires the API client).

## Build status

Phase 0: scaffolding — dashboard shape with placeholder zeros, rendering the
shared `exam-ui` components. Phase 9 wires the real Edge API.
