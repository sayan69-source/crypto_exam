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
import {
  attestTerminal,
  commissionTerminal,
  makeStationKeys,
  signBio,
  signEnrol,
  stationLogin,
} from "../helpers/commissioning.ts";
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
  // Explicitly off: a test must never inherit a trust concession.
  allowFirstBootCommissioning: false,
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
  // app.inject() connects over the loopback socket, so the address the Edge
  // OBSERVES is 127.0.0.1 — and the observed address is the only one that
  // counts now. Binding the identity to anything else is how the test would
  // pass while the real gate denied.
  const hqIp = "127.0.0.1";
  const hqKeys = makeStationKeys("hq");
  await commissionTerminal(pool, {
    id: hqStation, centreId: centreA, seatNo: "HQ-1",
    capability: "ADMIN_STATION", boundIp: hqIp, keys: hqKeys,
  });
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

  // The centre-A admin station the applicant physically stands at. Their
  // centre is read from THIS row — the form cannot name a centre any more.
  const stationA = randomUUID();
  const stationAKeys = makeStationKeys("centre-a");
  await commissionTerminal(pool, {
    id: stationA, centreId: centreA, seatNo: "ADM-1",
    capability: "ADMIN_STATION", boundIp: "127.0.0.1", keys: stationAKeys,
  });
  assert.equal((await attestTerminal(app, stationA, stationAKeys)).body.ok, true);
  assert.equal((await attestTerminal(app, hqStation, hqKeys)).body.ok, true);

  /** File a Centre Admin registration from a commissioned admin station. */
  const registerAt = async (station: string, keys: ReturnType<typeof makeStationKeys>, fullName: string) => {
    const ch = J(await app!.inject({ method: "POST", url: "/api/login/challenge", payload: { terminalId: station } }));
    return J(await app!.inject({
      method: "POST", url: "/api/centeradmin/register",
      payload: {
        fullName, terminalId: station, challengeNonce: ch.nonce,
        enrol: signEnrol(keys.bioPrivate, {
          terminalId: station, nonce: ch.nonce,
          faceEmbeddingHash: "bb".repeat(32), fingerprintTemplate: "cc".repeat(32),
        }),
      },
    }));
  };

  // ── 1) applicant registers as a Centre Admin for centre A (§10.1 step 3) ──
  const reg = await registerAt(stationA, stationAKeys, "Neha Rao");
  assert.equal(reg.status, "PENDING_APPROVAL");
  const requestId = reg.requestId;

  // ── 2) NEGATIVE (INV-4) — the identity is bound to an address this
  //    connection is not coming from. The client cannot state its own address,
  //    so this is exercised by moving the BINDING, not the claim.
  await pool.query(`UPDATE staff_identities SET bound_ip = '172.16.0.99' WHERE id = $1`, [sysId]);
  const badIp = await stationLogin(app, "/system/login", hqStation, hqKeys);
  assert.equal(badIp.statusCode, 401);
  assert.ok(badIp.body.failures?.includes("SOURCE_IP_MISMATCH"));
  await pool.query(`UPDATE staff_identities SET bound_ip = $2 WHERE id = $1`, [sysId, hqIp]);

  // ── 2b) NEGATIVE — a tier-0 login whose scores were signed by the centre-A
  //    station's daemon. Possession of one machine is not possession of HQ.
  const crossStation = await stationLogin(app, "/system/login", hqStation, {
    ...hqKeys, bioPrivate: stationAKeys.bioPrivate,
  });
  assert.equal(crossStation.statusCode, 401);
  assert.ok(crossStation.body.failures?.includes("BIOMETRIC_SIGNATURE_INVALID"));

  // ── 3) System Admin login — all factors pass → token (centre = null) ──
  const login = await stationLogin(app, "/system/login", hqStation, hqKeys);
  assert.equal(login.body.ok, true, JSON.stringify(login.body.failures));
  const sysToken = login.body.token!;

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
  /** Activation: the one-time code plus a fingerprint captured at the station. */
  const activateAt = async (station: string, keys: ReturnType<typeof makeStationKeys>, id: string, theCode: string) => {
    const ch = J(await app!.inject({ method: "POST", url: "/api/login/challenge", payload: { terminalId: station } }));
    return app!.inject({
      method: "POST", url: "/api/staff/activate",
      payload: {
        requestId: id, code: theCode, terminalId: station, challengeNonce: ch.nonce,
        bio: signBio(keys.bioPrivate, {
          terminalId: station, nonce: ch.nonce, subject: `activate:${id}`,
          faceScoreBp: 9200, fpScoreBp: 9000,
        }),
      },
    });
  };

  const early = await activateAt(stationA, stationAKeys, requestId, code);
  assert.equal(early.statusCode, 401);
  assert.equal(J(early).reason, "FINGERPRINT_NOT_AUTHORISED");

  // ── 8) System Admin authorises & binds the fingerprint ──
  assert.equal(J(await app.inject({ method: "POST", url: `/api/system/approvals/${requestId}/authorise-fp`, headers: bearer(sysToken) })).ok, true);

  // ── 9) activate with code + matching finger → Centre Admin ACTIVE ──
  const act = J(await activateAt(stationA, stationAKeys, requestId, code));
  assert.equal(act.status, "ACTIVE");

  // ── 10) NEGATIVE (INV-8) — replay the consumed code ──
  const replay = await activateAt(stationA, stationAKeys, requestId, code);
  assert.equal(replay.statusCode, 401);
  assert.equal(J(replay).reason, "CODE_CONSUMED");

  // ── 11) oversight reflects the new ACTIVE Centre Admin in centre A ──
  const centres = J(await app.inject({ method: "GET", url: "/api/system/centres", headers: bearer(sysToken) }));
  const rowA = centres.centres.find((r: { centerId: string }) => r.centerId === centreA);
  assert.equal(rowA.centerAdminsActive, 1);
  assert.equal(rowA.centerAdminPending, 0);

  // ── 12) INV-7 — a SECOND Centre Admin for centre A cannot also go ACTIVE ──
  const reg2 = await registerAt(stationA, stationAKeys, "Imposter");
  const code2 = J(await app.inject({ method: "POST", url: `/api/system/approvals/${reg2.requestId}/issue-code`, headers: bearer(sysToken) })).code;
  await app.inject({ method: "POST", url: `/api/system/approvals/${reg2.requestId}/authorise-fp`, headers: bearer(sysToken) });
  const dup = await activateAt(stationA, stationAKeys, reg2.requestId, code2);
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
