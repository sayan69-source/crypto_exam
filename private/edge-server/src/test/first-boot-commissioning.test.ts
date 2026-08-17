/**
 * The fences around first-boot self-commissioning.
 *
 * Letting a machine register itself is a real trust concession, granted for one
 * deployment: the all-in-one image, where a single laptop IS the centre and no
 * separate authority exists to have registered it beforehand. The concession is
 * only acceptable while it cannot escape that deployment, so the two things
 * that keep it there are asserted here rather than assumed:
 *
 *   1. it is opt-IN, and
 *   2. production overrides the opt-in, whatever the environment says.
 *
 * Both run without a database: the route refuses before it touches one, which
 * is itself the property being checked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../http.ts";
import { loadConfig } from "../config.ts";
import type { Pool } from "../db.ts";
import type { EdgeConfig } from "../config.ts";

const baseConfig: EdgeConfig = {
  host: "127.0.0.1",
  port: 0,
  databaseUrl: "postgres://unused",
  centreId: "11111111-1111-1111-1111-111111111111",
  provisioningKey: null,
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
    throw new Error("the commission route touched the database before refusing");
  },
  connect: () => {
    throw new Error("the commission route opened a transaction before refusing");
  },
} as unknown as Pool;

const payload = {
  terminalId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  seatNo: "ADM-1",
  capability: "ADMIN_STATION",
};

test("an Edge that was not asked to allow it refuses, before any database work", async () => {
  const app = buildApp({ pool: forbiddenPool, config: baseConfig });
  const res = await app.inject({ method: "POST", url: "/api/terminal/commission", payload });
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.payload).reason, "FIRST_BOOT_COMMISSIONING_DISABLED");
  await app.close();
});

test("production refuses even when the environment asks for it", () => {
  // The failure this prevents: an all-in-one unit file, or its env block, copied
  // into a real deployment. A flag that can travel is a flag that will.
  const saved = { ...process.env };
  try {
    process.env.EDGE_ALLOW_FIRST_BOOT_COMMISSION = "true";
    process.env.ZUUP_ENV = "production";
    process.env.EDGE_TOKEN_SECRET = "a".repeat(64);
    process.env.EDGE_BIND_SECRET = "b".repeat(64);
    process.env.EDGE_NODE_SIGN_SEED = "c".repeat(64);
    assert.equal(loadConfig().allowFirstBootCommissioning, false);

    // …and the same environment outside production is honoured, so the
    // all-in-one still works and this test cannot pass vacuously.
    delete process.env.ZUUP_ENV;
    process.env.NODE_ENV = "development";
    assert.equal(loadConfig().allowFirstBootCommissioning, true);
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  }
});

test("only the three real capabilities can be commissioned", async () => {
  const app = buildApp({
    pool: forbiddenPool,
    config: { ...baseConfig, allowFirstBootCommissioning: true },
  });
  for (const capability of ["ROOT_STATION", "", "admin_station"]) {
    const res = await app.inject({
      method: "POST", url: "/api/terminal/commission",
      payload: { ...payload, capability },
    });
    assert.equal(res.statusCode, 400, `capability ${capability || "(empty)"} must be refused`);
  }
  await app.close();
});

test("an incomplete registration is refused before any database work", async () => {
  const app = buildApp({
    pool: forbiddenPool,
    config: { ...baseConfig, allowFirstBootCommissioning: true },
  });
  for (const body of [{}, { terminalId: payload.terminalId }, { seatNo: "A-1", capability: "ADMIN_STATION" }]) {
    const res = await app.inject({ method: "POST", url: "/api/terminal/commission", payload: body });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.payload).reason, "MISSING_FIELDS");
  }
  await app.close();
});
