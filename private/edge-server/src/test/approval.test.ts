import { test } from "node:test";
import assert from "node:assert/strict";
import {
  issueCode,
  authoriseFingerprint,
  activate,
  canApprove,
  type ApprovalRecord,
} from "../services/approval.ts";
import type { ArgonParams } from "../lib/one-time-code.ts";

const FAST: ArgonParams = { timeCost: 2, memoryCostKiB: 8192, parallelism: 1 };

function pendingInvigilator(): ApprovalRecord {
  return {
    id: "req-1",
    kind: "INVIGILATOR_REGISTRATION",
    applicantIdentityId: "ident-1",
    centerId: "centre-A",
    codeHash: null,
    codeTtl: null,
    codeConsumed: false,
    fingerprintAuthorised: false,
    status: "PENDING_APPROVAL",
  };
}

test("RBAC: only the right tier may approve (cascading root of trust)", () => {
  // Centre Admin approves invigilators, same centre only.
  assert.equal(
    canApprove("CENTER_ADMIN", "INVIGILATOR_REGISTRATION", {
      approverCentreId: "centre-A",
      requestCentreId: "centre-A",
    }),
    true,
  );
  assert.equal(
    canApprove("CENTER_ADMIN", "INVIGILATOR_REGISTRATION", {
      approverCentreId: "centre-A",
      requestCentreId: "centre-B",
    }),
    false,
    "cannot approve another centre's invigilator",
  );
  // Invigilators cannot approve anyone.
  assert.equal(
    canApprove("CENTER_INVIGILATOR", "INVIGILATOR_REGISTRATION", {
      approverCentreId: "centre-A",
      requestCentreId: "centre-A",
    }),
    false,
  );
  // Only System Admin approves Centre Admins.
  assert.equal(
    canApprove("SYSTEM_ADMIN", "CENTER_ADMIN_REGISTRATION", {
      approverCentreId: null,
      requestCentreId: "centre-A",
    }),
    true,
  );
  assert.equal(
    canApprove("CENTER_ADMIN", "CENTER_ADMIN_REGISTRATION", {
      approverCentreId: "centre-A",
      requestCentreId: "centre-A",
    }),
    false,
    "a Centre Admin cannot mint another Centre Admin",
  );
});

test("happy path: issue → authorise fp → activate once", () => {
  const now = Date.now();
  let rec = pendingInvigilator();
  const { record: r1, code } = issueCode(rec, now, FAST);
  rec = authoriseFingerprint(r1);
  const res = activate(rec, { submittedCode: code, resuppliedFingerprintMatches: true, now: now + 1000 });
  assert.equal(res.ok, true);
  assert.equal(res.record.status, "ACTIVE");
  assert.equal(res.record.codeConsumed, true);
});

test("INV-8: a consumed code cannot be replayed", () => {
  const now = Date.now();
  const { record: r1, code } = issueCode(pendingInvigilator(), now, FAST);
  const rec = authoriseFingerprint(r1);
  const first = activate(rec, { submittedCode: code, resuppliedFingerprintMatches: true, now });
  assert.equal(first.ok, true);
  // Replay the very same code against the now-consumed record.
  const replay = activate(first.record, { submittedCode: code, resuppliedFingerprintMatches: true, now });
  assert.equal(replay.ok, false);
  assert.equal(replay.reason, "CODE_CONSUMED");
});

test("INV-8: an expired code is rejected", () => {
  const now = Date.now();
  const { record: r1, code } = issueCode(pendingInvigilator(), now, FAST);
  const rec = authoriseFingerprint(r1);
  const res = activate(rec, {
    submittedCode: code,
    resuppliedFingerprintMatches: true,
    now: now + 11 * 60 * 1000, // 11 min > 10 min TTL
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "CODE_EXPIRED");
});

test("activation requires BOTH the admin's fingerprint authorisation AND a finger match", () => {
  const now = Date.now();
  const { record: r1, code } = issueCode(pendingInvigilator(), now, FAST);

  // Admin never toggled "Authorise & bind fingerprint".
  const notAuthorised = activate(r1, { submittedCode: code, resuppliedFingerprintMatches: true, now });
  assert.equal(notAuthorised.reason, "FINGERPRINT_NOT_AUTHORISED");

  // Authorised, but the re-supplied finger does not match the enrolled one.
  const rec = authoriseFingerprint(r1);
  const mismatch = activate(rec, { submittedCode: code, resuppliedFingerprintMatches: false, now });
  assert.equal(mismatch.reason, "FINGERPRINT_MISMATCH");
});

test("a wrong code never activates", () => {
  const now = Date.now();
  const { record: r1 } = issueCode(pendingInvigilator(), now, FAST);
  const rec = authoriseFingerprint(r1);
  const res = activate(rec, { submittedCode: "0-000-000", resuppliedFingerprintMatches: true, now });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "CODE_INVALID");
});
