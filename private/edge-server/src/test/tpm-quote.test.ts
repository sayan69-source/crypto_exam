/**
 * TPM quote verification (§7.1).
 *
 * Every case here is an attack that the previous implementation — a
 * `JSON.stringify` comparison of PCR values — would have waved through, plus the
 * two "uncommissioned" states the estate actually shipped in.
 *
 * The quotes are built by hand (helpers/commissioning.ts) and signed with a
 * generated key rather than read from a TPM, so the suite runs on any machine.
 * What that costs is the assurance that a REAL tpm2_quote lands in the same byte
 * layout; what it buys is that the parser and every failure clause are exercised
 * on every commit. The layout is pinned to TPM 2.0 Library Part 2 §10.12.8.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as cryptoSign, createPrivateKey } from "node:crypto";
import { parseQuote, verifyQuote, QuoteParseError, type QuoteSubmission } from "../lib/tpm-quote.ts";
import { fromHex } from "../lib/crypto.ts";
import {
  GOLDEN_INDICES,
  buildQuote,
  goldenPcrSet,
  pcrValue,
  signQuote as signWithKey,
} from "./helpers/commissioning.ts";

const rsaAk = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ecAk = generateKeyPairSync("ec", { namedCurve: "P-256" });

const signQuote = (quote: Uint8Array, key = rsaAk.privateKey): Uint8Array => signWithKey(quote, key);

function submission(nonce: Uint8Array, pcrs: Record<string, string>, selected?: number[]): QuoteSubmission {
  const quote = buildQuote({ nonce, pcrs, selected });
  return { quote, signature: signQuote(quote), pcrs };
}

const NONCE = new Uint8Array(32).fill(7);
const akPem = rsaAk.publicKey.export({ type: "spki", format: "pem" }).toString();

// ════════════════════════════ the happy path ════════════════════════════════
test("a genuine quote over the golden PCRs verifies", () => {
  const pcrs = goldenPcrSet();
  const v = verifyQuote(submission(NONCE, pcrs), {
    akPubkeyPem: akPem,
    nonce: NONCE,
    goldenPcr: pcrs,
  });
  assert.deepEqual(v.failures, []);
  assert.equal(v.ok, true);
  assert.deepEqual(v.selectedPcrs, GOLDEN_INDICES);
});

test("an ECDSA attestation key verifies too (tpm2_createak -G ecc)", () => {
  const pcrs = goldenPcrSet();
  const quote = buildQuote({ nonce: NONCE, pcrs });
  const v = verifyQuote(
    { quote, signature: signQuote(quote, ecAk.privateKey), pcrs },
    {
      akPubkeyPem: ecAk.publicKey.export({ type: "spki", format: "pem" }).toString(),
      nonce: NONCE,
      goldenPcr: pcrs,
    },
  );
  assert.equal(v.ok, true, v.failures.join(","));
});

test("PCR values are read leniently (0x prefix, upper case) but never loosely", () => {
  const pcrs = goldenPcrSet();
  const decorated = Object.fromEntries(
    Object.entries(pcrs).map(([k, v]) => [k, `0x${v.toUpperCase()}`]),
  );
  // The quote digest is over the real bytes; only the registry/report form differs.
  const sub = submission(NONCE, pcrs);
  const v = verifyQuote({ ...sub, pcrs: decorated }, {
    akPubkeyPem: akPem, nonce: NONCE, goldenPcr: decorated,
  });
  assert.equal(v.ok, true, v.failures.join(","));

  // A 63-character "digest" is not a digest.
  const short = { ...pcrs, "4": pcrs["4"]!.slice(0, 63) };
  const bad = verifyQuote({ ...sub, pcrs: short }, {
    akPubkeyPem: akPem, nonce: NONCE, goldenPcr: short,
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.failures.includes("GOLDEN_PCR_4_MALFORMED"));
});

// ═══════════════════ the states the estate actually shipped in ══════════════
test("an uncommissioned terminal cannot attest — no golden set is a denial, not a pass", () => {
  const pcrs = goldenPcrSet();
  const v = verifyQuote(submission(NONCE, pcrs), {
    akPubkeyPem: akPem, nonce: NONCE, goldenPcr: null,
  });
  assert.equal(v.ok, false);
  assert.deepEqual(v.failures, ["NO_GOLDEN_PCR_REGISTERED"]);
});

test("a terminal with no registered AK cannot attest", () => {
  const pcrs = goldenPcrSet();
  const v = verifyQuote(submission(NONCE, pcrs), {
    akPubkeyPem: "", nonce: NONCE, goldenPcr: pcrs,
  });
  assert.equal(v.ok, false);
  assert.deepEqual(v.failures, ["NO_ATTESTATION_KEY_REGISTERED"]);
});

test("a corrupt registered key denies instead of throwing", () => {
  const pcrs = goldenPcrSet();
  const v = verifyQuote(submission(NONCE, pcrs), {
    akPubkeyPem: "-----BEGIN PUBLIC KEY-----\nnot a key\n-----END PUBLIC KEY-----",
    nonce: NONCE, goldenPcr: pcrs,
  });
  assert.equal(v.ok, false);
  assert.deepEqual(v.failures, ["ATTESTATION_KEY_UNREADABLE"]);
});

// ════════════════════════════ the attacks ═══════════════════════════════════
test("PCR values copied off another terminal do not attest (no AK signature)", () => {
  // The whole point of the old scheme's weakness: the values are public.
  const pcrs = goldenPcrSet();
  const impostor = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const quote = buildQuote({ nonce: NONCE, pcrs });
  const v = verifyQuote(
    { quote, signature: signQuote(quote, impostor.privateKey), pcrs },
    { akPubkeyPem: akPem, nonce: NONCE, goldenPcr: pcrs },
  );
  assert.equal(v.ok, false);
  assert.ok(v.failures.includes("QUOTE_SIGNATURE_INVALID"));
});

test("yesterday's good quote is not today's — the nonce is one-shot", () => {
  const pcrs = goldenPcrSet();
  const captured = submission(new Uint8Array(32).fill(1), pcrs);
  const v = verifyQuote(captured, {
    akPubkeyPem: akPem,
    nonce: NONCE, // the Edge issued a different nonce this time
    goldenPcr: pcrs,
  });
  assert.equal(v.ok, false);
  assert.ok(v.failures.includes("QUOTE_NONCE_MISMATCH"));
});

test("a tampered boot chain fails on both the digest and the value", () => {
  const golden = goldenPcrSet();
  const measured = { ...golden, "4": pcrValue(4, "rootkit") }; // kernel measurement changed
  const sub = submission(NONCE, measured); // the TPM honestly quotes what it measured
  const v = verifyQuote(sub, { akPubkeyPem: akPem, nonce: NONCE, goldenPcr: golden });
  assert.equal(v.ok, false);
  assert.ok(v.failures.includes("PCR_4_MISMATCH"));
});

test("reporting golden values while quoting tampered ones fails the digest", () => {
  const golden = goldenPcrSet();
  const measured = { ...golden, "8": pcrValue(8, "tampered") };
  // Quote commits to the tampered measurement; the submitted list claims golden.
  const quote = buildQuote({ nonce: NONCE, pcrs: measured });
  const v = verifyQuote(
    { quote, signature: signQuote(quote), pcrs: golden },
    { akPubkeyPem: akPem, nonce: NONCE, goldenPcr: golden },
  );
  assert.equal(v.ok, false);
  assert.ok(v.failures.includes("QUOTE_PCR_DIGEST_MISMATCH"));
});

test("quoting fewer PCRs than commissioned is refused", () => {
  const golden = goldenPcrSet();
  // Only PCR 0 — says nothing about the kernel, initrd or secure-boot state.
  const v = verifyQuote(submission(NONCE, golden, [0]), {
    akPubkeyPem: akPem, nonce: NONCE, goldenPcr: golden,
  });
  assert.equal(v.ok, false);
  assert.ok(v.failures.includes("QUOTE_PCR_SELECTION_MISMATCH"));
});

test("a structure that is not a TPM quote is refused before anything is believed", () => {
  const pcrs = goldenPcrSet();
  for (const bad of [
    buildQuote({ nonce: NONCE, pcrs, magic: 0xdeadbeef }),
    buildQuote({ nonce: NONCE, pcrs, type: 0x8017 }), // ATTEST_SESSION_AUDIT
  ]) {
    const v = verifyQuote({ quote: bad, signature: signQuote(bad), pcrs }, {
      akPubkeyPem: akPem, nonce: NONCE, goldenPcr: pcrs,
    });
    assert.equal(v.ok, false);
    assert.ok(v.failures.includes("QUOTE_MALFORMED"));
  }
});

test("a truncated quote cannot run the parser off the end", () => {
  const pcrs = goldenPcrSet();
  const full = buildQuote({ nonce: NONCE, pcrs });
  for (let cut = 1; cut < full.length; cut += 7) {
    const short = full.subarray(0, cut);
    assert.throws(() => parseQuote(short), QuoteParseError, `offset ${cut} should not parse`);
    // …and through the public entry point it is a denial, never a throw.
    const v = verifyQuote({ quote: short, signature: signQuote(short), pcrs }, {
      akPubkeyPem: akPem, nonce: NONCE, goldenPcr: pcrs,
    });
    assert.equal(v.ok, false);
  }
});

test("a garbage signature denies rather than throwing out of OpenSSL", () => {
  const pcrs = goldenPcrSet();
  const quote = buildQuote({ nonce: NONCE, pcrs });
  const v = verifyQuote({ quote, signature: new Uint8Array([1, 2, 3]), pcrs }, {
    akPubkeyPem: akPem, nonce: NONCE, goldenPcr: pcrs,
  });
  assert.equal(v.ok, false);
  assert.ok(v.failures.includes("QUOTE_SIGNATURE_INVALID"));
});

test("DER-encoded ECDSA signatures are accepted as well as raw r‖s", () => {
  const pcrs = goldenPcrSet();
  const quote = buildQuote({ nonce: NONCE, pcrs });
  const der = new Uint8Array(
    cryptoSign("sha256", Buffer.from(quote), {
      key: createPrivateKey(ecAk.privateKey.export({ type: "pkcs8", format: "pem" })),
      dsaEncoding: "der",
    }),
  );
  const v = verifyQuote({ quote, signature: der, pcrs }, {
    akPubkeyPem: ecAk.publicKey.export({ type: "spki", format: "pem" }).toString(),
    nonce: NONCE,
    goldenPcr: pcrs,
  });
  assert.equal(v.ok, true, v.failures.join(","));
});
