/**
 * Signed biometric attestation (§8.4).
 *
 * The first two tests are the two exploits this module exists to remove:
 *   • a client posting its own scores ("faceScore: 1"), which used to be the
 *     only thing standing between an unauthenticated LAN host and a session;
 *   • one genuine capture replayed across a hall full of candidates, which is
 *     what an unsubjected score is.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import {
  verifyBioEnvelope,
  checkinSubject,
  LOGIN_SUBJECT,
  type BioEnvelope,
  type SignedBio,
} from "../lib/bio-attest.ts";
import { canonicalJson, toHex, utf8 } from "../lib/crypto.ts";

const daemon = generateKeyPairSync("ed25519");
const bioPubkeyPem = daemon.publicKey.export({ type: "spki", format: "pem" }).toString();

const TERMINAL = "11111111-2222-3333-4444-555555555555";
const NONCE = "a".repeat(64);
const NOW = 1_800_000_000_000;

function sign(envelope: BioEnvelope, key = daemon.privateKey): SignedBio {
  return {
    envelope,
    sig: toHex(new Uint8Array(cryptoSign(null, Buffer.from(utf8.encode(canonicalJson(envelope))), key))),
  };
}

const goodEnvelope = (over: Partial<BioEnvelope> = {}): BioEnvelope => ({
  terminalId: TERMINAL,
  nonce: NONCE,
  subject: LOGIN_SUBJECT,
  faceScoreBp: 9400,
  fpScoreBp: 8800,
  capturedAt: NOW - 1_200,
  ...over,
});

const expectation = (over: Partial<Parameters<typeof verifyBioEnvelope>[1]> = {}) => ({
  bioPubkeyPem,
  terminalId: TERMINAL,
  nonce: NONCE,
  subject: LOGIN_SUBJECT,
  now: NOW,
  ...over,
});

// ═══════════════ the two-language contract, pinned on both sides ════════════
test("canonical bytes match zuup-biometricd's serialiser exactly", () => {
  // The daemon is Python and this verifier is JavaScript, so the signed bytes
  // are a paired implementation. This literal is duplicated verbatim in
  // zuup-os/biometric/zuup-biometricd.py (`_CANON_EXPECTED`), where the daemon
  // refuses to start if its own output differs. Changing one without the other
  // makes every genuine signature look forged, on exam morning, at every
  // station at once — so it is pinned here rather than assumed.
  const sample = {
    terminalId: "11111111-2222-3333-4444-555555555555",
    subject: checkinSubject("R-1461"),
    nonce: "ab12",
    fpScoreBp: 8800,
    faceScoreBp: 9400,
    capturedAt: 1_800_000_000_000,
  };
  assert.equal(
    canonicalJson(sample),
    '{"capturedAt":1800000000000,"faceScoreBp":9400,"fpScoreBp":8800,' +
      '"nonce":"ab12","subject":"checkin:R-1461",' +
      '"terminalId":"11111111-2222-3333-4444-555555555555"}',
  );
});

test("scores are integers because floats do not serialise alike in both languages", () => {
  // JSON.stringify(1.0) is "1"; Python's json.dumps(1.0) is "1.0". A perfect
  // match — the one score a real candidate most wants — would have been the
  // only score whose signature never verified.
  assert.equal(canonicalJson({ v: 10000 }), '{"v":10000}');
  assert.equal(canonicalJson({ v: 1.0 }), '{"v":1}', "this is the trap being avoided");
});

// ════════════════════════ the two exploits ══════════════════════════════════
test("unsigned scores are refused — there is no mode that accepts them", () => {
  // Exactly the old request shape: numbers in a body, no envelope.
  const v = verifyBioEnvelope(
    { faceScoreBp: 10000, fpScoreBp: 10000 } as unknown as SignedBio,
    expectation(),
  );
  assert.equal(v.ok, false);
  assert.deepEqual(v.failures, ["BIOMETRIC_ENVELOPE_MISSING"]);
  assert.equal(v.faceScore, 0, "a denied verdict must not carry usable scores");
  assert.equal(v.fpScore, 0);
});

test("one candidate's capture cannot seat another candidate", () => {
  const forRavi = sign(goodEnvelope({ subject: checkinSubject("R-1001") }));
  const v = verifyBioEnvelope(forRavi, expectation({ subject: checkinSubject("R-1002") }));
  assert.equal(v.ok, false);
  assert.ok(v.failures.includes("BIOMETRIC_SUBJECT_MISMATCH"));
});

// ════════════════════════════ happy path ════════════════════════════════════
test("a fresh, signed, correctly-bound capture passes and yields its scores", () => {
  const v = verifyBioEnvelope(sign(goodEnvelope()), expectation());
  assert.deepEqual(v.failures, []);
  assert.equal(v.ok, true);
  assert.equal(v.faceScore, 0.94);
  assert.equal(v.fpScore, 0.88);
});

test("check-in binds to the roll being verified", () => {
  const env = goodEnvelope({ subject: checkinSubject("R-1461") });
  const v = verifyBioEnvelope(sign(env), expectation({ subject: checkinSubject("R-1461") }));
  assert.equal(v.ok, true, v.failures.join(","));
});

test("ECDSA and RSA daemon keys verify as well as Ed25519", () => {
  for (const key of [
    generateKeyPairSync("ec", { namedCurve: "P-256" }),
    generateKeyPairSync("rsa", { modulusLength: 2048 }),
  ]) {
    const env = goodEnvelope();
    const signed: SignedBio = {
      envelope: env,
      sig: toHex(
        new Uint8Array(
          cryptoSign("sha256", Buffer.from(utf8.encode(canonicalJson(env))), {
            key: key.privateKey,
            dsaEncoding: "ieee-p1363",
          }),
        ),
      ),
    };
    const v = verifyBioEnvelope(signed, expectation({
      bioPubkeyPem: key.publicKey.export({ type: "spki", format: "pem" }).toString(),
    }));
    assert.equal(v.ok, true, v.failures.join(","));
  }
});

// ═══════════════════════════ every denial ═══════════════════════════════════
test("an uncommissioned terminal has no key to verify against", () => {
  const v = verifyBioEnvelope(sign(goodEnvelope()), expectation({ bioPubkeyPem: null }));
  assert.deepEqual(v.failures, ["NO_BIOMETRIC_KEY_REGISTERED"]);
});

test("a corrupt registered key denies instead of throwing", () => {
  const v = verifyBioEnvelope(sign(goodEnvelope()), expectation({ bioPubkeyPem: "not a pem" }));
  assert.deepEqual(v.failures, ["BIOMETRIC_KEY_UNREADABLE"]);
});

test("a score edited after signing breaks the signature", () => {
  const signed = sign(goodEnvelope({ faceScoreBp: 3000 }));
  signed.envelope.faceScoreBp = 9900; // the tempting one-character change
  const v = verifyBioEnvelope(signed, expectation());
  assert.equal(v.ok, false);
  assert.ok(v.failures.includes("BIOMETRIC_SIGNATURE_INVALID"));
});

test("another terminal's daemon key does not speak for this terminal", () => {
  const other = generateKeyPairSync("ed25519");
  const v = verifyBioEnvelope(sign(goodEnvelope(), other.privateKey), expectation());
  assert.equal(v.ok, false);
  assert.ok(v.failures.includes("BIOMETRIC_SIGNATURE_INVALID"));
});

test("an envelope captured at a different station is refused", () => {
  const v = verifyBioEnvelope(
    sign(goodEnvelope({ terminalId: "99999999-9999-9999-9999-999999999999" })),
    expectation(),
  );
  assert.equal(v.ok, false);
  assert.ok(v.failures.includes("BIOMETRIC_TERMINAL_MISMATCH"));
});

test("a capture from an earlier login attempt is refused (nonce)", () => {
  const v = verifyBioEnvelope(sign(goodEnvelope({ nonce: "b".repeat(64) })), expectation());
  assert.equal(v.ok, false);
  assert.ok(v.failures.includes("BIOMETRIC_NONCE_MISMATCH"));
});

test("a stale or future-dated capture is refused", () => {
  const old = verifyBioEnvelope(sign(goodEnvelope({ capturedAt: NOW - 60_000 })), expectation());
  assert.ok(old.failures.includes("BIOMETRIC_CAPTURE_STALE"));

  const future = verifyBioEnvelope(sign(goodEnvelope({ capturedAt: NOW + 60_000 })), expectation());
  assert.ok(future.failures.includes("BIOMETRIC_CAPTURE_STALE"));

  // Ordinary clock skew between the daemon and the Edge stays usable.
  const skewed = verifyBioEnvelope(sign(goodEnvelope({ capturedAt: NOW + 400 })), expectation());
  assert.equal(skewed.ok, true, skewed.failures.join(","));
});

test("scores that are not whole basis points in [0,10000] are refused, NaN included", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 9400.5, -1, 10001, "9400" as unknown as number]) {
    const v = verifyBioEnvelope(sign(goodEnvelope({ faceScoreBp: bad })), expectation());
    assert.equal(v.ok, false, `faceScoreBp ${String(bad)} must not pass`);
    assert.ok(v.failures.includes("BIOMETRIC_SCORES_MALFORMED"));
  }
});

test("a non-hex or empty signature denies", () => {
  for (const sig of ["", "zzzz", "0x"]) {
    const v = verifyBioEnvelope({ envelope: goodEnvelope(), sig }, expectation());
    assert.equal(v.ok, false);
    assert.ok(v.failures.includes("BIOMETRIC_SIGNATURE_INVALID"));
  }
});
