# Centre Edge Server (`private/edge-server`)

The on-prem centre appliance (§5.1, §13). One per centre, on the centre LAN,
**no WAN**. It is the only thing terminals talk to.

## Responsibilities

| Module | Spec | What it does |
|---|---|---|
| `identity-service` | §8, §9 | TPM attestation check, **match-all** privileged login (face+fp+IP+TPM), one-time approval codes |
| `assignment-service` | §9.6 | Uniformly random **AVAILABLE** seat assignment, atomic (`FOR UPDATE SKIP LOCKED`) |
| `answer-store` | §11.3 | Ciphertext answer ledger + append-only **Merkle hash-chain** + node-signed root (`lib/node-sign.ts`) |
| `hq/vault.ts` | §11.4, §13.5 | **HQ/Tier-0 only** — verify node sig + chain, HSM-unwrap+open, emit no-PII anchor. The Edge entrypoint never imports it. |
| `migrations` | §12 | Centre-scoped DDL (additive to the public `init.sql`) |

## HTTP surface (§13.1–§13.4)

Identity/gate (`/api/terminal/*`, `/api/invigilator/*`, `/api/admin/login`),
invigilator console (`/api/centre/{roster,seatmap}`, `/api/candidate/checkin`,
`/api/seat/assign`, `/api/incident`), candidate seat (`/api/seat/:id/state`,
`/api/candidate/login`, `/api/answer/submit`, `/api/answer/receipt/:leaf`,
`/api/exam/sealing-key`), centre admin (`/api/admin/{centre/counts,
approvals/*,ledger,ledger/export,identity/:id/revoke}`).

## Hard guarantees (tested)

- **INV-4** identity intersection — login exists iff *all* factors pass in one box.
- **INV-5** terminal binding — a seat accepts only its bound roll (foreign roll denied).
- **INV-7** one active Centre Admin per centre — partial unique index.
- **INV-8** one-time codes single-use + TTL — replay/expiry rejected.
- **INV-6** the centre is blind — the ledger has **no decrypt key column**; the
  Edge holds only the System Admin *public* key; only the HQ vault opens envelopes.
- **INV-9** tamper-evidence — editing any answer leaf / audit row / chain root
  breaks the re-walk; the HQ ingest refuses a broken chain or forged node sig.
- Cross-impl: the terminal's WebCrypto seal opens byte-for-byte with the HQ
  node:crypto path (`seal-compat.test.ts`).
- No double seat assignment under concurrency.

## Stack

TypeScript on Node ≥ 22 (run directly via type-stripping, no build step),
Fastify (HTTP), `pg` (PostgreSQL), `@noble/hashes` (pure-JS Argon2id/SHA-256 —
no native build). PostgreSQL + Redis via `docker-compose.yml` (LAN-only).

## Run

```bash
# from repo root, one-time:
npm install

# unit tests (no DB needed) — INV-4/8, Merkle tamper-evidence, envelope,
# terminal↔HQ seal compatibility, and the full HQ ingest/decrypt/anchor path:
npm test -w edge-server

# integration tests (need Postgres) — INV-5/6/7/9, the §9 cascade, the answer
# pipeline (submit→ciphertext-only→receipt), and centre-export→HQ-ingest:
docker compose -f private/edge-server/docker-compose.yml up -d
DATABASE_URL=postgres://zuup:zuup@127.0.0.1:5433/zuup_edge npm run migrate -w edge-server
DATABASE_URL=postgres://zuup:zuup@127.0.0.1:5433/zuup_edge npm run test:db -w edge-server
docker compose -f private/edge-server/docker-compose.yml down -v   # tear down when done
```

> Safety: this package never opens an internet socket. `docker-compose.yml`
> publishes ports to **127.0.0.1 only** and defines no WAN egress.
