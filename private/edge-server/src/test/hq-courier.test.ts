/**
 * The fences around the HQ courier link (§12 in, §13.4 out).
 *
 * The Admin Station carries this centre's provisioning credential on its ESP —
 * a FAT partition outside dm-verity — because the daemon that pulls bundles has
 * no human to log in as. So the credential alone must NOT be enough to write a
 * roster: HQ signs every bundle, and the Edge checks that signature. These
 * tests pin that, and the courier surface's own refusals.
 *
 * All of them run without a database, which is itself the property being
 * checked: every refusal happens before the route touches one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../http.ts";
import { makeNodeSigner } from "../lib/node-sign.ts";
import { sha256, toHex, utf8, canonicalJson } from "../lib/crypto.ts";
import type { Pool } from "../db.ts";
import type { EdgeConfig } from "../config.ts";

const HQ_SEED = new Uint8Array(32).fill(9);
const OTHER_SEED = new Uint8Array(32).fill(8);
const hq = makeNodeSigner(HQ_SEED);
const impostor = makeNodeSigner(OTHER_SEED);

const baseConfig: EdgeConfig = {
  host: "127.0.0.1",
  port: 0,
  databaseUrl: "postgres://unused",
  centreId: "11111111-1111-1111-1111-111111111111",
  provisioningKey: "centre-provisioning-secret",
  hqProvisioningPubkey: hq.publicKey,
  systemAdminPublicKeyPem: null,
  argon: { timeCost: 2, memoryCostKiB: 8192, parallelism: 1 },
  tokenSecret: new Uint8Array(32).fill(1),
  bindSecret: new Uint8Array(32).fill(2),
  nodeSignSeed: new Uint8Array(32).fill(3),
  allowFirstBootCommissioning: false,
  fleetPcr: null,
};

/** A pool the route must never reach — reaching it is the failure. */
const forbiddenPool = {
  query: () => {
    throw new Error("the route touched the database before refusing");
  },
  connect: () => {
    throw new Error("the route opened a transaction before refusing");
  },
} as unknown as Pool;

const bundle = {
  centre: { id: "11111111-1111-1111-1111-111111111111", name: "Test Centre" },
  exams: [],
  candidates: [],
  staff: [],
  question_bundles: [],
  exam_patterns: [],
};

const signWith = (signer: { signRoot(b: Uint8Array): Uint8Array }, body: unknown) =>
  toHex(signer.signRoot(sha256(utf8.encode(canonicalJson(body)))));

test("a bundle with no HQ signature is refused when HQ signing is configured", async () => {
  const app = buildApp({ pool: forbiddenPool, config: baseConfig });
  const res = await app.inject({
    method: "POST",
    url: "/api/provisioning/ingest",
    headers: { "x-provisioning-key": "centre-provisioning-secret" },
    payload: bundle,
  });
  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.payload).reason, "HQ_SIGNATURE_REQUIRED");
  await app.close();
});

test("a bundle signed by anyone other than HQ is refused", async () => {
  const app = buildApp({ pool: forbiddenPool, config: baseConfig });
  const res = await app.inject({
    method: "POST",
    url: "/api/provisioning/ingest",
    headers: {
      "x-provisioning-key": "centre-provisioning-secret",
      "x-hq-signature": signWith(impostor, bundle),
    },
    payload: bundle,
  });
  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.payload).reason, "HQ_SIGNATURE_INVALID");
  await app.close();
});

test("HQ's own signature over a DIFFERENT bundle does not carry over to this one", async () => {
  // The interesting forgery is not a bad key, it is a good signature on the
  // wrong document — a courier replaying yesterday's header onto a roster it
  // edited in transit.
  const app = buildApp({ pool: forbiddenPool, config: baseConfig });
  const tampered = { ...bundle, candidates: [{ id: "x", roll_number: "999" }] };
  const res = await app.inject({
    method: "POST",
    url: "/api/provisioning/ingest",
    headers: {
      "x-provisioning-key": "centre-provisioning-secret",
      "x-hq-signature": signWith(hq, bundle),
    },
    payload: tampered,
  });
  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.payload).reason, "HQ_SIGNATURE_INVALID");
  await app.close();
});

test("a malformed signature is a 400, not a crash", async () => {
  const app = buildApp({ pool: forbiddenPool, config: baseConfig });
  const res = await app.inject({
    method: "POST",
    url: "/api/provisioning/ingest",
    headers: {
      "x-provisioning-key": "centre-provisioning-secret",
      "x-hq-signature": "not-hex",
    },
    payload: bundle,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.payload).reason, "HQ_SIGNATURE_MALFORMED");
  await app.close();
});

test("the wrong provisioning key is refused before the signature is even considered", async () => {
  const app = buildApp({ pool: forbiddenPool, config: baseConfig });
  const res = await app.inject({
    method: "POST",
    url: "/api/provisioning/ingest",
    headers: {
      "x-provisioning-key": "wrong",
      "x-hq-signature": signWith(hq, bundle),
    },
    payload: bundle,
  });
  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.payload).reason, "BAD_PROVISIONING_KEY");
  await app.close();
});

test("courier routes refuse an unauthenticated caller", async () => {
  const app = buildApp({ pool: forbiddenPool, config: baseConfig });
  for (const [method, url] of [
    ["GET", "/api/courier/state"],
    ["POST", "/api/courier/ledger/export"],
  ] as const) {
    const res = await app.inject({ method, url, payload: { examId: "e" } });
    assert.equal(res.statusCode, 401, `${method} ${url}`);
    assert.equal(JSON.parse(res.payload).reason, "BAD_PROVISIONING_KEY");
  }
  await app.close();
});

test("an Edge with no provisioning key configured has no courier surface at all", async () => {
  // Fail-closed: an unconfigured Edge must not accept an empty credential as a
  // match for its own empty one.
  const app = buildApp({
    pool: forbiddenPool,
    config: { ...baseConfig, provisioningKey: null },
  });
  const res = await app.inject({
    method: "GET",
    url: "/api/courier/state",
    headers: { "x-provisioning-key": "" },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("an unsigned deployment still accepts a key-only bundle (all-in-one, tests)", async () => {
  // With no HQ public key configured there is nothing to verify against, and
  // requiring a signature anyway would break the demo image, which has no HQ.
  // The route must get PAST the signature stage — proven here by it reaching
  // the database, which the forbidden pool turns into a 400 rather than a 401.
  const app = buildApp({
    pool: forbiddenPool,
    config: { ...baseConfig, hqProvisioningPubkey: null },
  });
  const res = await app.inject({
    method: "POST",
    url: "/api/provisioning/ingest",
    headers: { "x-provisioning-key": "centre-provisioning-secret" },
    payload: bundle,
  });
  assert.notEqual(res.statusCode, 401);
  await app.close();
});
