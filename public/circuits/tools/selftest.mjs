#!/usr/bin/env node
/**
 * End-to-end check that the built circuit actually proves what it claims.
 *
 * Generates a Groth16 proof over a compliant paper and verifies it, then does
 * the same for three non-compliant papers and asserts each one is *impossible*
 * to prove. A ZK circuit that accepts everything is worth nothing, so the
 * negative cases are the point of this test.
 *
 *   node tools/selftest.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as snarkjs from "snarkjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD = join(HERE, "..", "build");
const WASM = join(BUILD, "difficulty_proof_js", "difficulty_proof.wasm");
const ZKEY = join(BUILD, "difficulty_proof_final.zkey");
const VKEY = join(BUILD, "verification_key.json");

// Difficulty is signed (IRT b runs about -3..+3) but the circuit's range
// comparators only read non-negative field elements, so b is carried shifted by
// this offset. target_mean_b is shifted identically, which leaves the
// comparison — and therefore the guarantee — unchanged. Keep in step with
// IRT_B_OFFSET in backend/crypto/zk_proof.py.
const B_OFFSET = 4000;

const N = 6;
const enc = Array.from({ length: N }, (_, i) => String(1000003n * BigInt(i + 1)));

async function poseidon(inputs) {
  const mod = await import(
    pathToFileURL(join(BUILD, "poseidon_commit_js", "witness_calculator.js")).href
  );
  const wc = await (mod.default ?? mod)(readFileSync(join(BUILD, "poseidon_commit_js", "poseidon_commit.wasm")));
  const w = await wc.calculateWitness({ question_enc: inputs.map(String) }, true);
  return w[1].toString();
}

/** A paper that satisfies every constraint. */
async function compliantInput() {
  return {
    irt_b: Array.from({ length: N }, (_, i) => String(B_OFFSET + (i - 4) * 100)), // mean = B_OFFSET+50
    irt_a: Array.from({ length: N }, () => "1200"), // a = 1.2 >= min_a 0.8
    irt_c: Array.from({ length: N }, () => "200"), //  c = 0.2 <= max_c 0.25
    question_enc: enc,
    committed_hash: await poseidon(enc),
    target_mean_b: String(B_OFFSET),
    min_a: "800",
    max_c: "250",
    tolerance: "500",
  };
}

async function prove(input) {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  const vkey = JSON.parse(readFileSync(VKEY, "utf8"));
  const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
  return { proof, publicSignals, ok };
}

let failures = 0;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} | ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
};

const t0 = Date.now();
const good = await compliantInput();
const { proof, publicSignals, ok } = await prove(good);
check("a compliant paper produces a verifying Groth16 proof", ok, `${Date.now() - t0} ms`);
check("the 5 declared public signals are the ones published", publicSignals.length === 5, publicSignals.join(", "));

// Tampering with a public signal must break verification: this is what stops
// somebody claiming a proof about difficulty 0.9 was a proof about 0.5.
const vkey = JSON.parse(readFileSync(VKEY, "utf8"));
const tampered = [...publicSignals];
tampered[1] = String(BigInt(tampered[1]) + 1n);
check(
  "a proof does not verify against altered public signals",
  !(await snarkjs.groth16.verify(vkey, tampered, proof)),
);

// Negative cases — each must be UNPROVABLE, not merely "unverified".
const cases = [
  ["a paper with an under-discriminating question cannot be proved", { irt_a: (a) => [...a.slice(1), "700"] }],
  ["a paper with an over-guessable question cannot be proved", { irt_c: (c) => ["900", ...c.slice(1)] }],
  [
    "a paper whose mean difficulty misses the target cannot be proved",
    { irt_b: () => Array.from({ length: N }, () => String(B_OFFSET + 2000)) },
  ],
];
for (const [name, patch] of cases) {
  const bad = { ...(await compliantInput()) };
  for (const [k, f] of Object.entries(patch)) bad[k] = f(bad[k]);
  let threw = false;
  try {
    await prove(bad);
  } catch {
    threw = true;
  }
  check(name, threw);
}

// Lying about the question set is caught by the Poseidon commitment.
const swapped = { ...(await compliantInput()) };
swapped.question_enc = [...enc.slice(1), "424242"];
let hashThrew = false;
try {
  await prove(swapped);
} catch {
  hashThrew = true;
}
check("a question set that does not match the commitment cannot be proved", hashThrew);

console.log(`\n=== ${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"} ===`);
process.exit(failures === 0 ? 0 : 1);
