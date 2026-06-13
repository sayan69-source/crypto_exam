/**
 * §13.5 DoD — the System Admin (tier-0) onboarding cascade, end to end over the
 * §13 HTTP API with every negative path denied (INV-4, INV-7, INV-8, RBAC §3.2).
 * This is the Centre-Admin counterpart of cascade.test.ts: a Centre Admin can
 * only ever come into being after a SYSTEM ADMIN approves it. Driven with
 * app.inject() (no socket). Needs PostgreSQL; skipped without DATABASE_URL.
 *
 *   docker compose -f private/edge-server/docker-compose.yml up -d
 *   DATABASE_URL=postgres://zuup:zuup@127.0.0.1:5433/zuup_edge \
 *     node --test --experimental-strip-types "src/test/integration/system-admin.test.ts"
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
const skip = DB ? false : "set DATABASE_URL to run the system-admin test";

const FAST_ARGON = { timeCost: 2, memoryCostKiB: 8192, parallelism: 1 };
const config: EdgeConfig = {
  host: "127.0.0.1", port: 0, databaseUrl: DB ?? "", centreId: "test",
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
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const dummy = Buffer.from("aa".repeat(32), "hex");

test("§13.5: System Admin approves a Centre Admin; tiers + INV-7/8 hold", { skip }, async () => {
  await migrate(DB!);
  pool = makePool(DB!);
  app = buildApp({ pool, config });

  // ── two centres so we can prove cross-centre oversight (not centre-scoped) ──
  const centreA = randomUUID();
  const centreB = randomUUID();
  await pool.query(`INSERT INTO centers (id, name, state) VALUES ($1,'DL-IITD','Delhi')`, [centreA]);
  await pool.query(`INSERT INTO centers (id, name, state) VALUES ($1,'MH-IITB','Maharashtra')`, [centreB]);

  // ── a SYSTEM_ADMIN bound to an HQ station + fixed IP (centre = NULL) ──
  const sysId = randomUUID();
  const hqStation = randomUUID();
  const hqIp = "172.16.0.10";
  await pool.query(
    `INSERT INTO staff_identities (id, role, center_id, full_name, face_embedding_hash, fingerprint_template, bound_ip, bound_terminal_id, status)
     VALUES ($1,'SYSTEM_ADMIN', NULL, 'HQ Root', $2, $2, $3, $4, 'ACTIVE')`,
    [sysId, dummy, hqIp, hqStation],
  );

  // a Centre Admin (centre A) — used to prove a tier-1 token is refused at tier-0
  const caId = randomUUID();
  await pool.query(
    `INSERT INTO staff_identities (id, role, center_id, full_name, face_embedding_hash, fingerprint_template, status)
     VALUES ($1,'CENTER_ADMIN',$2,'Existing CA',$3,$3,'ACTIVE')`,
    [caId, centreB, dummy], // active CA in centre B (not A)
  );
  const caTokenB = issueToken(config.tokenSecret, {
    sub: caId, tid: randomUUID(), tpm: "x", role: "CENTER_ADMIN", centre: centreB, exp: Date.now() + 3_600_000,
  });

  // ── 1) applicant registers as a Centre Admin for centre A (§10.1 step 3) ──
  const reg = J(await app.inject({
    method: "POST", url: "/api/centeradmin/register",
    payload: { centerId: centreA, fullName: "Neha Rao", faceEmbeddingHash: "bb".repeat(32), fingerprintTemplate: "cc".repeat(32), boundIp: "10.0.0.5", boundTerminalId: randomUUID() },
  }));
  assert.equal(reg.status, "PENDING_APPROVAL");
  const requestId = reg.requestId;

  // ── 2) NEGATIVE (INV-4) — System Admin login from a foreign IP ──
  const badIp = await app.inject({
    method: "POST", url: "/api/system/login",
    payload: { terminalId: hqStation, observedIp: "172.16.0.99", faceScore: 0.95, fpScore: 0.9, tpmValid: true, elapsedMs: 1000 },
  });
  assert.equal(badIp.statusCode, 401);
  assert.ok(J(badIp).failures.includes("SOURCE_IP_MISMATCH"));

  // ── 3) System Admin login — all factors pass → token (centre = null) ──
  const login = J(await app.inject({
    method: "POST", url: "/api/system/login",
    payload: { terminalId: hqStation, observedIp: hqIp, faceScore: 0.95, fpScore: 0.9, tpmValid: true, elapsedMs: 1000 },
  }));
  assert.equal(login.ok, true);
  const sysToken = login.token;

  // ── 4) the pending queue is cross-centre and names the centre ──
  // (the queue is deliberately GLOBAL for tier-0, so a shared dev DB may hold
  // other pending registrations — assert on the rows this test created)
  const pending = J(await app.inject({ method: "GET", url: "/api/system/approvals/pending", headers: bearer(sysToken) }));
  const mine = pending.pending.filter((p: { centerId: string }) => p.centerId === centreA);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].requestId, requestId);
  assert.equal(mine[0].centreName, "DL-IITD");

  // ── 5) NEGATIVE (RBAC §3.2) — a Centre Admin token cannot reach tier-0 ──
  assert.equal((await app.inject({ method: "GET", url: "/api/system/approvals/pending", headers: bearer(caTokenB) })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: `/api/system/approvals/${requestId}/issue-code`, headers: bearer(caTokenB) })).statusCode, 403);

  // ── 6) System Admin issues the one-time code (shown ONLY here) ──
  const issued = J(await app.inject({ method: "POST", url: `/api/system/approvals/${requestId}/issue-code`, headers: bearer(sysToken) }));
  assert.ok(issued.code, "approver receives the cleartext code");
  const code = issued.code;

  // ── 7) NEGATIVE — activate before the fingerprint is authorised ──
  const early = await app.inject({ method: "POST", url: "/api/staff/activate", payload: { requestId, code, fingerprintMatch: true } });
  assert.equal(early.statusCode, 401);
  assert.equal(J(early).reason, "FINGERPRINT_NOT_AUTHORISED");

  // ── 8) System Admin authorises & binds the fingerprint ──
  assert.equal(J(await app.inject({ method: "POST", url: `/api/system/approvals/${requestId}/authorise-fp`, headers: bearer(sysToken) })).ok, true);

  // ── 9) activate with code + matching finger → Centre Admin ACTIVE ──
  const act = J(await app.inject({ method: "POST", url: "/api/staff/activate", payload: { requestId, code, fingerprintMatch: true } }));
  assert.equal(act.status, "ACTIVE");

  // ── 10) NEGATIVE (INV-8) — replay the consumed code ──
  const replay = await app.inject({ method: "POST", url: "/api/staff/activate", payload: { requestId, code, fingerprintMatch: true } });
  assert.equal(replay.statusCode, 401);
  assert.equal(J(replay).reason, "CODE_CONSUMED");

  // ── 11) oversight reflects the new ACTIVE Centre Admin in centre A ──
  const centres = J(await app.inject({ method: "GET", url: "/api/system/centres", headers: bearer(sysToken) }));
  const rowA = centres.centres.find((r: { centerId: string }) => r.centerId === centreA);
  assert.equal(rowA.centerAdminsActive, 1);
  assert.equal(rowA.centerAdminPending, 0);

  // ── 12) INV-7 — a SECOND Centre Admin for centre A cannot also go ACTIVE ──
  const reg2 = J(await app.inject({
    method: "POST", url: "/api/centeradmin/register",
    payload: { centerId: centreA, fullName: "Imposter", faceEmbeddingHash: "dd".repeat(32), fingerprintTemplate: "ee".repeat(32), boundIp: "10.0.0.6", boundTerminalId: randomUUID() },
  }));
  const code2 = J(await app.inject({ method: "POST", url: `/api/system/approvals/${reg2.requestId}/issue-code`, headers: bearer(sysToken) })).code;
  await app.inject({ method: "POST", url: `/api/system/approvals/${reg2.requestId}/authorise-fp`, headers: bearer(sysToken) });
  const dup = await app.inject({ method: "POST", url: "/api/staff/activate", payload: { requestId: reg2.requestId, code: code2, fingerprintMatch: true } });
  assert.equal(dup.statusCode, 409);
  assert.equal(J(dup).reason, "DUPLICATE_ACTIVE_CENTER_ADMIN");

  // the tier-0 audit chain is intact (LOGIN/CODE/FP/ACTIVATE all hash-chained)
  const client = await pool.connect();
  try {
    const { verifyAuditChain } = await import("../../audit.ts");
    assert.equal((await verifyAuditChain(client, centreA)).ok, true, "centre A audit chain intact");
  } finally {
    client.release();
  }
});
