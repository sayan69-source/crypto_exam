/**
 * Which identity this machine reports, and to whom.
 *
 * This is the code path a freshly flashed laptop lands on, and getting it wrong
 * costs an install: prefer the placeholder over the commissioned id and a
 * perfectly good machine shows "uncommissioned" forever; let a URL name a
 * station and the kiosk is a machine claiming to be whichever seat someone
 * typed. Neither is visible from a build, and on hardware there may be one boot
 * in which to notice.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REAL = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const ADMIN = "11111111-2222-3333-4444-555555555555";
const SEAT = "99999999-8888-7777-6666-555555555555";

const dir = mkdtempSync(join(tmpdir(), "zuup-identity-"));
process.env.ZUUP_TERMINAL_ID_FILE = join(dir, "etc-terminal-id");
process.env.ZUUP_ROLES_FILE = join(dir, "roles.json");

// Imported AFTER the env is set: the route resolves its paths at module load,
// exactly as it does inside the image.
const { GET } = await import("../app/local/identity/route.ts");

const body = async (): Promise<Record<string, unknown>> =>
  (await (await GET()).json()) as Record<string, unknown>;

test("a machine with no identity at all reports itself uncommissioned", async () => {
  rmSync(process.env.ZUUP_TERMINAL_ID_FILE!, { force: true });
  rmSync(process.env.ZUUP_ROLES_FILE!, { force: true });
  const res = await GET();
  assert.equal(res.status, 503);
  assert.equal((await res.json()).reason, "NO_TERMINAL_IDENTITY");
});

test("a placeholder is not an identity", async () => {
  // The image ships this until an authority commissions the machine. Reading it
  // as an id would have every terminal in the estate share one identity.
  writeFileSync(process.env.ZUUP_TERMINAL_ID_FILE!, "REPLACE-AT-FIRST-BOOT\n");
  const res = await GET();
  assert.equal(res.status, 503);
});

test("a commissioned identity is reported, trimmed and lower-cased", async () => {
  writeFileSync(process.env.ZUUP_TERMINAL_ID_FILE!, `  ${REAL.toUpperCase()}  \n`);
  const j = await body();
  assert.equal(j.ok, true);
  assert.equal(j.terminalId, REAL);
  assert.deepEqual(j.roles, [], "a production terminal publishes no role list");
  assert.equal(j.commissionedVia, "PROVISIONED");
});

test("a self-commissioned machine reports its stations AND says so", async () => {
  rmSync(process.env.ZUUP_TERMINAL_ID_FILE!, { force: true });
  writeFileSync(
    process.env.ZUUP_ROLES_FILE!,
    JSON.stringify({
      commissionedVia: "FIRST_BOOT",
      roles: [
        { role: "ADMIN_STATION", terminalId: ADMIN, seatNo: "ADM-1" },
        { role: "INVIGILATOR_STATION", terminalId: REAL, seatNo: "INV-1" },
        { role: "CANDIDATE_SEAT", terminalId: SEAT, seatNo: "A-01" },
      ],
    }),
  );
  const j = await body();
  assert.equal(j.ok, true);
  assert.equal((j.roles as unknown[]).length, 3);
  assert.equal(j.commissionedVia, "FIRST_BOOT",
    "a machine that vouched for itself must never look like one an authority vouched for");
});

test("junk in the roles file is dropped, not trusted", async () => {
  writeFileSync(
    process.env.ZUUP_ROLES_FILE!,
    JSON.stringify({
      roles: [
        { role: "ADMIN_STATION", terminalId: ADMIN },
        { role: "ROOT_STATION", terminalId: SEAT },        // not a capability
        { role: "CANDIDATE_SEAT", terminalId: "not-a-uuid" },
        { role: "CANDIDATE_SEAT" },                        // no id
      ],
    }),
  );
  const j = await body();
  assert.deepEqual(j.roles, [{ role: "ADMIN_STATION", terminalId: ADMIN }]);
});

test("an unparseable roles file does not take the identity down with it", async () => {
  writeFileSync(process.env.ZUUP_TERMINAL_ID_FILE!, `${REAL}\n`);
  writeFileSync(process.env.ZUUP_ROLES_FILE!, "{ this is not json");
  const j = await body();
  assert.equal(j.ok, true);
  assert.equal(j.terminalId, REAL);
  assert.deepEqual(j.roles, []);
});

// ── the client side of the same contract ────────────────────────────────────
test("?role= selects among the machine's own stations and can invent none", async () => {
  const { terminalIdentity } = await import("./edge.ts");
  globalThis.fetch = mock.fn(async () =>
    new Response(
      JSON.stringify({
        ok: true,
        terminalId: REAL,
        commissionedVia: "FIRST_BOOT",
        roles: [
          { role: "ADMIN_STATION", terminalId: ADMIN },
          { role: "INVIGILATOR_STATION", terminalId: REAL },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  ) as unknown as typeof fetch;

  assert.equal(await terminalIdentity("ADMIN_STATION"), ADMIN);
  assert.equal(await terminalIdentity("INVIGILATOR_STATION"), REAL);
  // Not commissioned as a candidate seat → nothing, rather than a guess.
  assert.equal(await terminalIdentity("CANDIDATE_SEAT"), null);
  assert.equal(await terminalIdentity(), REAL, "no role asked → the primary identity");
});

test("a single-role terminal answers whatever role it is asked for", async () => {
  // Its capability is the Edge's answer, not this list's. Returning null here
  // would lock out every correctly-provisioned machine in the estate.
  const fresh = await import(`./edge.ts?single=${Date.now()}`);
  globalThis.fetch = mock.fn(async () =>
    new Response(JSON.stringify({ ok: true, terminalId: REAL, roles: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;

  assert.equal(await fresh.terminalIdentity("CANDIDATE_SEAT"), REAL);
  assert.equal(await fresh.terminalIdentity("ADMIN_STATION"), REAL);
});

test("a failed read is not cached — commissioning finishes seconds into boot", async () => {
  const fresh = await import(`./edge.ts?retry=${Date.now()}`);
  let attempt = 0;
  globalThis.fetch = mock.fn(async () => {
    attempt++;
    if (attempt === 1) {
      return new Response(JSON.stringify({ ok: false, reason: "NO_TERMINAL_IDENTITY" }), { status: 503 });
    }
    return new Response(JSON.stringify({ ok: true, terminalId: REAL, roles: [] }), { status: 200 });
  }) as unknown as typeof fetch;

  assert.equal(await fresh.terminalIdentity(), null, "not commissioned yet");
  assert.equal(await fresh.terminalIdentity(), REAL, "…and it must pick it up once it is");
});

process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
