# exam-terminal

The **examination-centre terminal** software.

This is a deliberately small, self-contained application that hosts only two
surfaces of CryptoExam Core:

1. **Candidate Examination Portal** — the sealed exam interface the candidate
   uses at a centre computer.
2. **Centre Invigilator Portal** — the verification, attendance and incident
   interface used by centre staff.

Nothing else runs here. No marketing, no setter workbench, no admin console,
no public audit portal. Those live on the public website at `public/frontend/`.

## Why this is a separate software

A web browser running on the candidate's own laptop is an environment we cannot
inspect: extensions, screen-sharing tools, virtual machines, AI assistants in
another tab. No amount of JavaScript can rule them out. The candidate and
invigilator portals therefore run only on examination-centre computers, inside
a locked operating-system shell, where the platform itself decides what
software may run.

This project is the **application** that the locked shell loads. The shell
itself (a stripped, signed Linux build) is described elsewhere; that's
deferred work — see "Future: OS embedding" below.

For the public-facing explanation that the marketing site links to, see
[`/center-access`](../../public/frontend/app/center-access/page.tsx).

## Terminal state machine (§5.3, v2)

The app root (`app/page.tsx` — the Login Gate) routes the screen by state. v2
adds the locked Gate + the assignment states around the original exam states
(`lib/terminal-state.ts`):

```
  LOCKED_GATE ─pick Invigilator─▶ INVIGILATOR_AUTH ─ok─▶ INVIGILATOR_CONSOLE
       │                                                  (drives assignment of OTHER seats)
       └─candidate seat, idle, polling Edge─▶ AVAILABLE
                                                │ invigilator runs Verify & Seat → binds a roll
                                                ▼
                                            ASSIGNED ─auto-redirect─▶ CANDIDATE_AUTH
                                                                          │ roll+DOB ok
                                                                          ▼
                                                                      ATTENDED ─T₀─▶ IN_EXAM
                                                                                       │ submit/timeout
                                                                                       ▼
                                            AVAILABLE ◀──── wipe ──── SUBMITTED
```

The Gate is **fail-closed** (INV-10): while `GET /api/health` fails it shows a
locked "Centre offline" wall with no actionable control. All coordination stays
on the centre LAN over the WireGuard tunnel — it never crosses to the public website.

## The bridge to the public side (blockchain only)

This is the load-bearing security rule: **the private terminal and the public
website share no code, no database, no API call, and no secret. The only thing
that crosses the boundary is the public blockchain.**

To obtain an exam, the terminal (`lib/chain-bridge.ts`) does exactly three
things:

1. **Reads the chain** for the exam's record — `{ questionsRoot, bundleCid,
   drandRound }` — committed by the public side's `lockExam`.
2. **Fetches the sealed bundle by CID** from a public content store (IPFS). The
   bundle is keyless ciphertext + Merkle proofs; serving it publicly leaks
   nothing.
3. **Verifies every question against the on-chain root** before trusting a
   single byte. A doctored bundle changes the CID (fails the fetch address) or
   the root (fails the proof), so an impersonated server cannot inject a paper.

Decryption keys never cross the bridge. At T₀ the terminal derives them locally
from the public drand beacon and opens questions one at a time, on selection
(`lib/question-crypto.ts`). The public side's matching half lives at
`public/backend/app/api/v1/delivery.py` and `public/frontend/lib/exam/question-pipeline.ts`.

## What is in this project today (v2, wired to the Edge)

- `app/page.tsx` — the **Login Gate** (§7.6): capability-driven role chooser,
  fail-closed health wall (INV-10), candidate-seat assignment poll + auto-redirect.
- `app/invigilator/page.tsx` — the **Invigilator Console** (§10.2): match-all
  login + §9.2 registration; **Verify & Seat** (biometric check-in → random seat
  assignment), live seat map, incident raising.
- `app/candidate/page.tsx` — the **Candidate Portal** (§10.1): seat poll →
  roll+DOB login (§9.7) → exam → **seal+submit** → signed receipt.
- `lib/edge.ts` — typed Edge client (§13.1–§13.3) over same-origin `/api/*`
  (proxied to the Edge in dev; WireGuard tunnel in prod).
- `lib/identity.ts` — §9.1 match-all login client + §9.2 register/activate.
- `lib/assignment.ts` — §9.6 seat-state poll/watch (fail-closed).
- `lib/answer-seal.ts` — §11.2 WebCrypto envelope (AES-256-GCM + RSA-OAEP),
  byte-compatible with the Edge/HQ (`seal-compat.test.ts` proves it).
- `lib/terminal-state.ts` — the §5.3 v2 state machine.

The candidate/invigilator *exam-content* screens still defer to the proven
`public/frontend/app/{exam,invigilator}` via the shared `@zuup/exam-ui` package;
the security-critical flows (login, assignment, seal/submit/receipt) are built
and tested here.

## How to run (dev)

```bash
npm install                                    # from repo root
# 1) bring up the Edge (it serves /api/* the terminal proxies to):
docker compose -f private/edge-server/docker-compose.yml up -d
DATABASE_URL=postgres://zuup:zuup@127.0.0.1:5433/zuup_edge npm run migrate -w edge-server
DATABASE_URL=postgres://zuup:zuup@127.0.0.1:5433/zuup_edge node --experimental-strip-types private/edge-server/src/seed-demo.ts
DATABASE_URL=postgres://zuup:zuup@127.0.0.1:5433/zuup_edge EDGE_PORT=4000 npm start -w edge-server &
# 2) run the terminal (proxies /api → 127.0.0.1:4000):
cd private/exam-terminal && npm run dev -- -p 3003
```

Open `/?terminal=<uuid>` with a provisioned terminal id (see `seed-demo.ts`:
invigilator station `5555…`, candidate seat `7777…`).

The terminal binds to a single keyboard/mouse and a single display. It does
not present any window chrome or address bar of its own — when launched
inside the OS shell, the browser engine runs in fullscreen kiosk mode.

## Future: OS embedding

This software will eventually run as the only foreground application of a
signed, stripped Linux build that boots centre computers. The OS will:

- Refuse to load if its TPM 2.0 PCR values don't match a known-good measurement.
- Disable USB mass storage, audio capture, screenshot keys and external display.
- Allow only one outbound network destination: the centre LAN endpoint
  serving the CryptoExam backend.
- Boot directly into this application at the URL `/`.

That OS is described in a separate internal planning document (kept local,
not committed). The structure proposed in that doc is being revised; this
README is the authoritative source for how the terminal software itself is
organised.

The two are deliberately decoupled: this application must run on a developer
workstation (for iteration) and on the centre OS (for production). The
state machine and the API contract are the only things both must agree on.
