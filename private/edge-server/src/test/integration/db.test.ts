/**
 * DB-backed invariants (need PostgreSQL): INV-7 and no-double-seat. Plus the
 * audit hash-chain (INV-9 for logs). These guarantees are *DB properties* — a
 * partial unique index and FOR UPDATE SKIP LOCKED — so they can only be proven
 * against a real engine.
 *
 *   docker compose -f private/edge-server/docker-compose.yml up -d
 *   DATABASE_URL=postgres://zuup:zuup@127.0.0.1:5433/zuup_edge \
 *     node --test --experimental-strip-types "src/test/integration/*.test.ts"
 *
 * Without DATABASE_URL the whole file is skipped (so the default unit run stays
 * green on machines with no database).
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { makePool, withTx, type Pool } from "../../db.ts";
import { migrate } from "../../migrate.ts";
import { assignRandomSeat, NoFreeSeatError } from "../../services/assignment-service.ts";
import { appendAudit, verifyAuditChain } from "../../audit.ts";

const DB = process.env.DATABASE_URL;
const skip = DB ? false : "set DATABASE_URL to run DB integration tests";

let pool: Pool | null = null;
let migrated = false;

async function ensurePool(max = 24): Promise<Pool> {
  if (!migrated) {
    await migrate(DB!); // idempotent
    migrated = true;
  }
  if (!pool) pool = makePool(DB!, max);
  return pool;
}

after(async () => {
  if (pool) await pool.end();
});

const DUMMY = Buffer.from("00", "hex");

async function seedCentre(p: Pool): Promise<{ centreId: string; examId: string; invigId: string }> {
  const centreId = randomUUID();
  const examId = randomUUID();
  const invigId = randomUUID();
  await p.query(`INSERT INTO centers (id, name) VALUES ($1, $2)`, [centreId, `C-${centreId.slice(0, 8)}`]);
  await p.query(`INSERT INTO exams (id, name, scheduled_at) VALUES ($1, $2, NOW())`, [examId, "Test Exam"]);
  await p.query(
    `INSERT INTO staff_identities (id, role, center_id, full_name, face_embedding_hash, fingerprint_template, status)
     VALUES ($1, 'CENTER_INVIGILATOR', $2, 'Invig', $3, $3, 'ACTIVE')`,
    [invigId, centreId, DUMMY],
  );
  return { centreId, examId, invigId };
}

// ── INV-7: one active Centre Admin per centre ────────────────────────────
test("INV-7: a second ACTIVE Centre Admin is rejected by the partial unique index", { skip }, async () => {
  const p = await ensurePool();
  const centreId = randomUUID();
  await p.query(`INSERT INTO centers (id, name) VALUES ($1, 'C')`, [centreId]);

  const insertAdmin = (status: string) =>
    p.query(
      `INSERT INTO staff_identities (role, center_id, full_name, face_embedding_hash, fingerprint_template, status)
       VALUES ('CENTER_ADMIN', $1, 'Admin', $2, $2, $3)`,
      [centreId, DUMMY, status],
    );

  await insertAdmin("ACTIVE"); // first active admin: fine
  await assert.rejects(() => insertAdmin("ACTIVE"), /duplicate key|one_active_center_admin|unique/i,
    "second ACTIVE admin must violate the partial unique index");

  // A PENDING admin alongside the ACTIVE one is allowed.
  await assert.doesNotReject(() => insertAdmin("PENDING_APPROVAL"));

  // After revoking the first, a new ACTIVE admin succeeds.
  await p.query(`UPDATE staff_identities SET status='REVOKED' WHERE center_id=$1 AND status='ACTIVE'`, [centreId]);
  await assert.doesNotReject(() => insertAdmin("ACTIVE"), "one revoked → a fresh ACTIVE admin is allowed");
});

// ── No double seat assignment under concurrency ──────────────────────────
test("no two invigilators are ever assigned the same seat (FOR UPDATE SKIP LOCKED)", { skip }, async () => {
  const p = await ensurePool();
  const { centreId, examId, invigId } = await seedCentre(p);

  const SEATS = 8;
  const CONTENDERS = 20; // more candidates than seats → some must fail-closed
  for (let i = 0; i < SEATS; i++) {
    await p.query(
      `INSERT INTO terminals (center_id, seat_no, capability, wg_pubkey, state, health)
       VALUES ($1, $2, 'CANDIDATE_SEAT', $3, 'AVAILABLE', 'OK')`,
      [centreId, `S-${i}`, `wg-${i}`],
    );
  }

  const bindSecret = new Uint8Array(32).fill(7);
  const attempts = Array.from({ length: CONTENDERS }, (_, i) =>
    withTx(p, (c) =>
      assignRandomSeat(c, {
        centreId,
        examId,
        candidateRoll: `R-${i}`,
        invigilatorId: invigId,
        bindSecret,
      }),
    ),
  );

  const results = await Promise.allSettled(attempts);
  const ok = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ seatNo: string }>[];
  const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

  assert.equal(ok.length, SEATS, "exactly SEATS assignments succeed");
  assert.equal(failed.length, CONTENDERS - SEATS, "the rest fail-closed");
  for (const f of failed) assert.ok(f.reason instanceof NoFreeSeatError, "failures are NO_FREE_SEAT, never a silent fallback");

  // Every successful seat is distinct.
  const seats = ok.map((r) => r.value.seatNo);
  assert.equal(new Set(seats).size, SEATS, "no seat assigned twice");

  // DB agrees: one binding per terminal, all terminals now ASSIGNED.
  const bindings = await p.query(`SELECT terminal_id FROM seat_bindings WHERE center_id=$1`, [centreId]);
  assert.equal(bindings.rowCount, SEATS);
  assert.equal(new Set(bindings.rows.map((r) => r.terminal_id)).size, SEATS, "one binding per terminal");
  const assigned = await p.query(`SELECT count(*) FROM terminals WHERE center_id=$1 AND state='ASSIGNED'`, [centreId]);
  assert.equal(Number(assigned.rows[0].count), SEATS);
});

// ── INV-9 (logs): the audit hash-chain detects tampering ─────────────────
test("INV-9: editing an audit row breaks the hash-chain", { skip }, async () => {
  const p = await ensurePool();
  const centreId = randomUUID();
  await p.query(`INSERT INTO centers (id, name) VALUES ($1, 'C')`, [centreId]);

  await withTx(p, async (c) => {
    await appendAudit(c, { centerId: centreId, actorId: null, action: "CODE_ISSUED", target: "req-1", details: { a: 1 } });
    await appendAudit(c, { centerId: centreId, actorId: null, action: "IDENTITY_ACTIVATED", target: "req-1", details: { a: 2 } });
    await appendAudit(c, { centerId: centreId, actorId: null, action: "SEAT_ASSIGNED", target: "S-3", details: { a: 3 } });
  });

  const client = await p.connect();
  try {
    const before = await verifyAuditChain(client, centreId);
    assert.equal(before.ok, true, "fresh chain verifies");

    // Tamper: edit the details of the middle row.
    await client.query(
      `UPDATE secure_audit_log SET details = '{"a": 999}'
         WHERE center_id=$1 AND action='IDENTITY_ACTIVATED'`,
      [centreId],
    );
    const after = await verifyAuditChain(client, centreId);
    assert.equal(after.ok, false, "tampered chain is detected");
    assert.ok(after.brokenSeq !== null);
  } finally {
    client.release();
  }
});
