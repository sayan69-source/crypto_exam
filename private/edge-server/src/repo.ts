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

/**
 * The applicant's enrolled templates and the station they enrolled at (§9.2
 * step 7), so the fingerprint they re-supply at activation can be matched
 * on-device against the one they registered with.
 */
export async function approvalEnrolment(
  q: Q,
  requestId: string,
): Promise<(EnrolmentTemplates & { boundTerminalId: string | null }) | null> {
  const res = await q.query(
    `SELECT s.face_embedding_hash, s.fingerprint_template, s.bound_terminal_id
       FROM approval_requests a JOIN staff_identities s ON s.id = a.applicant_identity_id
      WHERE a.id = $1`,
    [requestId],
  );
  if (!res.rowCount) return null;
  return {
    faceEmbeddingHash: toHex(bytes(res.rows[0].face_embedding_hash)),
    fingerprintTemplate: toHex(bytes(res.rows[0].fingerprint_template)),
    boundTerminalId: res.rows[0].bound_terminal_id ?? null,
  };
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

/**
 * Look up the ACTIVE privileged staff (invigilator/centre admin) at a station.
 *
 * The status filter is load-bearing. Without it "newest row wins" resolved to
 * whatever was registered last, and `/api/invigilator/register` is open and
 * takes an arbitrary `boundTerminalId` — so anyone on the LAN could register a
 * PENDING_APPROVAL identity against the real invigilator's station and that
 * station's genuine holder would then fail login as IDENTITY_NOT_ACTIVE,
 * permanently. Resolving only to an active, unrevoked holder makes the shadow
 * row inert. (A partial unique index enforces one active holder per station;
 * see migrations.)
 */
/**
 * The enrolled templates the on-device daemon needs in order to MATCH.
 *
 * Matching happens on the terminal, because the alternative is shipping a live
 * capture across the LAN — exactly what §8.4 forbids. That means the enrolled
 * side has to travel the other way: the daemon cannot compare a face to an
 * enrolment it does not have. (Before this, the client called the daemon with an
 * empty `enrolled_embedding_hex`, so the cosine was taken against nothing and
 * the face factor could only ever score 0.)
 *
 * Only the DPDP-safe stored forms move — a hash and a vendor template, never an
 * image — and http.ts gates the route on a freshly-attested terminal.
 */
export interface EnrolmentTemplates {
  faceEmbeddingHash: string;
  fingerprintTemplate: string;
}

export async function staffEnrolmentForStation(
  q: Q,
  terminalId: string,
): Promise<EnrolmentTemplates | null> {
  const res = await q.query(
    `SELECT face_embedding_hash, fingerprint_template
       FROM staff_identities
      WHERE bound_terminal_id = $1 AND status = 'ACTIVE' AND revoked_at IS NULL
      LIMIT 1`,
    [terminalId],
  );
  if (!res.rowCount) return null;
  return {
    faceEmbeddingHash: toHex(bytes(res.rows[0].face_embedding_hash)),
    fingerprintTemplate: toHex(bytes(res.rows[0].fingerprint_template)),
  };
}

/**
 * Enrol ONE candidate's fingerprint at the centre, once and only once (§9.5).
 *
 * The registration portal captures a face descriptor and nothing else — a
 * browser cannot read a fingerprint reader — so provisioning ships candidates
 * with `fingerprint_template` NULL and the design says the finger is "enrolled
 * in person at the seat". Nothing did that. `candidateEnrolment` therefore
 * returned an empty template, the daemon scored 0.0 against it, check-in
 * required `fpScore >= 0.6`, and every candidate in the estate was refused at
 * the desk. The exam could not start.
 *
 * ONCE-ONLY, and that is the security property rather than tidiness. If this
 * overwrote, an invigilator could enrol their own finger against a candidate's
 * roll and then "verify" that candidate all day — the substitution attack the
 * biometric exists to stop, performed with the tool meant to prevent it. A
 * second attempt affects no row and the caller is told the candidate is already
 * enrolled, which routes a genuine re-enrolment (a bandaged finger, a bad first
 * capture) to a supervisor rather than doing it silently.
 *
 * Returns false when the roll is not on THIS centre's roster for THIS exam, so
 * a neighbouring centre's candidate cannot be enrolled here.
 */
export async function enrolCandidateFingerprint(
  client: pg.PoolClient,
  input: { centerId: string; examId: string; roll: string; template: Uint8Array },
): Promise<{ ok: boolean; reason?: "ROLL_NOT_ON_ROSTER" | "ALREADY_ENROLLED" }> {
  const found = await client.query(
    `SELECT u.id, u.fingerprint_template
       FROM enrollments e JOIN users u ON u.id = e.candidate_id
      WHERE e.center_id = $1 AND e.exam_id = $2 AND e.roll_number = $3
      FOR UPDATE OF u`,
    [input.centerId, input.examId, input.roll],
  );
  if (!found.rowCount) return { ok: false, reason: "ROLL_NOT_ON_ROSTER" };

  const existing = found.rows[0].fingerprint_template as Buffer | null;
  // A zero-length template is "never enrolled", not "enrolled with nothing".
  if (existing && existing.length > 0) return { ok: false, reason: "ALREADY_ENROLLED" };

  await client.query(
    `UPDATE users SET fingerprint_template = $2 WHERE id = $1`,
    [found.rows[0].id, Buffer.from(input.template)],
  );
  return { ok: true };
}

export async function candidateEnrolment(
  q: Q,
  centerId: string,
  examId: string,
  roll: string,
): Promise<EnrolmentTemplates | null> {
  const res = await q.query(
    `SELECT u.enrolled_photo_hash, u.fingerprint_template
       FROM enrollments e JOIN users u ON u.id = e.candidate_id
      WHERE e.center_id = $1 AND e.exam_id = $2 AND e.roll_number = $3`,
    [centerId, examId, roll],
  );
  if (!res.rowCount) return null;
  const { enrolled_photo_hash, fingerprint_template } = res.rows[0];
  // A candidate with no enrolled biometric cannot be verified. Empty strings
  // make the daemon score 0 and the Edge deny, which is the right outcome: it
  // sends the invigilator to the exception process instead of waving them past.
  return {
    faceEmbeddingHash: enrolled_photo_hash ? toHex(bytes(enrolled_photo_hash)) : "",
    fingerprintTemplate: fingerprint_template ? toHex(bytes(fingerprint_template)) : "",
  };
}

export async function findStaffByStation(q: Q, role: string, terminalId: string): Promise<IdentityRow | null> {
  const res = await q.query(
    `SELECT * FROM staff_identities
       WHERE role = $1 AND bound_terminal_id = $2
         AND status = 'ACTIVE' AND revoked_at IS NULL
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
export async function listSealedForExport(q: Q, centerId: string, examId?: string): Promise<ExportRecord[]> {
  const res = await q.query(
    `SELECT exam_id, seat_no, leaf_index, leaf_hash, prev_root, chain_root, node_root_sig,
            ciphertext, iv, auth_tag, wrapped_dk
       FROM answer_ledger
      WHERE center_id=$1 AND sync_state='SEALED' ${examId ? "AND exam_id=$2" : ""}
      ORDER BY exam_id, leaf_index`,
    examId ? [centerId, examId] : [centerId],
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

/**
 * The exams this centre is actually running, soonest first.
 *
 * The invigilator console used to carry a hard-coded exam UUID, which meant it
 * showed the right roster only at the one centre the constant was written for.
 * A console must be told what it is invigilating by the data, not by a literal.
 */
export async function centreExams(
  q: Q,
  centerId: string,
): Promise<Array<{ id: string; name: string; scheduledAt: string; durationMinutes: number }>> {
  const res = await q.query(
    `SELECT DISTINCT x.id, x.name, x.scheduled_at, x.duration_minutes
       FROM exams x JOIN enrollments e ON e.exam_id = x.id
      WHERE e.center_id = $1
      ORDER BY x.scheduled_at`,
    [centerId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    name: r.name,
    scheduledAt: new Date(r.scheduled_at).toISOString(),
    durationMinutes: r.duration_minutes,
  }));
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

/**
 * Which centre a machine belongs to, and what it is allowed to be.
 *
 * Registration used to take the centre id from the request body, so an
 * applicant could file against any centre in the estate from any station. The
 * machine's own registry row is the fact; the form is a claim.
 */
export async function terminalPlacement(
  q: Q,
  terminalId: string,
): Promise<{ centerId: string; capability: string; commissionedVia: string } | null> {
  const res = await q.query(
    `SELECT center_id, capability, commissioned_via FROM terminals WHERE id=$1`,
    [terminalId],
  );
  return res.rowCount
    ? {
        centerId: res.rows[0].center_id as string,
        capability: res.rows[0].capability as string,
        commissionedVia: (res.rows[0].commissioned_via as string) ?? "PROVISIONED",
      }
    : null;
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

// ── §10.7 question delivery (Edge as the centre's keyless bundle cache) ────
export interface QuestionBundle {
  examId: string;
  questionsRoot: string; // hex
  bundleCid: string | null;
  chainTx: string | null;
  bundle: unknown;       // the keyless SealedBundle JSON
  /**
   * The paper's SHAPE (ExamPattern). NULL when the pattern never arrived, and
   * the terminal must refuse rather than assume four-option MCQ — guessing
   * renders a numeric-entry section as multiple choice, which looks like a
   * working exam and marks the wrong thing.
   */
  pattern: unknown | null;
  drandRound: number;
  hkdfSalt: string;      // hex (public)
}

/** Serve the sealed, keyless bundle + its root. Safe before T₀ — no keys here. */
export async function getQuestionBundle(q: Q, examId: string): Promise<QuestionBundle | null> {
  // Joined to the exam so the paper and its SHAPE arrive together. The terminal
  // cannot render a numeric-entry section without the pattern, and fetching the
  // two separately invites the state where it holds questions it does not know
  // how to present — so they travel in one answer or not at all.
  const res = await q.query(
    `SELECT b.questions_root, b.bundle_cid, b.chain_tx, b.bundle_json, b.drand_round,
            b.hkdf_salt, e.pattern
       FROM exam_question_bundle b
       JOIN exams e ON e.id = b.exam_id
      WHERE b.exam_id = $1`,
    [examId],
  );
  if (!res.rowCount) return null;
  const r = res.rows[0];
  return {
    examId,
    questionsRoot: toHex(bytes(r.questions_root)),
    bundleCid: r.bundle_cid ?? null,
    chainTx: r.chain_tx ?? null,
    bundle: r.bundle_json,
    pattern: (r.pattern as unknown) ?? null,
    drandRound: Number(r.drand_round),
    hkdfSalt: toHex(bytes(r.hkdf_salt)),
  };
}

/**
 * Release the T₀ beacon for an exam — but ONLY at/after t0_at (§10.7). Before
 * T₀ this returns null and the terminal cannot derive any question key, so a
 * pre-staged bundle stays undecryptable until the whole hall unlocks together.
 */
export async function getBeaconIfReleased(
  q: Q,
  examId: string,
  now: number,
): Promise<{ beacon: string; hkdfSalt: string; t0At: number } | null> {
  const res = await q.query(
    `SELECT t0_beacon, hkdf_salt, t0_at FROM exam_question_bundle WHERE exam_id = $1`,
    [examId],
  );
  if (!res.rowCount) return null;
  const r = res.rows[0];
  const t0 = new Date(r.t0_at as string).getTime();
  if (now < t0 || r.t0_beacon == null) return null; // locked until T₀
  return { beacon: toHex(bytes(r.t0_beacon)), hkdfSalt: toHex(bytes(r.hkdf_salt)), t0At: t0 };
}

// ── post-exam egress gate (§6) — internet for the Centre Admin opens ONLY
//    after the window closes AND every present candidate has submitted ───────
export interface EgressStatus {
  examId: string;
  windowClosed: boolean;
  presentCount: number;
  submittedCount: number;
  pendingCount: number;       // present-but-not-yet-submitted
  egressOpenedAt: number | null;
  mayOpen: boolean;           // window closed AND nothing pending
}

export async function egressStatus(q: Q, centerId: string, examId: string, now: number): Promise<EgressStatus | null> {
  const ex = await q.query(`SELECT window_closes_at, egress_opened_at FROM exams WHERE id = $1`, [examId]);
  if (!ex.rowCount) return null;
  const closesAt = ex.rows[0].window_closes_at ? new Date(ex.rows[0].window_closes_at as string).getTime() : null;
  const windowClosed = closesAt != null && now >= closesAt;

  // present = checked-in candidates (enrollment_status has no SUBMITTED — a
  // candidate stays PRESENT; "submitted" is a property of the answer ledger).
  const present = await q.query(
    `SELECT count(*) n FROM enrollments WHERE center_id=$1 AND exam_id=$2 AND status = 'PRESENT'`,
    [centerId, examId],
  );
  // DISTINCT seats, not rows. A bare count is a total the ledger can be padded
  // to: submit junk envelopes for every attended seat and `pendingCount` clamps
  // to 0, so the uplink opens on a false "everyone is done" the moment the
  // window closes. Counting seats ties the figure to the hall.
  const submitted = await q.query(
    `SELECT count(DISTINCT seat_no) n FROM answer_ledger
      WHERE center_id=$1 AND exam_id=$2 AND seat_no IS NOT NULL`,
    [centerId, examId],
  );
  const presentCount = Number(present.rows[0].n);
  const submittedCount = Number(submitted.rows[0].n);
  const pendingCount = Math.max(0, presentCount - submittedCount);
  return {
    examId,
    windowClosed,
    presentCount,
    submittedCount,
    pendingCount,
    egressOpenedAt: ex.rows[0].egress_opened_at ? new Date(ex.rows[0].egress_opened_at as string).getTime() : null,
    mayOpen: windowClosed && pendingCount === 0,
  };
}

/**
 * Whether this centre's uplink may be OPEN AT ALL right now (§6).
 *
 * `egressStatus` answers "may the Centre Admin authorise the post-exam push for
 * exam X". This answers the question the firewall actually has to ask, which is
 * different in two ways: it is not about one exam, and it is asked by a machine
 * that holds no session.
 *
 * The centre has two legitimate reasons to reach HQ, and they sit on opposite
 * sides of the exam:
 *
 *   before   pull the provisioning bundle (§12) — days ahead, nothing is live;
 *   after    push the sealed ledger (§13.4)     — window shut, everyone done.
 *
 * The state that must never permit egress is the one in between: a paper in
 * flight. So rather than enumerate the two permitted cases — and inevitably
 * miss one — this reports the centre BLOCKED whenever any exam it is running is
 * still in flight, and open otherwise. An exam is in flight if its window has
 * not closed yet, or if a candidate is sitting at a seat that has not submitted.
 *
 * That is the property worth enforcing: the centre's uplink is shut for exactly
 * as long as there is a live paper inside the building, and it does not depend
 * on anyone remembering to close it afterwards.
 */
export interface CentreEgressState {
  /** True when no exam at this centre is in flight. */
  open: boolean;
  /** The exams holding the uplink shut, for the operator's screen. */
  blockedBy: { examId: string; reason: "WINDOW_OPEN" | "SUBMISSIONS_PENDING"; pending: number }[];
}

export async function centreEgressState(q: Q, centerId: string, now: number): Promise<CentreEgressState> {
  // Only exams this centre actually runs. A centre is not held shut by a paper
  // being sat somewhere else in the country.
  const res = await q.query(
    `SELECT e.id,
            e.window_closes_at,
            (SELECT count(*) FROM enrollments en
              WHERE en.center_id = $1 AND en.exam_id = e.id AND en.status = 'PRESENT') AS present,
            (SELECT count(DISTINCT a.seat_no) FROM answer_ledger a
              WHERE a.center_id = $1 AND a.exam_id = e.id AND a.seat_no IS NOT NULL) AS submitted
       FROM exams e
      WHERE EXISTS (SELECT 1 FROM enrollments en
                     WHERE en.center_id = $1 AND en.exam_id = e.id)`,
    [centerId],
  );

  const blockedBy: CentreEgressState["blockedBy"] = [];
  for (const r of res.rows) {
    const closesAt = r.window_closes_at ? new Date(r.window_closes_at as string).getTime() : null;
    const pending = Math.max(0, Number(r.present) - Number(r.submitted));
    // A candidate at a seat with no envelope in the ledger is the strongest
    // signal there is that the paper is live, and it outranks the clock: an
    // exam that overran its window is still an exam in progress.
    if (pending > 0) {
      blockedBy.push({ examId: String(r.id), reason: "SUBMISSIONS_PENDING", pending });
      continue;
    }
    // No window recorded is not "in flight" — an unscheduled row would
    // otherwise hold the uplink shut forever with nobody able to say why.
    if (closesAt != null && now < closesAt) {
      blockedBy.push({ examId: String(r.id), reason: "WINDOW_OPEN", pending: 0 });
    }
  }
  return { open: blockedBy.length === 0, blockedBy };
}

/** Record that egress was opened (idempotent). Caller must have verified mayOpen. */
export async function openEgress(client: pg.PoolClient, examId: string, byId: string): Promise<void> {
  await client.query(
    `UPDATE exams SET egress_opened_at = COALESCE(egress_opened_at, NOW()), egress_opened_by = COALESCE(egress_opened_by, $2)
      WHERE id = $1`,
    [examId, byId],
  );
}

/**
 * What a terminal was commissioned with, for verifying its quote (§7.1).
 *
 * `null` means the machine is not in the registry at all — an unknown machine
 * on the exam VLAN, which attests to nothing and boots into nothing.
 */
export interface TerminalAttestKeys {
  akPubkeyPem: string | null;
  /** What this machine measured about ITSELF at enrolment (§7.1). */
  goldenPcr: Record<string, string> | null;
  /**
   * What the AUTHORITY computed this terminal's signed UKI must measure,
   * recorded at provisioning. Outranks `goldenPcr` for any index it names —
   * migration 006 explains why the distinction is the whole point.
   */
  predictedPcr: Record<string, string> | null;
}

export async function terminalAttestKeys(q: Q, terminalId: string): Promise<TerminalAttestKeys | null> {
  const res = await q.query(
    `SELECT ak_pubkey_pem, golden_pcr, predicted_pcr FROM terminals WHERE id = $1`,
    [terminalId],
  );
  if (!res.rowCount) return null;
  return {
    akPubkeyPem: res.rows[0].ak_pubkey_pem ?? null,
    goldenPcr: (res.rows[0].golden_pcr as Record<string, string> | null) ?? null,
    // What the AUTHORITY computed this terminal's UKI must measure, as opposed
    // to what the terminal reported measuring. See migration 006.
    predictedPcr: (res.rows[0].predicted_pcr as Record<string, string> | null) ?? null,
  };
}

/** How many terminals this centre already has (bounds self-commissioning). */
export async function countTerminals(q: Q, centerId: string): Promise<number> {
  const res = await q.query(`SELECT COUNT(*)::int AS n FROM terminals WHERE center_id = $1`, [centerId]);
  return res.rowCount ? (res.rows[0].n as number) : 0;
}

/**
 * The address this terminal was commissioned at, for checking that a request
 * about a machine is coming FROM that machine. Null when none was registered,
 * which the caller must treat as "cannot be verified", never as "allow".
 */
export async function terminalBoundIp(q: Q, terminalId: string): Promise<string | null> {
  const res = await q.query(`SELECT host(bound_ip) AS ip FROM terminals WHERE id = $1`, [terminalId]);
  return res.rowCount ? ((res.rows[0].ip as string | null) ?? null) : null;
}

/**
 * The daemon key that may speak for this terminal's camera and reader (§8.4).
 * Null (or an unknown terminal) means no biometric score from it is acceptable.
 */
export async function terminalBioPubkey(q: Q, terminalId: string): Promise<string | null> {
  const res = await q.query(`SELECT bio_pubkey_pem FROM terminals WHERE id = $1`, [terminalId]);
  return res.rowCount ? (res.rows[0].bio_pubkey_pem ?? null) : null;
}

/**
 * Register a machine into the terminal registry from the machine itself.
 *
 * Refuses if the id is already present — commissioning is a one-way door, so a
 * machine cannot re-key or re-measure itself later, which is what would turn
 * "this is the software that first ran here" into "this is whatever ran here
 * last". `http.ts` gates the route on `allowFirstBootCommissioning`.
 *
 * The centre row is created if absent for the same reason the terminal is: on
 * an all-in-one there is nobody else to have created it.
 */
export async function commissionSelf(
  client: pg.PoolClient,
  t: {
    id: string; centerId: string; centreName: string; seatNo: string;
    capability: string; wgPubkey: string; boundIp: string | null;
    goldenPcr: Record<string, string> | null;
    akPubkeyPem: string | null; bioPubkeyPem: string | null;
  },
): Promise<{ created: boolean; reason?: string }> {
  const existing = await client.query(`SELECT commissioned_via FROM terminals WHERE id = $1`, [t.id]);
  if (existing.rowCount) {
    return { created: false, reason: "ALREADY_COMMISSIONED" };
  }
  // `(center_id, seat_no)` is UNIQUE, and a machine picks its own seat labels
  // (ADM-1 / INV-1 / A-01) without knowing what the centre already holds. An
  // Edge that was provisioned from a bundle — or one carrying rows from an
  // earlier life — very plausibly has those seats already.
  //
  // Checked here rather than left to the constraint because an unhandled
  // 23505 leaves Fastify to answer `{"statusCode":500,"error":"Internal Server
  // Error"}`, with no `reason` for the commissioning script to read and nothing
  // for the operator's screen but a number. On a machine with no shell that is
  // the difference between a diagnosis and a dead end. (Observed: the first
  // hardware boot hit exactly this behind a different fault.)
  const seatTaken = await client.query(
    `SELECT 1 FROM terminals WHERE center_id = $1 AND seat_no = $2`,
    [t.centerId, t.seatNo],
  );
  if (seatTaken.rowCount) {
    return { created: false, reason: "SEAT_ALREADY_REGISTERED" };
  }
  await client.query(
    `INSERT INTO centers (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`,
    [t.centerId, t.centreName],
  );
  await client.query(
    `INSERT INTO terminals
       (id, center_id, seat_no, capability, wg_pubkey, bound_ip, golden_pcr,
        ak_pubkey_pem, bio_pubkey_pem, state, commissioned_via, commissioned_at)
     VALUES ($1,$2,$3,$4::terminal_cap,$5,$6,$7,$8,$9,'AVAILABLE','FIRST_BOOT', now())`,
    [
      t.id, t.centerId, t.seatNo, t.capability, t.wgPubkey, t.boundIp,
      t.goldenPcr ? JSON.stringify(t.goldenPcr) : null,
      t.akPubkeyPem, t.bioPubkeyPem,
    ],
  );
  return { created: true };
}

/**
 * Record the outcome of an attestation attempt.
 *
 * Both outcomes are written. A stored `false` is what makes a failed boot
 * visible to an auditor afterwards, and it also actively bars login on a
 * machine that just failed to prove itself — where leaving the previous
 * `true` in place would let a tampered image ride out the remaining TTL.
 */
export async function recordAttestation(q: Q, terminalId: string, ok: boolean): Promise<void> {
  await q.query(
    `UPDATE terminals SET last_attest_at = now(), last_attest_ok = $2 WHERE id = $1`,
    [terminalId, ok],
  );
}

/**
 * Did this terminal pass attestation recently enough to log in on?
 *
 * The TPM factor of the §8.2 match-all rule. Fail-closed: an unknown terminal,
 * one that has never attested, one whose last attestation failed, or one whose
 * attestation has aged out all return false.
 */
export async function hasFreshAttestation(
  q: Q,
  terminalId: string,
  now: number,
  ttlMs: number,
): Promise<boolean> {
  const res = await q.query(
    `SELECT last_attest_ok, last_attest_at FROM terminals WHERE id = $1`,
    [terminalId],
  );
  if (!res.rowCount) return false;
  const { last_attest_ok, last_attest_at } = res.rows[0] as {
    last_attest_ok: boolean | null;
    last_attest_at: Date | string | null;
  };
  if (last_attest_ok !== true || last_attest_at == null) return false;
  const at = new Date(last_attest_at).getTime();
  return Number.isFinite(at) && now - at <= ttlMs;
}
