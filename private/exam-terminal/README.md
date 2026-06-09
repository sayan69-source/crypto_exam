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

## Terminal state machine

A centre terminal moves through five states. The application root
(`app/page.tsx`) routes the screen based on the current state.

```
   ┌───────────────────┐   provisioned for an exam
   │   PROVISIONED     │   by the admin console (per-seat binding)
   └─────────┬─────────┘
             │
             ▼
   ┌───────────────────┐   waiting for the candidate to arrive
   │ AWAITING_CANDIDATE│   and the invigilator to verify them
   └─────────┬─────────┘
             │  invigilator marks attendance in /invigilator
             ▼
   ┌───────────────────┐   /candidate is now reachable on this
   │     ATTENDED      │   terminal — but the paper is still sealed
   └─────────┬─────────┘
             │  drand beacon releases the key at T0
             ▼
   ┌───────────────────┐   /candidate displays the paper, anti-cheat
   │     IN_EXAM       │   lockdown is active, autosave runs
   └─────────┬─────────┘
             │  candidate submits or time elapses
             ▼
   ┌───────────────────┐   cryptographic receipt printed; terminal
   │    SUBMITTED      │   returns to PROVISIONED for the next slot
   └───────────────────┘
```

The state is held locally on the terminal and synchronised with the backend
over the centre LAN. The backend is authoritative; local cache exists for
network-offline resilience.

## What is in this project today

Built (in this commit):

- `app/layout.tsx` — kiosk-mode root layout (no marketing chrome, no public
  navigation, locked viewport).
- `app/page.tsx` — terminal entry that reads `lib/terminal-state` and renders
  the screen matching the current state.
- `app/candidate/page.tsx` — entry point for the Candidate Examination
  Portal. Currently a stub that documents which routes from
  `public/frontend/app/exam` are the canonical implementations to be pulled in.
- `app/invigilator/page.tsx` — entry point for the Centre Invigilator Portal.
  Same stub pattern, referencing `public/frontend/app/invigilator`.
- `lib/terminal-state.ts` — the state machine: types, allowed transitions,
  and an in-memory store with a localStorage cache.
- `app/globals.css` — kiosk reset (no scrollbars, no text selection on
  non-input elements, OS-level focus styles).

Deliberately not yet built:

- The actual portal UIs. They already exist and are battle-tested in
  `public/frontend/app/exam` and `public/frontend/app/invigilator`. The next step is to
  port them in via a shared workspace (recommended) or controlled copy, so
  the marketing site and the terminal remain consistent. That work is not
  in scope for this commit.
- Per-terminal device attestation handshake. The backend exposes the right
  endpoints already (`/api/v1/invigilator/*`, `/api/v1/sessions/*`); the
  terminal will use them once it's running on attested hardware.
- Auto-update / signed-bundle delivery. Belongs with the OS work.

## How to run

```bash
cd exam-terminal
npm install
npm run dev
```

By default the terminal expects the main CryptoExam Core backend at
`http://localhost:8000`. Set `NEXT_PUBLIC_API_URL` to override.

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
