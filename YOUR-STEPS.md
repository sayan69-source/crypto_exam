# Your steps — six things, about two hours

Everything else is done. Each step below says **what it is for**, so you can
judge whether you need it for your demo.

---

## 1. Rotate your GitHub token — 2 minutes

**Purpose:** your personal access token is sitting in plaintext inside
`.git/config` and has been printed to a terminal. Anyone who sees it can push
to your repo as you.

1. Go to **github.com/settings/tokens** and delete the current token.
2. Point the remote at a clean URL (no credentials in it):
   ```bash
   git remote set-url origin https://github.com/sayan69-source/crypto_exam.git
   ```
3. Authenticate properly instead — `gh auth login`, or let Git prompt you once
   and store it in Windows Credential Manager.

---

## 2. Turn on email so people can log in — 10 minutes

**Purpose:** every account gets a one-time code as its second factor. Until a
gateway is configured, only accounts with a phone can receive one — which means
**a setter who registers on your site can never log in.** Email costs nothing.

Add to `public/.env` (Gmail needs an *App Password*, not your normal password —
Google Account → Security → 2-Step Verification → App passwords):

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASSWORD=abcdefghijklmnop
SMTP_FROM=CryptoExam Core <you@gmail.com>
```

**How to check it worked:** register a setter at `/setter/register`, approve it
from the admin console, then log in. The code should arrive in your inbox. If
SMTP is wrong the server says so (502) instead of pretending.

---

## 3. Enrol yourself as System Administrator — 10 minutes

**Purpose:** tier-0 is the only role that can approve Centre Admins and decrypt
answers. Nobody is enrolled right now — I deleted the test account. Enrolment
is one-shot and binds to your machine's fingerprint sensor.

1. Add your address to `public/.env`. For local use:
   ```
   SYSTEM_ADMIN_ALLOWED_IPS=127.0.0.1
   ```
2. Restart the backend, open **`/sysadmin/register`**. The page shows the
   address the server sees — if it does not match, paste the line it gives you.
3. Fill the form and touch your fingerprint sensor when Windows asks.
4. Sign in at **`/sysadmin/login`** — password *and* fingerprint. A password
   alone will not produce a tier-0 token.

**Requires:** a laptop with a fingerprint reader (Windows Hello) or Touch ID.
Without one, the browser has no platform authenticator and the page will say so
rather than let you half-enrol.

---

## 4. Deploy to Polygon Amoy — 45 minutes

**Purpose:** this is the single highest-value thing you can do. Your whole
pitch is "do not trust us, check the chain" — and right now there is no
contract for anyone to look up. Everything is ready; only a funded key is
missing.

1. Make a throwaway wallet in MetaMask. **Do not reuse a wallet with real
   funds.**
2. Get free test MATIC from the Polygon faucet (`faucet.polygon.technology`,
   choose Amoy). It is free and takes a minute.
3. Put the private key in `public/.env`:
   ```
   DEPLOYER_PRIVATE_KEY=0x<your test key>
   ```
4. Deploy:
   ```bash
   cd public/contracts && npx hardhat run deploy/01_deploy.ts --network amoy
   ```
5. Copy the two addresses it prints into `public/.env`
   (`CRYPTOEXAM_CONTRACT_ADDRESS`, `ZKVERIFIER_CONTRACT_ADDRESS`) and into the
   README's "Verify on Blockchain" block, replacing the local-chain note.

**What this unlocks:** the admin Blockchain page stops saying "not deployed",
and anyone can paste your address into amoy.polygonscan.com.

---

## 5. Start Postgres and apply the pending migration — 20 minutes

**Purpose:** the centre half (Edge server) runs on Postgres, not SQLite. It has
17 tests that have never run here, and a migration I wrote that has never been
applied to any database. Until this is done, the invigilator approval flow
inside the locked OS is correct by construction but unproven.

```bash
npm run db:up -w edge-server        # starts Postgres in Docker
npm run migrate -w edge-server      # applies 001, 002, and the new 003
npm run test:db -w edge-server      # the 17 skipped tests should now run
```

`003_security_hardening.sql` adds the attestation columns the fingerprint gate
reads, and two unique indexes (one active holder per station, one live seat per
candidate). **Docker Desktop must be running first** — starting it needs your
click; a script cannot.

---

## 6. Test the biometrics on a real face — 30 minutes

**Purpose:** the face engine (YuNet + SFace) is real code serving
`127.0.0.1:7700`, but no automated test can point a camera at a person. You
need to know how it behaves before an exam hall does.

Check three things, in this order:

1. **You match yourself** in normal light.
2. **You do not match someone else** — borrow a face.
3. **The false-reject case**: try it in poor light, with glasses on and off.
   This is the one that ruins an exam day — a genuine candidate turned away.

Write down the score you actually see and set the threshold from that, not from
the default.

---

## Optional — only if you are demonstrating the sealed terminal

**Purpose:** proves the offline half. Skip if your demo is web-only.

The bootable image already exists at
`private/zuup-os/image-build/out/zuup-os.img`. Flash it to a USB stick with
[Rufus](https://rufus.ie) or [balenaEtcher](https://etcher.balena.io), boot the
laptop from it (one-time boot menu, Secure Boot off for the dev-signed image),
and walk one candidate through check-in → paper → submit.

---

# What I already did — you do not need to touch these

- All three setter paper modes now work end to end. Verified with a real PDF:
  two questions extracted, stored, sealed under a real Merkle root, publicly
  verifiable.
- **Zero dead buttons remain** in the entire frontend (there were eight).
- Removed every simulation from the setter flow — invented file uploads, timer
  progress bars, hardcoded question banks, and a mock pipeline that produced a
  fake 75-question result whenever the backend was unreachable.
- Candidate exam screens on the public site are labelled as a walkthrough,
  because real exams only run on the sealed terminal.
- The public enquiry form reaches a real HQ queue instead of being discarded.
- Tier-0 portal built; the approval cascade is enforced by tier.
- All four critical security findings fixed, with regression tests that fail if
  they come back.
- `pymupdf` added to `requirements.txt` — without it no paper mode could parse
  a PDF.

**Test state:** backend 87 passed, edge-server 73 passed, exam-terminal 13
passed, contracts 32 passed. Frontend builds clean. Nothing failing.
