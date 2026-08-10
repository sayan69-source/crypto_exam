/**
 * The committed demo keypair is the one the demo actually deploys — prove it
 * works, with the real files, not a keypair minted inside the test.
 *
 * Everything else about §11 is already covered (envelope.test.ts,
 * hq-vault.unit.test.ts, …) using freshly generated keys. That proves the
 * ALGORITHM. It does not prove that the PEM the image bakes in and the PEM the
 * System Admin portal reads are two halves of the same key, that they are the
 * right encodings, or that the Edge's config loader can even find them. Those
 * are exactly the things that were broken: a public PEM sat in the repo with no
 * matching private half and no file referencing it, so every terminal got
 * SEALING_KEY_NOT_PROVISIONED and the whole answer pipeline was unreachable.
 *
 * This test fails if the keypair is regenerated as a mismatched pair, if either
 * file is moved, if the private half ever leaks into the centre-side artifacts,
 * or if the config loader stops honouring the `_FILE` form the deployments use.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ensureDemoKeypair } from "../../../hq-demo-key/ensure-keys.mjs";
import { loadConfig } from "../config.ts";
import { ingest, type SyncBundle, type ExportRecord } from "../hq/vault.ts";
import { GENESIS, nextRoot } from "../lib/merkle-chain.ts";
import { makeNodeSigner } from "../lib/node-sign.ts";
import { sha256, toHex, utf8, canonicalJson } from "../lib/crypto.ts";
import { sealRecord, receiptNonce, type AnswerRecord } from "../../../exam-terminal/lib/answer-seal.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const KEYS = join(HERE, "..", "..", "..", "hq-demo-key");
const PUBLIC_PEM = join(KEYS, "hq-demo-public.pem");
const PRIVATE_PEM = join(KEYS, "hq-demo-private.pem");

// The keypair is gitignored, so on a fresh clone it does not exist yet. Create
// it the same way every other consumer does rather than skipping the tests —
// a suite that silently skips the answer pipeline is how it broke unnoticed.
ensureDemoKeypair();

const CENTRE = "11111111-1111-1111-1111-111111111111";
const EXAM = "44444444-4444-4444-4444-444444444444";

test("the demo keypair exists in the encodings the vault expects", () => {
  const pub = readFileSync(PUBLIC_PEM, "utf8");
  const priv = readFileSync(PRIVATE_PEM, "utf8");
  assert.match(pub, /^-----BEGIN PUBLIC KEY-----/, "public half must be SPKI");
  assert.match(priv, /^-----BEGIN PRIVATE KEY-----/, "private half must be PKCS#8");
});

test("the Edge loads the sealing key from SYSTEM_ADMIN_PUBLIC_KEY_PEM_FILE", () => {
  // A PEM is multi-line, so no deployment can pass it as a systemd
  // `Environment=` value or a plain `.env` line — the `_FILE` form is the only
  // one the image and compose stack can actually use.
  const prev = process.env.SYSTEM_ADMIN_PUBLIC_KEY_PEM_FILE;
  process.env.SYSTEM_ADMIN_PUBLIC_KEY_PEM_FILE = PUBLIC_PEM;
  try {
    const cfg = loadConfig();
    assert.ok(cfg.systemAdminPublicKeyPem, "config must resolve the key, else /api/exam/sealing-key 503s");
    assert.match(cfg.systemAdminPublicKeyPem, /^-----BEGIN PUBLIC KEY-----/);
  } finally {
    if (prev === undefined) delete process.env.SYSTEM_ADMIN_PUBLIC_KEY_PEM_FILE;
    else process.env.SYSTEM_ADMIN_PUBLIC_KEY_PEM_FILE = prev;
  }
});

test("a pointer to a missing key file fails loudly instead of silently disabling the pipeline", () => {
  const prev = process.env.SYSTEM_ADMIN_PUBLIC_KEY_PEM_FILE;
  process.env.SYSTEM_ADMIN_PUBLIC_KEY_PEM_FILE = join(KEYS, "does-not-exist.pem");
  try {
    assert.throws(() => loadConfig(), /unreadable/);
  } finally {
    if (prev === undefined) delete process.env.SYSTEM_ADMIN_PUBLIC_KEY_PEM_FILE;
    else process.env.SYSTEM_ADMIN_PUBLIC_KEY_PEM_FILE = prev;
  }
});

test("a terminal sealing to the deployed public key produces a bundle HQ can open", async () => {
  const pub = readFileSync(PUBLIC_PEM, "utf8");
  const priv = readFileSync(PRIVATE_PEM, "utf8");
  const signer = makeNodeSigner(new Uint8Array(32).fill(7));

  const record: AnswerRecord = {
    exam_id: EXAM,
    subject_ref: "seat:A-77",
    responses: [{ question_hash: "0x" + "ab".repeat(32), chosen_option: "B", answered_at_ms: 1234, revision_count: 1 }],
    timing: { started: "2026-06-10T03:30:00Z", submitted: "2026-06-10T06:00:00Z" },
    anomaly_summary: { tab_switch: 0, face_fail: 0, multi_face: 0 },
    receipt_nonce: receiptNonce(),
  };

  // Seal exactly as the candidate seat does, then chain + sign as the Edge does.
  const sealed = await sealRecord(record, pub);
  const root = nextRoot(GENESIS, sealed.leaf);
  const records: ExportRecord[] = [{
    examId: EXAM, seatNo: "A-77", leafIndex: 0,
    leaf: toHex(sealed.leaf), prevRoot: toHex(GENESIS), chainRoot: toHex(root),
    nodeRootSig: toHex(signer.signRoot(root)),
    ciphertext: toHex(sealed.ct), iv: toHex(sealed.iv),
    authTag: toHex(sealed.tag), wrappedDk: toHex(sealed.wrappedDk),
  }];
  const manifest = { centreId: CENTRE, count: 1, records, exportedAt: 1_700_000_000_000 };
  const manifestHash = sha256(utf8.encode(canonicalJson(manifest)));
  const bundle: SyncBundle = {
    manifest,
    manifestHash: toHex(manifestHash),
    nodeSig: toHex(signer.signRoot(manifestHash)),
    nodePubkey: toHex(signer.publicKey),
  };

  const result = ingest(bundle, priv, new Map([[CENTRE, signer.publicKey]]));
  assert.equal(result.decrypted.length, 1);
  const opened = result.decrypted[0];
  assert.ok(opened, "HQ decrypted nothing");
  assert.deepEqual(opened.record, record, "HQ must recover the exact record the seat sealed");
});

test("the centre-side artifacts never carry the private half (INV-6)", () => {
  // The property that makes a compromised centre yield only ciphertext is that
  // no centre-side file contains a private key. Assert it on the two artifacts
  // the image and the compose stack actually mount.
  const pub = readFileSync(PUBLIC_PEM, "utf8");
  assert.doesNotMatch(pub, /PRIVATE KEY/, "the Edge's key file must not contain a private key");

  const unitPath = join(HERE, "..", "..", "..", "zuup-os", "security", "allinone", "zuup-edge.service");
  const unit = readFileSync(unitPath, "utf8");
  assert.match(unit, /SYSTEM_ADMIN_PUBLIC_KEY_PEM_FILE=/, "the Edge unit must provision the sealing key");
  assert.doesNotMatch(unit, /HQ_PRIVATE_KEY_PEM/, "a centre unit must never reference the HQ private key");
});
