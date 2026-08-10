# Question Pipeline — Reference Prototype

Runnable proof of the three load-bearing claims in
[`../../QUESTION-PIPELINE-DESIGN.md`](../../QUESTION-PIPELINE-DESIGN.md).

**Python 3.9+ stdlib only.** No dependencies, no API keys, no network, no GPU.

```bash
python3 pipeline.py           # full report
python3 pipeline.py --quiet   # self-checks only; exit code 0 = all claims hold
```

## What it proves

| Claim | Mechanism | How you can see it |
|---|---|---|
| **1. No hallucinated answer keys** | Items expand from *parametric templates*; the key is computed by evaluating an expression, never asserted by a model. A planted bad template is included. | Stage 1 rejects `BAD-HALLUCINATED-001` on every variant, plus ~28 genuine distractor collisions. |
| **2. Nobody can leak the paper** | The paper is selected at T₀ by a public randomness beacon, not by a person. | Stage 2: same beacon → identical manifest hash; different beacon → different paper. |
| **3. Fair difficulty for everyone** | Assembly targets an IRT Test Information Function under blueprint + anti-leak constraints. | Stage 3: two independently assembled forms match to ~1% of peak information. |

## Reading the code

| Section | What it is |
|---|---|
| §1 `DeterministicRNG` | HMAC-SHA256 counter-mode PRNG. Python's `random` is not contractually stable across versions, and the derivation has to be reproducible from the beacon alone. Mirrors the HKDF construction in `question-crypto.ts`. |
| §2 `verify_expression` | Locked-down evaluation of the answer expression. **In production this is SymPy** doing genuine symbolic re-derivation. |
| §3 `Template` / `Item` | The item model and its expanded, machine-verified children. `Item.information()` is the 3PL Fisher information function — the formal unit of "how hard". |
| §4 `expand_and_verify` | Gauntlet stages S0 (structural) and S1 (symbolic). |
| §5 `assemble` | Beacon-seeded Automated Test Assembly. Randomised greedy (GRASP) under hard constraints. **In production this is OR-Tools CP-SAT** — run once at HQ at T−14d, not at a centre; see the note below. |
| §5 `check_constraints` | Independent re-verification — what an external auditor runs against a published form. |

> **Where this runs, which the design doc revised on 2026-08-10.** The prototype does
> assembly and selection in one step, which reads as "each centre solves this at T₀".
> It does not, and must not: a MIP solution is not reproducible across solver versions,
> so 3,000 independently-built centre images could disagree about which paper today's
> is — a worse incident than a leak. Under the revised §6.1 the solve happens **once at
> HQ, at T−14d**, producing N candidate forms; at T₀ each Edge computes
> `idx = HKDF(beacon) mod N` and takes `form[idx]`. What this prototype demonstrates is
> that the optimisation is tractable and the constraints are satisfiable — the T−14d
> half. It does not demonstrate cross-implementation determinism, because it has only
> ever run on one machine with one Python, and that is exactly why the T₀ step is now
> an array index instead of a solve.

## Production substitutions

Deliberately avoided here to keep the prototype dependency-free:

| Prototype | Production |
|---|---|
| `verify_expression` (float eval) | **SymPy** symbolic re-derivation + **Pint** unit checking |
| randomised greedy `assemble` | **OR-Tools CP-SAT** at HQ, T−14d, emitting N candidate forms |
| `assemble` called at selection time | **`idx = HKDF(beacon) mod N`** on the Edge at T₀ — no solver in the image |
| `BEACON_A/B` constants | **drand quicknet** (`52db9ba7…`, `bls-unchained-g1-rfc9380`, 3 s) verified with `@noble/curves` against the chain public key baked into the signed image. Unchained matters: a chained beacon needs the previous signature to verify, which an air-gapped centre does not have (design doc §6.3a) |
| `status = "CALIBRATED"` set by fiat | IRT parameters estimated from real response data (design doc §7) |
| `DeterministicRNG` | unchanged — this one is already production-grade |

## Known limits

- Gauntlet stages **S2 (multi-model consensus)** and **S3 (novelty/contamination)** are
  not implemented — they need an LLM adapter and an embedding model respectively.
- IRT parameters here are **template-family priors with deterministic jitter**, not
  estimates from candidate responses. Real calibration cannot be prototyped without
  real response data; see design doc §7 for the bootstrapping path.
- Pool sealing (§6.2) and the delivery integration are not included; those plug into
  the existing `question-seal.ts` / `question-crypto.ts`.
- The demo pool is deliberately small (~200 items, 25 templates, 12 setters) so the run
  is instant. Every guarantee **strengthens** with pool size — the setter cap tightens
  from 11% to 5%, and form-to-form overlap falls toward zero.
- **Determinism is demonstrated within one interpreter, not across implementations.**
  Same beacon → identical manifest hash is a real result and it is the right property
  to want; it was just measured twice on the same machine. Cross-implementation
  agreement is what the revised §6.1 buys by replacing the T₀ solve with an index.

## Verification log

| Date | Result |
|---|---|
| 2026-08-10 | Re-run independently with `--quiet`: **`ALL CLAIMS HOLD`, exit 0.** The numbers in the design doc's §12 reproduce. |
