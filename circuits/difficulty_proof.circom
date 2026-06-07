/*
 * CryptoExam Core — ZK-SNARK Difficulty Proof Circuit
 * § 10.5 — CIRCOM 2.1.6 + snarkjs Groth16
 *
 * Guarantee 4 — AI-generated papers have machine-verifiable difficulty distribution.
 *
 * This circuit proves:
 *   1. Hash(Q₁,...,Qₙ) = committed_hash  (question set matches commitment)
 *   2. All IRT discrimination a[i] >= min_a  (questions are discriminating)
 *   3. All IRT guessing c[i] <= max_c  (guessing probability bounded)
 *   4. Mean IRT difficulty b is within tolerance of target  (difficulty on target)
 *
 * It does NOT reveal:
 *   - Questions themselves
 *   - Individual IRT parameters
 *   - Correct answers
 *
 * Verification: anyone with the proof and public inputs can verify
 * on Polygon Amoy using the on-chain ZKVerifier contract.
 *
 * Forging a proof for a non-compliant distribution is computationally
 * infeasible under the discrete log hardness assumption (bn128 curve).
 */

pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

/*
 * DifficultyProof(N):
 *   N = number of questions in the exam paper.
 *   For NEET: N=180, JEE Main: N=90, SSC CGL: N=100.
 *   Demo: N=10 (faster proof generation for hackathon demo).
 */
template DifficultyProof(N) {
    // ════════════════════════════════════════════
    // PRIVATE INPUTS (never revealed on-chain)
    // ════════════════════════════════════════════
    signal input irt_b[N];         // IRT difficulty parameter per question (scaled ×1000)
    signal input irt_a[N];         // IRT discrimination per question (scaled ×1000)
    signal input irt_c[N];         // IRT guessing parameter per question (scaled ×1000)
    signal input question_enc[N];  // Encoded question identifiers (for hash)

    // ════════════════════════════════════════════
    // PUBLIC INPUTS (visible on-chain, verifiable by anyone)
    // ════════════════════════════════════════════
    signal input committed_hash;   // Poseidon hash of question set
    signal input target_mean_b;    // Target mean difficulty (scaled ×1000)
    signal input min_a;            // Minimum discrimination threshold (scaled ×1000)
    signal input max_c;            // Maximum guessing threshold (scaled ×1000)
    signal input tolerance;        // Acceptable deviation from target mean (scaled ×1000)

    // ════════════════════════════════════════════
    // CONSTRAINT 1: Hash verification
    // Proves the question set matches the on-chain commitment
    // without revealing the questions themselves.
    // ════════════════════════════════════════════
    component hash = Poseidon(N);
    for (var i = 0; i < N; i++) {
        hash.inputs[i] <== question_enc[i];
    }
    hash.out === committed_hash;

    // ════════════════════════════════════════════
    // CONSTRAINT 2: Discrimination bounds
    // All questions must have discrimination >= min_a
    // (ensures questions can differentiate ability levels)
    // ════════════════════════════════════════════
    component disc[N];
    for (var i = 0; i < N; i++) {
        disc[i] = GreaterEqThan(16);
        disc[i].in[0] <== irt_a[i];
        disc[i].in[1] <== min_a;
        disc[i].out === 1;
    }

    // ════════════════════════════════════════════
    // CONSTRAINT 3: Guessing bounds
    // All questions must have guessing <= max_c
    // (limits random-guess success probability)
    // ════════════════════════════════════════════
    component guess[N];
    for (var i = 0; i < N; i++) {
        guess[i] = LessEqThan(16);
        guess[i].in[0] <== irt_c[i];
        guess[i].in[1] <== max_c;
        guess[i].out === 1;
    }

    // ════════════════════════════════════════════
    // CONSTRAINT 4: Mean difficulty within tolerance
    // |mean(b) - target_mean_b| <= tolerance
    // Implemented as: target - tol <= sum/N <= target + tol
    // Scaled to avoid division: (target - tol)*N <= sum <= (target + tol)*N
    // ════════════════════════════════════════════
    signal sum_b;
    var acc = 0;
    for (var i = 0; i < N; i++) {
        acc += irt_b[i];
    }
    sum_b <-- acc;

    // Verify the sum was computed correctly
    // (This constraint is needed because <-- is an assignment, not a constraint)
    signal partial_sums[N + 1];
    partial_sums[0] <== 0;
    for (var i = 0; i < N; i++) {
        partial_sums[i + 1] <== partial_sums[i] + irt_b[i];
    }
    sum_b === partial_sums[N];

    // Lower bound: sum_b >= (target_mean_b - tolerance) * N
    component lo = GreaterEqThan(32);
    lo.in[0] <== sum_b;
    lo.in[1] <== (target_mean_b - tolerance) * N;
    lo.out === 1;

    // Upper bound: sum_b <= (target_mean_b + tolerance) * N
    component hi = LessEqThan(32);
    hi.in[0] <== sum_b;
    hi.in[1] <== (target_mean_b + tolerance) * N;
    hi.out === 1;
}

// Main component with public inputs declared
// N=10 for demo (fast proof generation ~5-10 seconds)
// Production: N=90 (JEE), N=180 (NEET), N=100 (SSC)
component main { public [committed_hash, target_mean_b, min_a, max_c, tolerance] }
    = DifficultyProof(10);
