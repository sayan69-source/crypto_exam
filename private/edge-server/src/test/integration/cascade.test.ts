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
import {
  attestTerminal,
  captureCheckin,
  commissionTerminal,
  makeStationKeys,
  signBio,
  signEnrol,
  stationLogin,
} from "../helpers/commissioning.ts";

const DB = process.env.DATABASE_URL;
const skip = DB ? false : "set DATABASE_URL to run the cascade test";

const FAST_ARGON = { timeCost: 2, memoryCostKiB: 8192, parallelism: 1 };
const config: EdgeConfig = {
  host: "127.0.0.1",
  port: 0,
  databaseUrl: DB ?? "",
  centreId: "test",
  provisioningKey: null,
  hqProvisioningPubkey: null,
  systemAdminPublicKeyPem: null,
  argon: FAST_ARGON,
  tokenSecret: new Uint8Array(32).fill(1),
  bindSecret: new Uint8Array(32).fill(2),
  nodeSignSeed: new Uint8Array(32).fill(3),
  // Explicitly off: a test must never inherit a trust concession.
  allowFirstBootCommissioning: false,
  fleetPcr: null,
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

  // A COMMISSIONED station: registry row + golden PCRs + the two public keys.
  // Nothing in the estate can log in without all of it, which is precisely the
  // state every terminal in the estate was in before the registry had a write path.
  const keys = makeStationKeys();
  await commissionTerminal(pool, {
    id: stationId, centreId, seatNo: "IVG-1",
    capability: "INVIGILATOR_STATION", boundIp: "127.0.0.1", keys,
  });
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

  // 0) NEGATIVE — a station with nobody enrolled on it denies, and says only
  //    that. It must NOT report the attestation state of a machine whose
  //    identity does not exist: that would answer "is this station attested?"
  //    to an unauthenticated caller. (The TPM clause itself is exercised at 7d,
  //    once there is a real identity for it to apply to.)
  const beforeAttest = await stationLogin(app, "/invigilator/login", stationId, keys);
  assert.equal(beforeAttest.statusCode, 401);
  assert.deepEqual(beforeAttest.body.failures, ["NO_IDENTITY_FOR_STATION"]);

  // 0b) NEGATIVE — a quote over a TAMPERED boot chain is refused and recorded.
  const tampered = await attestTerminal(app, stationId, keys, {
    pcrs: { ...keys.goldenPcr, "4": "cd".repeat(32) },
  });
  assert.equal(tampered.statusCode, 401);
  assert.ok(tampered.body.failures?.includes("PCR_4_MISMATCH"));

  // 0c) the real boot attestation: nonce → signed quote → verdict
  const attested = await attestTerminal(app, stationId, keys);
  assert.equal(attested.body.ok, true, JSON.stringify(attested.body.failures));

  // 1) register the invigilator (§9.2 step 3). The applicant sends a name, this
  //    station, and an enrolment its daemon signed — no centre, no bindings.
  const regChallenge = J(
    await app.inject({ method: "POST", url: "/api/login/challenge", payload: { terminalId: stationId } }),
  );
  const reg = J(
    await app.inject({
      method: "POST", url: "/api/invigilator/register",
      payload: {
        fullName: "Ravi", terminalId: stationId, challengeNonce: regChallenge.nonce,
        enrol: signEnrol(keys.bioPrivate, {
          terminalId: stationId, nonce: regChallenge.nonce,
          faceEmbeddingHash: "bb".repeat(32), fingerprintTemplate: "cc".repeat(32),
        }),
      },
    }),
  );
  assert.equal(reg.status, "PENDING_APPROVAL");
  const requestId = reg.requestId;

  // 1b) NEGATIVE — the same registration without a signed enrolment. This is
  //     the shape anyone on the LAN could previously post, for any centre.
  const unsigned = await app.inject({
    method: "POST", url: "/api/invigilator/register",
    payload: { fullName: "Impostor", terminalId: stationId, challengeNonce: regChallenge.nonce },
  });
  assert.equal(unsigned.statusCode, 401);

  // 2) centre admin issues the one-time code (§9.4) — shown only here
  const issued = J(
    await app.inject({ method: "POST", url: `/api/admin/approvals/${requestId}/issue-code`, headers: bearer(adminToken) }),
  );
  assert.ok(issued.code, "approver receives the cleartext code");
  const code = issued.code;

  /** §9.2 step 7: the code plus a fingerprint captured HERE, bound to this request. */
  const activate = async (opts: { fpScoreBp?: number } = {}) => {
    // `app!` inside the closure: the module-level handle is nullable for the
    // after() teardown, and narrowing does not survive into a callback.
    const ch = J(await app!.inject({ method: "POST", url: "/api/login/challenge", payload: { terminalId: stationId } }));
    return app!.inject({
      method: "POST", url: "/api/staff/activate",
      payload: {
        requestId, code, terminalId: stationId, challengeNonce: ch.nonce,
        bio: signBio(keys.bioPrivate, {
          terminalId: stationId, nonce: ch.nonce, subject: `activate:${requestId}`,
          faceScoreBp: 9200, fpScoreBp: opts.fpScoreBp ?? 9000,
        }),
      },
    });
  };

  // 3) NEGATIVE — activate before the admin authorised the fingerprint
  const early = await activate();
  assert.equal(early.statusCode, 401);
  assert.equal(J(early).reason, "FINGERPRINT_NOT_AUTHORISED");

  // 4) admin authorises & binds the fingerprint
  assert.equal(J(await app.inject({ method: "POST", url: `/api/admin/approvals/${requestId}/authorise-fp`, headers: bearer(adminToken) })).ok, true);

  // 4b) NEGATIVE — the right code with a finger that does not match. The
  //     applicant's own browser used to decide this with `fingerprintMatch: true`.
  const badFinger = await activate({ fpScoreBp: 1000 });
  assert.equal(badFinger.statusCode, 401);

  // 5) activate with the code + a matching finger → ACTIVE
  const act = J(await activate());
  assert.equal(act.status, "ACTIVE");

  // 6) NEGATIVE (INV-8) — replay the consumed code
  const replay = await activate();
  assert.equal(replay.statusCode, 401);
  assert.equal(J(replay).reason, "CODE_CONSUMED");

  // 7) NEGATIVE (INV-4) — a login with no biometric envelope at all
  const noBio = await app.inject({
    method: "POST", url: "/api/invigilator/login",
    payload: { terminalId: stationId, challengeNonce: "not-a-nonce" },
  });
  assert.equal(noBio.statusCode, 401);
  assert.ok(J(noBio).failures.includes("BIOMETRIC_ENVELOPE_MISSING"));

  // 7b) NEGATIVE — a real signature over a genuinely failing face score
  const lowFace = await stationLogin(app, "/invigilator/login", stationId, keys, {
    faceScoreBp: 4000, fpScoreBp: 9000,
  });
  assert.equal(lowFace.statusCode, 401);
  assert.ok(lowFace.body.failures?.includes("FACE_BELOW_THRESHOLD"));

  // 7c) NEGATIVE — scores signed by a DIFFERENT station's daemon key
  const otherStation = makeStationKeys("other");
  const forged = await stationLogin(app, "/invigilator/login", stationId, {
    ...keys, bioPrivate: otherStation.bioPrivate,
  });
  assert.equal(forged.statusCode, 401);
  assert.ok(forged.body.failures?.includes("BIOMETRIC_SIGNATURE_INVALID"));

  // 7d) NEGATIVE (§7.1) — the TPM clause, now that a real identity exists for
  //     it to apply to. Clearing the attestation record is what a reboot into
  //     something else looks like from the Edge's side: the machine has not
  //     proved this boot, so no login may proceed on it.
  await pool.query(`UPDATE terminals SET last_attest_ok = NULL, last_attest_at = NULL WHERE id = $1`, [stationId]);
  const unattested = await stationLogin(app, "/invigilator/login", stationId, keys);
  assert.equal(unattested.statusCode, 401);
  assert.ok(unattested.body.failures?.includes("TPM_ATTESTATION_INVALID"));

  // …and a stale attestation is no better than none.
  await pool.query(
    `UPDATE terminals SET last_attest_ok = TRUE, last_attest_at = NOW() - INTERVAL '13 hours' WHERE id = $1`,
    [stationId],
  );
  const stale = await stationLogin(app, "/invigilator/login", stationId, keys);
  assert.equal(stale.statusCode, 401);
  assert.ok(stale.body.failures?.includes("TPM_ATTESTATION_INVALID"));

  // re-attest for real before continuing
  assert.equal((await attestTerminal(app, stationId, keys)).body.ok, true);

  // 8) invigilator login — every factor measured, none asserted → token
  const login = await stationLogin(app, "/invigilator/login", stationId, keys);
  assert.equal(login.body.ok, true, JSON.stringify(login.body.failures));
  const ivgToken = login.body.token!;

  // 9) NEGATIVE (§9.5) — a capture of one candidate cannot check in another.
  //    Without the subject binding, ONE genuine capture seats a whole hall.
  const forAnother = await captureCheckin(app, stationId, keys, "ROLL-9999");
  const wrongSubject = await app.inject({
    method: "POST", url: "/api/candidate/checkin", headers: bearer(ivgToken),
    payload: { examId, roll: candidateRoll, ...forAnother },
  });
  assert.equal(wrongSubject.statusCode, 401);
  assert.equal(J(wrongSubject).reason, "BIOMETRIC_ATTESTATION_INVALID");

  // 9b) candidate check-in — a live, signed capture bound to this roll → PRESENT
  const capture = await captureCheckin(app, stationId, keys, candidateRoll);
  const checkin = J(await app.inject({
    method: "POST", url: "/api/candidate/checkin", headers: bearer(ivgToken),
    payload: { examId, roll: candidateRoll, ...capture },
  }));
  assert.equal(checkin.status, "PRESENT");

  // 9c) NEGATIVE — the same capture replayed. The nonce was spent.
  const replayCapture = await app.inject({
    method: "POST", url: "/api/candidate/checkin", headers: bearer(ivgToken),
    payload: { examId, roll: candidateRoll, ...capture },
  });
  assert.equal(replayCapture.statusCode, 401);

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
