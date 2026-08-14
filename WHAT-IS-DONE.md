# What is actually built

Last updated 2026-08-15. Every claim here was produced by running the thing, not
by reading it. Where something is unproven it says so — an item in this file
means "this works", and the file is worthless the moment that stops being true.

---

## 1. The sealed examination terminal (ZUUP-OS)

A bootable, hardened Linux image that turns a laptop into an examination
terminal. **It boots on real hardware** — verified on a 2011 Samsung laptop.

**Measured on the machine, 2026-08-15:** 8.98 s kernel + 54.85 s userspace =
**1 min 3 s from power to the kiosk**.

What comes up unattended, in order: AppArmor profiles, seatd, the WireGuard
tunnel and nftables firewall, PostgreSQL in a tmpfs, the Centre Edge API, the
Caddy single-origin proxy, and Firefox inside a Cage kiosk.

- **Read-only root** — dm-verity over squashfs, signed UKI. The image cannot be
  modified without breaking the signature.
- **Persists nothing** — the database is built fresh in RAM at every boot from a
  baked schema and evaporates at power-off.
- **No login surface** — `su`, `login`, `agetty`, `newgrp`, `nsenter` and
  `passwd` are stripped from the image, and the build fails if any reappear.
- **Boot attestation** — a real TPM quote against the Edge. A genuinely failed
  attestation halts the machine on every variant; an *absent* TPM is reported
  and survived on the all-in-one, because a machine that powers itself off
  during a first flash tells whoever flashed it nothing.
- **First-boot self-commissioning** — the all-in-one image generates its own
  biometric signing key, creates a TPM attestation key where hardware allows,
  reads its own PCRs, and registers three stations (ADM-1, INV-1, A-01) with its
  own Edge. Identity lives on a RAM-only tmpfs, so it re-commissions every boot.

### What the hardware boots taught us

Three real defects, each found by booting and each now guarded:

1. **The baked schema was three migrations behind the code.** The bundle build
   ran migrations using a container it never rebuilt, so the dump was captured
   from a database stuck at migration 002. The image booted, restored, started —
   then answered `500 column "commissioned_via" does not exist` to every
   commissioning request. The build now fails if any migration is unapplied.
2. **The image shipped a demo seed that had been deleted from the repo.** The
   dump came from a Docker volume alive since June, carrying 487 users, 487
   enrolments, 43 terminals and 19 staff identities. Two of those terminals
   already held the seats the machine wanted, so commissioning collided with
   them. The build now starts from an empty database and fails if an
   unprovisioned centre contains any rows. `seed.sql` went from 329 KB of
   fixtures to 25 KB of pure schema.
3. **A systemd ordering cycle** made the *same image* fail differently on
   consecutive boots — systemd breaks a cycle by deleting an arbitrary edge. The
   cycle is gone, and the build now topologically sorts the unit graph and fails
   on any cycle. It reports `unit ordering acyclic (12 units)`.

---

## 2. The login gate — every factor server-measured

The §8.2 match-all rule used to be checked against numbers the client supplied.
A terminal asserted its own biometric scores and its own PCR values, so anything
on the exam VLAN could claim to be an attested station with a perfect match.
Every factor is now measured or signature-verified by the Edge.

- **TPM** — a real quote over a server-issued nonce. The parser verifies the
  attestation-key signature, that `extraData` equals the nonce, that the PCR
  selection matches what was commissioned, that the submitted values hash to the
  signed digest, and that they are golden. PCR values alone attest to nothing:
  they are public and identical across the estate.
- **Biometrics** — scores arrive in an Ed25519 envelope signed by the on-device
  daemon over `{terminalId, nonce, subject, faceScoreBp, fpScoreBp, capturedAt}`.
  The `subject` field is what stops one genuine capture seating an entire hall.
  Scores are integer **basis points**, because `json.dumps(1.0)` is `"1.0"` and
  `JSON.stringify(1.0)` is `"1"` — a float would break the signature on exactly
  a perfect match.
- **Source IP and elapsed time** — taken from the request and from a one-shot
  server nonce, never from the client.
- **Matching happens on-device.** The live capture never crosses the LAN; the
  *enrolled* template travels instead, and only to the machine it belongs to.

No simulation path remains anywhere: `SIMULATE_BIOMETRICS`, `?terminal=`,
`fingerprintMatch: true` and the demo seeder are all gone. A build guard fails if
any of them reappear in the portals.

---

## 3. The question pipeline (authoring → delivery)

- **Setters author parametric templates, not questions** — parameters plus an
  answer *expression*, never a literal. One template expands into many sibling
  items.
- **Items live in a pool and belong to no exam.** A setter cannot leak the paper
  because no setter has ever seen one.
- **Assembly at T−7d** builds N candidate papers and commits them *together*
  under one root, published before the exam. No single author may own more than
  **5%** of any form.
- **The draw at T₀** selects which paper is used from a **drand beacon that did
  not exist when the items were written**, so nobody — setter included — can
  know the paper in advance.
- **Sealed delivery, opened per question** as the candidate reaches it. The Edge
  and the terminal carry two *independent implementations* of the same
  commitment, length-prefixed and domain-tagged, pinned byte-for-byte by tests
  so they cannot drift apart.
- **Answers are sealed on the terminal** and submitted as ciphertext only, then
  appended to a Merkle hash-chained ledger with a signed receipt. The centre
  holds no decryption key, so a compromised centre yields ciphertext.
- **Egress** is a blind-courier export through a gate, ingested at HQ against a
  centre-key registry and opened under a Shamir threshold.

---

## 4. Registration, rebuilt around approved exams

Registration used to be two unrelated dropdowns — every exam whose status
happened to allow it, and every centre in the database — with nothing connecting
them and no record of who had asked for the exam.

**An exam now comes into existence exactly one way:**

1. An organisation submits a request naming the exam, itself, **its own
   administrator**, its locations and its subjects.
2. The **System Administrator** and the **exam's administration** must both
   approve. Which approval a console records is decided by the caller's role,
   never by the request body — otherwise one console could supply the other's.
3. Only then do an `Exam` and its public offering exist, and only then can
   anyone register.

**What a candidate is asked follows from the exam itself:**

- They pick the **conducting body**, then one of *its* exams. Matching is on a
  normalised form, so `N.T.A.`, `NTA` and `nta` are the same body.
- **Locations are ranked best-first.** Allotment walks that order and takes the
  first with a seat left; the satisfied rank is stored, so "did allotment honour
  people's choices" is a question the data can answer. A single location is not
  a choice — the form fills it in and says so. When every chosen location is
  full the answer is a refusal, because seating someone in a city they did not
  ask for is worse than telling them to pick again.
- **Optional subjects** are enforced per exam ("choose exactly 2 of these 4"),
  counted over the optionals alone. Compulsory subjects are added server-side.

Verified end to end against a live backend: after the System Admin alone the
request still had `exam_id: None`; after both approvals the exam appeared;
`?organisation=nta` matched `N.T.A.`; with Kolkata capped at 2, the first two
candidates got choice #1 and the third fell to Delhi as choice #2; one subject
was refused with `CHOOSE_AT_LEAST_2` and three with `CHOOSE_AT_MOST_2`.

---

## 5. Who may set questions

Authority is scoped to **one exam**, never to the platform. Three gates, none of
which may substitute for another:

1. **The exam's administrator nominates** a person by name and email. This
   grants nothing — the administrator types the address, so nomination alone
   would let them hand authoring rights to a mailbox they control themselves.
2. **The System Administrator approves.** Also not permission: tier-0 agrees to
   a *person at an address*, not to whoever later opens the link.
3. **The nominee proves they hold the mailbox.** A token is emailed to them and
   redeemed once.

`can_author` is the single place that decides, and it reads the timestamps as
well as the status, so a row whose status was flipped to `VERIFIED` without the
approvals having happened is still refused. Each gate is tested in isolation.

Tokens are stored as a SHA-256 hash only, are one-shot, expire in seven days,
and are cleared on rejection. Unknown and wrong tokens return the same message,
so the endpoint cannot be used to enumerate nominations. The invitation is sent
*before* the approval commits, and a delivery failure rolls the approval back.

**Email delivery is configured and proven** — a live invitation was delivered
through Gmail SMTP on 2026-08-15.

An exam may have many setters; a setter may serve many exams; one account per
address, because the 5% per-author cap on a form depends on that.

---

## 6. Candidate face enrolment

- A **real 128-dimension face descriptor** is computed in the browser and only
  the descriptor is transmitted — never the photograph.
- It is stored, exported in the centre provisioning bundle, and matched at the
  centre on exam day.
- **Failure is now diagnosable.** One `try` used to wrap both the model load and
  the camera, reporting a blocked permission, a missing camera, a camera held by
  another application, a page served over plain HTTP, and an unreachable CDN all
  as "Camera/model unavailable" — five different problems with five different
  remedies, behind a disabled button. Each is now named in words a candidate can
  act on, and a photo-upload fallback exists for a camera that genuinely cannot
  work. The descriptor is still computed on-device either way.

---

## 7. Consoles

Centre Admin and System Admin portals exist with dashboards, approvals queues,
the blind-courier ledger, centre counts, egress gate and identity revocation.

**Fixed 2026-08-15:** all four pages painted their privileged content *before*
checking the session, because the token check lived in an effect and effects run
after the first paint. Pressing `Alt`+`←` from the login screen showed the real
Centre Admin dashboard for a frame — photographable, and enough to tell anyone
at an unattended station what the machine holds. Each page now renders a neutral
placeholder until the session is known.

---

## 8. Test and CI status

| Suite | Result |
|---|---|
| edge-server (unit + integration) | **131 / 131**, 0 skipped |
| public backend (pytest) | **129 / 129** |
| exam-terminal | **27 / 27**, 0 skipped |
| contracts (hardhat) | **32 / 32** |
| guards (`npm run verify`) | 9 / 9 |

**CI is green** across all six jobs: guards, backend, frontend, node services,
contracts, and an aggregate gate that cannot be satisfied by a skipped job.

Two things CI enforces that tests cannot:

- **No test may skip.** A skipped test reports green, and 19 database-backed
  tests skipped for months; when finally run, 8 of them failed because they had
  been asserting behaviour the code stopped having.
- **The guards** catch what compiles, builds, passes its tests and is still a
  lie: dead controls, fabricated values, unreachable contact forms,
  client-asserted biometrics, committed secrets, and any import across the
  public/private boundary.

**A note on how this was verified.** The edge suite passed on every developer
machine while failing in CI, because `migrate()` was not safe to call
concurrently and a developer database has been migrated for weeks — the race
only opens against an empty one. It is fixed, and the suite now passes three
consecutive runs from a freshly created database.
