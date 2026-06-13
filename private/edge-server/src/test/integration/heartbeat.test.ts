/**
 * §10.2 — seat heartbeat endpoint (zuup-heartbeatd's server half). Health-only
 * telemetry: a known terminal's health + last_seen refresh; an unknown
 * terminal is 404 (never upserted). Needs PostgreSQL; skipped without
 * DATABASE_URL.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { makePool, type Pool } from "../../db.ts";
import { migrate } from "../../migrate.ts";
import { buildApp } from "../../http.ts";
import type { EdgeConfig } from "../../config.ts";

const DB = process.env.DATABASE_URL;
const skip = DB ? false : "set DATABASE_URL to run the heartbeat test";

const config: EdgeConfig = {
  host: "127.0.0.1", port: 0, databaseUrl: DB ?? "", centreId: "test",
  provisioningKey: null,
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

test("heartbeat refreshes health + last_seen; unknown terminal is 404", { skip }, async () => {
  await migrate(DB!);
  pool = makePool(DB!);
  app = buildApp({ pool, config });

  const centreId = randomUUID();
  const terminalId = randomUUID();
  await pool.query(`INSERT INTO centers (id, name) VALUES ($1,'HB-TEST')`, [centreId]);
  await pool.query(
    `INSERT INTO terminals (id, center_id, seat_no, capability, wg_pubkey, state, health)
     VALUES ($1,$2,'HB-1','CANDIDATE_SEAT','wg-hb','AVAILABLE','FAULT')`,
    [terminalId, centreId],
  );

  // OK heartbeat flips health and stamps last_seen
  const ok = await app.inject({ method: "POST", url: "/api/terminal/heartbeat", payload: { terminalId, status: "OK" } });
  assert.equal(ok.statusCode, 200);
  assert.equal(J(ok).ok, true);
  const row = await pool.query(`SELECT health, last_seen FROM terminals WHERE id=$1`, [terminalId]);
  assert.equal(row.rows[0].health, "OK");
  assert.ok(row.rows[0].last_seen !== null, "last_seen stamped");

  // anything not exactly "OK" is recorded as FAULT (no free-text into the DB)
  await app.inject({ method: "POST", url: "/api/terminal/heartbeat", payload: { terminalId, status: "definitely-fine" } });
  const row2 = await pool.query(`SELECT health FROM terminals WHERE id=$1`, [terminalId]);
  assert.equal(row2.rows[0].health, "FAULT");

  // unknown terminal: 404, nothing created
  const unknown = await app.inject({ method: "POST", url: "/api/terminal/heartbeat", payload: { terminalId: randomUUID(), status: "OK" } });
  assert.equal(unknown.statusCode, 404);

  // missing terminal id: 400
  const missing = await app.inject({ method: "POST", url: "/api/terminal/heartbeat", payload: { status: "OK" } });
  assert.equal(missing.statusCode, 400);
});
