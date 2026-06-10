import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendLeaf,
  verifyChain,
  inclusionWitness,
  verifyInclusion,
  type ChainRecord,
} from "../lib/merkle-chain.ts";
import { sha256, utf8 } from "../lib/crypto.ts";

function buildChain(n: number): ChainRecord[] {
  const records: ChainRecord[] = [];
  for (let i = 0; i < n; i++) {
    records.push(appendLeaf(records, sha256(utf8.encode(`answer-${i}`))));
  }
  return records;
}

test("rolling chain verifies end-to-end", () => {
  const records = buildChain(8);
  const r = verifyChain(records);
  assert.equal(r.ok, true);
  assert.equal(r.brokenAt, null);
});

test("INV-9: tampering a stored leaf breaks the chain", () => {
  const records = buildChain(8);
  // An attacker edits answer #3's leaf in the ledger (root left unchanged).
  records[3] = { ...records[3]!, leaf: sha256(utf8.encode("forged-answer")) };
  const r = verifyChain(records);
  assert.equal(r.ok, false);
  assert.equal(r.brokenAt, 3, "break detected exactly at the tampered index");
});

test("INV-9: tampering a stored root breaks the chain", () => {
  const records = buildChain(8);
  records[5] = { ...records[5]!, root: sha256(utf8.encode("forged-root")) };
  const r = verifyChain(records);
  assert.equal(r.ok, false);
  assert.equal(r.brokenAt, 5);
});

test("receipt inclusion witness verifies; a forged witness does not", () => {
  const records = buildChain(8);
  const w = inclusionWitness(records[4]!);
  assert.equal(verifyInclusion(w), true);
  const forged = { ...w, leaf: sha256(utf8.encode("not-my-answer")) };
  assert.equal(verifyInclusion(forged), false);
});
