#!/usr/bin/env node
/**
 * Poseidon commitment over a question set — circomlib's implementation, not a
 * second one.
 *
 * `difficulty_proof.circom` constrains Poseidon(question_enc) === committed_hash,
 * so the committer has to produce that digest before it can prove anything. This
 * runs the witness calculator of `poseidon_commit.circom` (the same circomlib
 * Poseidon the proof circuit instantiates) and prints the digest, so there is no
 * second implementation to drift out of sync.
 *
 *   echo '["1","2",…]' | node tools/poseidon-commit.mjs
 *   node tools/poseidon-commit.mjs '["1","2",…]'
 *
 * Prints the digest as a decimal string on stdout. Exits non-zero with a message
 * on stderr if the circuit has not been built — never a substitute value.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM = join(HERE, "..", "build", "poseidon_commit_js", "poseidon_commit.wasm");

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

const raw = process.argv[2] ?? (await readStdin());
let inputs;
try {
  inputs = JSON.parse(raw);
} catch {
  console.error("poseidon-commit: expected a JSON array of decimal field elements");
  process.exit(2);
}
if (!Array.isArray(inputs) || inputs.length === 0) {
  console.error("poseidon-commit: expected a non-empty JSON array");
  process.exit(2);
}

let builder;
try {
  // pathToFileURL: on Windows a bare absolute path is read as a "d:" protocol.
  const mod = await import(
    pathToFileURL(join(HERE, "..", "build", "poseidon_commit_js", "witness_calculator.js")).href
  );
  builder = mod.default ?? mod;
} catch (e) {
  console.error(
    "poseidon-commit: circuit not built — run public/circuits/build.sh first " +
      `(${e.message})`,
  );
  process.exit(3);
}

const wc = await builder(readFileSync(WASM));
// The witness vector is [1, <outputs…>, <inputs…>, …]; `out` is the only output.
const witness = await wc.calculateWitness({ question_enc: inputs.map(String) }, true);
process.stdout.write(witness[1].toString());
