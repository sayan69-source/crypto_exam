/**
 * Phase 9 DoD — invigilator console surface (§10.2 / §13.2).
 *   • Seat map is invigilator-only and centre-scoped (RBAC §3.2).
 *   • POST /api/incident appends a hash-chained audit row (tamper-evident,
 *     §12.7) and is denied to other roles.
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
import { verifyAuditChain } from "../../audit.ts";
import type { EdgeConfig } from "../../config.ts";

const DB = process.env.DATABASE_URL;
const skip = DB ? false : "set DATABASE_URL to run console tests";

const config: EdgeConfig = {
  host: "127.0.0.1", port: 0, databaseUrl: DB ?? "", centreId: "test",
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
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

async function seedCentreWithSeats(p: Pool, seats: Array<{ no: string; state: string }>) {
  const centreId = randomUUID();
  await p.query(`INSERT INTO centers (id, name) VALUES ($1,'C')`, [centreId]);
  const invigId = randomUUID();
  await p.query(
    `INSERT INTO staff_identities (id, role, center_id, full_name, face_embedding_hash, fingerprint_template, status)
     VALUES ($1,'CENTER_INVIGILATOR',$2,'I',$3,$3,'ACTIVE')`, [invigId, centreId, dummy]);
  for (const s of seats)
    await p.query(
      `INSERT INTO terminals (center_id, seat_no, capability, wg_pubkey, state) VALUES ($1,$2,'CANDIDATE_SEAT',$3,$4::terminal_state)`,
      [centreId, s.no, `wg-${s.no}`, s.state]);
  return { centreId, invigId };
}

const invigToken = (centre: string, sub: string) =>
  issueToken(config.tokenSecret, { sub, tid: "station", tpm: "x", role: "CENTER_INVIGILATOR", centre, exp: Date.now() + 3_600_000 });

test("Phase 9: seat map is centre-scoped and invigilator-only", { skip }, async () => {
  await migrate(DB!);
  pool = makePool(DB!);
  app = buildApp({ pool, config });

  const A = await seedCentreWithSeats(pool, [
    { no: "S-01", state: "AVAILABLE" },
    { no: "S-02", state: "IN_EXAM" },
    { no: "S-03", state: "DOWN" },
  ]);
  const B = await seedCentreWithSeats(pool, [{ no: "S-99", state: "AVAILABLE" }]);

  // invigilator A sees exactly A's three seats, in seat order, with states
  const map = J(await app.inject({ method: "GET", url: "/api/centre/seatmap", headers: bearer(invigToken(A.centreId, A.invigId)) }));
  assert.equal(map.seats.length, 3);
  assert.deepEqual(map.seats.map((s: { seatNo: string }) => s.seatNo), ["S-01", "S-02", "S-03"]);
  assert.deepEqual(map.seats.map((s: { state: string }) => s.state), ["AVAILABLE", "IN_EXAM", "DOWN"]);
  // no seat from centre B leaks into A's map
  assert.ok(!JSON.stringify(map).includes("S-99"));

  // a CENTER_ADMIN token is NOT an invigilator (RBAC row: seat map is tier 2)
  const adminTok = issueToken(config.tokenSecret, { sub: A.invigId, tid: "s", tpm: "x", role: "CENTER_ADMIN", centre: A.centreId, exp: Date.now() + 3_600_000 });
  assert.equal((await app.inject({ method: "GET", url: "/api/centre/seatmap", headers: bearer(adminTok) })).statusCode, 403);
  // no token → denied
  assert.equal((await app.inject({ method: "GET", url: "/api/centre/seatmap" })).statusCode, 403);
});

test("Phase 9: incident lands in the hash-chained audit log; chain verifies", { skip }, async () => {
  if (!pool || !app) { await migrate(DB!); pool = makePool(DB!); app = buildApp({ pool, config }); }
  const A = await seedCentreWithSeats(pool, [{ no: "S-01", state: "IN_EXAM" }]);

  const res = await app.inject({
    method: "POST", url: "/api/incident",
    headers: bearer(invigToken(A.centreId, A.invigId)),
    payload: { seatNo: "S-01", type: "MULTI_FACE", severity: "HIGH", note: "two faces in frame" },
  });
  assert.equal(res.statusCode, 200);

  // missing type is rejected (no silent empty incidents)
  const bad = await app.inject({
    method: "POST", url: "/api/incident",
    headers: bearer(invigToken(A.centreId, A.invigId)), payload: { seatNo: "S-01" },
  });
  assert.equal(bad.statusCode, 400);

  // the incident row exists, is attributed, and the centre audit chain verifies
  const rows = await pool!.query(
    `SELECT action, target, details FROM secure_audit_log WHERE center_id=$1 AND action='INCIDENT_RAISED'`,
    [A.centreId],
  );
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0].target, "S-01");
  assert.equal(rows.rows[0].details.type, "MULTI_FACE");

  const client = await pool!.connect();
  try {
    const chain = await verifyAuditChain(client, A.centreId);
    assert.equal(chain.ok, true);
  } finally {
    client.release();
  }
});
