# Production readiness — ZUUP-OS / CryptoExam

Audited 2026-08-14. Every claim below was produced by running the thing, not by
reading it. Where something has not been verified, it says so.

## Verified by execution

| Suite | Result | Notes |
|---|---|---|
| edge-server | **128 / 128**, 0 skipped | first run ever with a database attached |
| exam-terminal | **27 / 27**, 0 skipped | includes 2 that need a live chain |
| public backend (pytest) | **100 / 100** | |
| contracts (hardhat) | **32 / 32** | |
| guards (`npm run verify`) | 9 / 9 | boundary, no-fakes, no-secrets |
| typecheck | 0 errors | all workspaces + public frontend |
| builds | 4 / 4 | exam-terminal, centre-admin, system-admin, public frontend |

**What the database changed.** 19 integration tests were `skip`ped for want of
Postgres, and a skipped test reports green. Run for the first time, **8 of them
failed** — they had been asserting behaviour the code stopped having months ago:

- `answer/submit`, the question bundle and the T₀ beacon began requiring a
  candidate session in the 2026-08-10 remediation; five tests still called them
  unauthenticated and expected 200.
- Seat assignment gained a "the roll must be PRESENT" precondition; the
  concurrency test seeded no enrolments, so **all 20 contenders were failing on
  that check and the FOR-UPDATE-SKIP-LOCKED property under test was never
  exercised at all**.
- One was a bug in a test I had just written (it asserted a TPM failure before
  the identity existed, where the correct answer is `NO_IDENTITY_FOR_STATION` —
  an unauthenticated caller must not learn a station's attestation state).

All eight are fixed, and CI now runs the suite against a real Postgres with a
guard that **fails the build if any test skips**. A skipped test was the reason
this drift was invisible.

## Two defects found by reading the new code

Neither had a failing test, because neither was wrong in a way a test was
looking at.

1. **Biometric template disclosure to any host on the exam VLAN (fixed).**
   `/api/station/enrolment` serves an invigilator's enrolled face hash and
   fingerprint template so the on-device daemon has something to match against —
   the live capture must never cross the LAN (§8.4), so the enrolled side
   travels instead. It was gated on a login challenge plus a fresh attestation.
   Neither is a property of the *caller*: `POST /api/login/challenge` is
   necessarily unauthenticated and issues a nonce for any terminal id, and
   attestation is a fact about the target machine. Any laptop plugged into the
   VLAN could have harvested the enrolment secrets of every invigilator in the
   centre — the values the entire §8.2 rule is checked against, and unlike a
   password a fingerprint cannot be reissued. Now locked to the terminal's own
   registered address (`src/test/integration/enrolment-disclosure.test.ts`).

2. **First-boot commissioning would have written garbage station ids (fixed).**
   `commission_one` returns the new id on stdout and is called inside `$( )`;
   `log` also wrote to stdout, so every log line was captured into the id. The
   roles file would have named stations no lookup could match — on a machine
   that reported commissioning as successful.

## First boot on real hardware — 2026-08-14

The all-in-one image was flashed and booted on the target laptop (Samsung, 2011
era, no TPM 2.0). **It boots.** Kernel 8.98 s + userspace 44.46 s = **53.4 s from
power to kiosk.**

What came up on its own, in order: AppArmor profiles, seatd, the WireGuard tunnel
and nftables, PostgreSQL in tmpfs with the baked schema restored, the Centre Edge,
the Caddy origin, and Firefox in the Cage kiosk at `http://edge.local/kiosk/` —
with the role chooser rendering and its origin badge reading CENTRE EDGE ONLINE.
`zuup-attest` did the right thing on a machine with no TPM: reported, and
survived, rather than powering off mid-flash.

**One thing failed: `zuup-commission`, HTTP 500 on all three stations.** The cause
was not on the laptop.

1. **The image's baked schema was three migrations behind its code (fixed).**
   `build-artifacts.sh` built `edge`, `exam-terminal` and `centre-admin` but not
   `edge-init` — the container it then runs migrations *with*. That image still
   carried the June migration set, so it applied 000–002 to an already-migrated
   database, printed "up to date", and exited 0. The dump captured from it lacked
   `commissioned_via`, `commissioned_at`, `ak_pubkey_pem`, `bio_pubkey_pem` and
   everything else migrations 003–005 add. Nothing anywhere noticed: the build
   succeeded, the image built, the restore succeeded, the Edge started — and then
   answered `500 column "commissioned_via" does not exist` to every commissioning
   request. Reproduced exactly by restoring the shipped dump and replaying the
   laptop's request.

2. **The image shipped the demo seed that was deleted in August (fixed).** The
   dump was taken from a *named Docker volume* alive since 2026-06-15, so it
   carried 487 users, 487 enrolments, 43 terminals, 19 staff identities and four
   answer-ledger rows — the output of a `seed-demo.ts` the repository no longer
   contains, reaching the device through a volume nobody thought of as an input.
   Two of those terminals already held seats `ADM-1` and `INV-1`, so even with the
   columns present, commissioning collided with them (`23505`) and returned
   another unnamed 500. The build now starts from an empty database every time.

3. **The diagnosis was on the wire and thrown away (fixed).** The Edge's body said
   `column "commissioned_via" does not exist`; `zuup-commission.sh` only extracted
   a `"reason"` field, which an unhandled exception does not have, so the screen
   showed a bare `HTTP 500`. It now falls back to the message. On a machine with
   no shell, that line is the entire investigation.

Guards added, each verified to fire against the image that actually shipped and to
pass against a correct one: the bundle build now fails if any migration in the repo
is unapplied or if an unprovisioned centre contains any rows, and stage 25 fails if
`seed.sql`'s migration ledger is short — the last gate before a flash. `zuup-db`
also applies pending migrations after restoring, so a stale dump can no longer
brick a flashed machine. `commissionSelf` now names a seat collision
(`SEAT_ALREADY_REGISTERED`) instead of letting a constraint become a 500. And the
route's happy path — which had **no database-backed test at all**, which is why
both faults survived — is now covered by
`src/test/integration/first-boot-commission-db.test.ts`, using the exact payload a
machine with no TPM sends.

**Unresolved: whether the keyboard works.** The operator reported that no key did
anything, including `Alt`+`Home` and `Alt`+`←`. Static inspection of the shipped
image found the input path complete — `SERIO_I8042`, `KEYBOARD_ATKBD` and
`INPUT_EVDEV` built into the kernel; udev enabled at `sysinit.target` with
`60-input-id`, `71-seat` and `73-seat-late` present; `libinput10` and
`libinput-bin` installed; `xkb-data` installed with its keymaps; `AF_NETLINK`
permitted for udev enumeration; and cage running as root, so device permissions
cannot bite.

The more likely reading is that **the screen could not answer the question**. Both
shortcuts are no-ops exactly there: `Alt`+`Home` navigates to
`browser.startup.homepage`, which the launcher sets to the chooser that was
already displayed, and `Alt`+`←` has no history to return to. The page had no
input field (the terminal-id box was removed) and no role cards (commissioning had
failed), so a working keyboard and a dead one looked identical.

The chooser now carries a capture-phase keyboard readout that names the last key
and counts keystrokes, needing no focused field. Next boot answers this in one
glance instead of a reflash. Until then it is genuinely unknown, and it is listed
below rather than assumed away.

## Not production ready — and why

These are not code defects; they are things that cannot be true yet.

| Blocker | Owner | Note |
|---|---|---|
| **Commissioning not yet re-verified on the laptop** | you | The three faults above are fixed and reproduced-then-fixed on the host, but the corrected image has not been booted. `docs/FIRST-BOOT.md` is the walkthrough. |
| **Keyboard state unknown** | you | See above. The next boot's chooser reports it directly; nothing else can. |
| **The camera / reader path has never run** | hardware | `face_engine_cv.py` and the vendor fingerprint shim are exercised by nothing automated. The signing envelope around them is tested; the capture inside is not. |
| **No real TPM has ever produced a quote for this verifier** | hardware | `tpm-quote.ts` is driven by hand-built TPMS_ATTEST structures pinned to TPM 2.0 Part 2 §10.12.8. The parser and every failure clause are covered; agreement with a real `tpm2_quote` byte layout is not. |
| **Secrets are dev material** | you | The all-in-one unit files carry fixed `EDGE_TOKEN_SECRET` / `BIND` / `NODE_SIGN_SEED` and a demo HQ keypair. Production needs real secrets and an HSM for the HQ private half. |
| **Not deployed on-chain** | you | Contracts pass against a local node; Amoy needs a funded key. |
| **No load, soak or adversarial testing** | — | 487 candidates has been simulated in a database, never driven through 487 real terminals. |
| **ZK proof caps at 16 questions** | — | Poseidon input limit; single-contributor trusted setup. |

## Accepted trade-offs, stated rather than hidden

- **First-boot self-commissioning** lets an all-in-one machine register itself.
  It is opt-in, forced off in production regardless of environment, capped,
  refuses to re-key an existing terminal, audited, and stamped `FIRST_BOOT`
  wherever it is shown. Such a terminal's attestation proves *continuity*, not
  *provenance*.
- **`/api/terminal/:id/readiness`** is unauthenticated (restricted to the
  terminal's own address where one is registered). It returns booleans about a
  machine's own commissioning state, and it exists so a single boot on real
  hardware yields a full diagnosis.
- **The Docker all-in-one cannot log anyone in.** It has no TPM, camera or
  reader, and no substitute is accepted any more. It proves the origin contract,
  the migrations, the provisioning path and the API's denials.

## The honest verdict

The **security spine is production-grade**: every factor of the §8.2 rule is
server-measured or signature-verified, the answer pipeline is sealed end to end
with byte-agreement pinned across three independent implementations, and the
invariants that matter now run in CI against a real database.

The **system is not production-ready**, because it has never met the hardware it
was written for. Nothing on the blocker list is a code change — they are a boot,
a camera, a TPM, a set of real secrets and a funded deploy key. Until the first
of those happens, the correct description is: *ready for hardware bring-up*.
