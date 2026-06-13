/**
 * Phase 8 DoD — the full cascade, end to end over the §13 HTTP API, with every
 * negative path denied + logged (INV-4, INV-5, INV-8). Driven with app.inject()
 * (no socket). Needs PostgreSQL; skipped without DATABASE_URL.
 *
 *   docker compose -f private/edge-server/docker-compose.yml up -d
 *   DATABASE_URL=postgres://zuup:zuup@127.0.0.1:5433/zuup_edge \
 *     node --test --experimental-strip-types "src/test/integration/cascade.test.ts"
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { makePool, type Pool } from "../../db.ts";
import { migrate } from "../../migrate.ts";
import { buildApp } from "../../http.ts";
import { issueToken } from "../../lib/token.ts";
import { hashDob } from "../../lib/dob.ts";
import type { EdgeConfig } from "../../config.ts";

const DB = process.env.DATABASE_URL;
const skip = DB ? false : "set DATABASE_URL to run the cascade test";

const FAST_ARGON = { timeCost: 2, memoryCostKiB: 8192, parallelism: 1 };
const config: EdgeConfig = {
  host: "127.0.0.1",
  port: 0,
  databaseUrl: DB ?? "",
  centreId: "test",
  provisioningKey: null,
  systemAdminPublicKeyPem: null,
  argon: FAST_ARGON,
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

test("Phase 8: full cascade end-to-end with negative paths denied", { skip }, async () => {
  await migrate(DB!);
  pool = makePool(DB!);
  app = buildApp({ pool, config });

  // ── seed a centre, exam, candidate, ACTIVE centre admin, station, seats ──
  const centreId = randomUUID();
  const examId = randomUUID();
  const stationId = randomUUID();
  const candidateRoll = "ROLL-1001";
  const dob = "2005-03-14";
  const dummy = Buffer.from("aa".repeat(32), "hex");

  await pool.query(`INSERT INTO centers (id, name) VALUES ($1,'IITD')`, [centreId]);
  await pool.query(`INSERT INTO exams (id, name, scheduled_at) VALUES ($1,'Exam', NOW())`, [examId]);

  const candId = randomUUID();
  await pool.query(
    `INSERT INTO users (id, role, full_name, dob_hash) VALUES ($1,'CANDIDATE','Asha', $2)`,
    [candId, Buffer.from(hashDob(dob, FAST_ARGON))],
  );
  await pool.query(
    `INSERT INTO enrollments (candidate_id, exam_id, center_id, roll_number, status)
     VALUES ($1,$2,$3,$4,'ENROLLED')`,
    [candId, examId, centreId, candidateRoll],
  );

  const adminId = randomUUID();
  await pool.query(
    `INSERT INTO staff_identities (id, role, center_id, full_name, face_embedding_hash, fingerprint_template, status)
     VALUES ($1,'CENTER_ADMIN',$2,'Admin',$3,$3,'ACTIVE')`,
    [adminId, centreId, dummy],
  );

  await pool.query(
    `INSERT INTO terminals (id, center_id, seat_no, capability, wg_pubkey, state)
     VALUES ($1,$2,'IVG-1','INVIGILATOR_STATION','wg-ivg','AVAILABLE')`,
    [stationId, centreId],
  );
  for (let i = 0; i < 4; i++) {
    await pool.query(
      `INSERT INTO terminals (center_id, seat_no, capability, wg_pubkey, state, health)
       VALUES ($1,$2,'CANDIDATE_SEAT',$3,'AVAILABLE','OK')`,
      [centreId, `S-${i}`, `wg-${i}`],
    );
  }

  const adminToken = issueToken(config.tokenSecret, {
    sub: adminId, tid: stationId, tpm: "x", role: "CENTER_ADMIN", centre: centreId, exp: Date.now() + 3_600_000,
  });
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  // health — fail-closed gate liveness (INV-10)
  assert.equal(J(await app.inject({ method: "GET", url: "/api/health" })).ok, true);

  // 1) register invigilator (§9.2 step 3) bound to the station + a fixed IP
  const reg = J(
    await app.inject({
      method: "POST", url: "/api/invigilator/register",
      payload: { centerId: centreId, fullName: "Ravi", faceEmbeddingHash: "bb".repeat(32), fingerprintTemplate: "cc".repeat(32), boundIp: "10.0.0.5", boundTerminalId: stationId },
    }),
  );
  assert.equal(reg.status, "PENDING_APPROVAL");
  const requestId = reg.requestId;

  // 2) centre admin issues the one-time code (§9.4) — shown only here
  const issued = J(
    await app.inject({ method: "POST", url: `/api/admin/approvals/${requestId}/issue-code`, headers: bearer(adminToken) }),
  );
  assert.ok(issued.code, "approver receives the cleartext code");
  const code = issued.code;

  // 3) NEGATIVE — activate before the admin authorised the fingerprint
  const early = await app.inject({
    method: "POST", url: "/api/invigilator/activate",
    payload: { requestId, code, fingerprintMatch: true },
  });
  assert.equal(early.statusCode, 401);
  assert.equal(J(early).reason, "FINGERPRINT_NOT_AUTHORISED");

  // 4) admin authorises & binds the fingerprint
  assert.equal(J(await app.inject({ method: "POST", url: `/api/admin/approvals/${requestId}/authorise-fp`, headers: bearer(adminToken) })).ok, true);

  // 5) activate with the code + matching finger → ACTIVE
  const act = J(await app.inject({ method: "POST", url: "/api/invigilator/activate", payload: { requestId, code, fingerprintMatch: true } }));
  assert.equal(act.status, "ACTIVE");

  // 6) NEGATIVE (INV-8) — replay the consumed code
  const replay = await app.inject({ method: "POST", url: "/api/invigilator/activate", payload: { requestId, code, fingerprintMatch: true } });
  assert.equal(replay.statusCode, 401);
  assert.equal(J(replay).reason, "CODE_CONSUMED");

  // 7) NEGATIVE (INV-4) — invigilator login from a spoofed/foreign IP
  const badIp = await app.inject({
    method: "POST", url: "/api/invigilator/login",
    payload: { terminalId: stationId, observedIp: "10.0.0.99", faceScore: 0.95, fpScore: 0.9, tpmValid: true, elapsedMs: 1000 },
  });
  assert.equal(badIp.statusCode, 401);
  assert.ok(J(badIp).failures.includes("SOURCE_IP_MISMATCH"));

  // 8) invigilator login — all factors pass → token
  const login = J(await app.inject({
    method: "POST", url: "/api/invigilator/login",
    payload: { terminalId: stationId, observedIp: "10.0.0.5", faceScore: 0.95, fpScore: 0.9, tpmValid: true, elapsedMs: 1000 },
  }));
  assert.equal(login.ok, true);
  const ivgToken = login.token;

  // 9) candidate check-in (§9.5) — biometric pass → PRESENT
  const checkin = J(await app.inject({
    method: "POST", url: "/api/candidate/checkin", headers: bearer(ivgToken),
    payload: { examId, roll: candidateRoll, faceScore: 0.9, fpScore: 0.85 },
  }));
  assert.equal(checkin.status, "PRESENT");

  // 10) random seat assignment (§9.6) → a candidate seat
  const assign = J(await app.inject({
    method: "POST", url: "/api/seat/assign", headers: bearer(ivgToken),
    payload: { examId, roll: candidateRoll },
  }));
  assert.equal(assign.ok, true);
  const seatTerminalId = assign.terminalId;

  // the seat now reports ASSIGNED + the binding (drives the auto-redirect)
  const seatState = J(await app.inject({ method: "GET", url: `/api/seat/${seatTerminalId}/state` }));
  assert.equal(seatState.state, "ASSIGNED");
  assert.equal(seatState.binding.candidateRoll, candidateRoll);

  // 11) NEGATIVE (INV-5) — a foreign roll on the bound seat, even with a DOB
  const foreign = await app.inject({
    method: "POST", url: "/api/candidate/login",
    payload: { terminalId: seatTerminalId, roll: "ROLL-9999", dob: dob },
  });
  assert.equal(foreign.statusCode, 401);
  assert.equal(J(foreign).reason, "ROLL_NOT_BOUND_TO_SEAT");

  // 12) NEGATIVE — correct roll, wrong DOB
  const wrongDob = await app.inject({
    method: "POST", url: "/api/candidate/login",
    payload: { terminalId: seatTerminalId, roll: candidateRoll, dob: "1999-01-01" },
  });
  assert.equal(wrongDob.statusCode, 401);
  assert.equal(J(wrongDob).reason, "DOB_MISMATCH");

  // 13) correct roll + correct DOB on the bound seat → ATTENDED
  const ok = J(await app.inject({
    method: "POST", url: "/api/candidate/login",
    payload: { terminalId: seatTerminalId, roll: candidateRoll, dob: dob },
  }));
  assert.equal(ok.state, "ATTENDED");

  // the audit chain for this centre is intact after the whole cascade
  const client = await pool.connect();
  try {
    const { verifyAuditChain } = await import("../../audit.ts");
    const chain = await verifyAuditChain(client, centreId);
    assert.equal(chain.ok, true, "centre audit hash-chain intact end to end");
  } finally {
    client.release();
  }
});
