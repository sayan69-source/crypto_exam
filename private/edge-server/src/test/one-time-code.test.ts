import { test } from "node:test";
import assert from "node:assert/strict";
import { generateCode, hashCode, verifyCode, type ArgonParams } from "../lib/one-time-code.ts";

// Fast Argon2id params for tests (production uses 64 MiB / t=3).
const FAST: ArgonParams = { timeCost: 2, memoryCostKiB: 8192, parallelism: 1 };

test("generateCode: 128-bit, Crockford, grouped, unambiguous", () => {
  const code = generateCode();
  // grouped with hyphens; strip them for the entropy check
  const raw = code.replace(/-/g, "");
  assert.match(raw, /^[0-9A-HJKMNP-TV-Z]+$/, "only Crockford base32 chars");
  assert.ok(raw.length >= 25, "≥125 bits encoded in base32"); // 128/5 ≈ 26
  // no ambiguous I, L, O, U
  assert.doesNotMatch(raw, /[ILOU]/);
});

test("generateCode: collision-free across many draws", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) seen.add(generateCode());
  assert.equal(seen.size, 2000, "no collisions in 2000 draws");
});

test("hashCode/verifyCode: correct code verifies, wrong code rejected", () => {
  const code = generateCode();
  const stored = hashCode(code, FAST);
  assert.equal(verifyCode(code, stored), true, "right code verifies");
  assert.equal(verifyCode(generateCode(), stored), false, "different code rejected");
});

test("verifyCode: tolerant of separators/case (hand-off friendly)", () => {
  const code = generateCode();
  const stored = hashCode(code, FAST);
  assert.equal(verifyCode(code.toLowerCase(), stored), true);
  assert.equal(verifyCode(code.replace(/-/g, " "), stored), true);
});

test("hashCode: cleartext is never recoverable from the stored bytes", () => {
  const code = generateCode();
  const stored = hashCode(code, FAST);
  const text = Buffer.from(stored).toString("utf8");
  const raw = code.replace(/-/g, "");
  assert.ok(!text.includes(raw), "stored hash must not contain the cleartext code");
});
