/**
 * Phase 9 DoD — RBAC matrix (§3.2) + INV-6 at the API surface.
 *   • Centre Admin sees ONLY its own centre's counts (scope isolation).
 *   • An invigilator / no token cannot read admin counts (403).
 *   • The blind-courier ledger returns HASHES ONLY — no ciphertext, no wrapped
 *     DK, no key material (INV-6).
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
import type { EdgeConfig } from "../../config.ts";

const DB = process.env.DATABASE_URL;
const skip = DB ? false : "set DATABASE_URL to run RBAC tests";

const config: EdgeConfig = {
  host: "127.0.0.1", port: 0, databaseUrl: DB ?? "", centreId: "test",
  provisioningKey: null,
  systemAdminPublicKeyPem: null,
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

async function seedCentre(p: Pool, opts: { invigActive: number; invigPending: number; enrollments: number; seats: number }) {
  const centreId = randomUUID();
  const examId = randomUUID();
  await p.query(`INSERT INTO centers (id, name) VALUES ($1,'C')`, [centreId]);
  await p.query(`INSERT INTO exams (id, name, scheduled_at) VALUES ($1,'E', NOW())`, [examId]);
  const adminId = randomUUID();
  await p.query(
    `INSERT INTO staff_identities (id, role, center_id, full_name, face_embedding_hash, fingerprint_template, status)
     VALUES ($1,'CENTER_ADMIN',$2,'A',$3,$3,'ACTIVE')`, [adminId, centreId, dummy]);
  for (let i = 0; i < opts.invigActive; i++)
    await p.query(`INSERT INTO staff_identities (role, center_id, full_name, face_embedding_hash, fingerprint_template, status) VALUES ('CENTER_INVIGILATOR',$1,'I',$2,$2,'ACTIVE')`, [centreId, dummy]);
  for (let i = 0; i < opts.invigPending; i++)
    await p.query(`INSERT INTO staff_identities (role, center_id, full_name, face_embedding_hash, fingerprint_template, status) VALUES ('CENTER_INVIGILATOR',$1,'I',$2,$2,'PENDING_APPROVAL')`, [centreId, dummy]);
  for (let i = 0; i < opts.enrollments; i++) {
    const u = randomUUID();
    await p.query(`INSERT INTO users (id, role, full_name) VALUES ($1,'CANDIDATE','S')`, [u]);
    await p.query(`INSERT INTO enrollments (candidate_id, exam_id, center_id, roll_number) VALUES ($1,$2,$3,$4)`, [u, examId, centreId, `R-${i}`]);
  }
  for (let i = 0; i < opts.seats; i++)
    await p.query(`INSERT INTO terminals (center_id, seat_no, capability, wg_pubkey, state) VALUES ($1,$2,'CANDIDATE_SEAT',$3,'AVAILABLE')`, [centreId, `S-${i}`, `wg-${i}`]);
  return { centreId, examId, adminId };
}

const adminToken = (centre: string, sub: string) =>
  issueToken(config.tokenSecret, { sub, tid: "station", tpm: "x", role: "CENTER_ADMIN", centre, exp: Date.now() + 3_600_000 });

test("Phase 9: Centre Admin counts are centre-scoped; cross-role/no-token denied", { skip }, async () => {
  await migrate(DB!);
  pool = makePool(DB!);
  app = buildApp({ pool, config });

  const A = await seedCentre(pool, { invigActive: 2, invigPending: 1, enrollments: 3, seats: 2 });
  const B = await seedCentre(pool, { invigActive: 1, invigPending: 0, enrollments: 5, seats: 9 });

  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  // admin A sees A's numbers
  const ca = J(await app.inject({ method: "GET", url: "/api/admin/centre/counts", headers: bearer(adminToken(A.centreId, A.adminId)) }));
  assert.equal(ca.invigilatorsActive, 2);
  assert.equal(ca.invigilatorsPending, 1);
  assert.equal(ca.candidatesRegistered, 3);
  assert.equal(ca.seatsAvailable, 2);

  // admin B sees B's numbers — proving scope isolation (a B token can never see A)
  const cb = J(await app.inject({ method: "GET", url: "/api/admin/centre/counts", headers: bearer(adminToken(B.centreId, B.adminId)) }));
  assert.equal(cb.invigilatorsActive, 1);
  assert.equal(cb.candidatesRegistered, 5);
  assert.notDeepEqual(ca, cb);

  // an invigilator token is forbidden on admin counts
  const ivg = issueToken(config.tokenSecret, { sub: A.adminId, tid: "s", tpm: "x", role: "CENTER_INVIGILATOR", centre: A.centreId, exp: Date.now() + 3_600_000 });
  assert.equal((await app.inject({ method: "GET", url: "/api/admin/centre/counts", headers: bearer(ivg) })).statusCode, 403);

  // no token → forbidden
  assert.equal((await app.inject({ method: "GET", url: "/api/admin/centre/counts" })).statusCode, 403);
});

test("INV-6: the blind-courier ledger returns hashes only — no ciphertext, no key", { skip }, async () => {
  if (!pool || !app) { await migrate(DB!); pool = makePool(DB!); app = buildApp({ pool, config }); }
  const A = await seedCentre(pool, { invigActive: 0, invigPending: 0, enrollments: 0, seats: 0 });

  // a sealed bundle lands in the centre store (ciphertext + wrapped DK present in the row)
  await pool.query(
    `INSERT INTO answer_ledger (center_id, exam_id, seat_no, leaf_index, leaf_hash, prev_root, chain_root, node_root_sig, ciphertext, iv, auth_tag, wrapped_dk)
     VALUES ($1,$2,'S-1',0,$3,$3,$3,$3,$4,$3,$3,$4)`,
    [A.centreId, A.examId, Buffer.from("11".repeat(32), "hex"), Buffer.from("deadbeef".repeat(8), "hex")],
  );

  const res = J(await app.inject({ method: "GET", url: "/api/admin/ledger", headers: { authorization: `Bearer ${adminToken(A.centreId, A.adminId)}` } }));
  assert.equal(res.bundles.length, 1);
  const keys = Object.keys(res.bundles[0]).sort();
  assert.deepEqual(keys, ["chainRoot", "leafHash", "leafIndex", "nodeRootSig", "syncState"]);

  // Hard INV-6 assertion: nothing in the response can open the bundle.
  const blob = JSON.stringify(res).toLowerCase();
  for (const forbidden of ["ciphertext", "wrapped", "wrapped_dk", "private", "deadbeef", "\"iv\""]) {
    assert.ok(!blob.includes(forbidden), `ledger response must not expose ${forbidden}`);
  }
});
