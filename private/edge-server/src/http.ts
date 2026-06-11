/**
 * Centre Edge HTTP API (§13.1–§13.5). Served over the WireGuard tunnel only;
 * never publicly exposed (§6). Every privileged route re-validates the session
 * token + role + centre scope server-side, and every state-changing call writes
 * a hash-chained `secure_audit_log` entry (§13 preamble).
 *
 * `buildApp` returns a Fastify instance so it can be driven with `app.inject()`
 * in tests (no socket) and served for real from index.ts.
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { EdgeConfig } from "./config.ts";
import type { Pool } from "./db.ts";
import { withTx } from "./db.ts";
import { appendAudit } from "./audit.ts";
import { verifyToken, issueToken, DEFAULT_IDLE_MS, type TokenClaims } from "./lib/token.ts";
import { evaluateMatchAll, DEFAULT_POLICY } from "./lib/match-all.ts";
import { verifyDob } from "./lib/dob.ts";
import {
  issueCode as issueCodeRule,
  authoriseFingerprint,
  activate as activateRule,
  canApprove,
  type Role,
} from "./services/approval.ts";
import { assignRandomSeat, NoFreeSeatError } from "./services/assignment-service.ts";
import { GENESIS, nextRoot } from "./lib/merkle-chain.ts";
import { makeNodeSigner } from "./lib/node-sign.ts";
import { sha256, toHex, constantTimeEqual, utf8, canonicalJson } from "./lib/crypto.ts";
import * as repo from "./repo.ts";

const hex = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "hex"));

export interface AppDeps {
  pool: Pool;
  config: EdgeConfig;
  /** Override "now" for deterministic tests. */
  now?: () => number;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { pool, config } = deps;
  const now = deps.now ?? (() => Date.now());
  const app = Fastify({ logger: false });

  // ── helpers ──────────────────────────────────────────────────────────
  const auth = (req: FastifyRequest): TokenClaims | null => {
    const h = req.headers.authorization;
    if (!h || !h.startsWith("Bearer ")) return null;
    return verifyToken(config.tokenSecret, h.slice(7), now());
  };

  const deny = (reply: import("fastify").FastifyReply, code: number, reason: string) =>
    reply.code(code).send({ ok: false, reason });

  // ════════════════════════ §13.1 identity / gate ════════════════════════
  // Fail-closed liveness for the Login Gate (INV-10). LAN, no auth.
  app.get("/api/health", async () => ({ ok: true, service: "edge", ts: now() }));

  app.get("/api/terminal/:id/capability", async (req, reply) => {
    const { id } = req.params as { id: string };
    const cap = await repo.terminalCapability(pool, id);
    if (!cap) return deny(reply, 404, "UNKNOWN_TERMINAL");
    return { capability: cap };
  });

  app.post("/api/terminal/attest", async (req) => {
    const body = req.body as { terminalId: string; pcr: unknown };
    const ok = await repo.attestTerminal(pool, body.terminalId, body.pcr);
    return { ok }; // mismatch → false; the boot flow HALTs on false (§7.1)
  });

  // §10.2 — seat heartbeat (zuup-heartbeatd). LAN/no-auth by design: the wg
  // key already authenticates the sender, and the payload is health-only —
  // it can mark a seat OK/FAULT on the dashboard but gates nothing.
  app.post("/api/terminal/heartbeat", async (req, reply) => {
    const b = req.body as { terminalId?: string; status?: string };
    if (!b?.terminalId) return deny(reply, 400, "MISSING_TERMINAL");
    const ok = await repo.recordHeartbeat(pool, b.terminalId, b.status === "OK" ? "OK" : "FAULT");
    if (!ok) return deny(reply, 404, "UNKNOWN_TERMINAL");
    return { ok: true };
  });

  // §9.2 step 3 — create a PENDING invigilator registration.
  app.post("/api/invigilator/register", async (req, reply) => {
    const b = req.body as {
      centerId: string; fullName: string;
      faceEmbeddingHash: string; fingerprintTemplate: string;
      boundIp: string | null; boundTerminalId: string | null;
    };
    if (!b.centerId || !b.fullName) return deny(reply, 400, "MISSING_FIELDS");
    const out = await withTx(pool, async (c) => {
      const r = await repo.createInvigilatorRegistration(c, {
        centerId: b.centerId,
        fullName: b.fullName,
        faceEmbeddingHash: hex(b.faceEmbeddingHash),
        fingerprintTemplate: hex(b.fingerprintTemplate),
        boundIp: b.boundIp,
        boundTerminalId: b.boundTerminalId,
      });
      await appendAudit(c, { centerId: b.centerId, actorId: null, action: "INVIGILATOR_REGISTERED", target: r.requestId });
      return r;
    });
    return { ...out, status: "PENDING_APPROVAL" };
  });

  // Centre directory for registration forms (id/name/state — no counts, no
  // PII). Servable to the HQ relay so the PUBLIC website can offer a centre
  // picker while the centre LAN itself stays internet-free (§6).
  app.get("/api/centres", async () => ({ centres: await repo.listCentres(pool) }));

  // §10.1 step 3 — create a PENDING Centre Admin registration. Tier-1 onboarding:
  // only a SYSTEM_ADMIN (tier-0) can later approve it (canApprove). The applicant
  // captures the SAME factors as an invigilator (face hash + fp template + bound
  // IP/station); activation still needs the System-Admin-issued one-time code.
  app.post("/api/centeradmin/register", async (req, reply) => {
    const b = req.body as {
      centerId: string; fullName: string;
      faceEmbeddingHash: string; fingerprintTemplate: string;
      boundIp: string | null; boundTerminalId: string | null;
    };
    if (!b.centerId || !b.fullName) return deny(reply, 400, "MISSING_FIELDS");
    const out = await withTx(pool, async (c) => {
      const r = await repo.createCenterAdminRegistration(c, {
        centerId: b.centerId,
        fullName: b.fullName,
        faceEmbeddingHash: hex(b.faceEmbeddingHash),
        fingerprintTemplate: hex(b.fingerprintTemplate),
        boundIp: b.boundIp,
        boundTerminalId: b.boundTerminalId,
      });
      await appendAudit(c, { centerId: b.centerId, actorId: null, action: "CENTER_ADMIN_REGISTERED", target: r.requestId });
      return r;
    });
    return { ...out, status: "PENDING_APPROVAL" };
  });

  // §9.1 — invigilator login (face + fp + IP + TPM match-all → INV-4).
  app.post("/api/invigilator/login", async (req, reply) => {
    const b = req.body as {
      terminalId: string; observedIp: string;
      faceScore: number; fpScore: number; tpmValid: boolean; elapsedMs: number;
    };
    const ident = await repo.findInvigilatorByStation(pool, b.terminalId);
    const verdict = ident
      ? evaluateMatchAll(
          { faceScore: b.faceScore, fpScore: b.fpScore, sourceIp: b.observedIp, tpmValid: b.tpmValid, elapsedMs: b.elapsedMs },
          { boundIp: ident.boundIp, status: ident.status, revoked: ident.revoked },
          DEFAULT_POLICY,
        )
      : { ok: false, failures: ["NO_IDENTITY_FOR_STATION"] };

    await withTx(pool, (c) =>
      appendAudit(c, {
        centerId: ident?.centerId ?? null,
        actorId: ident?.id ?? null,
        action: verdict.ok ? "LOGIN_OK" : "LOGIN_DENIED",
        target: b.terminalId,
        details: verdict.ok ? null : { failures: verdict.failures },
      }),
    );

    if (!verdict.ok || !ident) return reply.code(401).send({ ok: false, failures: verdict.failures });
    const token = issueToken(config.tokenSecret, {
      sub: ident.id, tid: b.terminalId, tpm: "attested", role: ident.role,
      centre: ident.centerId, exp: now() + DEFAULT_IDLE_MS,
    });
    return { ok: true, token };
  });

  // §9.2 step 7 / §9.4 — activate with one-time code + re-supplied fingerprint.
  // One handler serves BOTH tiers: an invigilator activating against a Centre-
  // Admin-issued code, and a Centre Admin activating against a System-Admin-
  // issued code. The kind/centre constraints were already enforced when the
  // code was issued; here we only consume the code + flip the identity ACTIVE.
  const activateHandler = async (req: FastifyRequest, reply: import("fastify").FastifyReply) => {
    const b = req.body as { requestId: string; code: string; fingerprintMatch: boolean };
    const record = await repo.getApproval(pool, b.requestId);
    if (!record) return deny(reply, 404, "UNKNOWN_REQUEST");

    const result = activateRule(record, {
      submittedCode: b.code,
      resuppliedFingerprintMatches: b.fingerprintMatch,
      now: now(),
    });
    if (!result.ok) {
      await withTx(pool, (c) =>
        appendAudit(c, { centerId: record.centerId, actorId: null, action: "ACTIVATION_DENIED", target: b.requestId, details: { reason: result.reason } }),
      );
      return reply.code(401).send({ ok: false, reason: result.reason });
    }
    // Persist consume + activate atomically. INV-7 may reject a 2nd Centre Admin.
    try {
      await withTx(pool, async (c) => {
        await repo.saveApproval(c, result.record, null);
        await repo.activateIdentity(c, record.applicantIdentityId, null);
        await appendAudit(c, { centerId: record.centerId, actorId: null, action: "IDENTITY_ACTIVATED", target: b.requestId });
      });
    } catch (err) {
      const msg = String((err as Error).message);
      if (/duplicate key|one_active_center_admin|unique/i.test(msg)) {
        await withTx(pool, (c) =>
          appendAudit(c, { centerId: record.centerId, actorId: null, action: "ACTIVATION_DENIED", target: b.requestId, details: { reason: "DUPLICATE_ACTIVE_CENTER_ADMIN" } }),
        );
        return reply.code(409).send({ ok: false, reason: "DUPLICATE_ACTIVE_CENTER_ADMIN" });
      }
      throw err;
    }
    return { ok: true, status: "ACTIVE" };
  };
  app.post("/api/invigilator/activate", activateHandler);
  app.post("/api/staff/activate", activateHandler); // tier-neutral alias (Centre Admin too)

  // §10.3 — Centre Admin login (same match-all rule as the invigilator, §8.2).
  app.post("/api/admin/login", async (req, reply) => {
    const b = req.body as {
      terminalId: string; observedIp: string;
      faceScore: number; fpScore: number; tpmValid: boolean; elapsedMs: number;
    };
    const ident = await repo.findStaffByStation(pool, "CENTER_ADMIN", b.terminalId);
    const verdict = ident
      ? evaluateMatchAll(
          { faceScore: b.faceScore, fpScore: b.fpScore, sourceIp: b.observedIp, tpmValid: b.tpmValid, elapsedMs: b.elapsedMs },
          { boundIp: ident.boundIp, status: ident.status, revoked: ident.revoked },
          DEFAULT_POLICY,
        )
      : { ok: false, failures: ["NO_IDENTITY_FOR_STATION"] };

    await withTx(pool, (c) =>
      appendAudit(c, {
        centerId: ident?.centerId ?? null, actorId: ident?.id ?? null,
        action: verdict.ok ? "ADMIN_LOGIN_OK" : "ADMIN_LOGIN_DENIED",
        target: b.terminalId, details: verdict.ok ? null : { failures: verdict.failures },
      }),
    );

    if (!verdict.ok || !ident) return reply.code(401).send({ ok: false, failures: verdict.failures });
    const token = issueToken(config.tokenSecret, {
      sub: ident.id, tid: b.terminalId, tpm: "attested", role: ident.role,
      centre: ident.centerId, exp: now() + DEFAULT_IDLE_MS,
    });
    return { ok: true, token };
  });

  // ════════════════════ §13.5 SYSTEM ADMIN (tier-0) ══════════════════════
  // The System Admin is the root of trust (§3.1): it approves Centre Admins and
  // oversees the whole estate. It is centre-less (centre = null) and never sees
  // an answer plaintext here — decryption is HQ + HSM only (hq/vault.ts, §11.4).
  const requireSystemAdmin = (req: FastifyRequest): TokenClaims | null => {
    const c = auth(req);
    return c && c.role === "SYSTEM_ADMIN" ? c : null;
  };

  // §10.3-equivalent — System Admin login (same match-all rule, HQ-bound, §8.2).
  app.post("/api/system/login", async (req, reply) => {
    const b = req.body as {
      terminalId: string; observedIp: string;
      faceScore: number; fpScore: number; tpmValid: boolean; elapsedMs: number;
    };
    const ident = await repo.findStaffByStation(pool, "SYSTEM_ADMIN", b.terminalId);
    const verdict = ident
      ? evaluateMatchAll(
          { faceScore: b.faceScore, fpScore: b.fpScore, sourceIp: b.observedIp, tpmValid: b.tpmValid, elapsedMs: b.elapsedMs },
          { boundIp: ident.boundIp, status: ident.status, revoked: ident.revoked },
          DEFAULT_POLICY,
        )
      : { ok: false, failures: ["NO_IDENTITY_FOR_STATION"] };

    await withTx(pool, (c) =>
      appendAudit(c, {
        centerId: null, actorId: ident?.id ?? null,
        action: verdict.ok ? "SYSTEM_LOGIN_OK" : "SYSTEM_LOGIN_DENIED",
        target: b.terminalId, details: verdict.ok ? null : { failures: verdict.failures },
      }),
    );

    if (!verdict.ok || !ident) return reply.code(401).send({ ok: false, failures: verdict.failures });
    const token = issueToken(config.tokenSecret, {
      sub: ident.id, tid: b.terminalId, tpm: "attested", role: ident.role,
      centre: null, exp: now() + DEFAULT_IDLE_MS,
    });
    return { ok: true, token };
  });

  // §13.5 — pending Centre Admin registrations across ALL centres (tier-0 queue).
  app.get("/api/system/approvals/pending", async (req, reply) => {
    if (!requireSystemAdmin(req)) return deny(reply, 403, "FORBIDDEN");
    return { pending: await repo.listPendingCenterAdminApprovals(pool) };
  });

  // §13.5 — per-centre oversight rollup (counts only; no PII, no ciphertext).
  app.get("/api/system/centres", async (req, reply) => {
    if (!requireSystemAdmin(req)) return deny(reply, 403, "FORBIDDEN");
    return { centres: await repo.systemOverview(pool) };
  });

  // §10.1 / §9.4 — issue the Centre-Admin one-time code (shown ONLY here, to the
  // System Admin) and authorise the applicant's fingerprint. Both re-check
  // canApprove(SYSTEM_ADMIN, CENTER_ADMIN_REGISTRATION) — a Centre Admin token
  // is refused here even if it reaches this route.
  app.post("/api/system/approvals/:id/issue-code", async (req, reply) => {
    const claims = requireSystemAdmin(req);
    if (!claims) return deny(reply, 403, "FORBIDDEN");
    const { id } = req.params as { id: string };
    const record = await repo.getApproval(pool, id);
    if (!record) return deny(reply, 404, "UNKNOWN_REQUEST");
    if (record.kind !== "CENTER_ADMIN_REGISTRATION" ||
        !canApprove(claims.role as Role, record.kind, { approverCentreId: claims.centre, requestCentreId: record.centerId })) {
      return deny(reply, 403, "NOT_AUTHORISED_TO_APPROVE");
    }
    const issued = issueCodeRule(record, now(), config.argon);
    await withTx(pool, async (c) => {
      await repo.saveApproval(c, issued.record, claims.sub);
      await appendAudit(c, { centerId: record.centerId, actorId: claims.sub, action: "CODE_ISSUED", target: id });
    });
    return { ok: true, code: issued.code, ttl: issued.record.codeTtl };
  });

  app.post("/api/system/approvals/:id/authorise-fp", async (req, reply) => {
    const claims = requireSystemAdmin(req);
    if (!claims) return deny(reply, 403, "FORBIDDEN");
    const { id } = req.params as { id: string };
    const record = await repo.getApproval(pool, id);
    if (!record) return deny(reply, 404, "UNKNOWN_REQUEST");
    if (record.kind !== "CENTER_ADMIN_REGISTRATION" ||
        !canApprove(claims.role as Role, record.kind, { approverCentreId: claims.centre, requestCentreId: record.centerId })) {
      return deny(reply, 403, "NOT_AUTHORISED_TO_APPROVE");
    }
    const next = authoriseFingerprint(record);
    await withTx(pool, async (c) => {
      await repo.saveApproval(c, next, claims.sub);
      await appendAudit(c, { centerId: record.centerId, actorId: claims.sub, action: "FINGERPRINT_AUTHORISED", target: id });
    });
    return { ok: true };
  });

  // ═══════════════════ §13.4 centre admin (approvals + counts) ════════════
  // §9.4 — issue the one-time code (shown ONLY to the approver here).
  app.post("/api/admin/approvals/:id/issue-code", async (req, reply) => {
    const claims = auth(req);
    if (!claims) return deny(reply, 401, "NO_SESSION");
    const { id } = req.params as { id: string };
    const record = await repo.getApproval(pool, id);
    if (!record) return deny(reply, 404, "UNKNOWN_REQUEST");
    if (!canApprove(claims.role as Role, record.kind, { approverCentreId: claims.centre, requestCentreId: record.centerId })) {
      return deny(reply, 403, "NOT_AUTHORISED_TO_APPROVE");
    }
    const issued = issueCodeRule(record, now(), config.argon);
    await withTx(pool, async (c) => {
      await repo.saveApproval(c, issued.record, claims.sub);
      await appendAudit(c, { centerId: record.centerId, actorId: claims.sub, action: "CODE_ISSUED", target: id });
    });
    // The cleartext code is returned ONLY in this approver response (§9.4).
    return { ok: true, code: issued.code, ttl: issued.record.codeTtl };
  });

  // §9.2 step 5 — toggle "Authorise & bind fingerprint".
  app.post("/api/admin/approvals/:id/authorise-fp", async (req, reply) => {
    const claims = auth(req);
    if (!claims) return deny(reply, 401, "NO_SESSION");
    const { id } = req.params as { id: string };
    const record = await repo.getApproval(pool, id);
    if (!record) return deny(reply, 404, "UNKNOWN_REQUEST");
    if (!canApprove(claims.role as Role, record.kind, { approverCentreId: claims.centre, requestCentreId: record.centerId })) {
      return deny(reply, 403, "NOT_AUTHORISED_TO_APPROVE");
    }
    const next = authoriseFingerprint(record);
    await withTx(pool, async (c) => {
      await repo.saveApproval(c, next, claims.sub);
      await appendAudit(c, { centerId: record.centerId, actorId: claims.sub, action: "FINGERPRINT_AUTHORISED", target: id });
    });
    return { ok: true };
  });

  app.get("/api/admin/approvals/pending", async (req, reply) => {
    const claims = auth(req);
    if (!claims || claims.role !== "CENTER_ADMIN" || !claims.centre) return deny(reply, 403, "FORBIDDEN");
    return { pending: await repo.listPendingApprovals(pool, claims.centre) };
  });

  app.get("/api/admin/centre/counts", async (req, reply) => {
    const claims = auth(req);
    if (!claims || claims.role !== "CENTER_ADMIN" || !claims.centre) return deny(reply, 403, "FORBIDDEN");
    const examId = (req.query as { examId?: string }).examId ?? null;
    return await repo.centreCounts(pool, claims.centre, examId);
  });

  // §10.3 blind courier — held bundles as hashes only (INV-6).
  app.get("/api/admin/ledger", async (req, reply) => {
    const claims = auth(req);
    if (!claims || claims.role !== "CENTER_ADMIN" || !claims.centre) return deny(reply, 403, "FORBIDDEN");
    return { bundles: await repo.listLedgerHashes(pool, claims.centre) };
  });

  app.post("/api/admin/identity/:id/revoke", async (req, reply) => {
    const claims = auth(req);
    if (!claims || claims.role !== "CENTER_ADMIN" || !claims.centre) return deny(reply, 403, "FORBIDDEN");
    const { id } = req.params as { id: string };
    const target = await repo.getIdentity(pool, id);
    if (!target || target.centerId !== claims.centre) return deny(reply, 404, "NOT_IN_CENTRE");
    const reason = (req.body as { reason?: string })?.reason ?? "revoked by centre admin";
    await withTx(pool, async (c) => {
      await repo.revokeIdentity(c, id, reason);
      await appendAudit(c, { centerId: claims.centre, actorId: claims.sub, action: "IDENTITY_REVOKED", target: id, details: { reason } });
    });
    return { ok: true };
  });

  // §6 egress gate — the centre's internet for HQ sync opens ONLY after the
  // exam window has closed AND every present candidate has submitted. The
  // Centre Admin sees the live status (how many submissions are still pending).
  app.get("/api/admin/egress/status", async (req, reply) => {
    const claims = auth(req);
    if (!claims || claims.role !== "CENTER_ADMIN" || !claims.centre) return deny(reply, 403, "FORBIDDEN");
    const examId = (req.query as { examId?: string }).examId;
    if (!examId) return deny(reply, 400, "MISSING_EXAM");
    const status = await repo.egressStatus(pool, claims.centre, examId, now());
    if (!status) return deny(reply, 404, "UNKNOWN_EXAM");
    return status;
  });

  // §6 — authorise opening the HQ uplink. Refused (409) while any present
  // candidate has not submitted, or before the window closes — this is what
  // keeps the centre internet-free for the entire duration of the exam.
  app.post("/api/admin/egress/open", async (req, reply) => {
    const claims = auth(req);
    if (!claims || claims.role !== "CENTER_ADMIN" || !claims.centre) return deny(reply, 403, "FORBIDDEN");
    const examId = (req.body as { examId?: string })?.examId;
    if (!examId) return deny(reply, 400, "MISSING_EXAM");
    const status = await repo.egressStatus(pool, claims.centre, examId, now());
    if (!status) return deny(reply, 404, "UNKNOWN_EXAM");
    if (!status.mayOpen) {
      await withTx(pool, (c) =>
        appendAudit(c, { centerId: claims.centre, actorId: claims.sub, action: "EGRESS_OPEN_DENIED", target: examId, details: { windowClosed: status.windowClosed, pending: status.pendingCount } }),
      );
      return reply.code(409).send({ ok: false, reason: status.windowClosed ? "SUBMISSIONS_PENDING" : "EXAM_WINDOW_OPEN", pending: status.pendingCount });
    }
    await withTx(pool, async (c) => {
      await repo.openEgress(c, examId, claims.sub);
      await appendAudit(c, { centerId: claims.centre, actorId: claims.sub, action: "EGRESS_OPENED", target: examId, details: { submitted: status.submittedCount } });
    });
    return { ok: true, status: { ...status, egressOpenedAt: now() } };
  });

  // §13.4 — produce a signed, ciphertext-only sync bundle for HQ (§11 egress).
  // The Centre Admin is a courier: it forwards sealed envelopes it cannot open
  // and node-signs the manifest so HQ can detect any tamper in transit. GATED:
  // refuses until egress has been authorised for this exam (window closed + all
  // present candidates submitted), so answers cannot leak mid-exam (§6, INV-3).
  app.post("/api/admin/ledger/export", async (req, reply) => {
    const claims = auth(req);
    if (!claims || claims.role !== "CENTER_ADMIN" || !claims.centre) return deny(reply, 403, "FORBIDDEN");
    const examId = (req.body as { examId?: string })?.examId;
    if (!examId) return deny(reply, 400, "MISSING_EXAM");
    const status = await repo.egressStatus(pool, claims.centre, examId, now());
    if (!status) return deny(reply, 404, "UNKNOWN_EXAM");
    if (!status.egressOpenedAt && !status.mayOpen) {
      return reply.code(409).send({ ok: false, reason: "EGRESS_NOT_OPEN", pending: status.pendingCount });
    }
    const records = await repo.listSealedForExport(pool, claims.centre, examId);
    if (records.length === 0) return { ok: true, bundle: null, exported: 0 };

    const manifest = {
      centreId: claims.centre,
      count: records.length,
      records,
      exportedAt: now(),
    };
    // Sign the canonical manifest bytes with the centre node key (TPM stand-in).
    const manifestBytes = utf8.encode(canonicalJson(manifest));
    const manifestHash = sha256(manifestBytes);
    const signer = makeNodeSigner(config.nodeSignSeed);
    const sig = signer.signRoot(manifestHash);

    const exported = await withTx(pool, async (c) => {
      const n = await repo.markSynced(c, claims.centre!, records.map((r) => r.leaf));
      await appendAudit(c, {
        centerId: claims.centre, actorId: claims.sub, action: "LEDGER_EXPORTED",
        target: null, details: { count: n, manifestHash: toHex(manifestHash) },
      });
      return n;
    });

    return {
      ok: true,
      exported,
      bundle: {
        manifest,
        manifestHash: toHex(manifestHash),
        nodeSig: toHex(sig),
        nodePubkey: toHex(signer.publicKey),
      },
    };
  });

  // ════════════════════ §13.2 invigilator console ════════════════════════
  const requireInvigilator = (req: FastifyRequest): TokenClaims | null => {
    const c = auth(req);
    return c && c.role === "CENTER_INVIGILATOR" && c.centre ? c : null;
  };

  app.get("/api/centre/roster", async (req, reply) => {
    const claims = requireInvigilator(req);
    if (!claims) return deny(reply, 403, "FORBIDDEN");
    const examId = (req.query as { examId?: string }).examId;
    if (!examId) return deny(reply, 400, "MISSING_EXAM");
    return { roster: await repo.roster(pool, claims.centre!, examId) };
  });

  // §9.5 — candidate check-in (invigilator verifies face + fingerprint).
  app.post("/api/candidate/checkin", async (req, reply) => {
    const claims = requireInvigilator(req);
    if (!claims) return deny(reply, 403, "FORBIDDEN");
    const b = req.body as { examId: string; roll: string; faceScore: number; fpScore: number };
    const bioOk = b.faceScore >= DEFAULT_POLICY.tauFace && b.fpScore >= DEFAULT_POLICY.tauFp;
    if (!bioOk) {
      await withTx(pool, (c) =>
        appendAudit(c, { centerId: claims.centre, actorId: claims.sub, action: "CHECKIN_DENIED", target: b.roll, details: { face: b.faceScore, fp: b.fpScore } }),
      );
      return reply.code(401).send({ ok: false, reason: "BIOMETRIC_MISMATCH" });
    }
    const ok = await withTx(pool, async (c) => {
      const updated = await repo.markCheckedIn(c, { centerId: claims.centre!, examId: b.examId, roll: b.roll, checkedInBy: claims.sub });
      if (updated) await appendAudit(c, { centerId: claims.centre, actorId: claims.sub, action: "CANDIDATE_CHECKED_IN", target: b.roll });
      return updated;
    });
    if (!ok) return deny(reply, 404, "ROLL_NOT_ON_ROSTER");
    return { ok: true, status: "PRESENT" };
  });

  // §9.6 — random seat auto-assignment (atomic, fail-closed).
  app.post("/api/seat/assign", async (req, reply) => {
    const claims = requireInvigilator(req);
    if (!claims) return deny(reply, 403, "FORBIDDEN");
    const b = req.body as { examId: string; roll: string };
    try {
      const result = await withTx(pool, (c) =>
        assignRandomSeat(c, {
          centreId: claims.centre!, examId: b.examId, candidateRoll: b.roll,
          invigilatorId: claims.sub, bindSecret: config.bindSecret,
        }),
      );
      return { ok: true, seatNo: result.seatNo, terminalId: result.terminalId };
    } catch (err) {
      if (err instanceof NoFreeSeatError) return reply.code(409).send({ ok: false, reason: "NO_FREE_SEAT" });
      throw err;
    }
  });

  // §10.2 — live seat map for THIS centre (feeds the invigilator dashboard).
  app.get("/api/centre/seatmap", async (req, reply) => {
    const claims = requireInvigilator(req);
    if (!claims) return deny(reply, 403, "FORBIDDEN");
    return { seats: await repo.seatMap(pool, claims.centre!) };
  });

  // §13.2 — raise an anomaly/incident. The hash-chained audit log IS the
  // incident store, so a raised incident can never be silently removed.
  app.post("/api/incident", async (req, reply) => {
    const claims = requireInvigilator(req);
    if (!claims) return deny(reply, 403, "FORBIDDEN");
    const b = req.body as { seatNo?: string; type?: string; severity?: string; note?: string };
    if (!b?.type) return deny(reply, 400, "MISSING_TYPE");
    await withTx(pool, (c) =>
      appendAudit(c, {
        centerId: claims.centre,
        actorId: claims.sub,
        action: "INCIDENT_RAISED",
        target: b.seatNo ?? null,
        details: { type: b.type, severity: b.severity ?? "INFO", note: b.note ?? null },
      }),
    );
    return { ok: true };
  });

  // ════════════════════════ §13.3 candidate seat ═════════════════════════
  app.get("/api/seat/:id/state", async (req, reply) => {
    const { id } = req.params as { id: string };
    const state = await repo.seatState(pool, id);
    if (!state) return deny(reply, 404, "UNKNOWN_TERMINAL");
    // ASSIGNED → the live (unconsumed) binding the candidate will log in against.
    // ATTENDED/IN_EXAM/SUBMITTED → the binding is consumed, but the seat still
    // needs to know WHICH exam it serves (so a page reload mid-exam fetches the
    // right paper); expose the latest binding's exam id then (no roll/PII).
    let binding: { candidateRoll: string; examId: string } | { examId: string } | null = null;
    if (state === "ASSIGNED") binding = await repo.getActiveBinding(pool, id);
    else if (state === "ATTENDED" || state === "IN_EXAM" || state === "SUBMITTED") {
      const latest = await repo.getLatestBinding(pool, id);
      if (latest) binding = { examId: latest.examId }; // exam only, not the roll
    }
    return { state, binding };
  });

  // §9.7 — candidate roll + DOB login, terminal-bound (INV-5).
  const attempts = new Map<string, number>(); // simple per-terminal rate-limit
  app.post("/api/candidate/login", async (req, reply) => {
    const b = req.body as { terminalId: string; roll: string; dob: string };
    const used = attempts.get(b.terminalId) ?? 0;
    if (used >= 3) {
      await withTx(pool, (c) =>
        appendAudit(c, { centerId: null, actorId: null, action: "CANDIDATE_LOCKED", target: b.terminalId, details: { roll: b.roll } }),
      );
      return reply.code(429).send({ ok: false, reason: "LOCKED_TOO_MANY_ATTEMPTS" });
    }

    const binding = await repo.getActiveBinding(pool, b.terminalId);
    // INV-5: the seat accepts ONLY the roll bound to it — a foreign roll is
    // refused even with a correct DOB.
    if (!binding || binding.candidateRoll !== b.roll) {
      attempts.set(b.terminalId, used + 1);
      await withTx(pool, (c) =>
        appendAudit(c, { centerId: null, actorId: null, action: "CANDIDATE_LOGIN_DENIED", target: b.terminalId, details: { reason: "ROLL_NOT_BOUND_TO_SEAT", roll: b.roll } }),
      );
      return reply.code(401).send({ ok: false, reason: "ROLL_NOT_BOUND_TO_SEAT" });
    }

    const cand = await repo.getCandidateByRoll(pool, binding.examId, b.roll);
    if (!cand || !cand.dobHash || !verifyDob(b.dob, cand.dobHash)) {
      attempts.set(b.terminalId, used + 1);
      await withTx(pool, (c) =>
        appendAudit(c, { centerId: null, actorId: null, action: "CANDIDATE_LOGIN_DENIED", target: b.terminalId, details: { reason: "DOB_MISMATCH", roll: b.roll } }),
      );
      return reply.code(401).send({ ok: false, reason: "DOB_MISMATCH" });
    }

    attempts.delete(b.terminalId);
    await withTx(pool, async (c) => {
      await repo.consumeBindingAttend(c, b.terminalId);
      await appendAudit(c, { centerId: null, actorId: null, action: "CANDIDATE_ATTENDED", target: b.terminalId, details: { roll: b.roll } });
    });
    return { ok: true, state: "ATTENDED" };
  });

  // ═══════════════ §11 encrypted answer pipeline (Phase 10) ═══════════════
  const nodeSigner = makeNodeSigner(config.nodeSignSeed);

  // §11.2 — the System Admin SEALING key (public half only). Ships in the
  // signed image in production; served from Edge config for the kiosk here.
  app.get("/api/exam/sealing-key", async (_req, reply) => {
    if (!config.systemAdminPublicKeyPem) return deny(reply, 503, "SEALING_KEY_NOT_PROVISIONED");
    return { pem: config.systemAdminPublicKeyPem, nodePubkey: toHex(nodeSigner.publicKey) };
  });

  // §10.7 — serve the SEALED, KEYLESS question bundle for an exam. The Edge is
  // the centre's pre-staged cache of the public website's sealed paper; this
  // payload is ciphertext + Merkle proofs only, so it is safe to serve before
  // T₀. The terminal verifies it against questionsRoot and refuses any question
  // not committed to that root (question-crypto.ts). A seat must have a live
  // binding to this exam (a checked-in candidate) before it can pull the bundle.
  app.get("/api/exam/:examId/bundle", async (req, reply) => {
    const { examId } = req.params as { examId: string };
    const terminalId = (req.query as { terminalId?: string }).terminalId;
    if (!terminalId) return deny(reply, 400, "MISSING_TERMINAL");
    const binding = await repo.getLatestBinding(pool, terminalId);
    if (!binding || binding.examId !== examId) return deny(reply, 403, "SEAT_NOT_BOUND_TO_EXAM");
    const bundle = await repo.getQuestionBundle(pool, examId);
    if (!bundle) return deny(reply, 404, "NO_BUNDLE_STAGED");
    return { questionsRoot: bundle.questionsRoot, bundleCid: bundle.bundleCid, chainTx: bundle.chainTx, bundle: bundle.bundle };
  });

  // §10.7 — release the T₀ beacon. Returns 425 (locked) until t0_at, so the
  // pre-staged ciphertext is undecryptable until the whole hall unlocks at once.
  app.get("/api/exam/:examId/beacon", async (req, reply) => {
    const { examId } = req.params as { examId: string };
    const terminalId = (req.query as { terminalId?: string }).terminalId;
    if (!terminalId) return deny(reply, 400, "MISSING_TERMINAL");
    const binding = await repo.getLatestBinding(pool, terminalId);
    if (!binding || binding.examId !== examId) return deny(reply, 403, "SEAT_NOT_BOUND_TO_EXAM");
    const released = await repo.getBeaconIfReleased(pool, examId, now());
    if (!released) return reply.code(425).send({ ok: false, reason: "BEFORE_T0" }); // 425 Too Early
    return { ok: true, beacon: released.beacon, hkdfSalt: released.hkdfSalt, t0At: released.t0At };
  });

  // §13.3 — push one sealed envelope; append to the centre hash-chain (§11.3).
  app.post("/api/answer/submit", async (req, reply) => {
    const b = req.body as { terminalId: string; ct: string; iv: string; tag: string; wrappedDk: string };
    if (!b?.terminalId || !b.ct || !b.iv || !b.tag || !b.wrappedDk) return deny(reply, 400, "MISSING_FIELDS");

    const term = await repo.terminalForSubmit(pool, b.terminalId);
    if (!term) return deny(reply, 404, "UNKNOWN_TERMINAL");
    // Only a seat whose candidate authenticated may commit; SUBMITTED refuses
    // a second envelope (one submission per binding), AVAILABLE/ASSIGNED have
    // no authenticated candidate yet — fail closed.
    if (term.state !== "ATTENDED" && term.state !== "IN_EXAM") {
      return deny(reply, 409, `SEAT_NOT_IN_EXAM(${term.state})`);
    }
    const binding = await repo.getLatestBinding(pool, b.terminalId);
    if (!binding) return deny(reply, 409, "NO_BINDING_FOR_SEAT");

    const ct = hex(b.ct), iv = hex(b.iv), tag = hex(b.tag), wrappedDk = hex(b.wrappedDk);
    // Never trust a client-supplied leaf — recompute over the wire bytes.
    const leaf = sha256(ct, iv, tag, wrappedDk);

    const receipt = await withTx(pool, async (c) => {
      const tail = await repo.lockChainTail(c, term.centerId, binding.examId);
      const prevRoot = tail ? tail.chainRoot : GENESIS;
      const leafIndex = tail ? tail.leafIndex + 1 : 0;
      const chainRoot = nextRoot(prevRoot, leaf);
      const sig = nodeSigner.signRoot(chainRoot);
      await repo.appendAnswer(c, {
        centerId: term.centerId, examId: binding.examId, seatNo: term.seatNo,
        leafIndex, leaf, prevRoot, chainRoot, nodeRootSig: sig,
        ciphertext: ct, iv, authTag: tag, wrappedDk,
      });
      await repo.setTerminalState(c, b.terminalId, "SUBMITTED");
      // hashes only in the audit trail — never ciphertext
      await appendAudit(c, {
        centerId: term.centerId, actorId: null, action: "ANSWER_SEALED",
        target: term.seatNo, details: { leafIndex, leaf: toHex(leaf), root: toHex(chainRoot) },
      });
      return { leafIndex, leaf, prevRoot, chainRoot, sig };
    });

    // The candidate receipt (§11.3): inclusion witness + node-signed root.
    return {
      ok: true,
      receipt: {
        leafIndex: receipt.leafIndex,
        leaf: toHex(receipt.leaf),
        prevRoot: toHex(receipt.prevRoot),
        root: toHex(receipt.chainRoot),
        nodeRootSig: toHex(receipt.sig),
        nodePubkey: toHex(nodeSigner.publicKey),
      },
    };
  });

  // §13.3 — re-fetch a receipt by leaf. Hashes only; harmless to any reader.
  app.get("/api/answer/receipt/:leaf", async (req, reply) => {
    const { leaf } = req.params as { leaf: string };
    if (!/^[0-9a-f]{64}$/i.test(leaf)) return deny(reply, 400, "BAD_LEAF");
    const row = await repo.findLedgerByLeaf(pool, hex(leaf));
    if (!row) return deny(reply, 404, "UNKNOWN_LEAF");
    // verify the witness before vouching for it (INV-9 surface)
    const valid = constantTimeEqual(row.chainRoot, nextRoot(row.prevRoot, row.leaf));
    return {
      leafIndex: row.leafIndex,
      leaf: toHex(row.leaf),
      prevRoot: toHex(row.prevRoot),
      root: toHex(row.chainRoot),
      nodeRootSig: toHex(row.nodeRootSig),
      nodePubkey: toHex(nodeSigner.publicKey),
      chainValid: valid,
    };
  });

  return app;
}
