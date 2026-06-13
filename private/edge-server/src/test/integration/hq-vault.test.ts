/**
 * Phase 10c DoD — centre export → HQ ingest → HSM decrypt → no-PII anchor.
 *
 *   • The Centre Admin exports a signed, ciphertext-only sync bundle; rows go
 *     SEALED → SYNCED (idempotent re-export yields nothing).
 *   • HQ verifies the node signature + re-walks the chain, then opens each
 *     envelope with the HQ private key (HSM stand-in) → recovers R.
 *   • The anchor payload carries roots/counts/hashes only — assertNoPii passes
 *     (DPDP, §11.6); a forged bundle is rejected (INV-9 in transit + at rest).
 * Needs PostgreSQL; skipped without DATABASE_URL.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { makePool, type Pool } from "../../db.ts";
import { migrate } from "../../migrate.ts";
import { buildApp } from "../../http.ts";
import { issueToken } from "../../lib/token.ts";
import type { EdgeConfig } from "../../config.ts";
import { ingest, assertNoPii, IngestError, type SyncBundle } from "../../hq/vault.ts";
import { sealRecord, receiptNonce, type AnswerRecord } from "../../../../exam-terminal/lib/answer-seal.ts";

const DB = process.env.DATABASE_URL;
const skip = DB ? false : "set DATABASE_URL to run hq-vault tests";

const hq = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const config: EdgeConfig = {
  host: "127.0.0.1", port: 0, databaseUrl: DB ?? "", centreId: "test",
  provisioningKey: null,
  systemAdminPublicKeyPem: hq.publicKey,
  argon: { timeCost: 2, memoryCostKiB: 8192, parallelism: 1 },
  tokenSecret: new Uint8Array(32).fill(1),
  bindSecret: new Uint8Array(32).fill(2),
  nodeSignSeed: new Uint8Array(32).fill(9),
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

const adminToken = (centre: string, sub: string) =>
  issueToken(config.tokenSecret, { sub, tid: "s", tpm: "x", role: "CENTER_ADMIN", centre, exp: Date.now() + 3_600_000 });

async function seedAndSubmit(p: Pool, a: FastifyInstance, count: number) {
  const centreId = randomUUID();
  const examId = randomUUID();
  const adminId = randomUUID();
  await p.query(`INSERT INTO centers (id, name) VALUES ($1,'C')`, [centreId]);
  // window already closed → the §6 egress gate may open once all present
  // candidates have submitted (which they do below).
  await p.query(`INSERT INTO exams (id, name, scheduled_at, window_closes_at) VALUES ($1,'E',NOW() - INTERVAL '4 hours', NOW() - INTERVAL '1 hour')`, [examId]);
  await p.query(
    `INSERT INTO staff_identities (id, role, center_id, full_name, face_embedding_hash, fingerprint_template, status)
     VALUES ($1,'CENTER_ADMIN',$2,'A',$3,$3,'ACTIVE')`, [adminId, centreId, dummy]);

  const records: AnswerRecord[] = [];
  for (let i = 0; i < count; i++) {
    const terminalId = randomUUID();
    await p.query(
      `INSERT INTO terminals (id, center_id, seat_no, capability, wg_pubkey, state)
       VALUES ($1,$2,$3,'CANDIDATE_SEAT','wg','ATTENDED')`, [terminalId, centreId, `S-${i}`]);
    await p.query(
      `INSERT INTO seat_bindings (terminal_id, center_id, exam_id, candidate_roll, bound_by, bind_token, consumed_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())`, [terminalId, centreId, examId, `R-${i}`, adminId, dummy]);
    const record: AnswerRecord = {
      exam_id: examId, subject_ref: `seat:${i}`,
      responses: [{ question_hash: "0x" + "ab".repeat(32), chosen_option: "B", answered_at_ms: 1000 + i, revision_count: 0 }],
      timing: { started: "2026-06-10T03:30:00Z", submitted: "2026-06-10T06:00:00Z" },
      anomaly_summary: { tab_switch: 0, face_fail: 0, multi_face: 0 },
      receipt_nonce: receiptNonce(),
    };
    records.push(record);
    const sealed = await sealRecord(record, hq.publicKey);
    const r = await a.inject({
      method: "POST", url: "/api/answer/submit",
      payload: { terminalId, ct: toHexStr(sealed.ct), iv: toHexStr(sealed.iv), tag: toHexStr(sealed.tag), wrappedDk: toHexStr(sealed.wrappedDk) },
    });
    assert.equal(r.statusCode, 200);
  }
  return { centreId, examId, adminId, records };
}

test("Phase 10c: export → HQ ingest → decrypt R; anchor is PII-free; re-export is empty", { skip }, async () => {
  await migrate(DB!);
  pool = makePool(DB!);
  app = buildApp({ pool, config });

  const S = await seedAndSubmit(pool, app, 3);

  // §6 egress gate: window closed + all present candidates submitted → may open.
  const eg = J(await app.inject({
    method: "POST", url: "/api/admin/egress/open",
    headers: { authorization: `Bearer ${adminToken(S.centreId, S.adminId)}` },
    payload: { examId: S.examId },
  }));
  assert.equal(eg.ok, true, "egress opens after the window closes with no pending submissions");

  // Centre Admin exports the signed, ciphertext-only bundle for this exam.
  const out = J(await app.inject({
    method: "POST", url: "/api/admin/ledger/export",
    headers: { authorization: `Bearer ${adminToken(S.centreId, S.adminId)}` },
    payload: { examId: S.examId },
  }));
  assert.equal(out.exported, 3);
  const bundle = out.bundle as SyncBundle;

  // the bundle is ciphertext only — no plaintext answer leaked into it
  const raw = JSON.stringify(bundle).toLowerCase();
  assert.ok(!raw.includes("chosen_option"), "export must not contain plaintext answers");

  // HQ verifies + decrypts with the private key (HSM stand-in).
  const result = ingest(bundle, hq.privateKey);
  assert.equal(result.decrypted.length, 3);
  const recovered = result.decrypted.map((d) => (d.record as AnswerRecord).subject_ref).sort();
  assert.deepEqual(recovered, ["seat:0", "seat:1", "seat:2"]);

  // one exam → one anchor, PII-free, count correct.
  assert.equal(result.anchors.length, 1);
  const anchor = result.anchors[0]!;
  assert.equal(anchor.count, 3);
  assert.equal(anchor.examId, S.examId);
  assert.doesNotThrow(() => assertNoPii(anchor));
  // the raw centre id is NOT on the anchor — only its hash
  assert.ok(!JSON.stringify(anchor).includes(S.centreId));

  // rows are now SYNCED → a second export carries nothing.
  const again = J(await app.inject({
    method: "POST", url: "/api/admin/ledger/export",
    headers: { authorization: `Bearer ${adminToken(S.centreId, S.adminId)}` },
    payload: { examId: S.examId },
  }));
  assert.equal(again.exported, 0);
  assert.equal(again.bundle, null);
});

test("Phase 10c: HQ rejects a tampered bundle (node sig + chain)", { skip }, async () => {
  if (!pool || !app) { await migrate(DB!); pool = makePool(DB!); app = buildApp({ pool, config }); }
  const S = await seedAndSubmit(pool, app, 2);
  await app.inject({
    method: "POST", url: "/api/admin/egress/open",
    headers: { authorization: `Bearer ${adminToken(S.centreId, S.adminId)}` },
    payload: { examId: S.examId },
  });
  const out = J(await app.inject({
    method: "POST", url: "/api/admin/ledger/export",
    headers: { authorization: `Bearer ${adminToken(S.centreId, S.adminId)}` },
    payload: { examId: S.examId },
  }));
  const good = out.bundle as SyncBundle;

  // flip a byte in a ciphertext → manifest hash no longer matches the signature
  const tampered: SyncBundle = JSON.parse(JSON.stringify(good));
  const ct = tampered.manifest.records[0]!.ciphertext;
  tampered.manifest.records[0]!.ciphertext = (ct[0] === "0" ? "1" : "0") + ct.slice(1);
  assert.throws(() => ingest(tampered, hq.privateKey), (e) => e instanceof IngestError);

  // a wrong HQ key cannot open even an untampered bundle
  const { privateKey: wrong } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  assert.throws(() => ingest(good, wrong));
});
