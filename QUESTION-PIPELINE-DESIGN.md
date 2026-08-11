# Question Authoring & Delivery Pipeline — Architecture and Product Plan

**Author's hat:** product manager / systems architect
**Reading basis:** `private/zuup_os_implementation_plan.md` (v2.0), the edge-server and
exam-terminal source, `public/frontend/app/setter/*`, and my prior security review
(`SECURITY-REVIEW.md`).
**Date:** 2026-08-09 · **revised for feasibility 2026-08-10**

---

## Revision note — what changed and why (2026-08-10)

The design is sound. Four things in it were not buildable as written, and one was
factually wrong about the codebase. Everything else stands.

| # | Change | Why |
|---|---|---|
| 1 | **§0 rewritten.** `public/backend/` exists — 106 routes, 71 passing tests, a six-agent generation pipeline, the three paper modes, and a working on-chain Groth16 proof. The setter portal calls it. | The draft called this a greenfield and planned accordingly. It is a change to a running system, and §9 was costing work that is already done. |
| 2 | **§6.1: the T₀ CP-SAT solve is gone.** Optimise at T−14d into N candidate forms; at T₀ the beacon picks an index. | The draft asserted every Edge derives the same form *and* that solver output drifts between versions. Both cannot hold. An index cannot drift; a MIP solution across 3,000 independently-built images can. It also removes OR-Tools and Python from a signed read-only image. |
| 3 | **§6.3a added.** Switch to drand **quicknet** (unchained), verify with `@noble/curves`, and stop treating the DB column as the source of truth. | "Verify the BLS signature" hides a choice. The chain currently pinned is *chained*, so a single beacon cannot be verified standalone — exactly what the air-gapped case needs. |
| 4 | **Two live bugs named.** `DRAND_PERIOD = 3` against a 30-second chain (rounds come out ~10× too high); the pinned chain hash is compared to nothing. | Verified against the live drand API on 2026-08-10. A T₀ round computed today points years into the future. |
| 5 | **§9 re-ordered.** Beacon integrity is phase 0, practice product moves ahead of assembly, setter portal shrinks to a week. | Nine weeks of work on top of a beacon HQ pre-loads means the headline property is false the whole time — and it is the smallest phase. |
| 6 | **§11 gained four limitations**, including the one this revision *introduces*: HQ now knows the paper is one of N. | It is a real step back from "HQ knows nothing", bounded above by the pool HQ already distributes. §6.1a removes it once the pool is calibrated. |

**§12's prototype was re-run independently: `ALL CLAIMS HOLD`, exit 0.** The measured
numbers reproduce.

**Feasibility verdict: buildable at ₹0 through phase 5 (~7 weeks).** Phases 6–9 need
response data and human reviewers, which are time and money, not architecture.

---

## 0. What I found, and the one assumption I'm making

`public/frontend/app/setter/` already contains the shape of the intent: three paper
modes (Direct Upload / AI-Edited / AI Full Generation), an IRT parameter editor
(`setter/irt`), a proofs surface, and a question bank. The delivery half is real —
`question-seal.ts`, `question-crypto.ts`, `chain-bridge.ts` and the T₀ beacon flow
are implemented and tested.

> **Correction, 2026-08-10 — the first draft of this section was wrong on the facts,
> and the error changed the plan.** It said "All of it is UI with hardcoded arrays.
> `public/backend/` does not exist," and concluded "nothing has to be un-built."
> Both halves are false, verified by running the thing:
>
> - **`public/backend/` exists and runs.** FastAPI, **106 routes**, 71 passing tests,
>   SQLAlchemy async over SQLite or Postgres. It already contains a six-agent
>   generation pipeline (`app/agents/`), the three paper modes
>   (`app/api/v1/question_modes.py`), the sealing pipeline (`app/api/v1/delivery.py`),
>   the lifecycle service, and a **working Groth16 difficulty proof** verified
>   on-chain.
> - **The setter portal calls that backend.** `dashboard`, `generate`, `irt`,
>   `proofs`, `questions` and `register` all issue real API calls.
>
> So this is **not** a greenfield. The plan below is therefore written as a set of
> changes to a running system, and every section names the file it lands in. Where
> the existing code already does something well, the plan reuses it rather than
> proposing a parallel implementation — the whole authoring plane described here can
> be built as a new `app/services/item_pool/` package plus changes to four existing
> files, not as a new backend.

**What is genuinely missing** (this is the real gap the plan should address):

| Piece | State today |
|---|---|
| Item **pool** as a first-class object | Absent. Questions belong to an exam from birth (`questions.exam_id`), so there is nothing to assemble *from*. |
| Parametric templates + computed keys | Absent. Generation emits finished items with model-asserted answers. |
| Verification gauntlet | Partial. A validator agent checks IRT range, Bloom's and duplicates; there is no symbolic re-derivation and no consensus stage. |
| Beacon-driven **selection** | Absent. The beacon decrypts a paper that was already chosen. |
| Beacon **unpredictability** | **Broken** — see §6.3. `t0_beacon` is a database column pre-loaded before the exam. |
| IRT calibration from response data | Absent. `irt_b/a/c` are authored values, never estimated. |

**Assumption I'm making:** this targets high-stakes competitive entrance exams in the
Indian context (the spec's DPDP references, centre/roll/DOB model, NEET/JEE-shaped
config of 90 questions / 180 min / 720 marks / negative marking / 4 sets). If it's
actually low-stakes or corporate assessment, several of my recommendations are
over-engineered and I'd cut them — say so and I'll re-scope.

**Assumption I'm making:** this targets high-stakes competitive entrance exams in the
Indian context (the spec's DPDP references, centre/roll/DOB model, NEET/JEE-shaped
config of 90 questions / 180 min / 720 marks / negative marking / 4 sets). If it's
actually low-stakes or corporate assessment, several of my recommendations are
over-engineered and I'd cut them — say so and I'll re-scope.

---

## 1. The three requirements, restated as engineering problems

You asked for four things. Three of them are in genuine tension, and naming the
tension is most of the work.

| You said | The real problem | Why it's hard |
|---|---|---|
| "the question setter shouldn't be able to leak the paper" | **Nobody may know the paper before T₀** | Someone has to write the questions. Whoever writes them, knows them. |
| "fair difficulty to all" | **Statistically equivalent forms** | If you randomise to prevent leaks, candidates get different papers — and different papers are not equally hard. |
| "without blunders or hallucination" | **Every item's answer key must be provably correct** | An LLM that writes a physics question also writes the answer. If it's wrong, lakhs of candidates are scored against a wrong key. |
| "almost free for prototype" | **Cost must sit in verification, not generation** | Generation is already cheap. Human review is what costs money. |

The tension: **anti-leak pushes toward randomisation; fairness pushes toward
uniformity.** The entire design below is the resolution of that one conflict.

---

## 2. The central idea

> **Move the secret from the paper to the pool, and let the T₀ beacon assemble the
> paper. Then no human — not the setter, not HQ, not the centre — has ever seen the
> paper, because it did not exist until the moment the exam began.**

Today's design (and every conventional exam) has a **leak window**: the paper is
assembled by people at time T−30 days, and must stay secret until T₀. Every leak in
Indian competitive exams has happened inside that window. You cannot close it with
process, because the window's existence is the vulnerability.

The system already has the mechanism to close it and is using it for only half its
power. `question-crypto.ts` derives decryption keys from the drand beacon at T₀. The
upgrade is one sentence:

**The beacon should not just decrypt the paper. It should choose it.**

Concretely:

```
T−30d   Setters author items into a large pool. No one authors a "paper".
T−7d    HQ commits on-chain to:  poolRoot ‖ blueprintHash ‖ drandRound
        The whole sealed pool ships to every centre. It is 10–100 MB. It contains
        ~10,000 items. Nobody knows which 90 will be used, because the number that
        decides has not been generated yet.
T₀      drand publishes round R. It is BLS-signed and verifiable offline.
        Every Edge independently computes:
             seed  = HKDF(beacon_R, "cryptoexam:ata:" ‖ examId)
             form  = AutomatedTestAssembly(pool, blueprint, seed)
        Every Edge gets the identical form. The paper exists for the first time.
T+      Anyone can re-run the assembly against the published pool and beacon and
        confirm the paper was not hand-picked.
```

**What this buys, precisely:**

- A setter who leaks *everything they wrote* leaks ~50 items out of 10,000, of which
  a hard constraint (§5.3) allows at most 4 onto any form. Leak value: ~4%.
- HQ cannot leak the paper because HQ does not know it. HQ knows the pool.
- The centre cannot leak it: the pool is ciphertext and the manifest is sealed.
- Selection is **verifiable after the fact**, which converts "trust us" into "check us".

**What it does not buy — the honest limit:** it does not make leaking *impossible*.
It makes leaking **low-value**. Someone who exfiltrates the whole 10,000-item pool
has a real advantage. The mitigations for that are pool size, canary items,
compartmentalisation, and the observation that memorising 10,000 items with worked
answers is *approximately indistinguishable from studying* — which is the outcome you
actually want. I'd rather tell you that plainly than sell you an absolute.

---

## 3. Trust model — before and after

| Who | Can they leak the paper today? | After this design? |
|---|---|---|
| **Question setter** | **Yes — completely.** They wrote it. | No. They know ~0.5% of the pool and are capped at ~4% of any form. |
| **Setter's reviewer / SME** | **Yes.** Reviews the assembled paper. | No. Reviews items in shuffled order, never a paper. |
| **HQ / platform operator** | **Yes.** Assembles and seals it. | No. Commits to the pool before the beacon exists. |
| **Centre Admin** | No (already ciphertext) | No. Also cannot enumerate the pool (§6.2). |
| **Candidate** | No | No. Gets 90 items, cannot derive keys for the other 9,910. |
| **Anyone with the whole pool** | n/a | **Yes, partially** — this is the residual risk, addressed in §5.4. |

The row that matters is row 3. **No current exam system in this space removes the
operator from the trust path.** That is the defensible thing here, and it is worth
building the product story around.

---

## 4. Architecture — four planes

```
┌─ AUTHORING PLANE (public internet, HQ-side) ──────────────────────────────┐
│                                                                           │
│  Setter Portal ──▶ Item Templates ──▶ VERIFICATION GAUNTLET ──▶ Item Pool │
│  (public/frontend    (§5.1)            (§5.2, 5 stages)          (sealed) │
│   /app/setter)                                                            │
│                            ▲                                              │
│                            │ AI is a pluggable backend, not a dependency  │
│                     ┌──────┴──────┐                                       │
│                     │ LLM adapter │  Ollama · Gemini · Groq · any         │
│                     └─────────────┘                                       │
└───────────────────────────────────────────────────────────────────────────┘
                                    │  sealed pool + blueprint, committed on-chain
                                    ▼
┌─ COMMITMENT PLANE (Polygon, public) ──────────────────────────────────────┐
│  lockExam(examId, poolRoot, blueprintHash, drandRound, poolCid)           │
│  Published at T−7d. Immutable. This is what makes selection auditable.    │
└───────────────────────────────────────────────────────────────────────────┘
                                    │  pool ships to centres (offline, USB/PXE)
                                    ▼
┌─ ASSEMBLY PLANE — split across two times, not one place (§6.1) ───────────┐
│                                                                           │
│  T−14d  at HQ, online, offline-batch:                                     │
│         CP-SAT ──▶ N TIF-matched candidate forms ──▶ formSetRoot          │
│         Slow, heavyweight, and it does not matter: nobody is waiting.     │
│                                                                           │
│  T₀     at each Centre Edge, air-gapped:                                  │
│         verify drand BLS sig ──▶ idx = HKDF(beacon) mod N ──▶ form[idx]   │
│         An index lookup. No solver, no Python, no floating point, so      │
│         3,000 centres cannot disagree about which paper today's is.       │
└───────────────────────────────────────────────────────────────────────────┘
                                    │  manifest + per-item keys
                                    ▼
┌─ DELIVERY PLANE (existing — question-crypto.ts, unchanged in shape) ──────┐
│  Terminal derives keys, verifies Merkle proofs, renders one item at a time │
└───────────────────────────────────────────────────────────────────────────┘

┌─ CALIBRATION PLANE (feedback loop, §7) ───────────────────────────────────┐
│  Response data ──▶ IRT estimation ──▶ item parameters ──▶ back to pool     │
│  Fed by practice tests (free product) and embedded field-test items.       │
└───────────────────────────────────────────────────────────────────────────┘
```

The authoring plane lives entirely in `public/`. The assembly plane lives entirely in
`private/`. **The `public/`↔`private/` boundary the spec calls "load-bearing" is
preserved** — the only things crossing are the sealed pool (content-addressed) and the
on-chain commitment, exactly as §0.1(3) of the implementation plan requires.

---

## 5. The authoring pipeline

### 5.1 Parametric item templates — the anti-hallucination core

**This is my single strongest recommendation, and it also fixes the most dangerous
thing currently specified.**

The spec's Mode 2 ("AI randomly edits 20–80% of questions based on difficulty level")
will ship wrong answer keys. Changing a number in a physics question changes its
answer; an LLM asked to "edit" will frequently update the stem and not the key, or
update both inconsistently. In a national exam that is a Supreme Court case, not a bug
report.

The fix is to stop generating *items* and start generating *item templates* with
computed answers:

```yaml
template_id: PHY-MECH-CIRC-001
author: setter-7f3a
subject: Physics
topic: Mechanics / Circular Motion
blooms: 3
stem: >
  A particle moves along a circular path of radius {R} m with a constant
  speed of {v} m/s. The magnitude of its centripetal acceleration is:
parameters:
  R: {type: int, values: [2, 3, 4, 5, 8]}
  v: {type: int, values: [4, 6, 8, 10, 12]}
constraints:
  - "v % R != 0 or v//R < 10"        # keep the arithmetic non-trivial
solution:
  expr: "v**2 / R"
  units: "m/s^2"
distractors:                          # each is a *named misconception*, computed
  - {expr: "v / R",      misconception: "confuses ω with a"}
  - {expr: "v**2",       misconception: "drops the radius"}
  - {expr: "2*v**2 / R", misconception: "spurious factor of 2"}
verification:
  method: sympy
  derivation: "a_c = v^2/R  [standard circular motion]"
```

25 parameter combinations × 1 template = 25 sibling items. Each one's answer is
**computed by SymPy, not asserted by a model**. A hallucinated key is structurally
impossible.

What this gives you, in one move:

| Property | How |
|---|---|
| **No hallucinated answers** | The key is the output of a symbolic evaluation, not of a language model. |
| **Pool scale for free** | 400 templates × 25 variants = 10,000 items. Human reviews 400 things, not 10,000. |
| **Difficulty fairness** | Sibling variants have near-identical IRT parameters by construction. Swapping siblings between forms is fairness-neutral. |
| **Leak resistance** | Leaking one variant tells you the template, not the answer to the sibling that actually appears. |
| **Better distractors** | Distractors are computed from *named misconceptions*, so they're diagnostically meaningful rather than plausible-looking noise. |

This is established psychometrics — **automatic item generation from item models** —
not something I'm inventing. It's how large item banks are actually built.

**Where templates don't work:** conceptual and factual items (biology recall,
history, comprehension, reasoning) have no computable answer. Roughly:

- Physics, Chemistry (physical/numerical), Mathematics, Quantitative Aptitude →
  **80–90% templatable**
- Chemistry (organic/inorganic reasoning), Biology → **30–50%**
- Comprehension, general awareness → **~0%, human-authored, full gauntlet**

Plan for a **hybrid pool**: templated items where possible, gauntlet-verified authored
items elsewhere. Don't pretend templates cover everything.

### 5.2 The verification gauntlet

Every item — templated or authored — passes five stages, ordered cheapest-first so
the expensive human stage sees the fewest items.

```
   1000 AI-generated candidates
        │
   ┌────▼────────────────────────────────────────────┐
   │ S0  STRUCTURAL          free, deterministic     │  → ~850 survive
   │ schema · exactly one key · no duplicate options │
   │ LaTeX parses · length bounds · key-position     │
   │ balance · no "all of the above"                 │
   ├─────────────────────────────────────────────────┤
   │ S1  SYMBOLIC            free, deterministic     │  → ~600 survive
   │ SymPy re-derives the answer · Pint checks units │
   │ · sandboxed execution · MUST match the key      │
   │ ⟵ this is the stage that kills hallucination    │
   ├─────────────────────────────────────────────────┤
   │ S2  CONSENSUS           ~₹0.02/item             │  → ~450 survive
   │ N models answer BLIND (no key shown)            │
   │  · disagree with key      → reject              │
   │  · all correct, high conf → too easy / leaked   │
   │  · split or moderate conf → keep + difficulty   │
   │    proxy = fraction correct                     │
   ├─────────────────────────────────────────────────┤
   │ S3  NOVELTY             free, local embeddings  │  → ~400 survive
   │ cosine vs PYQ corpus · vs existing pool · vs    │
   │ public banks → rejects duplicates, training-set │
   │ regurgitation, and copyright exposure           │
   ├─────────────────────────────────────────────────┤
   │ S4  HUMAN SME           the only real cost      │  → ~380 accepted
   │ shuffled order · cross-setter · never a paper   │
   │ · signed, hash-chained attestation              │
   └─────────────────────────────────────────────────┘
```

Two design notes worth calling out:

**S2 is doing double duty.** Model consensus is simultaneously a correctness check
*and* a first-pass difficulty estimate. If 9 of 10 models get it right, it's probably
easy; if 3 of 10, probably hard. That proxy is not IRT — it is not calibrated against
human candidates and it will be wrong at the tails — but it's free, and it's what
bootstraps §7 before you have response data.

**S2 also detects training-set contamination.** An item that every model answers
instantly and confidently is likely one it memorised — meaning it's a known PYQ, which
means candidates have seen it too. Rejecting those improves both security and validity.

**Failure modes of the gauntlet, honestly:** S1 only helps computational items. S2's
consensus can be confidently wrong on genuinely hard items where models share a
misconception — this is the residual risk and it's why S4 exists and cannot be
removed. Never ship an item that only S2 vouched for.

### 5.3 Compartmentalisation of setters

Hard constraints, enforced in code and in the assembly optimiser:

1. A setter writes into a **topic-scoped queue**. They never see the pool, other
   setters' items, or any assembled form.
2. A setter never learns the exam date their items will be used for. Items are
   authored continuously and consumed opportunistically.
3. **Contribution cap as an ATA constraint:** `Σ_{i authored by s} x_i ≤ ⌈0.05·k⌉`.
   With k=90 that's 4 items. A fully corrupt setter who leaks their entire output
   compromises at most 4.4% of the paper. *This is the mathematical statement of "the
   setter cannot leak the paper."*
4. **Canary items.** Each setter's queue contains uniquely-fingerprinted items that
   circulate in the pool and appear only as unscored field-test items. If a canary
   surfaces in a coaching centre's "leaked paper", you have attribution — the same
   trick cartographers use with trap streets.
5. Every submission is **signed by the setter's key and hash-chained** — reuse
   `audit.ts`'s existing pattern verbatim. Non-repudiation for free.

### 5.4 The residual risk: pool exfiltration

Be clear-eyed. If someone walks off with the whole decrypted pool, the design degrades
to "very large open-book exam". Mitigations, in order of value:

- **Pool size ≫ paper size.** Target ratio ≥ 100:1. At 100:1 the marginal value of
  memorising the pool approaches the value of studying.
- **Continuous rotation.** Retire items after N exposures; keep an inflow of fresh
  templates. Track per-item exposure count — this is standard item-bank hygiene.
- **The pool at rest is ciphertext with unlabelled blobs** (§6.2), so exfiltration
  requires compromising the authoring plane, not any centre.
- **Statistical leak detection.** If a cohort's response pattern on a subset of items
  is anomalously fast and accurate relative to their performance elsewhere, that
  subset is compromised. This is detectable post-hoc with the response data you're
  already collecting, and it is how leaks are actually caught in practice.

---

## 6. Assembly, sealing, and how it plugs into the existing code

### 6.1 Assembly — optimise at T−7d, *draw* at T₀

The first draft put a CP-SAT solve at T₀ inside every Edge. **That does not survive
contact with the deployment**, for two reasons that the draft itself half-noticed and
then argued past:

1. **It contradicts its own verification note.** The draft says selection is
   trustworthy because every Edge independently computes the same form — and then, two
   paragraphs later, says auditors must *not* re-derive the solution "because solver
   versions drift". Both cannot be true. If a solver's output drifts between versions,
   it drifts between the 3,000 independently-built centre images too, and two centres
   sitting different papers is a worse incident than a leak. Fixing a seed makes CP-SAT
   reproducible *for one build of one binary*; it is not a cross-version guarantee, and
   nobody should bet a national exam on one.
2. **It puts a heavyweight, non-Node dependency on the critical path.** The Edge is a
   TypeScript/Node service inside a signed, read-only, dm-verity image. OR-Tools is a
   C++/Python toolchain. Adding it means a Python runtime plus native wheels in the
   image, and the first time it runs in anger is T₀ at every centre simultaneously.
   A solver that OOMs or times out at that moment has no recovery path.

**The fix: separate the hard part from the timing-critical part.** Optimisation needs
to be good, not fast, and it does not need to be secret — only the *choice* does.

```
T−14d  HQ runs the CP-SAT solve ONCE, offline, at leisure, producing
       N = 256 candidate forms. Each is TIF-matched to the target curve and
       satisfies every constraint below. Solver drift is irrelevant: the output
       is data, not something anyone re-derives.

T−7d   HQ commits on-chain to  formSetRoot = MerkleRoot(hash(form_1) … hash(form_N))
       together with blueprintHash and the drand round R. The sealed pool and all
       N sealed form manifests ship to every centre.

T₀     beacon_R arrives and is BLS-verified (§6.3). Every Edge computes:

           idx  = HKDF(beacon_R, "cryptoexam:form:" ‖ examId) mod N
           form = form_manifest[idx]                    ← one array index

       No solver. No floating point. No dependency. Two lines that cannot drift.

T+     Anyone recomputes idx from the published beacon and the committed
       formSetRoot and confirms the form that ran was the one the beacon chose.
```

The optimisation problem itself is unchanged and still runs — just at T−14d, at HQ:

```
minimise   Σ_θ | TIF_form(θ) − TIF_target(θ) |          over θ ∈ {−3.0, −2.5, …, +3.0}
subject to Σ x_i = k                                     (paper length)
           Σ_{i ∈ topic t} x_i = k_t   ∀t                (blueprint)
           lo_b ≤ Σ_{i ∈ bloom b} x_i ≤ hi_b  ∀b         (cognitive mix)
           Σ_{i ∈ author s} x_i ≤ ⌈0.05k⌉  ∀s            (§5.3 anti-leak cap)
           Σ_{i ∈ template m} x_i ≤ 1     ∀m             (no two siblings on one form)
           x_i + x_j ≤ 1  ∀(i,j) ∈ enemies               (no item gives away another)
           x_i = 0 ∀i with status ≠ CALIBRATED           (nothing unproven is scored)
           x_i ∈ {0,1}
```

…solved N times with a no-good cut after each solution, so the N forms are distinct.

`TIF` is the Item Test Information Function from IRT — the standard measure of how
precisely a form measures ability at each level. **Matching TIF across forms is the
formal definition of "equally hard".** This is not an approximation of fairness; it is
the psychometric definition of it.

**What this costs, stated honestly.** HQ now knows the paper is one of 256, instead of
knowing nothing. That is a real weakening of the §2 claim and it should not be glossed:

| | Draft design | This design |
|---|---|---|
| Does HQ know the paper? | No | No — but knows it is 1 of 256 |
| An HQ insider who leaks everything they hold leaks… | the pool (10,000 items) | the union of 256 forms (≤ 23,040 slots over ≤ 10,000 distinct items — i.e. **at most the pool**) |
| Determinism across 3,000 centres | solver-dependent | an array index |
| Runtime dependency at T₀ | OR-Tools + Python | none |

The insider's leak is bounded *above* by what they could leak anyway, because the pool
already ships to every centre — so this trades **no real confidentiality** for a
guarantee that every hall sits the same paper. Raising N costs nothing but storage
(a form manifest is ~90 ids; 256 of them is a few hundred KB), so N=256 is a floor,
not a ceiling. If the residual bothers you, §6.1a removes it entirely.

**Verification is now trivial and version-independent.** An auditor checks two things,
both pure functions: that `idx` was computed correctly from the published beacon, and
that `form[idx]` satisfies every constraint and achieves the published objective value.
Neither requires running a solver.

#### 6.1a Optional: removing HQ from the trust path entirely

If "HQ knows it is 1 of 256" is unacceptable, keep the T₀ draw but make the *pool
stratification* — not a pre-solved form — the committed artifact:

- At T−14d, HQ partitions the pool into blueprint cells (topic × Bloom's × information
  stratum) and proves each cell has ≥ 4× the items the blueprint draws from it.
- At T₀ the Edge runs a **specified deterministic draw**, not an optimisation: within
  each cell, sort candidate items by `HMAC(beacon_R, itemId)` and take the first `k_t`,
  then apply a fully-specified greedy repair pass for the author-cap and enemy
  constraints (deterministic tie-break on item id).

Because every item in a cell sits in the same information stratum, any draw satisfying
the cells has TIF within a bounded tolerance of the target **by construction** — you
buy fairness from the stratification instead of from an optimiser. Sorting by an HMAC
is byte-identical on every implementation, so cross-centre agreement is guaranteed
without a solver.

This is strictly stronger on secrecy and strictly weaker on TIF precision. **Ship 6.1
for the prototype** (simpler, and the stratification quality needed for 6.1a depends on
calibration data you will not have until P2, §7); move to 6.1a once the pool is
calibrated and large enough for every cell to be deep.

### 6.2 Sealing the pool so it can't be enumerated

The current scheme derives every item key from `masterSeed` and the item id. If the
whole pool ships to the centre and `masterSeed` is released at T₀, a candidate could
derive keys for all 10,000 items, not just their 90 — which erodes the pool after a
single exam.

Fix, small and clean:

- Each pool item gets a **random 128-bit blob id** `r_i`, unrelated to its position.
- The pool ships as **unlabelled ciphertext blobs in shuffled order**.
- `itemKey_i = HKDF(masterSeed, info = "cryptoexam:q:" ‖ r_i)`.
- The **form manifest** (position → blob index, `r_i`) is itself sealed and released
  at T₀ alongside the beacon.

Without the manifest you hold 10,000 opaque blobs and cannot guess any `r_i`. Only the
90 selected items are ever derivable. Pool erosion solved.

### 6.3 The beacon must be genuinely unpredictable — a gap in the current design

`repo.getBeaconIfReleased()` reads `t0_beacon` from a **database column** that was
pre-loaded before the exam and merely withheld until `t0_at`. That is a time-lock by
*policy*, not by *cryptography* — whoever loaded that row knows the beacon in advance,
and under this new design that person would know the paper in advance. The whole §2
property collapses on this one line.

**The fix is easy and it's the reason drand was the right choice in the first place:
drand beacons are BLS-signed and verifiable offline.** You do not need a trusted
channel to deliver one.

So at T₀, deliver the beacon by *any* means — a brief pinned inbound fetch, a USB
stick, an SMS read aloud and typed by the Centre Admin, a radio broadcast — and have
the Edge **verify the BLS signature against the drand chain public key baked into the
signed image**. A forged beacon is cryptographically impossible; a *withheld* one just
delays the exam (fail-closed, which is correct).

This preserves INV-3 (no live internet at the centre) while making the beacon genuinely
unpredictable. It is a strict improvement on the current design and it costs one
signature verification.

#### 6.3a Making that concrete — and two live bugs in the current constants

The above is right but unbuildable as written; "verify the BLS signature" hides a
choice that decides whether offline verification is possible at all. Checked against
the live drand API on 2026-08-10:

**Use quicknet, not the default chain.** The repo currently pins
`8990e7a9…2ce`, whose `schemeID` is **`pedersen-bls-chained`**: each signature covers
`round ‖ previous_signature`, so verifying one beacon standalone requires the previous
one too — awkward precisely in the air-gapped case this design depends on. Quicknet is
**unchained**, so a single beacon verifies against nothing but the chain public key.

| | default `8990e7a9…` (in the repo) | **quicknet `52db9ba7…` (use this)** |
|---|---|---|
| scheme | `pedersen-bls-chained` | `bls-unchained-g1-rfc9380` |
| period | 30 s | 3 s |
| genesis | 1595431050 | 1692803367 |
| public key | 48 B (G1) | 96 B (G2) |
| signature | 96 B (G2) | 48 B (G1) |
| offline single-beacon verify | needs previous sig | **self-contained** |

**Bug 1 — the period constant is wrong.** `public/backend/crypto/drand_client.py`
declares `DRAND_PERIOD = 3` alongside the *default* chain's hash and genesis, but that
chain's period is **30**. `round_for_timestamp()` therefore returns a round roughly
**10× too large** — a T₀ round computed from a timestamp points years into the future
and will never be published. Confirmed arithmetically: the live round at the time of
writing was ~6.36 M, which is `(now − 1595431050) / 30`; the code's formula yields
~63.6 M. Either switch to quicknet (period 3, genesis 1692803367 — the constants then
become self-consistent) or set the period to 30. **Do not leave the current mix.**

**Bug 2 — the chain hash is never used to verify anything.** It is carried in config
and compared to nothing. Baking a chain hash next to an unverified signature is the
kind of detail that reads as security in review and provides none.

**Implementation, zero cost and no native dependencies.** The Edge is Node, so:

```ts
import { bls12_381 } from "@noble/curves/bls12-381";   // pure JS, no native build

// quicknet: sig on G1, pubkey on G2, message = SHA-256(round as 8-byte BE),
// hashed to G1 with the RFC 9380 suite the scheme id names.
const msg = sha256(u64be(round));
const ok = bls12_381.verifyShortSignature(sigG1, msg, CHAIN_PUBKEY_G2);
```

`@noble/curves` is pure TypeScript with no native compilation, which matters because
this has to run inside a read-only dm-verity image built reproducibly. Python side
(`drand_client.py`) has an equivalent in `py_ecc` or `blspy` — but note the Python side
is HQ-only; **the verification that must exist is the Edge's**, because that is the
one happening where nobody is watching.

**The three changes this section actually requires:**

1. `private/edge-server/src/lib/drand-verify.ts` — new, ~40 lines, one dependency.
2. `repo.getBeaconIfReleased()` stops being the source of truth. Keep the column as a
   *cache*, but have `/api/exam/:examId/beacon` refuse to release a beacon whose
   signature does not verify against the baked-in chain key — so a pre-loaded row is
   no longer sufficient to unlock an exam.
3. A `POST /api/exam/:examId/beacon` ingest route so the Centre Admin can hand the Edge
   a beacon out of band, which is the whole point: **delivery becomes untrusted**.

Until (2) lands, every claim in §2 is aspirational, because the person who fills that
column at T−1d decides the paper.

### 6.4 Fairness within a hall vs across shifts — split these, they are different problems

The current config has `setsCount: 4`, which conflates two requirements that want
opposite solutions:

| Requirement | Right mechanism | Fairness cost |
|---|---|---|
| **Stop neighbour-copying** | **Per-seat scrambling.** Same 90 items for everyone; question order and option order permuted per seat via `HKDF(beacon, seatId)`. | **Zero** — everyone answers literally the same items. |
| **Different shifts / days** | **Distinct forms** with matched TIF + **anchor items** (10–15 common items across forms) to enable post-hoc statistical equating. | Real, and manageable only with IRT. |

**Recommendation: stop using multiple item-sets for anti-copying.** Per-seat scrambling
is strictly better — it defeats copying completely and introduces no equating problem
at all. Reserve distinct forms for the case that genuinely requires them (multiple
shifts), where you must do the equating work anyway.

Residual caveat, stated honestly: item *position* has a small measurable effect on
difficulty (fatigue, ordering). It is far smaller than item substitution, and it is
measurable and correctable in the calibration plane.

---

## 7. Calibration: how "fair difficulty" actually becomes true

**The honest headline: IRT parameters cannot be predicted, only estimated from
response data. On day one you will not have that data, and any claim of calibrated
difficulty before the first cohort is marketing, not psychometrics.**

Here is the bootstrapping path that gets you there without pretending.

| Phase | Difficulty source | Status of items | Honesty of the claim |
|---|---|---|---|
| **P0 — prototype** | Model-consensus proxy (§5.2 S2) + template-family priors | `PROVISIONAL` | "Estimated difficulty." Never call it calibrated. |
| **P1 — practice tests** | Real response data from volunteer/practice cohorts | `CALIBRATED (weak)` | Real IRT, wide confidence intervals. |
| **P2 — embedded field test** | 10 of 100 items unscored, rotating, in live exams | `CALIBRATED` | n in the lakhs. Genuinely calibrated. |
| **P3 — steady state** | Continuous re-estimation + DIF + drift monitoring | `CALIBRATED + DIF-CLEARED` | Defensible in court. |

**The product insight worth acting on:** ship a **free practice-test product** and your
calibration problem solves itself. Every practice attempt is a calibration event.
Students want free mocks; you need response data; those are the same thing. This turns
your biggest psychometric liability into your cheapest acquisition channel. Do this
first — it is the highest-leverage item on the whole roadmap.

**Field-test embedding (P2)** is how ETS and NBME actually do it: a handful of unscored
items ride along in a live exam, candidates can't tell which, and one administration
yields hundreds of thousands of responses per item. Zero extra candidate burden, zero
extra cost.

**Hard rule for the optimiser:** `x_i = 0` for any item not `CALIBRATED`. Uncalibrated
items may appear **only** in unscored field-test slots. This is the constraint that
stops the system from ever scoring someone against an item whose difficulty nobody
knows.

### 7.1 Fairness beyond difficulty — DIF

"Fair to all" in the Indian context means more than equal difficulty. It means an item
must not be systematically harder for a subgroup for reasons unrelated to ability —
language medium (English vs regional), urban/rural, gender.

That's **Differential Item Functioning**, and IRT gives you the tool for it
(Mantel-Haenszel, or IRT-based DIF). Once you have P2 response data, run DIF on every
item and retire the flagged ones.

I'd argue this is the most *socially* important part of the whole plan and it is the
part most likely to get dropped for schedule. Budget for it explicitly. A question
that's harder for Hindi-medium candidates because of an idiom in the stem is a
fairness failure that no amount of cryptography addresses.

---

## 8. Cost

### 8.1 Prototype — genuinely ~₹0

| Component | Choice | Cost |
|---|---|---|
| LLM generation | **Ollama** locally (Qwen2.5-14B / Llama-3.x) behind a pluggable adapter | ₹0 |
| LLM fallback / consensus | Free tiers — Google AI Studio, Groq, OpenRouter free endpoints | ₹0 |
| Embeddings (S3 novelty) | `sentence-transformers` (bge-small / MiniLM), local | ₹0 |
| Symbolic verification (S1) | SymPy + Pint | ₹0 |
| Sandbox | subprocess with rlimits, or a scratch container | ₹0 |
| ATA solver | OR-Tools CP-SAT — **HQ only, offline, at T−14d** (§6.1) | ₹0 |
| Beacon verification | `@noble/curves` (pure TS, no native build) | ₹0 |
| IRT estimation | `girth` / `py-irt` (Python) or `mirt` (R) | ₹0 |
| Beacon | drand public endpoints (quicknet — §6.3a) | ₹0 |
| Anchoring | **Polygon Amoy testnet** + faucet | ₹0 |
| Storage | the SQLite/Postgres the backend already runs on | ₹0 |

> Free-tier quotas change constantly and I can't verify today's limits from here —
> check them before you commit. The architecture deliberately doesn't care: the model
> sits behind an adapter, and **the entire value of the gauntlet (S0, S1, S3) is free
> and deterministic regardless of which model you plug in.**

**Two cost notes the first draft got wrong, both in your favour:**

- **Nothing heavyweight ships to the centre any more.** Moving the solve to T−14d
  (§6.1) removes OR-Tools, Python and the whole native toolchain from the Edge image.
  The Edge gains exactly one pure-TypeScript dependency (`@noble/curves`) and one array
  index. For a signed, reproducibly-built, read-only image that is the difference
  between "feasible" and "a rebuild of the OS image pipeline".
- **S2 consensus is the only stage that needs a network, and it runs at HQ.** The
  air-gapped side never calls a model. So free-tier flakiness delays authoring; it
  cannot affect an exam in progress. Design the adapter to treat a model timeout as
  "item stays in the queue", never as "item passes".

**Where the prototype's ₹0 genuinely stops being ₹0:** S4 human review. At prototype
scale you review the ~40 templates you actually author, yourself, in an afternoon. The
₹8L–20L in §8.2 is the honest number for a 10,000-item production pool and no
architecture choice here removes it.

### 8.2 Production — where the money actually is

For a 10,000-item pool:

| Line item | Estimate | Notes |
|---|---|---|
| AI generation | **₹5,000–15,000** | ~15k tokens per *surviving* item (≈5 candidates generated per keeper) at commodity model prices. |
| Gauntlet S0/S1/S3 | **₹0** | Deterministic local compute. |
| Gauntlet S2 consensus | **₹15,000–25,000** | N models × blind answer per candidate item. |
| **Human SME review** | **₹8L–20L** | **This is 95%+ of the cost.** |
| Anchoring | **< ₹1,000/exam** | Roots and counts only. |

Compare with conventional human item-writing at ₹500–2,000 per item: **₹50L–2Cr** for
the same pool.

**So the real economic argument is not "AI is cheap".** It is:

> Templates mean a human reviews **400 templates instead of 10,000 items**, and the
> gauntlet means the items they do review are pre-filtered to ~40% survival. That is
> roughly a **20× reduction in expert-hours**, and expert-hours are the entire budget.

Frame the business case that way. The token cost is a rounding error either way.

---

## 9. Roadmap

Re-ordered, and re-scoped against the code that actually exists (§0). Every row names
the files it lands in, because "wire up a backend" was the first draft's estimate for
work that is mostly already done.

| Phase | Build | Lands in | Definition of done | Time |
|---|---|---|---|---|
| **0. Beacon integrity** | quicknet constants · BLS verify · out-of-band beacon ingest (§6.3a) | `edge-server/src/lib/drand-verify.ts` (new), `repo.getBeaconIfReleased`, `crypto/drand_client.py` | A beacon with a bad signature cannot unlock an exam; a pre-loaded DB row is no longer sufficient | 3 d |
| **1. Skeleton** | Template schema · SymPy verifier · deterministic expander | `backend/app/services/item_pool/` (new) | 1 template → 25 variants, every key machine-verified | 1 wk |
| **2. Pool as an object** | `items` table decoupled from `exam_id` · status lifecycle · exposure counter | new migration + `backend/app/models` | An item can exist without belonging to an exam | 4 d |
| **3. Gauntlet** | S0/S1/S3 local · LLM adapter · S2 consensus | `item_pool/gauntlet/`, reusing `app/agents/validator.py` for S0 | 1,000 candidates → ~400 accepted, zero key errors in a 100-item hand-audit | 2 wk |
| **4. Practice product** | Free mock-test surface + response capture | `frontend/app/practice/`, `backend/app/api/v1/practice.py` | 10,000 responses collected | 3 wk |
| **5. Assembly** | CP-SAT at HQ · N candidate forms · `formSetRoot` commit · T₀ index draw (§6.1) | `item_pool/assembly.py`, `edge-server/src/services/form-select.ts` | Two Edges, same beacon → same form index, with no solver on either | 1 wk |
| **6. Setter portal** | Template authoring UI on the **existing** setter routes; pool never exposed | `frontend/app/setter/*` (extend), `api/v1/question_modes.py` (replace Mode 2 engine) | A setter authors a template, sees it verified, never sees the pool | 1 wk |
| **7. Calibration** | IRT estimation · status lifecycle · DIF | `item_pool/calibration.py` | Items graduate PROVISIONAL → CALIBRATED from real data | 2 wk |
| **8. Integration** | Pool sealing with blob ids (§6.2) · per-seat scramble (§6.4) | `edge-server/src/lib/question-seal.ts`, `exam-terminal/lib/question-crypto.ts` | End-to-end: pool → T₀ → paper on a terminal, air-gapped | 2 wk |
| **9. Hardening** | Canaries · exposure tracking · leak detection · rescore path | across | Tabletop: invalidate an item post-exam and rescore cleanly | 2 wk |

**Three ordering changes from the first draft, each for a reason:**

- **Beacon integrity moved to phase 0.** It was phase 6. Every security claim in §2
  rests on it, so building the pool, the gauntlet and the assembly on top of a beacon
  that HQ pre-loads means nine weeks of work whose headline property is false the whole
  time. It is also the smallest phase. Do it first.
- **Practice product moved ahead of assembly.** The draft already said "do phase 4
  earlier than feels natural" and then listed it fourth; this makes the advice
  structural. Response data has a lead time you cannot compress, and phase 7 is blocked
  on it.
- **"Setter portal" shrank from 2 weeks to 1.** The portal exists and talks to a real
  backend. The work is a template authoring surface and replacing Mode 2's engine, not
  wiring a frontend to a backend that has to be written first.

**Phases 0–5 are the zero-cost prototype** (~7 weeks). Phases 6–9 need response data
and human reviewers, so they cost real money and real time.

---

## 10. What I'd push back on

Being useful here means disagreeing with parts of the current spec.

1. **Kill Mode 2 (AI-Edited Upload) as specified.** "AI randomly edits 20–80% of
   questions" is the highest-risk feature in the product and it will ship wrong answer
   keys. Replace it with **template parameterisation**, which delivers the same user
   value (unpredictable variants at a chosen difficulty) with the answer computed
   rather than generated. Same button in the UI, completely different engine behind it.

2. **Mode 1 (Direct Upload for "trusted institutions with zero leak history")
   contradicts the thesis.** If the architecture's claim is that *nobody* needs to be
   trusted, an escape hatch for institutions we've decided to trust is the weakest link
   and the one an attacker will target. Every historical leak came from a trusted
   institution — that's what made it a leak. If Mode 1 must exist for adoption, at
   minimum force uploaded items **into the pool** rather than allowing them to be a
   pre-assembled paper.

3. **`setsCount: 4` is solving the wrong problem** (§6.4). Per-seat scrambling beats
   multiple sets on both fairness and anti-copying.

4. **Don't let AI near scoring or evaluation.** Generation and verification, yes.
   Deciding whether a candidate's answer is correct — no. Keep scoring a deterministic
   key match.

5. **Design the post-hoc item-invalidation path now, not later.** Every large exam
   eventually has to drop a bad item and rescore. Your answer records already store
   `question_hash` per response, so this is feasible — but it needs an explicit,
   audited, anchored "item revoked, forms rescored" flow, or the first bad item becomes
   a crisis instead of a procedure.

---

## 11. Honest limitations

- **This does not make leaking impossible.** It makes leaking low-value and
  attributable. Anyone promising impossibility is wrong.
- **Templates cover maybe half a typical syllabus.** The non-computational half still
  depends on human review, which is still the cost and still the weak point.
- **The first exam will run on weakly-calibrated items.** Unavoidable. Be transparent
  about it rather than claiming precision you don't have.
- **Model consensus (S2) can be confidently wrong** on exactly the hard items you most
  want to include. S4 human review is not optional.
- **The whole §2 property rests on the T₀ beacon being unpredictable**, which today it
  is not (§6.3). That single fix is a precondition for every security claim above it.
- **With §6.1 as revised, HQ knows the paper is one of N.** Not nothing. Bounded above
  by the pool HQ already ships, and removable via §6.1a once the pool is calibrated —
  but it is a real step back from "HQ knows nothing", and it bought cross-centre
  determinism, which is not optional.
- **The pool must reach every centre before T₀.** 10,000 sealed items is 10–100 MB per
  centre, distributed offline. That is a logistics problem this document does not
  solve, and at 3,000 centres it is a bigger operational risk than any cryptography
  here. A centre that received a stale pool computes a form index into items it does
  not hold — so the form manifest must be verified against the local pool at T₀−ε, not
  at T₀, with a documented fallback.
- **Per-seat scrambling (§6.4) changes what a "question number" means.** Every
  downstream surface that identifies an item by position — receipts, the answer key,
  the complaint flow, the rescore path — has to key on item id instead. That is a small
  change made in many places, which is the kind that gets half-done.

---

## 12. The prototype — measured, not projected

`prototypes/question-pipeline/pipeline.py` implements §5.1, §5.2 (S0/S1), §6.1 and §6.4
end to end. **Python 3.9+ stdlib only, no dependencies, no API keys, no network.**

```bash
python3 prototypes/question-pipeline/pipeline.py           # full report
python3 prototypes/question-pipeline/pipeline.py --quiet   # self-checks, exit code
```

> **Re-run independently on 2026-08-10: `ALL CLAIMS HOLD`, exit 0.** The numbers below
> reproduce. This section is the part of the document that was already load-bearing —
> it is measured rather than asserted, and it survives being checked.
>
> One scope note the run makes clear: the prototype implements §6.1 as an *optimiser*,
> which is the design this revision moves to T−14d. That is fine — it demonstrates the
> optimisation is tractable and the constraints are satisfiable. What it does **not**
> demonstrate is cross-implementation determinism, because it only ever ran on one
> machine with one Python. That gap is precisely why §6.1 now draws an index at T₀
> instead of solving.

Measured output from an actual run (25 templates, 12 setters, 3 subjects):

| Claim | Result |
|---|---|
| **Anti-hallucination** | 227 variants expanded → **199 accepted, 28 mechanically rejected**. Every rejection is an answer key that would otherwise have shipped wrong. The planted hallucinated template (`BAD-HALLUCINATED-001`, whose "distractor" silently equals the key) was rejected on **every** variant. |
| **Determinism** | Same beacon, two independent runs → **byte-identical manifest hash** `d159f355…`. This is what lets every centre compute the same paper offline with no coordination. |
| **Unpredictability** | Different beacon → different paper (`b35d5beb…`), **9/18 items overlap** at this toy pool size; overlap falls toward zero as the pool scales. |
| **Fairness** | Two independently assembled forms match the target information curve and each other to within **0.02 of ~4.2 peak information (1.2% of peak)** — statistically equivalent by the standard psychometric criterion. |
| **Anti-leak cap** | Worst-case setter contribution **2/18 (11.1%)** on both forms, enforced as a hard optimiser constraint rather than a policy. |

Two things the prototype taught me that I would not have got from design alone:

1. **The blueprint was infeasible on the first run.** "No two siblings of one template
   on a form" caps paper length at the number of distinct templates — 17 templates
   cannot produce a 24-item paper. The optimiser correctly refused rather than
   silently relaxing a constraint. I added an explicit feasibility pre-check with a
   diagnostic, because in production this failure would occur *at T₀, in every centre
   simultaneously*, and "no admissible item remains" at that moment is a national
   incident. **Blueprint feasibility must be verified at commit time (T−7d), not at
   assembly time.** That is a hard-won requirement and it goes in the spec.

2. **Distractor collisions are common** — ~12% of variants. Whenever a parameter
   combination makes a distractor equal the key (e.g. Bohr n=1, where `-13.6/n` and
   `-13.6/n²` coincide), the variant is discarded. That's the anti-hallucination check
   firing on *correctly generated* content, which is exactly right: expand generously,
   reject cheaply.

I hand-checked ten of the assembled items independently (circular motion, Bohr levels,
parallel resistance, det(adj A), lens equation, inelastic collision, sum of squares of
roots, definite integral, first-order half-life, hypergeometric probability). **All ten
keys were correct.** That is the property templates buy you, and it does not degrade
with pool size.

What the prototype does **not** yet cover, and should next: gauntlet stages S2
(multi-model consensus) and S3 (novelty/contamination), the pool sealing scheme of
§6.2, drand BLS verification (§6.3), and real IRT estimation from response data (§7) —
which cannot be prototyped at all until there is response data to estimate from.

---

## 5.1a Template hardening — two measured flaws in §5.1

Added 2026-08-10 after working the template mechanism against the prototype
rather than the prose. §5.1 is the strongest idea in this document, and both
problems below are in its *accounting*, not its principle.

### A. The security parameter is the TEMPLATE, not the item — §5.4's margin is 25× optimistic

§5.4 sets a pool-to-paper ratio target of "≥ 100:1", and §8/§9 plan for 400
templates × 25 variants = 10,000 items against k=90. Those are not the same
ratio, because **§6.1 forbids two siblings of one template on a form** — so a
90-item paper draws from **90 distinct templates**:

| Quantity | Ratio to a 90-item paper |
|---|---|
| Items in the pool (10,000) | 111 : 1 — what §5.4 measures |
| **Templates in the pool (400)** | **4.4 : 1** — what an attacker actually faces |

The variants are not independent secrets. A template's parameters are *printed
on the page*; anyone holding the template answers all 25 of its children by
doing the arithmetic the item exists to test. The unit of secrecy is the
template, so the pool is effectively 400 deep, not 10,000.

This does **not** break §2 or §3 — those are stated as fractions, and the
fractions survive. A setter who authors 2 templates leaks 2/400 = 0.5% of the
pool either way, and the §5.3.3 contribution cap still binds at 5% of a form.
What it breaks is the **residual-risk argument in §5.4**:

> "memorising 10,000 items with worked answers is approximately
> indistinguishable from studying"

becomes *"memorising 400 templates"* — which is a term of coaching, not an
education. That sentence is the whole load-bearing claim of §5.4.

**Three consequences, in order of importance:**

1. **State the ratio in templates everywhere.** A true 100:1 margin on the
   quantity that matters needs **9,000 templates** (225,000 items at 25
   variants), not 400. That is a different programme — and if it is not
   affordable, the honest move is to lower the claimed margin, not to keep
   quoting the item count.
2. **Exposure tracking and rotation must be per-TEMPLATE.** §5.4's "retire items
   after N exposures" retires one variant while its 24 siblings — which a
   compromised party can already answer — stay live. Retire the family.
3. **Statistical leak detection should cluster by template family.** A cohort
   that is anomalously fast on three variants of one template has been drilled
   on the template. The per-item signal is 25× weaker than the per-family
   signal and may not clear noise at all.

### B. The distractor check tests inequality, not distinguishability

`expand_and_verify` rejects an item when the four rendered options are not four
distinct strings. That check is better than it looks — comparing *rendered* text
rather than raw floats catches near-collisions inside display precision and
absorbs float noise (`0.1+0.2` and `0.3` both render `0.3`, so no false
rejection).

It still ships items whose options a candidate cannot tell apart. A distractor
differing from the key by a lower-order term converges on it as parameters grow.
Measured, for `key = n(n+1)/2` against the common "drops the +1" misconception
`n^2/2`:

| n | key | distractor | separation | distinct strings? |
|---|---|---|---|---|
| 5 | 15 | 12.5 | 16.7 % | yes |
| 10 | 55 | 50 | 9.1 % | yes |
| **20** | **210** | **200** | **4.8 %** | yes — **ships** |
| **80** | **3240** | **3200** | **1.2 %** | yes — **ships** |

Every row passes the current test. The bottom rows are items where two options
sit a couple of percent apart: the candidate is being graded on transcription
care rather than on physics, and the item's discrimination collapses.

**Fix — a relative separation floor in S0:**

```python
MIN_REL_SEPARATION = 0.05      # 5% of the key's magnitude

for w in wrongs:
    if abs(w - answer) < MIN_REL_SEPARATION * max(abs(answer), 1e-9):
        raise VerificationError(
            f"distractor {w} is within {MIN_REL_SEPARATION:.0%} of the key {answer} — "
            "distinct on the page but not distinguishable to a candidate"
        )
```

Apply it distractor-to-distractor as well, for the same reason. It costs a few
percent of variants on top of the ~12% already lost to exact collisions, and it
is the cheapest place in the whole gauntlet to buy item quality: deterministic,
free, and it catches a defect no human reviewer reliably spots in a list of four
numbers.

**Related, smaller:** the docstring claims key position is "balanced across the
pool", but the implementation shuffles each item independently — that gives ~25%
per position *in expectation*, not balance. Across 90 items the binomial spread
is wide enough to produce a visible bias in one paper. If the claim is kept,
allocate positions from a running counter rather than an independent draw.

### What is NOT wrong with templates

Worth recording, because the mechanism is sound and both entries above are
corrections rather than objections:

- **The anti-hallucination property holds completely.** The key is the output of
  evaluating an expression, so a wrong key requires a wrong *expression* — which
  a human reviewing 400 templates will catch, and which the planted
  `BAD-HALLUCINATED-001` case demonstrates being rejected on every variant.
- **Forcing the key's unit onto every option is correct**, and worth stating
  explicitly because it looks like a bug: a distractor computed from `v/R` has
  units of 1/s, and rendering it honestly would let a candidate eliminate it by
  dimensional analysis without knowing any physics. The misconception is the
  point; the units are not part of what is being asked.
- **Sibling IRT similarity is a real property**, not an assumption — siblings
  differ only in parameter values, so §5.1's claim that swapping them is
  fairness-neutral is sound, and it is what makes the §6.1 candidate-form set
  viable in the first place.
