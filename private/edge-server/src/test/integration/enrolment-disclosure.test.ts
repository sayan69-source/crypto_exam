/**
 * Biometric enrolment templates must never leave the Edge for anyone but the
 * machine they belong to.
 *
 * Found by reading the code rather than by a failing test, which is why this
 * file exists. `/api/station/enrolment` serves an invigilator's enrolled face
 * hash and fingerprint template so the on-device daemon has something to match
 * against — the live capture must never cross the LAN (§8.4), so the enrolled
 * side travels instead. It was gated on a login challenge plus a fresh
 * attestation, and neither is a property of the CALLER:
 *
 *   • `POST /api/login/challenge` is necessarily unauthenticated (a login has
 *     to start somewhere) and issues a nonce for any terminal id;
 *   • attestation is a fact about the target machine, not about whoever asked.
 *
 * So any host on the exam VLAN could have collected the enrolment secrets of
 * every invigilator in the centre — the exact values the §8.2 match-all rule is
 * checked against, and unlike a password, a fingerprint cannot be reissued.
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
import type { EdgeConfig } from "../../config.ts";
import { attestTerminal, commissionTerminal, makeStationKeys } from "../helpers/commissioning.ts";

const DB = process.env.DATABASE_URL;
const skip = DB ? false : "set DATABASE_URL to run the enrolment disclosure test";

const config: EdgeConfig = {
  host: "127.0.0.1", port: 0, databaseUrl: DB ?? "", centreId: "test",
  provisioningKey: null, systemAdminPublicKeyPem: null,
  argon: { timeCost: 2, memoryCostKiB: 8192, parallelism: 1 },
  tokenSecret: new Uint8Array(32).fill(1),
  bindSecret: new Uint8Array(32).fill(2),
  nodeSignSeed: new Uint8Array(32).fill(3),
  allowFirstBootCommissioning: false,
};

let pool: Pool | null = null;
let app: FastifyInstance | null = null;
after(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
});

const J = (r: { payload: string }) => JSON.parse(r.payload);

test("staff enrolment templates are served only to the station they belong to", { skip }, async () => {
  await migrate(DB!);
  pool = makePool(DB!);
  app = buildApp({ pool, config });

  const centreId = randomUUID();
  const stationId = randomUUID();
  const invigId = randomUUID();
  const face = Buffer.from("11".repeat(32), "hex");
  const finger = Buffer.from("22".repeat(32), "hex");

  await pool.query(`INSERT INTO centers (id, name) VALUES ($1,'C')`, [centreId]);
  const keys = makeStationKeys();
  // app.inject() presents as 127.0.0.1, so a station bound THERE is "this
  // machine" and one bound elsewhere is "some other machine on the LAN".
  await commissionTerminal(pool, {
    id: stationId, centreId, seatNo: "INV-1",
    capability: "INVIGILATOR_STATION", boundIp: "127.0.0.1", keys,
  });
  await pool.query(
    `INSERT INTO staff_identities (id, role, center_id, full_name, face_embedding_hash, fingerprint_template, bound_ip, bound_terminal_id, status, activated_at)
     VALUES ($1,'CENTER_INVIGILATOR',$2,'Arun',$3,$4,'127.0.0.1',$5,'ACTIVE', NOW())`,
    [invigId, centreId, face, finger, stationId],
  );
  assert.equal((await attestTerminal(app, stationId, keys)).body.ok, true);

  const challenge = async (terminalId: string): Promise<string> =>
    J(await app!.inject({ method: "POST", url: "/api/login/challenge", payload: { terminalId } })).nonce;

  // The station itself, mid-login, gets what its daemon needs to match against.
  const own = await app.inject({
    method: "GET",
    url: `/api/station/enrolment?terminalId=${stationId}&challengeNonce=${await challenge(stationId)}`,
  });
  assert.equal(own.statusCode, 200);
  assert.equal(J(own).fingerprintTemplate, "22".repeat(32));

  // ── the attack ──────────────────────────────────────────────────────────
  // Another host on the exam VLAN, doing exactly what the station does: take a
  // challenge for the station's id (the endpoint cannot require auth), then ask
  // for the enrolment. It is a different machine, so it must get nothing.
  await pool.query(`UPDATE terminals SET bound_ip = '10.0.0.44' WHERE id = $1`, [stationId]);
  const sweep = await app.inject({
    method: "GET",
    url: `/api/station/enrolment?terminalId=${stationId}&challengeNonce=${await challenge(stationId)}`,
  });
  assert.equal(sweep.statusCode, 403, "a foreign host must not receive an invigilator's biometric template");
  assert.equal(J(sweep).reason, "NOT_THIS_TERMINAL");

  // A terminal with no bound address cannot be shown to be the caller either,
  // so it is refused rather than trusted.
  await pool.query(`UPDATE terminals SET bound_ip = NULL WHERE id = $1`, [stationId]);
  const unbound = await app.inject({
    method: "GET",
    url: `/api/station/enrolment?terminalId=${stationId}&challengeNonce=${await challenge(stationId)}`,
  });
  assert.equal(unbound.statusCode, 403);
});

test("an applicant's enrolment is served only at the station they registered from", { skip }, async () => {
  if (!pool || !app) {
    await migrate(DB!);
    pool = makePool(DB!);
    app = buildApp({ pool, config });
  }
  const centreId = randomUUID();
  const stationId = randomUUID();
  const applicantId = randomUUID();
  const dummy = Buffer.from("33".repeat(32), "hex");

  await pool.query(`INSERT INTO centers (id, name) VALUES ($1,'C2')`, [centreId]);
  const keys = makeStationKeys("second");
  await commissionTerminal(pool, {
    id: stationId, centreId, seatNo: "ADM-1",
    capability: "ADMIN_STATION", boundIp: "10.0.0.99", keys,
  });
  await pool.query(
    `INSERT INTO staff_identities (id, role, center_id, full_name, face_embedding_hash, fingerprint_template, bound_terminal_id, status)
     VALUES ($1,'CENTER_ADMIN',$2,'Applicant',$3,$3,$4,'PENDING_APPROVAL')`,
    [applicantId, centreId, dummy, stationId],
  );
  const requestId = (
    await pool.query(
      `INSERT INTO approval_requests (kind, applicant_identity_id, center_id, status)
       VALUES ('CENTER_ADMIN_REGISTRATION',$1,$2,'PENDING_APPROVAL') RETURNING id`,
      [applicantId, centreId],
    )
  ).rows[0].id;

  const nonce = J(
    await app.inject({ method: "POST", url: "/api/login/challenge", payload: { terminalId: stationId } }),
  ).nonce;
  const res = await app.inject({
    method: "GET",
    url: `/api/activation/enrolment?requestId=${requestId}&terminalId=${stationId}&challengeNonce=${nonce}`,
  });
  // The station is bound to 10.0.0.99; this request comes from loopback.
  assert.equal(res.statusCode, 403);
  assert.equal(J(res).reason, "NOT_THIS_TERMINAL");
});
