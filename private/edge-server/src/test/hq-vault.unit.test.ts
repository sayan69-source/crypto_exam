/**
 * Phase 10c — HQ vault ingest/decrypt/anchor, proven WITHOUT a database.
 *
 * `ingest()` is a pure function over a sync bundle: verify node sig → re-walk
 * chain → HSM-unwrap+open → emit no-PII anchors. This test builds a bundle in
 * memory exactly the way the Edge export endpoint does (terminal seal + rolling
 * Merkle root + node-signed manifest), then drives the full HQ path and the
 * tamper-rejection paths. It runs under plain `npm test` (no Docker).
 *
 * The DB-backed half (the /api/admin/ledger/export SQL) is covered separately
 * by src/test/integration/hq-vault.test.ts when a Postgres is available.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { ingest, assertNoPii, IngestError, type SyncBundle, type ExportRecord } from "../hq/vault.ts";
import { GENESIS, nextRoot } from "../lib/merkle-chain.ts";
import { makeNodeSigner } from "../lib/node-sign.ts";
import { sha256, toHex, utf8, canonicalJson } from "../lib/crypto.ts";
import { sealRecord, receiptNonce, type AnswerRecord } from "../../../exam-terminal/lib/answer-seal.ts";

const hq = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const signer = makeNodeSigner(new Uint8Array(32).fill(7));
const CENTRE = "11111111-1111-1111-1111-111111111111";
const EXAM = "44444444-4444-4444-4444-444444444444";

function rec(i: number): AnswerRecord {
  return {
    exam_id: EXAM,
    subject_ref: `seat:${i}`,
    responses: [{ question_hash: "0x" + "ab".repeat(32), chosen_option: "B", answered_at_ms: 1000 + i, revision_count: 0 }],
    timing: { started: "2026-06-10T03:30:00Z", submitted: "2026-06-10T06:00:00Z" },
    anomaly_summary: { tab_switch: 0, face_fail: 0, multi_face: 0 },
    receipt_nonce: receiptNonce(),
  };
}

/** Build a bundle the way the Edge export endpoint would, for `count` records. */
async function buildBundle(count: number): Promise<SyncBundle> {
  const records: ExportRecord[] = [];
  let prevRoot = GENESIS;
  for (let i = 0; i < count; i++) {
    const sealed = await sealRecord(rec(i), hq.publicKey);
    const root = nextRoot(prevRoot, sealed.leaf);
    records.push({
      examId: EXAM, seatNo: `S-${i}`, leafIndex: i,
      leaf: toHex(sealed.leaf), prevRoot: toHex(prevRoot), chainRoot: toHex(root),
      nodeRootSig: toHex(signer.signRoot(root)),
      ciphertext: toHex(sealed.ct), iv: toHex(sealed.iv),
      authTag: toHex(sealed.tag), wrappedDk: toHex(sealed.wrappedDk),
    });
    prevRoot = root;
  }
  const manifest = { centreId: CENTRE, count, records, exportedAt: 1_700_000_000_000 };
  const manifestHash = sha256(utf8.encode(canonicalJson(manifest)));
  return {
    manifest,
    manifestHash: toHex(manifestHash),
    nodeSig: toHex(signer.signRoot(manifestHash)),
    nodePubkey: toHex(signer.publicKey),
  };
}

test("HQ ingest verifies the node sig + chain, decrypts R, emits a PII-free anchor", async () => {
  const bundle = await buildBundle(3);
  const result = ingest(bundle, hq.privateKey);

  // every record decrypted back to its canonical R
  assert.equal(result.decrypted.length, 3);
  assert.deepEqual(
    result.decrypted.map((d) => (d.record as AnswerRecord).subject_ref).sort(),
    ["seat:0", "seat:1", "seat:2"],
  );

  // one exam → one anchor; root = the final chain root; count correct
  assert.equal(result.anchors.length, 1);
  const anchor = result.anchors[0]!;
  assert.equal(anchor.count, 3);
  assert.equal(anchor.answerRoot, bundle.manifest.records[2]!.chainRoot);
  // centre id is hashed, never raw
  assert.equal(anchor.centreIdHash, toHex(sha256(utf8.encode(CENTRE))));
  assert.ok(!JSON.stringify(anchor).includes(CENTRE));
  assert.doesNotThrow(() => assertNoPii(anchor));
});

test("HQ rejects a tampered ciphertext (manifest signature no longer matches)", async () => {
  const bundle = await buildBundle(2);
  const ct = bundle.manifest.records[0]!.ciphertext;
  bundle.manifest.records[0]!.ciphertext = (ct[0] === "0" ? "1" : "0") + ct.slice(1);
  assert.throws(() => ingest(bundle, hq.privateKey), (e) => e instanceof IngestError);
});

test("HQ rejects a tampered chain root with the node sig forged off the bad root", async () => {
  // Rebuild record[1] with a broken prevRoot but re-sign the manifest, so the
  // ONLY thing wrong is the internal chain link — proves the chain re-walk, not
  // just the manifest signature, is load-bearing (INV-9).
  const bundle = await buildBundle(3);
  bundle.manifest.records[1]!.prevRoot = toHex(new Uint8Array(32).fill(0xee));
  const manifestHash = sha256(utf8.encode(canonicalJson(bundle.manifest)));
  bundle.manifestHash = toHex(manifestHash);
  bundle.nodeSig = toHex(signer.signRoot(manifestHash));
  assert.throws(() => ingest(bundle, hq.privateKey), (e) => /CHAIN_BROKEN/.test((e as Error).message));
});

test("HQ rejects the wrong HSM key (RSA-OAEP unwrap fails)", async () => {
  const bundle = await buildBundle(1);
  const { privateKey: wrong } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  assert.throws(() => ingest(bundle, wrong));
});

test("assertNoPii throws when an anchor field smells like an identifier", () => {
  assert.throws(
    () => assertNoPii({ centreIdHash: "ab", examId: "roll-of-thunder", answerRoot: "cd", count: 1, nodePubkey: "ef" }),
    (e) => e instanceof IngestError,
  );
});
