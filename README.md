# CryptoExam · ZUUP-OS

**Examination infrastructure where the operator is not a trusted party.**

Two halves that never import each other, joined only by a signed provisioning
bundle:

- **`public/`** — the outward-facing platform. Exam requests, candidate
  registration, the item pool, the public verification surface, smart contracts.
- **`private/`** — the sealed examination centre. A bootable hardened OS, the
  on-premise Edge appliance, and the operator consoles. Air-gapped during an
  exam.

A build guard fails if anything in `private/` imports from `public/`.

---

## The idea

Most examination systems ask you to trust the body running the exam. This one is
built so that trust is not required at any single point:

- **The paper does not exist until the exam starts.** Setters author parametric
  *templates*, never questions. Items sit in a pool belonging to no exam. N
  candidate papers are committed together beforehand, and which one is used is
  chosen at T₀ by a public random beacon that did not exist when the items were
  written. No setter — and no administrator — can know the paper in advance.
- **No author owns a paper.** A cap enforces that no single setter contributes
  more than 5% of any form.
- **The centre cannot read the answers.** They are sealed on the terminal and
  submitted as ciphertext. No decryption key exists on that side of the
  boundary, so a fully compromised centre yields ciphertext and a hash chain.
- **The terminal proves what it is.** Boot is attested by a real TPM quote;
  biometric scores are signed by an on-device daemon; every factor of the login
  rule is measured by the server, never asserted by the client.
- **The machine remembers nothing.** Read-only dm-verity root, database in RAM,
  identity on a tmpfs. Power-off is the erasure.

---

## Repository layout

```
public/
  frontend/     Next.js — public site, registration, admin consoles
  backend/      FastAPI — exams, registration, approvals, item pool
  contracts/    Solidity — on-chain exam and proof anchoring
  circuits/     circom — zero-knowledge difficulty proof
  docs/         master specification

private/
  zuup-os/      the bootable examination OS (kernel, rootfs, kiosk, biometrics)
  edge-server/  the on-premise Centre Edge API (Fastify + PostgreSQL)
  exam-terminal/  candidate and invigilator surfaces
  centre-admin/   centre operator console
  system-admin/   tier-0 console
  all-in-one/     one-machine Docker stack, and the image bundle builder

packages/exam-ui   shared UI primitives
scripts/           build guards (boundary, no-fakes, no-secrets)
```

---

## How an exam happens

```
organisation requests an exam
        │   names the exam, its locations, its subjects, its administrator
        ▼
System Admin  +  the exam's administration        ← both must approve
        ▼
exam becomes registerable
        │
        ├── candidates register  → rank locations → choose optional subjects
        │                        → face descriptor computed on-device
        │
        └── administrator nominates setters
                 → System Admin approves
                 → nominee proves they hold the mailbox     ← all three required
                 → may author items into the pool

T−7d   N candidate papers assembled and committed together
T₀     public random beacon selects which paper is used
       questions delivered sealed, opened one at a time
       answers sealed on the terminal, submitted as ciphertext
       appended to a Merkle hash chain with a signed receipt
after  blind-courier export → HQ vault → opened under Shamir threshold
```

> **Results are not implemented.** The chain above stops at decryption. See
> [WHAT-IS-LEFT.md](WHAT-IS-LEFT.md).

---

## Running it

**Public platform**

```bash
cd public/backend && pip install -r requirements-dev.txt && python -m uvicorn app.main:app
cd public/frontend && npm ci && npm run dev
```

**Centre Edge** (needs PostgreSQL)

```bash
npm ci
npm run db:up -w edge-server
npm run migrate -w edge-server
npm test -w edge-server
```

**The whole centre on one machine** (Docker)

```bash
docker compose -f private/all-in-one/docker-compose.yml up --build
```

Nobody can log in on the Docker host, and that is correct — a container has no
TPM, camera or fingerprint reader, and no substitute is accepted. It proves the
origin contract, the migrations, the provisioning path and the API's denials.

**The bootable image**

```bash
bash private/all-in-one/build-artifacts.sh                  # → app bundle
bash private/zuup-os/image-build/docker-build.sh -- --allinone   # → out/zuup-os.img
dd if=private/zuup-os/image-build/out/zuup-os.img of=/dev/sdX bs=4M oflag=direct
```

Write with Rufus in **DD mode** — it is a whole-disk image, not an ISO. Check the
size first: the all-in-one is ~1.0–1.4 GB; ~500 MB means you built the thin
variant, which carries no centre at all.
[FIRST-BOOT.md](private/zuup-os/docs/FIRST-BOOT.md) is the boot walkthrough and
the on-screen failure table.

---

## Checks

```bash
npm run verify      # boundary, no fabricated values, no committed secrets
npm test            # workspace test suites
```

CI runs six jobs on every push and **fails if any test skips** — a skipped test
reports green, and that is how nineteen database-backed tests went unrun for
months.

| Suite | Result |
|---|---|
| edge-server | 131 / 131 |
| public backend | 129 / 129 |
| exam-terminal | 27 / 27 |
| contracts | 32 / 32 |
| guards | 9 / 9 |

---

## Documentation

| File | What it is |
|---|---|
| [WHAT-IS-DONE.md](WHAT-IS-DONE.md) | Everything that works, and how it was proven |
| [WHAT-IS-LEFT.md](WHAT-IS-LEFT.md) | Everything that does not, ordered by consequence |
| [QUESTION-PIPELINE-DESIGN.md](QUESTION-PIPELINE-DESIGN.md) | The authoring and delivery architecture |
| [SECURITY-REVIEW.md](SECURITY-REVIEW.md) | 24 findings, all verified real, with remediation status |
| [FIRST-BOOT.md](private/zuup-os/docs/FIRST-BOOT.md) | Booting the image on real hardware |
| [THREAT_MODEL.md](private/zuup-os/docs/THREAT_MODEL.md) | What the terminal defends against |

---

## Status

**Ready for hardware bring-up, not for production.** The image boots on real
hardware and commissions itself in about a minute; the security spine is
server-measured end to end; the invariants run in CI against a real database.

It has never scored an examination, never met a real TPM or camera, and never
been driven at scale. Read [WHAT-IS-LEFT.md](WHAT-IS-LEFT.md) before treating
any of it as finished.
