/**
 * Phase 10a DoD — cross-implementation envelope compatibility.
 *
 * The TERMINAL seals with WebCrypto (exam-terminal/lib/answer-seal.ts); the
 * EDGE recomputes leaves and the HQ HSM opens envelopes with node:crypto
 * (lib/envelope.ts). These are two independent codebases that must agree on
 * every byte: ct/iv/tag layout, RSA-OAEP-SHA256 wrap, canonical JSON, and
 * leaf = SHA-256(ct‖iv‖tag‖wrapped_DK).
 *
 * Runs without a DB (pure crypto), under plain `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { open, sealRecord as edgeSealRecord, type Sealed } from "../lib/envelope.ts";
import { sha256, canonicalJson as edgeCanonicalJson, fromUtf8 } from "../lib/crypto.ts";
import {
  sealRecord as terminalSealRecord,
  canonicalJson as terminalCanonicalJson,
  receiptNonce,
  type AnswerRecord,
} from "../../../exam-terminal/lib/answer-seal.ts";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const record: AnswerRecord = {
  exam_id: "44444444-4444-4444-4444-444444444444",
  subject_ref: "R-1042",
  responses: [
    { question_hash: "0x" + "ab".repeat(32), chosen_option: "B", answered_at_ms: 123456, revision_count: 2 },
    { question_hash: "0x" + "cd".repeat(32), chosen_option: "D", answered_at_ms: 234567, revision_count: 0 },
  ],
  timing: { started: "2026-06-10T03:30:00Z", submitted: "2026-06-10T06:29:12Z" },
  anomaly_summary: { tab_switch: 0, face_fail: 0, multi_face: 0 },
  receipt_nonce: receiptNonce(),
};

test("terminal WebCrypto seal opens with the HQ node:crypto implementation", async () => {
  const sealed = await terminalSealRecord(record, publicKey);

  // The Edge recomputes the leaf over the wire bytes — must equal the terminal's.
  const edgeLeaf = sha256(sealed.ct, sealed.iv, sealed.tag, sealed.wrappedDk);
  assert.deepEqual(Buffer.from(sealed.leaf), Buffer.from(edgeLeaf), "leaf computation must agree");

  // HQ HSM-side open (the ONLY place the private key exists).
  const pt = open(sealed as Sealed, privateKey);
  assert.equal(fromUtf8.decode(pt), edgeCanonicalJson(record), "decrypted bytes must be the canonical record");
});

test("canonical JSON byte-agreement between the two implementations", () => {
  const messy = { b: [3, 1, { z: 1, a: 2 }], a: "x", nested: { k2: null, k1: "v" } };
  assert.equal(terminalCanonicalJson(messy), edgeCanonicalJson(messy));
});

test("tampered ciphertext or wrong key fails to open (GCM/OAEP integrity)", async () => {
  const sealed = await terminalSealRecord(record, publicKey);
  const tampered = { ...sealed, ct: sealed.ct.map((b, i) => (i === 0 ? b ^ 0xff : b)) as Uint8Array };
  assert.throws(() => open(tampered as Sealed, privateKey));

  const { privateKey: wrongKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  assert.throws(() => open(sealed as Sealed, wrongKey));
});

test("edge sealRecord and terminal sealRecord are interchangeable for HQ open", async () => {
  const fromEdge = edgeSealRecord(record, publicKey);
  const fromTerminal = await terminalSealRecord(record, publicKey);
  assert.equal(fromUtf8.decode(open(fromEdge, privateKey)), fromUtf8.decode(open(fromTerminal as Sealed, privateKey)));
});
