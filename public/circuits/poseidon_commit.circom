/*
 * CryptoExam Core — Poseidon commitment helper circuit.
 *
 * The difficulty proof constrains `Poseidon(question_enc) === committed_hash`,
 * so whoever builds the witness has to know the Poseidon digest *before* it can
 * prove anything. Re-implementing Poseidon in Python would mean maintaining a
 * second copy of the round constants and MDS matrix, and any drift between the
 * two would show up only as an unsatisfiable witness with no useful error.
 *
 * Instead this exposes circomlib's own Poseidon as a one-output circuit. The
 * backend computes the commitment by running this circuit's witness calculator,
 * so the hash it commits to is by construction the hash the proof circuit
 * recomputes — there is exactly one implementation.
 *
 * N must match DifficultyProof(N) in difficulty_proof.circom.
 */
pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";

template PoseidonCommit(N) {
    signal input question_enc[N];
    signal output out;

    component h = Poseidon(N);
    for (var i = 0; i < N; i++) {
        h.inputs[i] <== question_enc[i];
    }
    out <== h.out;
}

component main = PoseidonCommit(6);
