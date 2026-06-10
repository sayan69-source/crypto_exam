/**
 * Phase 10 DoD — encrypted answer pipeline, end to end on the Edge (§11).
 *
 *   • A terminal-sealed envelope (WebCrypto impl) submits to /api/answer/submit;
 *     the Edge appends leaf→root, node-signs the root, stores CIPHERTEXT ONLY.
 *   • The receipt verifies: root == SHA-256(prevRoot‖leaf), Ed25519 sig valid.
 *   • INV-6: nothing the centre holds can open the envelope; HQ private key can.
 *   • INV-9: tampering a stored leaf breaks the re-walked chain.
 *   • Fail-closed guards: no submit on an unauthenticated seat; one submit per seat.
 * Needs PostgreSQL; skipped without DATABASE_URL.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { makePool, type Pool } from "../../db.ts";
import { migrate } from "../../migrate.ts";
import { buildApp } from "../../http.ts";
import type { EdgeConfig } from "../../config.ts";
import { open, type Sealed } from "../../lib/envelope.ts";
import { verifyChain, type ChainRecord } from "../../lib/merkle-chain.ts";
import { verifyRootSig } from "../../lib/node-sign.ts";
import { sha256, fromHex, fromUtf8, canonicalJson } from "../../lib/crypto.ts";
import { sealRecord, receiptNonce, type AnswerRecord } from "../../../../exam-terminal/lib/answer-seal.ts";

const DB = process.env.DATABASE_URL;
const skip = DB ? false : "set DATABASE_URL to run answer-pipeline tests";

const hq = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const config: EdgeConfig = {
  host: "127.0.0.1", port: 0, databaseUrl: DB ?? "", centreId: "test",
  systemAdminPublicKeyPem: hq.publicKey,
  argon: { timeCost: 2, memoryCostKiB: 8192, parallelism: 1 },
  tokenSecret: new Uint8Array(32).fill(1),
  bindSecret: new Uint8Array(32).fill(2),
  nodeSignSeed: new Uint8Array(32).fill(3),
};

let pool: Pool | null = null;
let app: FastifyInstance | null = null;
after(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
});
const J = (res: { payload: string }) => JSON.parse(res.payload);
const dummy = Buffer.from("aa".repeat(16), "hex");
const toHexStr = (b: Uint8Array) => Buffer.from(b).toString("hex");

async function seedSeat(p: Pool, state: string) {
  const centreId = randomUUID();
  const examId = randomUUID();
  const terminalId = randomUUID();
  const invigId = randomUUID();
  await p.query(`INSERT INTO centers (id, name) VALUES ($1,'C')`, [centreId]);
  await p.query(`INSERT INTO exams (id, name, scheduled_at) VALUES ($1,'E',NOW())`, [examId]);
  await p.query(
    `INSERT INTO staff_identities (id, role, center_id, full_name, face_embedding_hash, fingerprint_template, status)
     VALUES ($1,'CENTER_INVIGILATOR',$2,'I',$3,$3,'ACTIVE')`, [invigId, centreId, dummy]);
  await p.query(
    `INSERT INTO terminals (id, center_id, seat_no, capability, wg_pubkey, state)
     VALUES ($1,$2,'S-1','CANDIDATE_SEAT','wg',$3::terminal_state)`, [terminalId, centreId, state]);
  await p.query(
    `INSERT INTO seat_bindings (terminal_id, center_id, exam_id, candidate_roll, bound_by, bind_token, consumed_at)
     VALUES ($1,$2,$3,'R-1',$4,$5,NOW())`, [terminalId, centreId, examId, invigId, dummy]);
  return { centreId, examId, terminalId };
}

function makeRecord(examId: string): AnswerRecord {
  return {
    exam_id: examId,
    subject_ref: "R-1",
    responses: [{ question_hash: "0x" + "ab".repeat(32), chosen_option: "C", answered_at_ms: 1000, revision_count: 1 }],
    timing: { started: "2026-06-10T03:30:00Z", submitted: "2026-06-10T06:29:12Z" },
    anomaly_summary: { tab_switch: 0, face_fail: 0, multi_face: 0 },
    receipt_nonce: receiptNonce(),
  };
}

test("Phase 10: submit → ciphertext-only ledger row, verifiable signed receipt; HQ opens", { skip }, async () => {
  await migrate(DB!);
  pool = makePool(DB!);
  app = buildApp({ pool, config });

  const S = await seedSeat(pool, "ATTENDED");
  const record = makeRecord(S.examId);
  const sealed = await sealRecord(record, hq.publicKey);

  const res = await app.inject({
    method: "POST", url: "/api/answer/submit",
    payload: {
      terminalId: S.terminalId,
      ct: toHexStr(sealed.ct), iv: toHexStr(sealed.iv),
      tag: toHexStr(sealed.tag), wrappedDk: toHexStr(sealed.wrappedDk),
    },
  });
  assert.equal(res.statusCode, 200);
  const { receipt } = J(res);

  // receipt witness: root == SHA-256(prevRoot ‖ leaf), leaf is the Edge-recomputed one
  assert.equal(receipt.leaf, toHexStr(sealed.leaf), "edge must recompute the same leaf");
  const expectRoot = sha256(fromHex(receipt.prevRoot), fromHex(receipt.leaf));
  assert.equal(receipt.root, toHexStr(expectRoot));
  // node-signed root verifies with the published key (TPM_sign stand-in)
  assert.ok(verifyRootSig(fromHex(receipt.nodePubkey), fromHex(receipt.root), fromHex(receipt.nodeRootSig)));

  // the seat is now SUBMITTED and refuses a second envelope
  const again = await app.inject({
    method: "POST", url: "/api/answer/submit",
    payload: { terminalId: S.terminalId, ct: "00", iv: "00", tag: "00", wrappedDk: "00" },
  });
  assert.equal(again.statusCode, 409);

  // INV-6: the stored row is ciphertext + hashes; the centre cannot open it,
  // the HQ private key can — and recovers the exact canonical record.
  const row = (await pool.query(`SELECT * FROM answer_ledger WHERE center_id=$1`, [S.centreId])).rows[0];
  const stored: Sealed = {
    ct: new Uint8Array(row.ciphertext), iv: new Uint8Array(row.iv),
    tag: new Uint8Array(row.auth_tag), wrappedDk: new Uint8Array(row.wrapped_dk),
    leaf: new Uint8Array(row.leaf_hash),
  };
  const cols = Object.keys(row);
  assert.ok(!cols.some((c) => /priv|secret|decrypt/i.test(c)), "no key-material column may exist (INV-6)");
  assert.equal(fromUtf8.decode(open(stored, hq.privateKey)), canonicalJson(record));

  // the receipt re-fetch endpoint agrees and reports the chain valid
  const re = J(await app.inject({ method: "GET", url: `/api/answer/receipt/${receipt.leaf}` }));
  assert.equal(re.root, receipt.root);
  assert.equal(re.chainValid, true);
});

test("INV-9: tampering a stored ledger leaf breaks the re-walked chain", { skip }, async () => {
  if (!pool || !app) { await migrate(DB!); pool = makePool(DB!); app = buildApp({ pool, config }); }
  const S = await seedSeat(pool, "ATTENDED");

  // three honest submissions on three seats of one exam chain
  for (let i = 0; i < 3; i++) {
    const sealed = await sealRecord(makeRecord(S.examId), hq.publicKey);
    const payload = {
      terminalId: S.terminalId,
      ct: toHexStr(sealed.ct), iv: toHexStr(sealed.iv),
      tag: toHexStr(sealed.tag), wrappedDk: toHexStr(sealed.wrappedDk),
    };
    // re-arm the same seat for the demo chain (state back to ATTENDED)
    await pool.query(`UPDATE terminals SET state='ATTENDED' WHERE id=$1`, [S.terminalId]);
    const r: { statusCode: number } = await app!.inject({ method: "POST", url: "/api/answer/submit", payload });
    assert.equal(r.statusCode, 200);
  }

  const readChain = async (): Promise<ChainRecord[]> =>
    (await pool!.query(
      `SELECT leaf_index, leaf_hash, prev_root, chain_root FROM answer_ledger
        WHERE center_id=$1 AND exam_id=$2 ORDER BY leaf_index`,
      [S.centreId, S.examId],
    )).rows.map((row: { leaf_index: unknown; leaf_hash: Buffer; prev_root: Buffer; chain_root: Buffer }) => ({
      index: Number(row.leaf_index),
      leaf: new Uint8Array(row.leaf_hash),
      prevRoot: new Uint8Array(row.prev_root),
      root: new Uint8Array(row.chain_root),
    }));

  assert.equal((await readChain()).length, 3);
  assert.deepEqual(verifyChain(await readChain()), { ok: true, brokenAt: null });

  // a malicious centre edits the middle leaf — detection is immediate
  await pool.query(
    `UPDATE answer_ledger SET leaf_hash=$3 WHERE center_id=$1 AND leaf_index=1 AND exam_id=$2`,
    [S.centreId, S.examId, Buffer.from("ee".repeat(32), "hex")],
  );
  const verdict = verifyChain(await readChain());
  assert.equal(verdict.ok, false);
  assert.equal(verdict.brokenAt, 1);
});

test("fail-closed: an AVAILABLE seat (no authenticated candidate) cannot submit", { skip }, async () => {
  if (!pool || !app) { await migrate(DB!); pool = makePool(DB!); app = buildApp({ pool, config }); }
  const S = await seedSeat(pool, "AVAILABLE");
  const sealed = await sealRecord(makeRecord(S.examId), hq.publicKey);
  const res = await app.inject({
    method: "POST", url: "/api/answer/submit",
    payload: {
      terminalId: S.terminalId,
      ct: toHexStr(sealed.ct), iv: toHexStr(sealed.iv),
      tag: toHexStr(sealed.tag), wrappedDk: toHexStr(sealed.wrappedDk),
    },
  });
  assert.equal(res.statusCode, 409);
  const held = await pool.query(`SELECT count(*) n FROM answer_ledger WHERE center_id=$1`, [S.centreId]);
  assert.equal(Number(held.rows[0].n), 0);
});
