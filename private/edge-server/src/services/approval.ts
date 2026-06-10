/**
 * Approval / one-time-code state transitions (§9.2–§9.4), as pure functions
 * over an ApprovalRecord. The DB layer persists these records; this module
 * holds the *rules* so they can be tested exhaustively without a database.
 *
 * The cascading root of trust (§3.1): no tier admits itself.
 *   • System Admin  approves CENTER_ADMIN_REGISTRATION
 *   • Centre Admin  approves INVIGILATOR_REGISTRATION (same centre)
 *
 * INV-8 (single-use codes): a code verifies at most once, before its expiry.
 * Replay of a consumed code, or use after TTL, is denied here.
 */
import { generateCode, hashCode, verifyCode, type ArgonParams, DEFAULT_ARGON } from "../lib/one-time-code.ts";

export type ApprovalKind = "INVIGILATOR_REGISTRATION" | "CENTER_ADMIN_REGISTRATION";
export type Role = "SYSTEM_ADMIN" | "CENTER_ADMIN" | "CENTER_INVIGILATOR";

export interface ApprovalRecord {
  id: string;
  kind: ApprovalKind;
  applicantIdentityId: string;
  centerId: string | null;
  codeHash: Uint8Array | null;
  codeTtl: number | null; // epoch ms
  codeConsumed: boolean;
  fingerprintAuthorised: boolean;
  status: "PENDING_APPROVAL" | "ACTIVE" | "SUSPENDED" | "REVOKED";
}

/** RBAC: which role may approve which kind, and the same-centre constraint. */
export function canApprove(
  approverRole: Role,
  kind: ApprovalKind,
  opts: { approverCentreId: string | null; requestCentreId: string | null },
): boolean {
  if (kind === "CENTER_ADMIN_REGISTRATION") {
    return approverRole === "SYSTEM_ADMIN"; // tier-0 only
  }
  if (kind === "INVIGILATOR_REGISTRATION") {
    return (
      approverRole === "CENTER_ADMIN" &&
      opts.approverCentreId !== null &&
      opts.approverCentreId === opts.requestCentreId // same centre
    );
  }
  return false;
}

export const CODE_TTL_MS = 10 * 60 * 1000; // §9.4 default 10 min

export interface IssueResult {
  record: ApprovalRecord;
  /** Cleartext code — return ONLY to the approver's portal view. */
  code: string;
}

/**
 * Issue (or regenerate) the one-time code for a pending request. Regenerating
 * invalidates any prior code (new hash, fresh TTL, consumed=false).
 */
export function issueCode(
  record: ApprovalRecord,
  now: number,
  params: ArgonParams = DEFAULT_ARGON,
): IssueResult {
  const code = generateCode();
  return {
    code,
    record: {
      ...record,
      codeHash: hashCode(code, params),
      codeTtl: now + CODE_TTL_MS,
      codeConsumed: false,
    },
  };
}

export function authoriseFingerprint(record: ApprovalRecord): ApprovalRecord {
  return { ...record, fingerprintAuthorised: true };
}

export interface ActivateInput {
  submittedCode: string;
  /** Result of matching the re-supplied finger against the enrolled template. */
  resuppliedFingerprintMatches: boolean;
  now: number;
}

export interface ActivateResult {
  record: ApprovalRecord;
  ok: boolean;
  reason?: string;
}

/**
 * Activation (§9.4 `activate`). All clauses must hold; on success the code is
 * consumed atomically and the identity becomes ACTIVE. Mirrors the spec exactly.
 */
export function activate(record: ApprovalRecord, input: ActivateInput): ActivateResult {
  const deny = (reason: string): ActivateResult => ({ record, ok: false, reason });

  if (!record.codeHash || record.codeTtl === null) return deny("NO_CODE_ISSUED");
  if (record.codeConsumed) return deny("CODE_CONSUMED"); // INV-8: replay rejected
  if (input.now > record.codeTtl) return deny("CODE_EXPIRED"); // INV-8: TTL
  if (!verifyCode(input.submittedCode, record.codeHash)) return deny("CODE_INVALID");
  if (!record.fingerprintAuthorised) return deny("FINGERPRINT_NOT_AUTHORISED");
  if (!input.resuppliedFingerprintMatches) return deny("FINGERPRINT_MISMATCH");

  // atomically: consume + activate
  return {
    ok: true,
    record: { ...record, codeConsumed: true, status: "ACTIVE" },
  };
}
