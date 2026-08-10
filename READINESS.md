# What is left to make this presentable

Audited by running it, on 2026-08-10. Every claim below was checked against the
code or a live request — nothing here is inferred from a docstring.

**Current test state:** backend **87 passed**, edge-server **73 passed / 17
skipped**, exam-terminal **13 passed / 2 skipped**, contracts **32 passed**.
Zero failing anywhere.

---

## 1. BROKEN — things that render but do nothing

This is the most damaging category, because a demo looks fine until someone
clicks. Three were fixed this session; **eight remain**, found by parsing every
`<button>` in the frontend for a missing handler.

| Where | Button | What a visitor expects |
|---|---|---|
| `app/setter/paper-modes/direct-upload/page.tsx:315` | **Encrypt & Lock on Blockchain →** | The whole point of the page |
| `app/setter/paper-modes/ai-generated/page.tsx:316` | **Finalize Paper & Generate ZK Proof →** | The whole point of the page |
| `app/setter/paper-modes/ai-edited/page.tsx:307` | **Finalize & Lock Paper →** | The whole point of the page |
| `app/exam/receipt/[examId]/page.tsx:186` | Export JSON Proof | Download their receipt |
| `app/exam/receipt/[examId]/page.tsx:187` | Share Link | Share the verification |
| `app/exam/audit/[examId]/page.tsx:73` | Verify Inclusion | Check their Merkle proof |
| `app/exam/dashboard/page.tsx:123` | Enter → | Start the exam |

**These are the three headline setter flows.** All three modes end in a button
that does nothing — no request, no error, no navigation. The backend endpoints
they should call already exist (`/delivery/seal/{id}`, `/lifecycle/{id}/lock`,
`/lifecycle/{id}/generate-zk`), so this is wiring, not new capability.

> **How to check for more yourself:** the type-checker and the build cannot see
> this class of defect. Parse for `<button>` elements whose opening tag has no
> `onClick` and no `type="submit"`, and for `onSubmit` handlers whose body never
> calls `fetch`.

---

## 2. INCOMPLETE — real code, unfinished paths

### 2a. The candidate exam UI exists twice, and the public copy is a mock

`public/frontend/app/exam/*` is **1,500+ lines** across session, dashboard,
instructions, paper-info, receipt, audit and system-check. **None of it calls
the API.** Meanwhile `private/exam-terminal/` is the real candidate UI that runs
in the locked OS, is wired to the Edge, and has passing tests.

Your own backend says candidates never log in online (`auth.py` returns 403:
"Candidates do not log in online"). So the public `/exam/*` tree contradicts the
architecture it sits inside. **Decide one:**

- **Delete it**, and let `/exam/*` redirect to an explainer. Cleanest, and it
  makes the "exams only happen on the sealed terminal" story unambiguous.
- **Relabel it** as a guided walkthrough — clearly marked as a demonstration,
  the way `/pipeline` is. Keeps the demo value, kills the ambiguity.

I would delete it. It is the single biggest source of "which of these is real?"
for anyone evaluating the repo.

### 2b. Invigilator approval inside the locked OS — untested, not unbuilt

The cascade is enforced (a web admin gets 403; even tier-0 gets
`APPROVE_AT_THE_CENTRE`), and the Edge has the endpoints. But I could not watch
an invigilator actually get approved on the Edge, because the Edge needs
Postgres and none is running here — that is what the **17 skipped tests** are.

### 2c. Setter registration → login now works, but only with SMTP set

The OTP flow was SMS-only and demanded `user.phone`, so every self-registered
setter was permanently locked out. Email delivery now exists — but it is inert
until you configure SMTP (§3).

### 2d. IRT difficulty is authored, not calibrated

`irt_b/a/c` are values a human typed, not estimates from candidate responses.
Real calibration needs response data. `QUESTION-PIPELINE-DESIGN.md` §7 has the
bootstrapping path; the short version is **ship a free practice-test product and
your calibration problem solves itself**.

### 2e. Security findings still open

From `SECURITY-REVIEW.md` — all criticals are fixed; these are not:

- **H4** — question-root pinning is empty, so provenance is always `EDGE_ONLY`
  and the terminal renders the paper anyway. The on-chain guarantee does not
  actually bind at a sealed centre until the provisioning pipeline populates it.
- **M5** — no re-export path. Export marks rows `SYNCED` immediately, so a
  bundle lost in transit can never be re-sent. These are exam answers with no
  other copy.
- **M6** — `nftables.conf` permits the WireGuard handshake to *any* destination,
  not just the Edge — a covert egress channel through the layer built to
  prevent egress.
- **M8** — Firefox content sandbox at level 0 (needs `CONFIG_USER_NS`).
- Invigilator registration is still unauthenticated and unthrottled.

---

## 3. WHAT ONLY YOU CAN DO

Nothing here is code. Every item is a credential, a device, or a decision.

### Must do — the demo is materially weaker without these

1. **Rotate your GitHub token.** It is sitting in plaintext in your git remote
   URL and was printed to a terminal. Revoke at
   github.com/settings/tokens, then:
   ```bash
   git remote set-url origin https://github.com/sayan69-source/crypto_exam.git
   ```
   and use `gh auth login` or a credential helper instead.

2. **Deploy to Polygon Amoy.** This is the single highest-value thing you can
   do — the README's headline claim is "verify it yourself on-chain", and right
   now there is nothing to look up. Get a wallet, claim faucet MATIC, put the
   key in `public/.env`, then:
   ```bash
   cd public/contracts && npx hardhat run deploy/01_deploy.ts --network amoy
   ```
   Everything else is ready; the scripts take `--network amoy` unchanged.

3. **Configure SMTP** so setters can actually log in. Free with a Gmail App
   Password (Google Account → Security → 2-Step Verification → App passwords):
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=you@gmail.com
   SMTP_PASSWORD=<16-char app password, NOT your account password>
   SMTP_FROM=CryptoExam Core <you@gmail.com>
   ```

4. **Enrol yourself as System Admin.** The DB is clean — the throwaway test
   account is deleted. Set `SYSTEM_ADMIN_ALLOWED_IPS` to your address, visit
   `/sysadmin/register`, and use a real fingerprint. The page shows you the
   address the server sees.

5. **Test the biometrics on real hardware.** `face_engine_cv.py` (YuNet +
   SFace) is real and serves `127.0.0.1:7700`, but no CI can point a camera at
   a face. You need to confirm the match threshold behaves on real people —
   including the false-reject case, which is the one that ruins an exam day.

### Should do — for a credible demonstration

6. **Boot ZUUP-OS on the laptop.** The image is built (`out/zuup-os.img`) and
   has booted before, but nothing in this session touched real hardware. Flash
   it, boot it, and walk one candidate through check-in → paper → submit.

7. **Run the Edge against Postgres** and unskip those 17 tests:
   ```bash
   npm run db:up -w edge-server && npm run test:db -w edge-server
   ```
   Then apply the pending migration —
   `private/edge-server/migrations/003_security_hardening.sql` is written but
   **has never been applied to any database**.

8. **Decide the `/exam/*` question** in §2a. It is a five-minute decision that
   removes the biggest ambiguity in the repo.

---

## 4. SUGGESTED ORDER

| # | Item | Effort | Why this order |
|---|---|---|---|
| 1 | Rotate the token | 2 min | It is exposed right now |
| 2 | Wire the 3 setter Finalize buttons | ~1 h | Your headline flow currently does nothing |
| 3 | Delete or relabel `/exam/*` | 30 min | Removes "which is real?" |
| 4 | Deploy to Amoy | ~1 h | Makes the central claim checkable |
| 5 | SMTP + enrol yourself | 30 min | Unblocks setter and tier-0 login |
| 6 | Postgres + migration 003 + 17 tests | ~1 h | Proves the centre half |
| 7 | Remaining receipt/audit buttons | ~1 h | Candidate-facing polish |
| 8 | H4 root pinning | larger | Makes the on-chain guarantee bind |

Items 1–5 are roughly **a day**, and they are the difference between "an
impressive repo" and "a system someone can verify".

---

## 5. WHAT IS GENUINELY SOLID

Worth stating, because the list above is long and the foundation is not the
problem.

- **The cryptography is real and agrees across four independent
  implementations.** Question sealing is domain-separated and length-prefixed,
  pinned by a shared golden vector asserted from both Python and TypeScript.
  Two constructions that silently disagreed (public zero-padded vs private
  duplicate-last) now produce identical roots.
- **The ZK circuit is built, not described.** Real Groth16 artifacts, and a
  `ZKVerifier.sol` generated from that exact zkey.
- **The backend refuses to fabricate.** Four `ALLOW_*` switches default to
  False, so a missing beacon returns 503 rather than a locally computed
  substitute, and an unbuilt circuit returns `ZK_CIRCUIT_NOT_BUILT` rather than
  a convincing fake.
- **The approval cascade is enforced by tier**, verified by live request in
  both the allow and deny directions.
- **All four critical security findings are fixed**, and the proof-of-concept
  suite has been inverted into regression tests that fail if a vulnerability
  returns.
- **The initramfs and boot chain are the strongest part of the codebase** —
  dm-verity proves the bytes regardless of which device-discovery path wins,
  and every error path powers off rather than dropping to a shell.
