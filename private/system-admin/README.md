# System Admin Portal (§13.5, tier-0)

The root of trust. This portal is what the **System Admin** — the national exam
authority — uses to run the estate. It is the counterpart of `centre-admin`
one tier up, and the ONLY tier where sealed answers are ever decrypted.

| Page | What it does | Spec |
|---|---|---|
| `/login` | Match-all login: face + fingerprint + bound HQ IP + TPM, one time-box | §8.2, INV-4 |
| `/` | Nationwide oversight — per-centre counts (admins, invigilators, candidates, bundles) | §10.4, §13.5 |
| `/approvals` | Pending **Centre Admin** registrations across all centres; issue the one-time code (shown ONLY here) + authorise fingerprint | §9.3, §9.4, INV-7/8 |
| `/vault` | HQ Answer Vault — verify-then-decrypt a centre's sync bundle; emit no-PII anchors | §11.4, §11.5, INV-6/9 |

## The trust boundary this app embodies

- **`/api/*` is proxied to a Centre Edge** (dev) / carried over the HQ
  WireGuard link (production). Everything reachable that way is counts,
  hashes, and approval state — no PII, no plaintext answers, no keys.
- **`/hq/ingest` is served by THIS app's own process** and nothing else. It
  holds `HQ_PRIVATE_KEY_PEM` (the HSM stand-in) and is the single place a
  sealed answer record R — the candidate's responses with their questions —
  becomes readable. The Edge, the terminals, and the Centre Admin never can
  (INV-6: the centre is a blind courier).
- `lib/vault.ts` is deliberately **self-contained** (no Edge imports), and its
  byte-compatibility with the Edge seal format is pinned by
  `edge-server/src/test/sysadmin-vault-compat.test.ts`.

## Running it (dev)

```bash
# 1. Edge DB + migrations + demo seed (see edge-server/README)
npm run db:up -w edge-server
DATABASE_URL=postgres://zuup:zuup@127.0.0.1:5433/zuup_edge npm run migrate -w edge-server
DATABASE_URL=postgres://zuup:zuup@127.0.0.1:5433/zuup_edge node --experimental-strip-types private/edge-server/src/seed-demo.ts

# 2. dev HQ keypair → Edge public half + portal private half
node scripts/write-dev-hq-env.mjs

# 3. Edge with the sealing key
cd private/edge-server
SYSTEM_ADMIN_PUBLIC_KEY_PEM="$(cat .hq-pub.pem)" node --experimental-strip-types src/index.ts

# 4. the portal
npm run dev -w system-admin   # http://localhost:3004
```

Demo login: HQ workstation `88888888-8888-8888-8888-888888888888`, bound IP
`172.16.0.10` (seeded). A spoofed IP is denied by the match-all rule.

To exercise the vault with REAL data, run the full pipeline driver, then paste
`scripts/out/last-export.json` into `/vault`:

```bash
node --experimental-strip-types scripts/demo-answer-flow.mjs
```

## Production posture

- The portal binds to the HQ management VLAN only; the HSM replaces
  `HQ_PRIVATE_KEY_PEM` (the unwrap becomes an HSM op; the key is non-exportable).
- One System Admin identity exists per deployment, provisioned at
  commissioning — there is no registration path for tier-0 (§3.1: no tier
  admits itself).
- Anchors emitted by the vault go to the public chain via the HQ anchor
  service (`public/backend` §13.5 endpoints + `CryptoExamCore.anchorCentreAnswerRoot`).
