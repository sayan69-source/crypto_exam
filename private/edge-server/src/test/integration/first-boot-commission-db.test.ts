/**
 * First-boot self-commissioning, against a real database.
 *
 * `first-boot-commissioning.test.ts` covers the FENCES — opt-in, production
 * override, bad capability, missing fields — and every one of those refuses
 * before touching a database, which is the property it is checking. The
 * consequence was that the route's HAPPY PATH had never once been executed
 * against Postgres, and two faults lived there undisturbed until an image was
 * flashed onto a laptop:
 *
 *   1. `commissionSelf` writes `commissioned_via`, `commissioned_at`,
 *      `ak_pubkey_pem` and `bio_pubkey_pem` — four columns added by migrations
 *      003-005. The image's baked dump had been captured from a database that
 *      stopped at 002, so every request answered
 *      `500 column "commissioned_via" does not exist`. The build now checks the
 *      dump, but this test is what makes the code/schema agreement a thing CI
 *      asserts on every push rather than something a flash discovers.
 *
 *   2. `(center_id, seat_no)` is UNIQUE and the machine picks its own seat
 *      labels, so an Edge that already holds ADM-1 met a raw 23505 — answered
 *      as `{"statusCode":500,"error":"Internal Server Error"}`, with no `reason`
 *      for the commissioning script to read. On a machine with no shell, an
 *      unnamed 500 is the end of the investigation.
 *
 * The payloads below are the shape `zuup-commission.sh` actually sends from a
 * machine with NO TPM — `goldenPcr: null`, `akPubkeyPem: null` — because that is
 * the machine this image is for: a 2011 laptop with no TPM 2.0.
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
import { makeStationKeys } from "../helpers/commissioning.ts";

const DB = process.env.DATABASE_URL;
const skip = DB ? false : "set DATABASE_URL to run first-boot commissioning against a database";

let pool: Pool | null = null;
const apps: FastifyInstance[] = [];
after(async () => {
  for (const a of apps) await a.close();
  if (pool) await pool.end();
});

/**
 * A fresh centre per test. The seat-uniqueness this file is about is scoped to
 * `center_id`, so sharing one would make the tests depend on their own order.
 */
function edgeFor(centreId: string): EdgeConfig {
  return {
    host: "127.0.0.1", port: 0, databaseUrl: DB ?? "", centreId,
    provisioningKey: null, systemAdminPublicKeyPem: null,
    argon: { timeCost: 2, memoryCostKiB: 8192, parallelism: 1 },
    tokenSecret: new Uint8Array(32).fill(1),
    bindSecret: new Uint8Array(32).fill(2),
    nodeSignSeed: new Uint8Array(32).fill(3),
    allowFirstBootCommissioning: true,
    fleetPcr: null,
  };
}

async function edge(centreId: string): Promise<FastifyInstance> {
  const app = buildApp({ pool: pool!, config: edgeFor(centreId) });
  apps.push(app);
  return app;
}

const J = (r: { payload: string }) => JSON.parse(r.payload);

/** What a machine with no TPM 2.0 posts: a daemon key, and nothing else. */
const noTpmBody = (seatNo: string, capability: string, bioPubkeyPem: string) => ({
  terminalId: randomUUID(),
  seatNo,
  capability,
  centreName: "Self-commissioned centre",
  wgPubkey: `self:${seatNo}`,
  goldenPcr: null,
  akPubkeyPem: null,
  bioPubkeyPem,
});

test("a machine with no TPM commissions its three stations into an empty centre", { skip }, async () => {
  await migrate(DB!);
  pool = makePool(DB!);
  const centreId = randomUUID();
  const app = await edge(centreId);
  const { bioPubkeyPem } = makeStationKeys();

  const stations = [
    ["ADM-1", "ADMIN_STATION"],
    ["INV-1", "INVIGILATOR_STATION"],
    ["A-01", "CANDIDATE_SEAT"],
  ] as const;

  for (const [seatNo, capability] of stations) {
    const payload = noTpmBody(seatNo, capability, bioPubkeyPem);
    const res = await app.inject({ method: "POST", url: "/api/terminal/commission", payload });

    // Stated separately from the 200 assert: a 500 here is the failure this
    // whole file exists for, and it deserves to name itself in the output
    // rather than arriving as "expected 500 to equal 200".
    assert.notEqual(res.statusCode, 500, `${capability}: the Edge threw — ${res.payload}`);
    assert.equal(res.statusCode, 200, `${capability}: ${res.payload}`);

    const body = J(res);
    assert.equal(body.ok, true);
    assert.equal(body.commissionedVia, "FIRST_BOOT");
    // No TPM: the machine must be told plainly that the TPM factor is
    // unavailable to it, not left to discover it at a login three screens later.
    assert.equal(body.canAttest, false);
    assert.equal(body.canCaptureBiometrics, true);

    const [reg] = (
      await pool.query(
        `SELECT capability, commissioned_via, commissioned_at, bio_pubkey_pem, ak_pubkey_pem, golden_pcr
           FROM terminals WHERE id = $1`,
        [payload.terminalId],
      )
    ).rows as Array<{
      capability: string;
      commissioned_via: string;
      commissioned_at: Date | null;
      bio_pubkey_pem: string | null;
      ak_pubkey_pem: string | null;
      golden_pcr: Record<string, string> | null;
    }>;
    assert.ok(reg, `${capability}: no registry row was written`);
    assert.equal(reg.capability, capability);
    assert.equal(reg.commissioned_via, "FIRST_BOOT");
    assert.notEqual(reg.commissioned_at, null);
    assert.equal(reg.bio_pubkey_pem, bioPubkeyPem);
    assert.equal(reg.ak_pubkey_pem, null);
    assert.equal(reg.golden_pcr, null);
  }

  // The centre row is created by the first station: on an all-in-one there is
  // nobody else to have created it.
  assert.equal(
    (await pool.query(`SELECT name FROM centers WHERE id = $1`, [centreId])).rowCount,
    1,
  );
});

test("a seat the centre already holds is refused by name, not by a 500", { skip }, async () => {
  const centreId = randomUUID();
  const app = await edge(centreId);
  const { bioPubkeyPem } = makeStationKeys();

  const first = await app.inject({
    method: "POST", url: "/api/terminal/commission",
    payload: noTpmBody("ADM-1", "ADMIN_STATION", bioPubkeyPem),
  });
  assert.equal(first.statusCode, 200, first.payload);

  // A different machine (or the same one after a reflash) asking for the seat
  // that is already registered. `(center_id, seat_no)` is UNIQUE, so before the
  // explicit check this reached Postgres and came back as an unnamed 500.
  const second = await app.inject({
    method: "POST", url: "/api/terminal/commission",
    payload: noTpmBody("ADM-1", "ADMIN_STATION", bioPubkeyPem),
  });
  assert.notEqual(second.statusCode, 500, `an unnamed 500 tells the operator nothing — ${second.payload}`);
  assert.equal(second.statusCode, 409);
  assert.equal(J(second).reason, "SEAT_ALREADY_REGISTERED");
});

test("a terminal id already in the registry cannot be re-keyed or re-measured", { skip }, async () => {
  const centreId = randomUUID();
  const app = await edge(centreId);
  const { bioPubkeyPem } = makeStationKeys();
  const payload = noTpmBody("INV-1", "INVIGILATOR_STATION", bioPubkeyPem);

  assert.equal(
    (await app.inject({ method: "POST", url: "/api/terminal/commission", payload })).statusCode,
    200,
  );

  // Same id, different seat and different keys — the case that would turn "this
  // is the software that first ran here" into "this is whatever ran here last".
  const again = await app.inject({
    method: "POST", url: "/api/terminal/commission",
    payload: { ...payload, seatNo: "INV-2", bioPubkeyPem: makeStationKeys("other").bioPubkeyPem },
  });
  assert.notEqual(again.statusCode, 500, again.payload);
  assert.equal(again.statusCode, 409);
  assert.equal(J(again).reason, "ALREADY_COMMISSIONED");

  // …and nothing about the existing row moved.
  const [reg] = (
    await pool!.query(`SELECT seat_no, bio_pubkey_pem FROM terminals WHERE id = $1`, [
      payload.terminalId,
    ])
  ).rows as Array<{ seat_no: string; bio_pubkey_pem: string | null }>;
  assert.ok(reg, "the original registry row disappeared");
  assert.equal(reg.seat_no, "INV-1");
  assert.equal(reg.bio_pubkey_pem, bioPubkeyPem);
});
