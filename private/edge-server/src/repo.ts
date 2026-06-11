/**
 * Centre Edge persistence (§12 tables ↔ §9 flows). Pure data access; the
 * security *rules* live in services/approval.ts, lib/match-all.ts, etc. Every
 * read is centre-scoped by the caller. Writes happen inside the caller's
 * transaction so they commit atomically with the audit entry.
 */
import pg from "pg";
import type { ApprovalRecord, ApprovalKind } from "./services/approval.ts";
import { toHex } from "./lib/crypto.ts";

type Q = pg.Pool | pg.PoolClient;

const bytes = (b: unknown): Uint8Array => new Uint8Array(b as Buffer);

// ── Registration (§9.2 step 3) ───────────────────────────────────────────
export interface RegisterInvigilatorInput {
  centerId: string;
  fullName: string;
  faceEmbeddingHash: Uint8Array;
  fingerprintTemplate: Uint8Array;
  boundIp: string | null;
  boundTerminalId: string | null;
}

export async function createInvigilatorRegistration(
  client: pg.PoolClient,
  input: RegisterInvigilatorInput,
): Promise<{ identityId: string; requestId: string }> {
  const ident = await client.query(
    `INSERT INTO staff_identities
       (role, center_id, full_name, face_embedding_hash, fingerprint_template, bound_ip, bound_terminal_id, status)
     VALUES ('CENTER_INVIGILATOR', $1, $2, $3, $4, $5, $6, 'PENDING_APPROVAL')
     RETURNING id`,
    [
      input.centerId,
      input.fullName,
      Buffer.from(input.faceEmbeddingHash),
      Buffer.from(input.fingerprintTemplate),
      input.boundIp,
      input.boundTerminalId,
    ],
  );
  const identityId = ident.rows[0].id as string;
  const req = await client.query(
    `INSERT INTO approval_requests (kind, applicant_identity_id, center_id, status)
     VALUES ('INVIGILATOR_REGISTRATION', $1, $2, 'PENDING_APPROVAL')
     RETURNING id`,
    [identityId, input.centerId],
  );
  return { identityId, requestId: req.rows[0].id as string };
}

/**
 * Create a PENDING Centre Admin registration (§10.1, tier-1 onboarding). Same
 * shape as the invigilator path but the applicant role is CENTER_ADMIN and the
 * request kind is CENTER_ADMIN_REGISTRATION — which, by canApprove(), only a
 * SYSTEM_ADMIN (tier-0) may ever approve. The centre's `one_active_center_admin`
 * unique index still guarantees at most one ACTIVE Centre Admin per centre at
 * activation time (INV-7).
 */
export async function createCenterAdminRegistration(
  client: pg.PoolClient,
  input: RegisterInvigilatorInput,
): Promise<{ identityId: string; requestId: string }> {
  const ident = await client.query(
    `INSERT INTO staff_identities
       (role, center_id, full_name, face_embedding_hash, fingerprint_template, bound_ip, bound_terminal_id, status)
     VALUES ('CENTER_ADMIN', $1, $2, $3, $4, $5, $6, 'PENDING_APPROVAL')
     RETURNING id`,
    [
      input.centerId,
      input.fullName,
      Buffer.from(input.faceEmbeddingHash),
      Buffer.from(input.fingerprintTemplate),
      input.boundIp,
      input.boundTerminalId,
    ],
  );
  const identityId = ident.rows[0].id as string;
  const req = await client.query(
    `INSERT INTO approval_requests (kind, applicant_identity_id, center_id, status)
     VALUES ('CENTER_ADMIN_REGISTRATION', $1, $2, 'PENDING_APPROVAL')
     RETURNING id`,
    [identityId, input.centerId],
  );
  return { identityId, requestId: req.rows[0].id as string };
}

// ── Approval record mapping (approval_requests row ↔ ApprovalRecord) ──────
function rowToApproval(r: Record<string, unknown>): ApprovalRecord {
  return {
    id: r.id as string,
    kind: r.kind as ApprovalKind,
    applicantIdentityId: r.applicant_identity_id as string,
    centerId: (r.center_id as string | null) ?? null,
    codeHash: r.code_hash ? bytes(r.code_hash) : null,
    codeTtl: r.code_ttl ? new Date(r.code_ttl as string).getTime() : null,
    codeConsumed: Boolean(r.code_consumed),
    fingerprintAuthorised: Boolean(r.fingerprint_authorised),
    status: r.status as ApprovalRecord["status"],
  };
}

export async function getApproval(q: Q, requestId: string): Promise<ApprovalRecord | null> {
  const res = await q.query(`SELECT * FROM approval_requests WHERE id = $1`, [requestId]);
  return res.rowCount ? rowToApproval(res.rows[0]) : null;
}

export async function saveApproval(
  client: pg.PoolClient,
  record: ApprovalRecord,
  approverId: string | null,
): Promise<void> {
  await client.query(
    `UPDATE approval_requests SET
       code_hash = $2, code_ttl = $3, code_consumed = $4,
       fingerprint_authorised = $5, status = $6::identity_status,
       approver_identity_id = COALESCE($7, approver_identity_id),
       resolved_at = CASE WHEN $6::identity_status = 'ACTIVE' THEN NOW() ELSE resolved_at END
     WHERE id = $1`,
    [
      record.id,
      record.codeHash ? Buffer.from(record.codeHash) : null,
      record.codeTtl ? new Date(record.codeTtl).toISOString() : null,
      record.codeConsumed,
      record.fingerprintAuthorised,
      record.status,
      approverId,
    ],
  );
}

export async function listPendingApprovals(
  q: Q,
  centerId: string,
): Promise<Array<{ requestId: string; applicantName: string; kind: string; fingerprintAuthorised: boolean }>> {
  const res = await q.query(
    `SELECT ar.id AS request_id, ar.kind, ar.fingerprint_authorised, si.full_name
       FROM approval_requests ar
       JOIN staff_identities si ON si.id = ar.applicant_identity_id
      WHERE ar.center_id = $1 AND ar.status = 'PENDING_APPROVAL'
      ORDER BY ar.created_at ASC`,
    [centerId],
  );
  return res.rows.map((r) => ({
    requestId: r.request_id,
    applicantName: r.full_name,
    kind: r.kind,
    fingerprintAuthorised: Boolean(r.fingerprint_authorised),
  }));
}

/**
 * §13.5 — every PENDING Centre Admin registration across ALL centres, for the
 * System Admin (tier-0) approval queue. Unlike listPendingApprovals this is NOT
 * centre-scoped: the System Admin oversees the whole estate. Invigilator
 * registrations are deliberately excluded — those are a Centre Admin concern.
 */
export async function listPendingCenterAdminApprovals(
  q: Q,
): Promise<Array<{ requestId: string; applicantName: string; centerId: string; centreName: string; fingerprintAuthorised: boolean; codeIssued: boolean }>> {
  const res = await q.query(
    `SELECT ar.id AS request_id, ar.fingerprint_authorised,
            (ar.code_hash IS NOT NULL AND ar.code_consumed = FALSE) AS code_issued,
            ar.center_id, si.full_name, c.name AS centre_name
       FROM approval_requests ar
       JOIN staff_identities si ON si.id = ar.applicant_identity_id
       JOIN centers c ON c.id = ar.center_id
      WHERE ar.kind = 'CENTER_ADMIN_REGISTRATION' AND ar.status = 'PENDING_APPROVAL'
      ORDER BY ar.created_at ASC`,
  );
  return res.rows.map((r) => ({
    requestId: r.request_id,
    applicantName: r.full_name,
    centerId: r.center_id,
    centreName: r.centre_name,
    fingerprintAuthorised: Boolean(r.fingerprint_authorised),
    codeIssued: Boolean(r.code_issued),
  }));
}

/** Centre directory (id/name/state only) — feeds the public-website staff
 * registration form over the HQ relay. Deliberately free of counts or PII. */
export async function listCentres(
  q: Q,
): Promise<Array<{ centerId: string; name: string; state: string | null }>> {
  const res = await q.query(`SELECT id, name, state FROM centers ORDER BY name`);
  return res.rows.map((r) => ({ centerId: r.id, name: r.name, state: r.state ?? null }));
}

// ── System Admin oversight (§13.5) — per-centre rollup across the estate ───
export interface CentreOverviewRow {
  centerId: string;
  centreName: string;
  state: string | null;
  centerAdminsActive: number;
  centerAdminPending: number;
  invigilatorsActive: number;
  invigilatorsPending: number;
  candidatesRegistered: number;
  bundlesHeld: number;
  bundlesSynced: number;
}

/**
 * One row per centre with the headline counts a System Admin needs: how many
 * Centre Admins / invigilators / candidates each centre holds, plus how many
 * sealed answer bundles are held vs already synced to HQ. Pure read; no PII —
 * counts only.
 */
export async function systemOverview(q: Q): Promise<CentreOverviewRow[]> {
  const res = await q.query(
    `SELECT c.id AS center_id, c.name AS centre_name, c.state,
        (SELECT count(*) FROM staff_identities s WHERE s.center_id=c.id AND s.role='CENTER_ADMIN'        AND s.status='ACTIVE')           AS ca_active,
        (SELECT count(*) FROM staff_identities s WHERE s.center_id=c.id AND s.role='CENTER_ADMIN'        AND s.status='PENDING_APPROVAL') AS ca_pending,
        (SELECT count(*) FROM staff_identities s WHERE s.center_id=c.id AND s.role='CENTER_INVIGILATOR'  AND s.status='ACTIVE')           AS inv_active,
        (SELECT count(*) FROM staff_identities s WHERE s.center_id=c.id AND s.role='CENTER_INVIGILATOR'  AND s.status='PENDING_APPROVAL') AS inv_pending,
        (SELECT count(*) FROM enrollments  e WHERE e.center_id=c.id)                                                                      AS cand,
        (SELECT count(*) FROM answer_ledger a WHERE a.center_id=c.id AND a.sync_state='SEALED')                                           AS held,
        (SELECT count(*) FROM answer_ledger a WHERE a.center_id=c.id AND a.sync_state IN ('SYNCED','DECRYPTED','ANCHORED'))               AS synced
       FROM centers c
      ORDER BY c.name`,
  );
  return res.rows.map((r) => ({
    centerId: r.center_id,
    centreName: r.centre_name,
    state: r.state ?? null,
    centerAdminsActive: Number(r.ca_active),
    centerAdminPending: Number(r.ca_pending),
    invigilatorsActive: Number(r.inv_active),
    invigilatorsPending: Number(r.inv_pending),
    candidatesRegistered: Number(r.cand),
    bundlesHeld: Number(r.held),
    bundlesSynced: Number(r.synced),
  }));
}

// ── Identity ──────────────────────────────────────────────────────────────
export interface IdentityRow {
  id: string;
  role: string;
  centerId: string | null;
  status: string;
  boundIp: string | null;
  boundTerminalId: string | null;
  revoked: boolean;
}

function rowToIdentity(r: Record<string, unknown>): IdentityRow {
  return {
    id: r.id as string,
    role: r.role as string,
    centerId: (r.center_id as string | null) ?? null,
    status: r.status as string,
    boundIp: (r.bound_ip as string | null) ?? null,
    boundTerminalId: (r.bound_terminal_id as string | null) ?? null,
    revoked: r.status === "REVOKED" || r.revoked_at != null,
  };
}

export async function getIdentity(q: Q, id: string): Promise<IdentityRow | null> {
  const res = await q.query(`SELECT * FROM staff_identities WHERE id = $1`, [id]);
  return res.rowCount ? rowToIdentity(res.rows[0]) : null;
}

/** Look up the privileged identity for a login (§9.1) by centre + bound IP. */
export async function findPrivilegedByBoundIp(
  q: Q,
  opts: { centerId: string | null; role: string; boundIp: string },
): Promise<IdentityRow | null> {
  const res = await q.query(
    `SELECT * FROM staff_identities
       WHERE role = $1 AND bound_ip = $2 AND (center_id IS NOT DISTINCT FROM $3)
       ORDER BY created_at DESC LIMIT 1`,
    [opts.role, opts.boundIp, opts.centerId],
  );
  return res.rowCount ? rowToIdentity(res.rows[0]) : null;
}

/** Look up the invigilator bound to a station terminal (§9.1 login challenge). */
export async function findInvigilatorByStation(q: Q, terminalId: string): Promise<IdentityRow | null> {
  return findStaffByStation(q, "CENTER_INVIGILATOR", terminalId);
}

/** Look up the privileged staff (invigilator/centre admin) bound to a station. */
export async function findStaffByStation(q: Q, role: string, terminalId: string): Promise<IdentityRow | null> {
  const res = await q.query(
    `SELECT * FROM staff_identities
       WHERE role = $1 AND bound_terminal_id = $2
       ORDER BY created_at DESC LIMIT 1`,
    [role, terminalId],
  );
  return res.rowCount ? rowToIdentity(res.rows[0]) : null;
}

// ── Blind-courier answer ledger (§10.3) — HASHES ONLY, never key material ──
export interface LedgerHashRow {
  leafIndex: number;
  leafHash: string; // hex
  chainRoot: string; // hex
  nodeRootSig: string; // hex
  syncState: string;
}

/**
 * List held answer bundles as hashes + sync state ONLY. There is intentionally
 * no ciphertext, no wrapped DK, and (by schema) no decryption key — the centre
 * is a blind courier (INV-6).
 */
export async function listLedgerHashes(q: Q, centerId: string): Promise<LedgerHashRow[]> {
  const res = await q.query(
    `SELECT leaf_index, leaf_hash, chain_root, node_root_sig, sync_state
       FROM answer_ledger WHERE center_id = $1 ORDER BY leaf_index ASC`,
    [centerId],
  );
  return res.rows.map((r) => ({
    leafIndex: Number(r.leaf_index),
    leafHash: toHex(bytes(r.leaf_hash)),
    chainRoot: toHex(bytes(r.chain_root)),
    nodeRootSig: toHex(bytes(r.node_root_sig)),
    syncState: r.sync_state as string,
  }));
}

// ── Answer ingest (§11.3 / §13.3) ─────────────────────────────────────────
/**
 * Serialise appends for one (centre, exam) chain and return the previous
 * chain point. Advisory xact lock (not row FOR UPDATE) so the very first
 * append — when there is no row to lock — is serialised too.
 */
export async function lockChainTail(
  client: pg.PoolClient,
  centerId: string,
  examId: string,
): Promise<{ leafIndex: number; chainRoot: Uint8Array } | null> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))`, [centerId, examId]);
  const res = await client.query(
    `SELECT leaf_index, chain_root FROM answer_ledger
      WHERE center_id=$1 AND exam_id=$2 ORDER BY leaf_index DESC LIMIT 1`,
    [centerId, examId],
  );
  if (!res.rowCount) return null;
  return { leafIndex: Number(res.rows[0].leaf_index), chainRoot: bytes(res.rows[0].chain_root) };
}

export interface AppendAnswerInput {
  centerId: string;
  examId: string;
  seatNo: string | null;
  leafIndex: number;
  leaf: Uint8Array;
  prevRoot: Uint8Array;
  chainRoot: Uint8Array;
  nodeRootSig: Uint8Array;
  ciphertext: Uint8Array;
  iv: Uint8Array;
  authTag: Uint8Array;
  wrappedDk: Uint8Array;
}

/** Persist one sealed submission — ciphertext + hashes only (INV-6). */
export async function appendAnswer(client: pg.PoolClient, a: AppendAnswerInput): Promise<void> {
  await client.query(
    `INSERT INTO answer_ledger
       (center_id, exam_id, seat_no, leaf_index, leaf_hash, prev_root, chain_root,
        node_root_sig, ciphertext, iv, auth_tag, wrapped_dk, sync_state)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'SEALED')`,
    [
      a.centerId, a.examId, a.seatNo, a.leafIndex,
      Buffer.from(a.leaf), Buffer.from(a.prevRoot), Buffer.from(a.chainRoot),
      Buffer.from(a.nodeRootSig), Buffer.from(a.ciphertext), Buffer.from(a.iv),
      Buffer.from(a.authTag), Buffer.from(a.wrappedDk),
    ],
  );
}

export interface ReceiptRow {
  leafIndex: number;
  leaf: Uint8Array;
  prevRoot: Uint8Array;
  chainRoot: Uint8Array;
  nodeRootSig: Uint8Array;
  examId: string;
  seatNo: string | null;
}

/** Look up one commitment by its leaf for the candidate receipt — hashes only. */
export async function findLedgerByLeaf(q: Q, leaf: Uint8Array): Promise<ReceiptRow | null> {
  const res = await q.query(
    `SELECT leaf_index, leaf_hash, prev_root, chain_root, node_root_sig, exam_id, seat_no
       FROM answer_ledger WHERE leaf_hash = $1`,
    [Buffer.from(leaf)],
  );
  if (!res.rowCount) return null;
  const r = res.rows[0];
  return {
    leafIndex: Number(r.leaf_index),
    leaf: bytes(r.leaf_hash),
    prevRoot: bytes(r.prev_root),
    chainRoot: bytes(r.chain_root),
    nodeRootSig: bytes(r.node_root_sig),
    examId: r.exam_id,
    seatNo: r.seat_no ?? null,
  };
}

/** Terminal context for an answer submission (state guard + seat + centre). */
export async function terminalForSubmit(
  q: Q,
  terminalId: string,
): Promise<{ centerId: string; seatNo: string; state: string } | null> {
  const res = await q.query(`SELECT center_id, seat_no, state FROM terminals WHERE id=$1`, [terminalId]);
  if (!res.rowCount) return null;
  return { centerId: res.rows[0].center_id, seatNo: res.rows[0].seat_no, state: res.rows[0].state };
}

/** Latest binding for a terminal regardless of consumption (submit pairing). */
export async function getLatestBinding(
  q: Q,
  terminalId: string,
): Promise<{ candidateRoll: string; examId: string } | null> {
  const res = await q.query(
    `SELECT candidate_roll, exam_id FROM seat_bindings
      WHERE terminal_id=$1 ORDER BY bound_at DESC LIMIT 1`,
    [terminalId],
  );
  return res.rowCount ? { candidateRoll: res.rows[0].candidate_roll, examId: res.rows[0].exam_id } : null;
}

export async function setTerminalState(client: pg.PoolClient, terminalId: string, state: string): Promise<void> {
  await client.query(`UPDATE terminals SET state=$2::terminal_state WHERE id=$1`, [terminalId, state]);
}

// ── Export sync bundle (§13.4 /admin/ledger/export) ───────────────────────
export interface ExportRecord {
  examId: string;
  seatNo: string | null;
  leafIndex: number;
  leaf: string;       // hex
  prevRoot: string;   // hex
  chainRoot: string;  // hex
  nodeRootSig: string; // hex
  ciphertext: string; // hex (sealed to SA key — opaque to the centre)
  iv: string;         // hex
  authTag: string;    // hex
  wrappedDk: string;  // hex
}

/**
 * Read all SEALED bundles for a centre as a transportable, ciphertext-only
 * export. The centre is forwarding sealed envelopes it cannot open (INV-6);
 * the payload carries no key able to decrypt them.
 */
export async function listSealedForExport(q: Q, centerId: string): Promise<ExportRecord[]> {
  const res = await q.query(
    `SELECT exam_id, seat_no, leaf_index, leaf_hash, prev_root, chain_root, node_root_sig,
            ciphertext, iv, auth_tag, wrapped_dk
       FROM answer_ledger
      WHERE center_id=$1 AND sync_state='SEALED'
      ORDER BY exam_id, leaf_index`,
    [centerId],
  );
  return res.rows.map((r) => ({
    examId: r.exam_id,
    seatNo: r.seat_no ?? null,
    leafIndex: Number(r.leaf_index),
    leaf: toHex(bytes(r.leaf_hash)),
    prevRoot: toHex(bytes(r.prev_root)),
    chainRoot: toHex(bytes(r.chain_root)),
    nodeRootSig: toHex(bytes(r.node_root_sig)),
    ciphertext: toHex(bytes(r.ciphertext)),
    iv: toHex(bytes(r.iv)),
    authTag: toHex(bytes(r.auth_tag)),
    wrappedDk: toHex(bytes(r.wrapped_dk)),
  }));
}

/** Mark exported bundles SYNCED (idempotent re-export skips them). */
export async function markSynced(client: pg.PoolClient, centerId: string, leaves: string[]): Promise<number> {
  if (leaves.length === 0) return 0;
  const res = await client.query(
    `UPDATE answer_ledger SET sync_state='SYNCED'
      WHERE center_id=$1 AND sync_state='SEALED' AND leaf_hash = ANY($2::bytea[])`,
    [centerId, leaves.map((h) => Buffer.from(h, "hex"))],
  );
  return res.rowCount ?? 0;
}

/** Activate an identity (§9.4). May throw 23505 for a 2nd ACTIVE Centre Admin (INV-7). */
export async function activateIdentity(
  client: pg.PoolClient,
  identityId: string,
  approverId: string | null,
): Promise<void> {
  await client.query(
    `UPDATE staff_identities
       SET status = 'ACTIVE', activated_at = NOW(), approved_by = $2
     WHERE id = $1`,
    [identityId, approverId],
  );
}

export async function revokeIdentity(
  client: pg.PoolClient,
  identityId: string,
  reason: string,
): Promise<void> {
  await client.query(
    `UPDATE staff_identities
       SET status = 'REVOKED', revoked_at = NOW(), revoke_reason = $2
     WHERE id = $1`,
    [identityId, reason],
  );
}

// ── Counts for THIS centre only (§10.3) ───────────────────────────────────
export interface CentreCounts {
  invigilatorsActive: number;
  invigilatorsPending: number;
  candidatesRegistered: number;
  present: number;
  inExam: number;
  submitted: number;
  seatsAvailable: number;
  seatsAssigned: number;
  bundlesHeld: number;
}

export async function centreCounts(q: Q, centerId: string, examId: string | null): Promise<CentreCounts> {
  const one = async (sql: string, params: unknown[]): Promise<number> => {
    const r = await q.query(sql, params);
    return Number(r.rows[0]?.n ?? 0);
  };
  const examFilter = examId ? `AND exam_id = $2` : ``;
  const examParams = examId ? [centerId, examId] : [centerId];
  return {
    invigilatorsActive: await one(
      `SELECT count(*) n FROM staff_identities WHERE center_id=$1 AND role='CENTER_INVIGILATOR' AND status='ACTIVE'`,
      [centerId],
    ),
    invigilatorsPending: await one(
      `SELECT count(*) n FROM staff_identities WHERE center_id=$1 AND role='CENTER_INVIGILATOR' AND status='PENDING_APPROVAL'`,
      [centerId],
    ),
    candidatesRegistered: await one(`SELECT count(*) n FROM enrollments WHERE center_id=$1 ${examFilter}`, examParams),
    present: await one(`SELECT count(*) n FROM enrollments WHERE center_id=$1 AND status='PRESENT' ${examFilter}`, examParams),
    inExam: await one(`SELECT count(*) n FROM terminals WHERE center_id=$1 AND state='IN_EXAM'`, [centerId]),
    submitted: await one(`SELECT count(*) n FROM terminals WHERE center_id=$1 AND state='SUBMITTED'`, [centerId]),
    seatsAvailable: await one(
      `SELECT count(*) n FROM terminals WHERE center_id=$1 AND capability='CANDIDATE_SEAT' AND state='AVAILABLE'`,
      [centerId],
    ),
    seatsAssigned: await one(`SELECT count(*) n FROM terminals WHERE center_id=$1 AND state='ASSIGNED'`, [centerId]),
    bundlesHeld: await one(`SELECT count(*) n FROM answer_ledger WHERE center_id=$1`, [centerId]),
  };
}

// ── Roster + check-in (§9.5) ──────────────────────────────────────────────
export async function roster(
  q: Q,
  centerId: string,
  examId: string,
): Promise<Array<{ roll: string; name: string; status: string }>> {
  const res = await q.query(
    `SELECT e.roll_number AS roll, u.full_name AS name, e.status
       FROM enrollments e JOIN users u ON u.id = e.candidate_id
      WHERE e.center_id = $1 AND e.exam_id = $2
      ORDER BY e.roll_number`,
    [centerId, examId],
  );
  return res.rows.map((r) => ({ roll: r.roll, name: r.name, status: r.status }));
}

export async function getCandidateByRoll(
  q: Q,
  examId: string,
  roll: string,
): Promise<{ candidateId: string; dobHash: Uint8Array | null; status: string } | null> {
  const res = await q.query(
    `SELECT e.candidate_id, u.dob_hash, e.status
       FROM enrollments e JOIN users u ON u.id = e.candidate_id
      WHERE e.exam_id = $1 AND e.roll_number = $2`,
    [examId, roll],
  );
  if (!res.rowCount) return null;
  const r = res.rows[0];
  return { candidateId: r.candidate_id, dobHash: r.dob_hash ? bytes(r.dob_hash) : null, status: r.status };
}

export async function markCheckedIn(
  client: pg.PoolClient,
  opts: { centerId: string; examId: string; roll: string; checkedInBy: string },
): Promise<boolean> {
  const res = await client.query(
    `UPDATE enrollments SET status='PRESENT', checked_in_at=NOW(), checked_in_by=$4
      WHERE center_id=$1 AND exam_id=$2 AND roll_number=$3`,
    [opts.centerId, opts.examId, opts.roll, opts.checkedInBy],
  );
  return (res.rowCount ?? 0) > 0;
}

// ── Seat map (§10.2 dashboard / §13.2) ────────────────────────────────────
export interface SeatMapRow {
  terminalId: string;
  seatNo: string;
  capability: string;
  state: string;
  health: string | null;
}

/** Live seat states for ONE centre — read-only feed for the invigilator grid. */
export async function seatMap(q: Q, centerId: string): Promise<SeatMapRow[]> {
  const res = await q.query(
    `SELECT id, seat_no, capability, state, health FROM terminals
      WHERE center_id = $1 ORDER BY seat_no`,
    [centerId],
  );
  return res.rows.map((r) => ({
    terminalId: r.id as string,
    seatNo: r.seat_no as string,
    capability: r.capability as string,
    state: r.state as string,
    health: (r.health as string | null) ?? null,
  }));
}

// ── Terminal / seat ───────────────────────────────────────────────────────
export async function terminalCapability(q: Q, terminalId: string): Promise<string | null> {
  const res = await q.query(`SELECT capability FROM terminals WHERE id=$1`, [terminalId]);
  return res.rowCount ? (res.rows[0].capability as string) : null;
}

export async function seatState(q: Q, terminalId: string): Promise<string | null> {
  const res = await q.query(`SELECT state FROM terminals WHERE id=$1`, [terminalId]);
  return res.rowCount ? (res.rows[0].state as string) : null;
}

export async function getActiveBinding(
  q: Q,
  terminalId: string,
): Promise<{ candidateRoll: string; examId: string } | null> {
  const res = await q.query(
    `SELECT candidate_roll, exam_id FROM seat_bindings
      WHERE terminal_id=$1 AND consumed_at IS NULL
      ORDER BY bound_at DESC LIMIT 1`,
    [terminalId],
  );
  return res.rowCount ? { candidateRoll: res.rows[0].candidate_roll, examId: res.rows[0].exam_id } : null;
}

/** Consume the bind token and move the seat to ATTENDED (§9.7 step 4). */
export async function consumeBindingAttend(client: pg.PoolClient, terminalId: string): Promise<void> {
  await client.query(`UPDATE seat_bindings SET consumed_at=NOW() WHERE terminal_id=$1 AND consumed_at IS NULL`, [terminalId]);
  await client.query(`UPDATE terminals SET state='ATTENDED' WHERE id=$1`, [terminalId]);
}

/**
 * Seat heartbeat (§10.2) — refresh a terminal's health + last_seen for the
 * invigilator seat map. Operational telemetry only; returns false for an
 * unknown terminal so the caller can 404 instead of upserting strays.
 */
export async function recordHeartbeat(q: Q, terminalId: string, health: "OK" | "FAULT"): Promise<boolean> {
  const res = await q.query(`UPDATE terminals SET health=$2, last_seen=NOW() WHERE id=$1`, [terminalId, health]);
  return (res.rowCount ?? 0) > 0;
}

/**
 * TPM attestation check (§7.1) — compare the submitted PCR quote to the golden
 * set stored for this terminal. Real quote verification is hardware (Phase 7);
 * here it is a deterministic comparison against `golden_pcr`. Fail-closed: an
 * unknown terminal or a mismatch returns false.
 */
export async function attestTerminal(q: Q, terminalId: string, providedPcr: unknown): Promise<boolean> {
  const res = await q.query(`SELECT golden_pcr FROM terminals WHERE id=$1`, [terminalId]);
  if (!res.rowCount) return false;
  const golden = res.rows[0].golden_pcr;
  if (golden == null) return false;
  return JSON.stringify(golden) === JSON.stringify(providedPcr);
}
