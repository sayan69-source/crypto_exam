import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { sealRecord, open, seal } from "../lib/envelope.ts";
import { canonicalJson, utf8, fromUtf8, sha256, constantTimeEqual } from "../lib/crypto.ts";

function rsaPair() {
  return generateKeyPairSync("rsa", {
    modulusLength: 3072,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

const RECORD = {
  exam_id: "exam-123",
  subject_ref: "pseudo-abc",
  responses: [{ question_hash: "0xdead", chosen_option: "B", answered_at_ms: 42, revision_count: 2 }],
  timing: { started: "t0", submitted: "t1" },
  anomaly_summary: { tab_switch: 0, face_fail: 0, multi_face: 0 },
  receipt_nonce: "nonce-xyz",
};

test("seal → open round-trips with the System Admin private key (HQ)", () => {
  const { publicKey, privateKey } = rsaPair();
  const sealed = sealRecord(RECORD, publicKey);
  const recovered = fromUtf8.decode(open(sealed, privateKey));
  assert.equal(recovered, canonicalJson(RECORD));
});

test("INV-6: the centre is blind — sealed bytes carry no opening key", () => {
  const { publicKey } = rsaPair();
  const sealed = sealRecord(RECORD, publicKey);
  // The ledger row would hold exactly these fields. None of them is a private
  // key, and the DK only exists wrapped to the SA public key.
  const keys = Object.keys(sealed).sort();
  assert.deepEqual(keys, ["ct", "iv", "leaf", "tag", "wrappedDk"]);
  // ciphertext must not equal plaintext
  assert.notEqual(fromUtf8.decode(sealed.ct), canonicalJson(RECORD));
});

test("INV-6: a different/compromised private key cannot open the bundle", () => {
  const { publicKey } = rsaPair(); // sealed to the real SA key
  const other = rsaPair(); // a malicious centre's own keypair
  const sealed = sealRecord(RECORD, publicKey);
  assert.throws(() => open(sealed, other.privateKey), "wrong key must fail to unwrap");
});

test("INV-9 base: leaf == SHA-256(ct||iv||tag||wrapped_DK)", () => {
  const { publicKey } = rsaPair();
  const sealed = seal(utf8.encode("x"), publicKey);
  const expected = sha256(sealed.ct, sealed.iv, sealed.tag, sealed.wrappedDk);
  assert.ok(constantTimeEqual(sealed.leaf, expected));
});

test("tampered ciphertext fails the GCM tag on open (integrity)", () => {
  const { publicKey, privateKey } = rsaPair();
  const sealed = sealRecord(RECORD, publicKey);
  sealed.ct[0] = (sealed.ct[0] ?? 0) ^ 0xff; // flip a byte
  assert.throws(() => open(sealed, privateKey), "GCM auth tag must reject tampering");
});
