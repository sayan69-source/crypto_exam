/**
 * Random terminal auto-assignment (§9.6) — the iON/iLeon hand-off, on LAN.
 *
 * On a successful candidate check-in the Edge atomically picks a uniformly
 * random AVAILABLE candidate seat and binds it to the candidate's roll. The
 * seat (which has been polling) then auto-redirects to the candidate login.
 *
 * Properties:
 *   • uniform random  — ORDER BY random(): no predictable seat to pre-stage.
 *   • atomic          — FOR UPDATE SKIP LOCKED: two invigilators never grab the
 *                       same seat (no double assignment).
 *   • bound           — the seat now accepts only this roll (INV-5).
 *   • fail-closed     — no free seat → explicit NO_FREE_SEAT, never a silent
 *                       fallback.
 */
import type { PoolClient } from "../db.ts";
import { hmacSha256, utf8 } from "../lib/crypto.ts";
import { appendAudit } from "../audit.ts";

export class NoFreeSeatError extends Error {
  constructor() {
    super("NO_FREE_SEAT");
    this.name = "NoFreeSeatError";
  }
}

export interface AssignInput {
  centreId: string;
  examId: string;
  candidateRoll: string;
  invigilatorId: string;
  /** Server-side HMAC key for the one-shot bind token. Never leaves the Edge. */
  bindSecret: Uint8Array;
}

export interface AssignResult {
  seatNo: string;
  terminalId: string;
  bindToken: Uint8Array;
}

/**
 * Assign a random free seat. MUST be called inside a transaction (use
 * `withTx`) so the row lock and the state change commit together.
 */
export async function assignRandomSeat(
  client: PoolClient,
  input: AssignInput,
): Promise<AssignResult> {
  const sel = await client.query(
    `SELECT id, seat_no FROM terminals
       WHERE center_id = $1
         AND capability = 'CANDIDATE_SEAT'
         AND state = 'AVAILABLE'
         AND health = 'OK'
       ORDER BY random()
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
    [input.centreId],
  );
  if (!sel.rowCount) throw new NoFreeSeatError(); // fail-closed

  const seat = sel.rows[0] as { id: string; seat_no: string };
  const bindToken = hmacSha256(
    input.bindSecret,
    utf8.encode(`${seat.id}|${input.candidateRoll}|${Date.now()}`),
  );

  await client.query(`UPDATE terminals SET state = 'ASSIGNED' WHERE id = $1`, [seat.id]);
  await client.query(
    `INSERT INTO seat_bindings
       (terminal_id, center_id, exam_id, candidate_roll, bound_by, bind_token)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [seat.id, input.centreId, input.examId, input.candidateRoll, input.invigilatorId, Buffer.from(bindToken)],
  );
  await appendAudit(client, {
    centerId: input.centreId,
    actorId: input.invigilatorId,
    action: "SEAT_ASSIGNED",
    target: seat.seat_no,
    details: { roll: input.candidateRoll, terminal_id: seat.id },
  });

  return { seatNo: seat.seat_no, terminalId: seat.id, bindToken };
}
