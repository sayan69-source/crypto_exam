/**
 * The courier surface, against a real database (§12 in, §13.4 out).
 *
 * `hq-courier.test.ts` pins the refusals, and pins them without a database
 * because refusing before touching one is part of the claim. This is the other
 * half: that the routes the daemon on the admin station actually calls do the
 * work when the credential and the signature are right.
 *
 * It matters more than most integration tests because of who the caller is.
 * There is no operator here to notice a 500 and retry — the courier runs on a
 * timer, on a machine with no shell, in a hall. A route that only works when a
 * human is watching is a route that does not work.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../http.ts";
import { makeNodeSigner } from "../../lib/node-sign.ts";
import { sha256, toHex, utf8, canonicalJson } from "../../lib/crypto.ts";
import { makePool, type Pool } from "../../db.ts";
import type { EdgeConfig } from "../../config.ts";
import type { FastifyInstance } from "fastify";

const DB = process.env.DATABASE_URL;
const CENTRE = "f230876c-b459-4278-a946-6ecd677c0fcb";
const PROV_KEY = "test-provisioning-key";

const hq = makeNodeSigner(new Uint8Array(32).fill(9));
const impostor = makeNodeSigner(new Uint8Array(32).fill(8));

const config: EdgeConfig = {
  host: "127.0.0.1",
  port: 0,
  databaseUrl: DB ?? "",
  centreId: CENTRE,
  provisioningKey: PROV_KEY,
  hqProvisioningPubkey: hq.publicKey,
  systemAdminPublicKeyPem: null,
  argon: { timeCost: 2, memoryCostKiB: 8192, parallelism: 1 },
  tokenSecret: new Uint8Array(32).fill(1),
  bindSecret: new Uint8Array(32).fill(2),
  nodeSignSeed: new Uint8Array(32).fill(3),
  allowFirstBootCommissioning: false,
  fleetPcr: null,
};

let pool: Pool;
let app: FastifyInstance;

const sign = (signer: { signRoot(b: Uint8Array): Uint8Array }, body: unknown) =>
  toHex(signer.signRoot(sha256(utf8.encode(canonicalJson(body)))));

/** The shape HQ's /centre-sync/bundle hands the courier, minimally populated. */
const bundle = (name: string) => ({
  centre: { id: CENTRE, name, state: "WB", district: "Kolkata" },
  exams: [],
  candidates: [],
  staff: [],
  question_bundles: [],
  exam_patterns: [],
});

before(async () => {
  if (!DB) return;
  pool = makePool(DB);
  await pool.query(`DELETE FROM centers WHERE id = $1`, [CENTRE]).catch(() => {});
  app = buildApp({ pool, config });
});

after(async () => {
  if (!DB) return;
  await app?.close();
  await pool?.end();
});

test("a signed bundle is ingested, and the centre row appears", { skip: !DB }, async () => {
  const b = bundle("Dry Run Centre");
  const res = await app.inject({
    method: "POST",
    url: "/api/provisioning/ingest",
    headers: { "x-provisioning-key": PROV_KEY, "x-hq-signature": sign(hq, b) },
    payload: b,
  });
  assert.equal(res.statusCode, 200, res.payload);
  const rows = await pool.query(`SELECT name FROM centers WHERE id = $1`, [CENTRE]);
  assert.equal(rows.rows[0]?.name, "Dry Run Centre");
});

test("ingest is idempotent — a courier retries the whole bundle", { skip: !DB }, async () => {
  // The daemon cannot know whether a POST that timed out was applied, so it
  // re-sends on its next tick. Re-sending must be a no-op, not a duplicate
  // centre or a unique-violation 500 that looks like a permanent fault.
  const b = bundle("Dry Run Centre");
  for (let i = 0; i < 2; i++) {
    const res = await app.inject({
      method: "POST",
      url: "/api/provisioning/ingest",
      headers: { "x-provisioning-key": PROV_KEY, "x-hq-signature": sign(hq, b) },
      payload: b,
    });
    assert.equal(res.statusCode, 200, `attempt ${i + 1}: ${res.payload}`);
  }
  const n = await pool.query(`SELECT count(*)::int c FROM centers WHERE id = $1`, [CENTRE]);
  assert.equal(n.rows[0].c, 1);
});

test("an updated roster from HQ replaces the old one, still under signature", { skip: !DB }, async () => {
  // Every courier run re-pulls: candidates get added, staff get approved, a
  // paper's beacon appears after T₀. So a second, DIFFERENT bundle must apply —
  // and its signature must cover the new bytes, not the old ones.
  const b = bundle("Dry Run Centre (renamed)");
  const res = await app.inject({
    method: "POST",
    url: "/api/provisioning/ingest",
    headers: { "x-provisioning-key": PROV_KEY, "x-hq-signature": sign(hq, b) },
    payload: b,
  });
  assert.equal(res.statusCode, 200, res.payload);
  const rows = await pool.query(`SELECT name FROM centers WHERE id = $1`, [CENTRE]);
  assert.equal(rows.rows[0]?.name, "Dry Run Centre (renamed)");
});

test("yesterday's signature does not authorise today's bundle", { skip: !DB }, async () => {
  const good = bundle("Dry Run Centre (renamed)");
  const tampered = bundle("Attacker's Centre");
  const res = await app.inject({
    method: "POST",
    url: "/api/provisioning/ingest",
    headers: { "x-provisioning-key": PROV_KEY, "x-hq-signature": sign(hq, good) },
    payload: tampered,
  });
  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.payload).reason, "HQ_SIGNATURE_INVALID");
  const rows = await pool.query(`SELECT name FROM centers WHERE id = $1`, [CENTRE]);
  assert.equal(rows.rows[0]?.name, "Dry Run Centre (renamed)", "a refused bundle changed the database");
});

test("a bundle signed by the wrong key is refused with the database untouched", { skip: !DB }, async () => {
  const b = bundle("Impostor Centre");
  const res = await app.inject({
    method: "POST",
    url: "/api/provisioning/ingest",
    headers: { "x-provisioning-key": PROV_KEY, "x-hq-signature": sign(impostor, b) },
    payload: b,
  });
  assert.equal(res.statusCode, 401);
  const rows = await pool.query(`SELECT name FROM centers WHERE id = $1`, [CENTRE]);
  assert.equal(rows.rows[0]?.name, "Dry Run Centre (renamed)");
});

test("courier state answers with this centre's exams and nothing to carry", { skip: !DB }, async () => {
  const res = await app.inject({
    method: "GET",
    url: "/api/courier/state",
    headers: { "x-provisioning-key": PROV_KEY },
  });
  assert.equal(res.statusCode, 200, res.payload);
  const body = JSON.parse(res.payload);
  assert.equal(body.ok, true);
  assert.equal(body.centre, CENTRE);
  assert.ok(Array.isArray(body.exams), "exams must be a list the daemon can walk");
  // With no exam staged there is nothing waiting — the daemon's ordinary answer.
  assert.equal(body.exams.filter((e: { unsynced: number }) => e.unsynced > 0).length, 0);
});

test("the export gate refuses an exam that does not exist, rather than 500ing", { skip: !DB }, async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/courier/ledger/export",
    headers: { "x-provisioning-key": PROV_KEY },
    payload: { examId: "00000000-0000-0000-0000-000000000000" },
  });
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.payload).reason, "UNKNOWN_EXAM");
});

test("the health probe the courier uses to find the Edge's port answers", { skip: !DB }, async () => {
  // zuup-hqsync.sh calls /api/health first to decide whether the Edge is on the
  // bare origin or on :4000. If this route ever moved, the daemon would pick the
  // wrong port for both directions and report it as "the centre link is down".
  const res = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.payload).service, "edge");
});
