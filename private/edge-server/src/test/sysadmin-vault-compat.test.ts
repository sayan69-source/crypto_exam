/**
 * Cross-implementation proof for the System Admin portal's vault (§11.4).
 *
 * The portal's `lib/vault.ts` is a self-contained reimplementation of the HQ
 * ingest (no Edge imports — the HQ app must never grow a dependency path into
 * centre code). Like `seal-compat.test.ts` for the terminal's WebCrypto sealer,
 * this test pins the two implementations to the same bytes: a bundle built
 * with the Edge's own seal + chain + node-sign must ingest identically through
 * BOTH `hq/vault.ts` and the portal's `ingestBundle`, and every tamper path
 * must refuse before any decrypt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { ingest, type SyncBundle, type ExportRecord } from "../hq/vault.ts";
import { sealRecord } from "../lib/envelope.ts";
import { GENESIS, nextRoot } from "../lib/merkle-chain.ts";
import { makeNodeSigner } from "../lib/node-sign.ts";
import { sha256, toHex, utf8, canonicalJson } from "../lib/crypto.ts";
import {
  ingestBundle,
  canonicalJson as portalCanonicalJson,
} from "../../../system-admin/lib/vault.ts";

const hq = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const signer = makeNodeSigner(new Uint8Array(32).fill(9));
const CENTRE = "11111111-1111-1111-1111-111111111111";
const EXAM = "44444444-4444-4444-4444-444444444444";

// §11.2 record R: the questions travel WITH the responses inside the seal.
const rec = (i: number) => ({
  exam_id: EXAM,
  subject_ref: `seat:${i}`,
  responses: [
    {
      question_hash: "0x" + "ab".repeat(32),
      question_text: `Q${i}: sample stem`,
      chosen_option: "B",
      answered_at_ms: 1000 + i,
      revision_count: 0,
    },
  ],
  timing: { started: "2026-06-10T03:30:00Z", submitted: "2026-06-10T06:00:00Z" },
});

function buildBundle(count: number): SyncBundle {
  const records: ExportRecord[] = [];
  let prevRoot = GENESIS;
  for (let i = 0; i < count; i++) {
    const sealed = sealRecord(rec(i), hq.publicKey);
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

test("portal vault ingests an Edge-built bundle and matches hq/vault.ts exactly", () => {
  const bundle = buildBundle(3);

  const edgeResult = ingest(structuredClone(bundle), hq.privateKey);
  const portalResult = ingestBundle(structuredClone(bundle), hq.privateKey);

  assert.equal(portalResult.ok, true);
  assert.ok(portalResult.steps.every((s) => s.ok), "every verification step passed");

  // identical decrypts (records carry their questions, §11.2)
  assert.equal(portalResult.decrypted.length, 3);
  assert.deepEqual(
    portalResult.decrypted.map((d) => d.record),
    edgeResult.decrypted.map((d) => d.record),
  );
  const r0 = portalResult.decrypted[0]!.record as ReturnType<typeof rec>;
  assert.equal(r0.responses[0]!.question_text, "Q0: sample stem");

  // identical anchors (no PII, same final root)
  assert.deepEqual(portalResult.anchors, edgeResult.anchors);
  assert.equal(portalResult.centreIdHash, edgeResult.centreIdHash);
});

test("canonical JSON byte-agreement between the two implementations", () => {
  const value = { z: 1, a: [{ y: 2, b: null }], nested: { q: [3, { p: "x" }] } };
  assert.equal(portalCanonicalJson(value), canonicalJson(value));
});

test("portal vault refuses a tampered ciphertext at MANIFEST_HASH — zero decrypts", () => {
  const bundle = buildBundle(2);
  const ct = bundle.manifest.records[0]!.ciphertext;
  bundle.manifest.records[0]!.ciphertext = (ct[0] === "0" ? "1" : "0") + ct.slice(1);
  const r = ingestBundle(bundle, hq.privateKey);
  assert.equal(r.ok, false);
  assert.equal(r.refusedBy, "MANIFEST_HASH");
  assert.equal(r.decrypted.length, 0);
});

test("portal vault refuses a broken chain even with a re-signed manifest (INV-9)", () => {
  const bundle = buildBundle(3);
  bundle.manifest.records[1]!.prevRoot = toHex(new Uint8Array(32).fill(0xee));
  const manifestHash = sha256(utf8.encode(canonicalJson(bundle.manifest)));
  bundle.manifestHash = toHex(manifestHash);
  bundle.nodeSig = toHex(signer.signRoot(manifestHash));
  const r = ingestBundle(bundle, hq.privateKey);
  assert.equal(r.ok, false);
  assert.equal(r.refusedBy, "CHAIN_WALK");
  assert.equal(r.decrypted.length, 0);
});

test("portal vault refuses the wrong HSM key — zero decrypts survive", () => {
  const bundle = buildBundle(1);
  const { privateKey: wrong } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const r = ingestBundle(bundle, wrong);
  assert.equal(r.ok, false);
  assert.equal(r.refusedBy, "HSM_DECRYPT");
  assert.equal(r.decrypted.length, 0);
});

test("portal vault refuses a forged node signature", () => {
  const bundle = buildBundle(1);
  const forged = makeNodeSigner(new Uint8Array(32).fill(13)); // not the centre's key
  bundle.nodeSig = toHex(forged.signRoot(sha256(utf8.encode(canonicalJson(bundle.manifest)))));
  const r = ingestBundle(bundle, hq.privateKey);
  assert.equal(r.ok, false);
  assert.equal(r.refusedBy, "NODE_SIGNATURE");
  assert.equal(r.decrypted.length, 0);
});
