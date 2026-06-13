/**
 * §6 post-exam egress gate + §10.7 question delivery, end to end over the HTTP
 * API. Proves the two properties the requirement calls out:
 *
 *  A. The Centre Admin CANNOT forward anything to HQ — the centre internet
 *     stays shut — until the window has closed AND every present candidate has
 *     submitted. Premature export/open is refused (409) and audited.
 *  B. The keyless question bundle is served to a bound seat and verifies against
 *     its root, but the T₀ beacon is withheld (425) until t0_at — so the paper
 *     is undecryptable before the synchronized start.
 *
 * Needs PostgreSQL; skipped without DATABASE_URL.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { makePool, type Pool } from "../../db.ts";
import { migrate } from "../../migrate.ts";
import { buildApp } from "../../http.ts";
import { issueToken } from "../../lib/token.ts";
import { sealExam, deriveMasterSeed } from "../../lib/question-seal.ts";
import type { EdgeConfig } from "../../config.ts";

const DB = process.env.DATABASE_URL;
const skip = DB ? false : "set DATABASE_URL to run egress/delivery tests";
const config: EdgeConfig = {
  host: "127.0.0.1", port: 0, databaseUrl: DB ?? "", centreId: "test", provisioningKey: null, systemAdminPublicKeyPem: null,
  argon: { timeCost: 2, memoryCostKiB: 8192, parallelism: 1 },
  tokenSecret: new Uint8Array(32).fill(1), bindSecret: new Uint8Array(32).fill(2), nodeSignSeed: new Uint8Array(32).fill(3),
};
let pool: Pool | null = null;
let app: FastifyInstance | null = null;
after(async () => { if (app) await app.close(); if (pool) await pool.end(); });

const J = (r: { payload: string }) => JSON.parse(r.payload);
const dummy = Buffer.from("aa".repeat(32), "hex");
const adminTok = (centre: string, sub: string) =>
  issueToken(config.tokenSecret, { sub, tid: randomUUID(), tpm: "x", role: "CENTER_ADMIN", centre, exp: Date.now() + 3_600_000 });

test("§6 egress gate: blocks while the window is open / submissions pending; opens after", { skip }, async () => {
  await migrate(DB!);
  pool = makePool(DB!);
  app = buildApp({ pool, config });

  const centreId = randomUUID(), examId = randomUUID(), adminId = randomUUID();
  await pool.query(`INSERT INTO centers (id,name) VALUES ($1,'C')`, [centreId]);
  // window still OPEN (closes in the future)
  await pool.query(`INSERT INTO exams (id,name,scheduled_at,window_closes_at) VALUES ($1,'E',NOW()-INTERVAL '10 min',NOW()+INTERVAL '2 hours')`, [examId]);
  await pool.query(
    `INSERT INTO staff_identities (id,role,center_id,full_name,face_embedding_hash,fingerprint_template,status)
     VALUES ($1,'CENTER_ADMIN',$2,'A',$3,$3,'ACTIVE')`, [adminId, centreId, dummy]);
  // two PRESENT candidates, none submitted yet
  for (let i = 0; i < 2; i++) {
    const u = (await pool.query(`INSERT INTO users (role,full_name) VALUES ('CANDIDATE',$1) RETURNING id`, [`C${i}`])).rows[0].id;
    await pool.query(`INSERT INTO enrollments (candidate_id,exam_id,center_id,roll_number,status) VALUES ($1,$2,$3,$4,'PRESENT')`, [u, examId, centreId, `R-${i}`]);
  }
  const tok = adminTok(centreId, adminId);

  // window OPEN → refused
  const open1 = await app.inject({ method: "POST", url: "/api/admin/egress/open", headers: { authorization: `Bearer ${tok}` }, payload: { examId } });
  assert.equal(open1.statusCode, 409);
  assert.equal(J(open1).reason, "EXAM_WINDOW_OPEN");

  // export is also refused while egress is shut
  const exp1 = await app.inject({ method: "POST", url: "/api/admin/ledger/export", headers: { authorization: `Bearer ${tok}` }, payload: { examId } });
  assert.equal(exp1.statusCode, 409);
  assert.equal(J(exp1).reason, "EGRESS_NOT_OPEN");

  // close the window, but submissions still pending (2 present, 0 submitted)
  await pool.query(`UPDATE exams SET window_closes_at = NOW() - INTERVAL '1 min' WHERE id=$1`, [examId]);
  const open2 = await app.inject({ method: "POST", url: "/api/admin/egress/open", headers: { authorization: `Bearer ${tok}` }, payload: { examId } });
  assert.equal(open2.statusCode, 409);
  assert.equal(J(open2).reason, "SUBMISSIONS_PENDING");
  assert.equal(J(open2).pending, 2);

  // both candidates submit → ledger has 2 rows for this exam
  for (let i = 0; i < 2; i++) {
    await pool.query(
      `INSERT INTO answer_ledger (center_id,exam_id,seat_no,leaf_index,leaf_hash,prev_root,chain_root,node_root_sig,ciphertext,iv,auth_tag,wrapped_dk)
       VALUES ($1,$2,$3,$4,$5,$5,$5,$5,$5,$5,$5,$5)`,
      [centreId, examId, `S-${i}`, i, dummy],
    );
  }
  const status = J(await app.inject({ method: "GET", url: `/api/admin/egress/status?examId=${examId}`, headers: { authorization: `Bearer ${tok}` } }));
  assert.equal(status.pendingCount, 0);
  assert.equal(status.mayOpen, true);

  // now egress opens
  const open3 = J(await app.inject({ method: "POST", url: "/api/admin/egress/open", headers: { authorization: `Bearer ${tok}` }, payload: { examId } }));
  assert.equal(open3.ok, true);

  // audit recorded the denials AND the open (the gate is tamper-evident)
  const actions = (await pool.query(
    `SELECT action FROM secure_audit_log WHERE center_id=$1 AND action LIKE 'EGRESS%' ORDER BY seq`, [centreId],
  )).rows.map((r) => r.action);
  assert.deepEqual(actions, ["EGRESS_OPEN_DENIED", "EGRESS_OPEN_DENIED", "EGRESS_OPENED"]);
});

test("§10.7 delivery: bound seat gets the keyless bundle; beacon withheld until T₀", { skip }, async () => {
  if (!pool || !app) { await migrate(DB!); pool = makePool(DB!); app = buildApp({ pool, config }); }
  const centreId = randomUUID(), examId = randomUUID(), adminId = randomUUID();
  const seat = randomUUID(), otherSeat = randomUUID();
  await pool.query(`INSERT INTO centers (id,name) VALUES ($1,'C')`, [centreId]);
  await pool.query(`INSERT INTO exams (id,name,scheduled_at) VALUES ($1,'E',NOW())`, [examId]);
  await pool.query(`INSERT INTO staff_identities (id,role,center_id,full_name,face_embedding_hash,fingerprint_template,status) VALUES ($1,'CENTER_ADMIN',$2,'A',$3,$3,'ACTIVE')`, [adminId, centreId, dummy]);
  for (const s of [seat, otherSeat])
    await pool.query(`INSERT INTO terminals (id,center_id,seat_no,capability,wg_pubkey,state) VALUES ($1,$2,$3,'CANDIDATE_SEAT',$4,'ATTENDED')`, [s, centreId, s.slice(0, 4), "wg-" + s.slice(0, 6)]);
  // bind only `seat` to this exam
  await pool.query(`INSERT INTO seat_bindings (terminal_id,center_id,exam_id,candidate_roll,bound_by,bind_token) VALUES ($1,$2,$3,'R-1',$4,$5)`, [seat, centreId, examId, adminId, dummy]);

  // stage a real sealed bundle; t0_at in the FUTURE (beacon must be withheld)
  const beacon = Buffer.from("ab".repeat(32), "hex"), salt = Buffer.from("cd".repeat(16), "hex");
  const master = await deriveMasterSeed(new Uint8Array(beacon), new Uint8Array(salt), examId);
  const bundle = await sealExam(examId, [{ id: "Q1", prompt: "p", options: ["a", "b"] }], master);
  await pool.query(
    `INSERT INTO exam_question_bundle (exam_id,questions_root,bundle_json,drand_round,hkdf_salt,t0_beacon,t0_at)
     VALUES ($1,$2,$3,1,$4,$5, NOW() + INTERVAL '1 hour')`,
    [examId, Buffer.from(bundle.questionsRoot, "hex"), JSON.stringify(bundle), salt, beacon],
  );

  // bound seat gets the bundle; its root matches what we sealed
  const got = J(await app.inject({ method: "GET", url: `/api/exam/${examId}/bundle?terminalId=${seat}` }));
  assert.equal(got.questionsRoot, bundle.questionsRoot);
  assert.equal(got.bundle.items.length, 1);

  // an UNbound seat is refused the bundle (a seat can only see its own exam)
  const denied = await app.inject({ method: "GET", url: `/api/exam/${examId}/bundle?terminalId=${otherSeat}` });
  assert.equal(denied.statusCode, 403);

  // the beacon is withheld before T₀ (425 Too Early) — paper undecryptable
  const early = await app.inject({ method: "GET", url: `/api/exam/${examId}/beacon?terminalId=${seat}` });
  assert.equal(early.statusCode, 425);

  // move T₀ into the past → beacon releases, and it is the exact public value
  await pool.query(`UPDATE exam_question_bundle SET t0_at = NOW() - INTERVAL '1 min' WHERE exam_id=$1`, [examId]);
  const released = J(await app.inject({ method: "GET", url: `/api/exam/${examId}/beacon?terminalId=${seat}` }));
  assert.equal(released.ok, true);
  assert.equal(released.beacon, "ab".repeat(32));
});
