/**
 * §9.5 — the step that made every candidate check-in impossible.
 *
 * Registration happens in a browser, which cannot read a fingerprint reader, so
 * `_build_bundle` ships candidates with `fingerprint: None` and the design says
 * the finger is "enrolled in person at the seat". Nothing did that. So
 * `candidateEnrolment` returned an empty template, the daemon scored 0.0 against
 * it, `/api/candidate/checkin` required `fpScore >= 0.6`, and every candidate in
 * the estate was refused at the desk — permanently, with a BIOMETRIC_MISMATCH
 * that reads as "wrong person" rather than "never enrolled".
 *
 * The existing cascade test could not catch this: `captureCheckin` INJECTS
 * scores of 0.90/0.85, so it proves the envelope plumbing and never compares
 * anything against a stored enrolment. This exercises the stored template.
 *
 *   DATABASE_URL=postgres://zuup:zuup@127.0.0.1:5433/zuup_edge \
 *     node --test --experimental-strip-types "src/test/integration/candidate-finger-enrolment.test.ts"
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { makePool } from "../../db.ts";
import { migrate } from "../../migrate.ts";
import { buildApp } from "../../http.ts";
import { issueToken } from "../../lib/token.ts";
import { hashDob } from "../../lib/dob.ts";
import * as repo from "../../repo.ts";
import type { EdgeConfig } from "../../config.ts";
import { commissionTerminal, makeStationKeys, signEnrol } from "../helpers/commissioning.ts";

const DB = process.env.DATABASE_URL;
const skip = DB ? false : "set DATABASE_URL to run this test";

const FAST_ARGON = { timeCost: 2, memoryCostKiB: 8192, parallelism: 1 };
const config: EdgeConfig = {
  host: "127.0.0.1", port: 0, databaseUrl: DB ?? "", centreId: "test",
  provisioningKey: null, systemAdminPublicKeyPem: null, argon: FAST_ARGON,
  tokenSecret: new Uint8Array(32).fill(1),
  bindSecret: new Uint8Array(32).fill(2),
  nodeSignSeed: new Uint8Array(32).fill(3),
  allowFirstBootCommissioning: false,
  fleetPcr: null,
};

const J = (r: { payload: string }) => JSON.parse(r.payload);
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const FINGER = "ab".repeat(32);
const FACE = "cd".repeat(32);

// migrate() takes the URL, not a pool, and is run ONCE for the file rather than
// per test — seven setups would otherwise contend on the same advisory lock.
let migrated: Promise<unknown> | null = null;

async function setup() {
  if (!migrated) migrated = migrate(config.databaseUrl);
  await migrated;
  const pool = makePool(config.databaseUrl);
  const centreId = randomUUID();
  const examId = randomUUID();
  const stationId = randomUUID();
  const roll = "ROLL-" + randomUUID().slice(0, 8);
  const keys = makeStationKeys();

  await pool.query("INSERT INTO centers (id, name) VALUES ($1,'C')", [centreId]);
  await pool.query(
    "INSERT INTO exams (id, name, scheduled_at, duration_minutes) VALUES ($1,'E',NOW(),180)",
    [examId],
  );
  await commissionTerminal(pool, {
    id: stationId, centreId, seatNo: "INV-1", capability: "INVIGILATOR_STATION", keys,
  });

  // A candidate EXACTLY as the provisioning bundle delivers one: a face
  // descriptor computed in the browser, and no fingerprint at all.
  const candId = randomUUID();
  await pool.query(
    "INSERT INTO users (id, role, full_name, dob_hash, enrolled_photo_hash) VALUES ($1,'CANDIDATE','Asha',$2,$3)",
    [candId, Buffer.from(hashDob("2005-01-01", FAST_ARGON)), Buffer.from(FACE, "hex")],
  );
  await pool.query(
    "INSERT INTO enrollments (candidate_id, exam_id, center_id, roll_number, status) VALUES ($1,$2,$3,$4,'ENROLLED')",
    [candId, examId, centreId, roll],
  );

  const invId = randomUUID();
  await pool.query(
    "INSERT INTO staff_identities (id, role, center_id, full_name, face_embedding_hash, fingerprint_template, status, bound_terminal_id) VALUES ($1,'CENTER_INVIGILATOR',$2,'Inv',$3,$3,'ACTIVE',$4)",
    [invId, centreId, Buffer.from(FINGER, "hex"), stationId],
  );
  const token = issueToken(config.tokenSecret, {
    sub: invId, tid: stationId, tpm: "attested", role: "CENTER_INVIGILATOR",
    centre: centreId, exp: Date.now() + 600_000,
  });

  const app = buildApp({ pool, config });
  return { pool, app, centreId, examId, stationId, roll, keys, token };
}

async function capture(app: any, stationId: string, keys: any, roll: string, subject?: string) {
  const ch = J(await app.inject({
    method: "POST", url: "/api/login/challenge", payload: { terminalId: stationId },
  }));
  return {
    challengeNonce: ch.nonce,
    enrol: signEnrol(keys.bioPrivate, {
      terminalId: stationId, nonce: ch.nonce,
      faceEmbeddingHash: FACE, fingerprintTemplate: FINGER,
      subject: subject ?? "enrol:candidate:" + roll,
    }),
  };
}

test("a provisioned candidate arrives with NO fingerprint — the bug, pinned", { skip }, async () => {
  const { pool, centreId, examId, roll } = await setup();
  const e = await repo.candidateEnrolment(pool, centreId, examId, roll);
  assert.ok(e, "the candidate must be on the roster");
  // This empty string is what scored 0.0 and refused everyone at the desk.
  assert.equal(e!.fingerprintTemplate, "", "provisioning delivers no finger — by design");
  assert.notEqual(e!.faceEmbeddingHash, "", "but the face descriptor DID arrive");
  after(() => pool.end());
});

test("the invigilator enrols it in person, so check-in has something to compare", { skip }, async () => {
  const { pool, app, centreId, examId, stationId, roll, keys, token } = await setup();
  const res = await app.inject({
    method: "POST", url: "/api/candidate/enrol-finger", headers: bearer(token),
    payload: { examId, roll, ...(await capture(app, stationId, keys, roll)) },
  });
  assert.equal(res.statusCode, 200, res.payload);

  const e = await repo.candidateEnrolment(pool, centreId, examId, roll);
  assert.equal(e!.fingerprintTemplate, FINGER, "the enrolled finger must be what check-in reads");
  after(() => pool.end());
});

test("a capture of ONE candidate cannot enrol another", { skip }, async () => {
  // Without the subject binding, an invigilator holding one signed capture could
  // enrol their own finger against any roll on the sheet — the substitution the
  // biometric exists to prevent, performed with the tool meant to prevent it.
  const { pool, app, examId, stationId, roll, keys, token } = await setup();
  const forSomeoneElse = await capture(app, stationId, keys, roll, "enrol:candidate:ROLL-9999");
  const res = await app.inject({
    method: "POST", url: "/api/candidate/enrol-finger", headers: bearer(token),
    payload: { examId, roll, ...forSomeoneElse },
  });
  assert.equal(res.statusCode, 401);
  assert.equal(J(res).reason, "ENROLMENT_ATTESTATION_INVALID");
  after(() => pool.end());
});

test("enrolling twice is REFUSED, not silently overwritten", { skip }, async () => {
  // The overwrite IS the attack: enrol your own finger over the candidate's,
  // then "verify" them all day.
  const { pool, app, examId, stationId, roll, keys, token } = await setup();
  const first = await app.inject({
    method: "POST", url: "/api/candidate/enrol-finger", headers: bearer(token),
    payload: { examId, roll, ...(await capture(app, stationId, keys, roll)) },
  });
  assert.equal(first.statusCode, 200);

  const second = await app.inject({
    method: "POST", url: "/api/candidate/enrol-finger", headers: bearer(token),
    payload: { examId, roll, ...(await capture(app, stationId, keys, roll)) },
  });
  assert.equal(second.statusCode, 409);
  assert.equal(J(second).reason, "ALREADY_ENROLLED");
  after(() => pool.end());
});

test("a roll from another centre cannot be enrolled here", { skip }, async () => {
  const { pool, app, examId, stationId, keys, token } = await setup();
  const other = "ROLL-ELSEWHERE";
  const res = await app.inject({
    method: "POST", url: "/api/candidate/enrol-finger", headers: bearer(token),
    payload: { examId, roll: other, ...(await capture(app, stationId, keys, other)) },
  });
  assert.equal(res.statusCode, 404);
  assert.equal(J(res).reason, "ROLL_NOT_ON_ROSTER");
  after(() => pool.end());
});

test("the nonce is one-shot — a signed enrolment cannot be replayed", { skip }, async () => {
  const { pool, app, examId, stationId, roll, keys, token } = await setup();
  const c = await capture(app, stationId, keys, roll);
  const first = await app.inject({
    method: "POST", url: "/api/candidate/enrol-finger", headers: bearer(token),
    payload: { examId, roll, ...c },
  });
  assert.equal(first.statusCode, 200);
  const replay = await app.inject({
    method: "POST", url: "/api/candidate/enrol-finger", headers: bearer(token),
    payload: { examId, roll, ...c },
  });
  assert.equal(replay.statusCode, 401);
  assert.equal(J(replay).reason, "CHALLENGE_INVALID");
  after(() => pool.end());
});

test("an unauthenticated caller cannot enrol anyone", { skip }, async () => {
  const { pool, app, examId, stationId, roll, keys } = await setup();
  const res = await app.inject({
    method: "POST", url: "/api/candidate/enrol-finger",
    payload: { examId, roll, ...(await capture(app, stationId, keys, roll)) },
  });
  assert.equal(res.statusCode, 403);
  after(() => pool.end());
});
