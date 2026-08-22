# The difficulty proof — what it proves, and what it does not

`difficulty_proof.circom` backs Guarantee 3: *the paper's difficulty is
machine-verifiable, without revealing a single question.*

Build everything (no toolchain to install by hand, nothing to download):

```bash
cd public/circuits && ./build.sh
```

That compiles the circuit with a WASM build of circom 2, runs a local
powers-of-tau and Groth16 setup, exports `../contracts/src/ZKVerifier.sol`, and
finishes by proving one compliant paper and **failing** to prove four
non-compliant ones.

---

## The statement

Private (never leaves the prover): every question's encoding and its IRT
`b` / `a` / `c`.

Public (published on-chain, readable by anyone):

| # | Signal | Meaning |
|---|--------|---------|
| 0 | `committed_hash` | Poseidon commitment to the question set |
| 1 | `target_mean_b`  | Target mean difficulty, ×1000, **plus `IRT_B_OFFSET`** |
| 2 | `min_a`          | Minimum discrimination, ×1000 |
| 3 | `max_c`          | Maximum guessing, ×1000 |
| 4 | `tolerance`      | Allowed deviation of the mean, ×1000 |

The circuit enforces four things at once: the questions hash to
`committed_hash`; every `a ≥ min_a`; every `c ≤ max_c`; and
`|mean(b) − target_mean_b| ≤ tolerance`. Break any one and **no proof exists** —
`tools/selftest.mjs` demonstrates each failure.

### The difficulty offset

IRT difficulty is signed (roughly −3…+3), but the circuit's range comparators
read field elements, where a negative value is a number just below the field
modulus and every comparison against it is meaningless. So `b` is carried
shifted by `IRT_B_OFFSET = 4000`, and `target_mean_b` is shifted identically —
the comparison, and therefore the guarantee, is unchanged. **Signal 1 on-chain
is the shifted target**; subtract 4000 to read it back. Defined in
`backend/crypto/zk_proof.py` and `tools/selftest.mjs`; keep them in step.

---

## Verification happens on-chain

`CryptoExamCore.submitZKProof` calls the deployed `Groth16Verifier` and
**reverts** if the pairing check fails. Nothing is recorded for a proof the
network did not accept, so `zkVerified` on the contract is a fact about the
proof rather than an assertion by whoever submitted it. Contract tests cover
both directions, including a corrupted proof that must be rejected.

`ZKVerifier.sol` is exported from **one specific proving key**. Re-running
`build.sh` produces new keys, so the old verifier will reject every new proof:
redeploy the verifier and refresh the test fixture together.

```bash
node tools/emit-fixture.mjs > ../contracts/test/fixtures/zk-proof.json
```

---

## Limits you should know before relying on this

**The trusted setup is single-contributor.** `build.sh` generates both phases
locally from `/dev/urandom`. Whoever ran it could, in principle, forge proofs.
Fine for development and a demo; a production deployment needs a multi-party
phase 1 (or a public perpetual-powers-of-tau file) and independent phase-2
contributions.

**One set, not the whole exam.** A candidate sits one paper set, so the proof is
scoped to a set (`POST /lifecycle/{id}/generate-zk?set_label=A`). Proving over
the union of A/B/C/D would be a claim about a paper nobody sits, and it can hold
for the union while an individual set is off-target — exactly the set-advantage
fraud the BalancerAgent exists to catch. Today only one proof per exam is stored
on-chain, so a four-set exam needs either per-set slots or an aggregate proof.

**The set size is fixed at build time**, currently 6 — the size the seeded demo
papers use. The backend refuses to prove a set of any other size rather than
trimming it (`ZK_CIRCUIT_SIZE_MISMATCH`), because proving a subset would be a
claim about part of the paper dressed up as a claim about the paper.

**It cannot scale past 16 questions as written.** The commitment is a single
circomlib Poseidon, which accepts at most 16 inputs; `DifficultyProof(24)` does
not compile. Real papers (NEET 180, JEE 90, SSC 100) need a chunked commitment —
Poseidon over ≤16-question chunks, then Poseidon over the chunk digests — plus a
larger powers-of-tau. That is the single biggest piece of work between this and
production.

**The proof is not bound on-chain to the sealed paper.** Signal 0 commits to *a*
question set; the contract cannot tell it is the same set behind `questionHash`,
because the two use different hash constructions. The link is checked off-chain
against the sealed manifest. Closing it on-chain means changing the paper
commitment scheme.
