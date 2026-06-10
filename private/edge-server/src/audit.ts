/**
 * Tamper-evident, hash-chained audit log (§12.7, INV-9 for logs).
 *
 *   entry_hash = SHA-256(prev_hash || canonicalJson(row))
 *
 * Every privilege grant, login verdict, seat assignment, and answer commitment
 * appends a row. Removing or editing any row breaks the chain — `verifyAuditChain`
 * surfaces exactly where. Chain order is the per-centre `seq` identity column.
 */
import type { PoolClient } from "./db.ts";
import { sha256, canonicalJson, utf8, constantTimeEqual } from "./lib/crypto.ts";

const GENESIS = new Uint8Array(32);

export interface AuditRow {
  center_id: string | null;
  actor_id: string | null;
  action: string;
  target: string | null;
  details: unknown;
}

export function computeEntryHash(prevHash: Uint8Array, row: AuditRow): Uint8Array {
  return sha256(prevHash, utf8.encode(canonicalJson(row)));
}

/** Append one hash-chained audit entry within the caller's transaction. */
export async function appendAudit(
  client: PoolClient,
  entry: { centerId: string | null; actorId: string | null; action: string; target?: string | null; details?: unknown },
): Promise<void> {
  const prevRes = await client.query(
    `SELECT entry_hash FROM secure_audit_log
       WHERE center_id IS NOT DISTINCT FROM $1
       ORDER BY seq DESC LIMIT 1`,
    [entry.centerId],
  );
  const prev: Uint8Array =
    prevRes.rowCount && prevRes.rowCount > 0
      ? new Uint8Array(prevRes.rows[0].entry_hash)
      : GENESIS;

  const row: AuditRow = {
    center_id: entry.centerId,
    actor_id: entry.actorId,
    action: entry.action,
    target: entry.target ?? null,
    details: entry.details ?? null,
  };
  const entryHash = computeEntryHash(prev, row);

  await client.query(
    `INSERT INTO secure_audit_log
       (center_id, actor_id, action, target, details, prev_hash, entry_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      entry.centerId,
      entry.actorId,
      entry.action,
      entry.target ?? null,
      entry.details ?? null,
      Buffer.from(prev),
      Buffer.from(entryHash),
    ],
  );
}

/** Re-walk one centre's audit chain and report the first broken seq, if any. */
export async function verifyAuditChain(
  client: PoolClient,
  centerId: string | null,
): Promise<{ ok: boolean; brokenSeq: number | null }> {
  const res = await client.query(
    `SELECT seq, center_id, actor_id, action, target, details, prev_hash, entry_hash
       FROM secure_audit_log
       WHERE center_id IS NOT DISTINCT FROM $1
       ORDER BY seq ASC`,
    [centerId],
  );
  let prev = GENESIS;
  for (const r of res.rows) {
    const row: AuditRow = {
      center_id: r.center_id,
      actor_id: r.actor_id,
      action: r.action,
      target: r.target,
      details: r.details,
    };
    const expected = computeEntryHash(prev, row);
    if (
      !constantTimeEqual(new Uint8Array(r.prev_hash), prev) ||
      !constantTimeEqual(new Uint8Array(r.entry_hash), expected)
    ) {
      return { ok: false, brokenSeq: Number(r.seq) };
    }
    prev = new Uint8Array(r.entry_hash);
  }
  return { ok: true, brokenSeq: null };
}
