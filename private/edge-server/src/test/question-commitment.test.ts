/**
 * The TypeScript half of the cross-language question-commitment contract.
 *
 * Same golden vectors as `public/backend/tests/test_question_commitment.py`.
 * Four independent implementations exist (Python sealer, public /pipeline demo,
 * this Edge stager, and the terminal's verifier) and delivery only works while
 * all four agree byte for byte. Editing one alone turns one of these two suites
 * red, which is the whole point — the previous divergence went unnoticed
 * because nothing compared them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { questionLeaf, hashNode } from "../lib/question-seal.ts";

const unhex = (s: string): Uint8Array =>
  new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));
const hex = (b: Uint8Array): string =>
  [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

// Odd count, variable-length ciphertexts — the two shapes that exposed the
// divergence. Must stay identical to ITEMS in the Python test.
const ITEMS = [
  { id: "Q1", iv: "11".repeat(12), ct: "22".repeat(20), tag: "33".repeat(16) },
  { id: "Q17", iv: "44".repeat(12), ct: "55".repeat(31), tag: "66".repeat(16) },
  { id: "Q3", iv: "77".repeat(12), ct: "88".repeat(9), tag: "99".repeat(16) },
];
const GOLDEN_LEAVES = ["0b65d1f51cc427c7", "fd17748babd4cd83", "cf431fd340ae77d2"];
const GOLDEN_ROOT = "82924401175822a92a0440745fd2c237bd23f381ed15531eb61b3cfabc35c4b0";

const leaves = () =>
  Promise.all(ITEMS.map((i) => questionLeaf(i.id, unhex(i.iv), unhex(i.ct), unhex(i.tag))));

/** The shipped tree: orphan promoted, internal nodes domain-tagged. */
async function root(ls: Uint8Array[]): Promise<Uint8Array> {
  let level = [...ls];
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 >= level.length) { next.push(level[i]!); continue; }
      next.push(await hashNode(level[i]!, level[i + 1]!));
    }
    level = next;
  }
  return level[0]!;
}

test("leaf matches the cross-language golden vector", async () => {
  assert.deepEqual((await leaves()).map((l) => hex(l).slice(0, 16)), GOLDEN_LEAVES);
});

test("root matches the cross-language golden vector", async () => {
  assert.equal(hex(await root(await leaves())), GOLDEN_ROOT);
});

test("sliding the id boundary no longer collides", async () => {
  const honest = await questionLeaf("Q17", unhex("11".repeat(12)), unhex("22".repeat(40)), unhex("33".repeat(16)));
  const forged = await questionLeaf("Q1", unhex("37" + "11".repeat(11)), unhex("11" + "22".repeat(40)), unhex("33".repeat(16)));
  assert.notDeepEqual(Array.from(honest), Array.from(forged));
});

test("duplicate-last-node does not alias two papers (CVE-2012-2459)", async () => {
  const ls = await leaves();
  assert.notDeepEqual(
    Array.from(await root(ls)),
    Array.from(await root([...ls, ls[ls.length - 1]!])),
  );
});
