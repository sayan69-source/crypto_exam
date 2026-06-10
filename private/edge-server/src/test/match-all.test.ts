import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateMatchAll,
  DEFAULT_POLICY,
  type MatchAllFactors,
  type IdentityFacts,
} from "../lib/match-all.ts";

// A fully-passing login transaction.
const GOOD_FACTORS: MatchAllFactors = {
  faceScore: 0.9,
  fpScore: 0.85,
  sourceIp: "10.20.0.17",
  tpmValid: true,
  elapsedMs: 1500,
};
const GOOD_ID: IdentityFacts = {
  boundIp: "10.20.0.17",
  status: "ACTIVE",
  revoked: false,
};

test("INV-4: all factors pass → login ok", () => {
  const r = evaluateMatchAll(GOOD_FACTORS, GOOD_ID, DEFAULT_POLICY);
  assert.equal(r.ok, true);
  assert.deepEqual(r.failures, []);
});

// INV-4: flipping ANY single factor must deny. One assertion per factor.
const NEGATIVES: Array<[string, Partial<MatchAllFactors>, Partial<IdentityFacts>, string]> = [
  ["wrong face", { faceScore: 0.5 }, {}, "FACE_BELOW_THRESHOLD"],
  ["wrong finger", { fpScore: 0.2 }, {}, "FINGERPRINT_BELOW_THRESHOLD"],
  ["spoofed/foreign IP", { sourceIp: "10.20.0.99" }, {}, "SOURCE_IP_MISMATCH"],
  ["tampered image (TPM fail)", { tpmValid: false }, {}, "TPM_ATTESTATION_INVALID"],
  ["identity not active", {}, { status: "PENDING_APPROVAL" }, "IDENTITY_NOT_ACTIVE"],
  ["identity revoked", {}, { revoked: true }, "IDENTITY_REVOKED"],
  ["login box expired", { elapsedMs: 25_000 }, {}, "LOGIN_BOX_EXPIRED"],
  ["no bound IP enrolled", {}, { boundIp: null }, "NO_BOUND_IP"],
];

for (const [name, fp, idp, expected] of NEGATIVES) {
  test(`INV-4: deny on ${name}`, () => {
    const r = evaluateMatchAll(
      { ...GOOD_FACTORS, ...fp },
      { ...GOOD_ID, ...idp },
      DEFAULT_POLICY,
    );
    assert.equal(r.ok, false, "must be denied");
    assert.ok(r.failures.includes(expected), `expected failure ${expected}, got ${r.failures.join(",")}`);
  });
}
