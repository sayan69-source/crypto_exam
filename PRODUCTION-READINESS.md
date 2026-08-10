# Production readiness — audit of 2026-08-09

Every claim below was checked by running the thing, not by reading it. Where
something does not work, it says so.

**Test totals after this pass: 169 passing, 0 failing, 17 skipped** (the skips
are Postgres integration tests in `edge-server`, which need a database).

| Suite | Result |
|---|---|
| `public/backend` pytest | 71 passed |
| `public/contracts` hardhat | 32 passed |
| `private/edge-server` node:test | 51 passed, 17 skipped |
| `private/exam-terminal` node:test | 15 passed |

All five apps build and typecheck clean: `public/frontend` (60 routes),
`private/exam-terminal`, `private/centre-admin`, `private/system-admin`,
`private/edge-server`.

---

## 1. What is genuinely real now

**The ZK difficulty proof exists.** It never had before — no circuit had been
compiled, no proving key existed, no proof had ever been produced. It now
compiles, proves a compliant paper in ~1.2 s, and **cannot** prove an
under-discriminating question, an over-guessable question, an off-target mean,
or a question set that does not match its commitment. See
[public/circuits/README-ZK.md](public/circuits/README-ZK.md).

**The chain verifies that proof itself.** `submitZKProof` used to contain
`bool verified = true;` — anyone with SETTER_ROLE could submit sixteen random
bytes and the contract would record `zkVerified = true`. It now calls the
deployed `Groth16Verifier` and reverts on a proof that does not verify, stores
and emits the five public signals so the exact statement proved is auditable,
and refuses outright when no verifier is configured.

**The whole lifecycle runs end to end**, exercised through the public API
against a live chain:

```
ZK difficulty proof for set A     verified=true simulated=false in 1174ms
published public signals          20527565…159825, 4200, 1000, 250, 1000
seal the paper                    0x2a2d4bd911d7dae823657fae2ea77b96…
lock the exam on-chain            status=LOCKED
public chain record (no auth)     questionHash=2a2d4bd911d7dae823… locked=1786296218
lifecycle audit                   question_hash_committed  ✓
                                  zk_proof_verified        ✓
                                  paper_locked_before_t0   ✓
```

**The public↔private bridge is proven.** With a contract deployed and the demo
exam locked, all 8 `chain-bridge` tests pass including the two that were always
skipped — a centre terminal really does read the questions root off-chain and
refuse a paper the chain contradicts.

**Auth is real** (bcrypt + RS256 JWT + a real one-time code with a TTL), the
drand beacon is real, the crypto agrees byte-for-byte across three independent
implementations, and the sealed bundle contains no key.

---

## 2. What was fixed in this pass

| Area | Was | Now |
|---|---|---|
| ZK circuit | never compiled | built, with keys, verifier, fixture, negative tests |
| `submitZKProof` | `verified = true` hardcoded | on-chain pairing check; reverts on a bad proof |
| Poseidon commitment | SHA-256 stand-in — could never satisfy the circuit | circomlib's own Poseidon via the helper circuit |
| IRT difficulty | signed values fed to unsigned comparators | documented `IRT_B_OFFSET`, plus range guards |
| ZK proof scope | union of all four sets | one set — the paper a candidate actually sits |
| AI pipeline | ran, then dropped every question | accepted questions persist to the exam |
| Generation blueprint | ignored the exam, always the NEET default | driven by the exam's `subject_taxonomy` |
| Validator bounds | pipeline defaults, ignoring `irt_config` | the exam's own IRT constraints |
| `POST → GET` | teardown committed **after** the response, so a read-back 404'd | commits before responding, app-wide |
| Off-spec paper | HTTP 500 with a snarkjs line number | 409 naming the offending question and bound |
| Proof → lock | no state transition, so a proved paper could never lock | verified proof advances to `PROOF_PENDING` |
| Chain anchoring | `asyncio.run()` inside a running loop → 500 | runs on its own loop; every lock anchors |
| Root/hash types | `'str' object has no attribute 'hex'` | accepts bytes or hex, validates 32 bytes |
| `/blockchain/verify` | HTTP 500 `Unknown format ''` | 503 `CONTRACT_NOT_DEPLOYED` with the fix |
| drand | one endpoint, intermittent 503 | four relays tried before failing closed |
| Terminal biometrics | hardcoded `faceScore: 0.95` | calls the daemon on `127.0.0.1:7700`; absent hardware scores 0 |
| ABI path | pointed at a directory that does not exist | resolves the Hardhat artifact |
| Seeded demo data | declared `min_a: 1.0`, contained `a: 0.925` | drawn inside each exam's own constraints |

---

## 3. What is left — and who has to do it

### Only you can do these

**1 · Deploy to Polygon Amoy** *(free, ~20 min)* — the headline "verify on
Polygonscan" claim has no address behind it. `public/.env` still has
`DEPLOYER_PRIVATE_KEY=<wallet_private_key>`.

1. Create a **throwaway** MetaMask wallet — never a wallet holding real funds.
2. Get free test POL at <https://faucet.polygon.technology> (Amoy).
3. Put the private key in `public/.env` as `DEPLOYER_PRIVATE_KEY`, and a free
   Polygonscan API key as `POLYGONSCAN_API_KEY`.
4. Deploy — this now deploys the verifier first, then the core pointing at it:

```bash
cd public/contracts && npx hardhat run deploy/01_deploy.ts --network amoy
```

5. Copy the two addresses into `public/.env` (`CRYPTOEXAM_CONTRACT_ADDRESS`) and
   `private/exam-terminal/.env.local` (`NEXT_PUBLIC_CHAIN_CONTRACT`), then run
   the two `npx hardhat verify` lines the script prints, and paste the address
   and a transaction hash into the README's "Verify on Blockchain" block.

I did not do this: it needs a funded key, and creating wallets or handling
private keys is not something I will do on your behalf.

**2 · Boot ZUUP-OS on the laptop** — never executed here, by your instruction
and because it cannot be built or booted on Windows. Build the image, flash it,
boot it, and confirm: kiosk Firefox comes up with no shell, the firewall blocks
egress, `zuup-biometricd` answers on `127.0.0.1:7700`, and the terminal login
screen now reports `Face: device · Fingerprint: device` rather than
`unavailable`. That last line is the acceptance test for the biometric wiring —
I could unit-test the fail-closed path but not the camera.

**3 · Test the real face engine on hardware** — `face_engine_cv.py` (YuNet +
SFace) is written and the image build fetches both ONNX models, but no camera
has ever run through it. `python face_engine_cv.py --selftest`, then `--enroll`
and `--verify` on the laptop.

**4 · Decide on the AI question generation** — `USE_MOCK_LLM` defaults to
`true`, so "AI-generated" questions currently come from a curated 50-item bank.
That is now labelled honestly in the database (`MANUAL_UPLOAD`, with
`generation_model` saying so) rather than claimed as AI. To make it real, either
set `OPENAI_API_KEY` (paid) or point `LLM_BASE_URL` at a local Ollama (free) and
set `USE_MOCK_LLM=false`. Until then the bank holds ~1 question per topic, so it
cannot fill a large paper.

**5 · Free hosting, if you want it public** — `render.yaml` is written for
Render's free tier (Postgres + API + web). Needs your account. Note the free
tier sleeps after inactivity, so first load is slow.

**6 · Optional: real SMS** — set `TWILIO_*` and login codes go by SMS instead of
being returned in the response. Not free.

### Engineering work still open

**a · Scale the ZK circuit to real paper sizes.** *This is the biggest one.* The
commitment is a single circomlib Poseidon, which caps at 16 inputs —
`DifficultyProof(24)` does not compile, so NEET (180) and JEE (90) are out of
reach as written. The fix is a chunked commitment (Poseidon over ≤16-question
chunks, then Poseidon over the chunk digests) plus a larger powers-of-tau. The
circuit is currently built for 6, which is the seeded demo's per-set size.

**b · Run a real trusted setup.** Both ceremony phases are generated locally
from `/dev/urandom` by `build.sh`. A single contributor could in principle forge
proofs. Production needs a multi-party phase 1 (or the public perpetual
powers-of-tau) and independent phase-2 contributions.

**c · Bind the proof to the sealed paper on-chain.** Public signal 0 commits to
*a* question set; the contract cannot tell it is the same set behind
`questionHash`, because the two use different hash constructions. Checked
off-chain today. Closing it means changing the paper commitment scheme — a
design decision, which is why I left it.

**d · One proof per exam, but four sets.** Only one proof is stored on-chain.
A four-set exam needs per-set slots or an aggregate proof.

**e · The candidate sitting exam is untested end to end.** `build-merkle`
refuses with "no submitted sessions" because nobody has sat one. Driving a
candidate through session start → answer → submit → receipt → Merkle root →
on-chain commit is the one lifecycle arm not yet proven.

**f · The demo bank cannot fill a paper.** ~1 question per topic and the
validator (correctly) rejects duplicates, so a 10-slot blueprint yields 7–8.
Fixed by (4) above or by growing `app/agents/mock_questions.py`.

**g · Empty directories** — `private/lockdown-client` and `private/hardware`
exist but contain nothing, while the README describes them.

**h · `zkStatementOf` is not surfaced in any UI.** The chain now publishes the
exact statement proved; no page reads it yet.

---

## 4. Reproducing the evidence

```bash
cd public/circuits && ./build.sh                                  # circuit + negative tests
cd public/contracts && npx hardhat test                           # 32, incl. forged-proof rejection
cd public/backend && .venv/Scripts/python.exe -m pytest tests/ -q  # 71
cd private/edge-server && npm test                                # 51
cd private/exam-terminal && node --test --experimental-strip-types "lib/*.test.ts"   # 15
```

For the full on-chain lifecycle without Amoy:

```bash
cd public/contracts && npx hardhat node
```

then, in another shell, `npx hardhat run deploy/01_deploy.ts --network localhost`,
`npx hardhat run deploy/02_lock_demo_exam.ts --network localhost`, and start the
backend with `POLYGON_RPC_URL=http://127.0.0.1:8545`, `POLYGON_CHAIN_ID=31337`,
`CRYPTOEXAM_CONTRACT_ADDRESS=<printed>` and hardhat's account-0 key.
