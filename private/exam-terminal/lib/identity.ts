"use client";
/**
 * Privileged-login client (§9.1) — a courier, and deliberately nothing more.
 *
 * Everything that decides anything now happens somewhere this file cannot
 * reach: the hardware measures, the on-device daemon signs what it measured,
 * and the Edge verifies the signature and applies the §8.2 match-all rule. This
 * module carries sealed envelopes between the two and renders the verdict.
 *
 * That division is the point. The previous version assembled a `LoginProbe`
 * here — `faceScore`, `fpScore`, `tpmValid`, `observedIp`, `elapsedMs` — and
 * posted it, so the browser was stating the facts the gate was deciding on. It
 * also carried a `simulate` mode that returned 0.95/0.91 with no hardware
 * present, and `spoof` switches that rewrote factors on the way out. None of
 * those exist any more: there is no code path in this process that can produce
 * a score, alter one, or stand in for a missing reader.
 *
 * On a real ZUUP-OS station the four factors come from:
 *   face   — camera + on-device embedding w/ liveness, signed by the daemon (§8.3)
 *   finger — vendor SDK template match, signed by the daemon (§8.1)
 *   ip     — observed by the Edge on the WireGuard tunnel
 *   tpm    — TPM 2.0 quote verified by the Edge against the golden PCRs (§7.1)
 */
import { EdgeError, getToken, setToken } from "./edge.ts";

/**
 * The on-device biometric daemon (`zuup-biometric.service`), on loopback only.
 *
 * Reached through the terminal's own origin so the kiosk CSP does not have to
 * allow a second host; the Next rewrite in next.config.ts maps it to
 * 127.0.0.1:7700. The daemon owns the camera and the reader — this process
 * never sees a pixel, a template or a score it could alter (§8.4).
 */
const BIOMETRIC_BASE = "/biometric";

/** §8.2 puts a 20 s box on the whole login; cap the capture well inside it. */
const CAPTURE_TIMEOUT_MS = 8_000;

/** Opaque to this process: signed by the daemon, verified by the Edge. */
export interface SignedEnvelope {
  envelope: Record<string, unknown>;
  sig: string;
}

export interface CaptureFailure {
  /** Why nothing could be captured, in the words the screen should use. */
  reason: string;
}

export type CaptureOutcome = SignedEnvelope | CaptureFailure;
export const isCaptured = (o: CaptureOutcome): o is SignedEnvelope => "sig" in o;

interface EnrolmentTemplates {
  faceEmbeddingHash: string;
  fingerprintTemplate: string;
}

async function postJson(url: string, body: unknown, signal?: AbortSignal): Promise<Response | null> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    return null; // unreachable is a missing factor, never a passing one
  }
}

/** A one-shot nonce from the Edge. Without it nothing downstream can be fresh. */
export async function loginChallenge(terminalId: string): Promise<string | null> {
  const res = await postJson("/api/login/challenge", { terminalId });
  if (!res || !res.ok) return null;
  const json = (await res.json()) as { nonce?: string };
  return typeof json.nonce === "string" ? json.nonce : null;
}

/**
 * Fetch the enrolled templates this station's daemon must match against.
 *
 * The daemon cannot compare a live face to an enrolment it does not hold, and
 * the live capture must never leave the machine (§8.4) — so the enrolled side
 * travels instead. The Edge serves it only to a freshly-attested station that
 * holds a live challenge, and only for the identity bound to that station.
 */
async function fetchEnrolment(path: string, params: Record<string, string>): Promise<EnrolmentTemplates | null> {
  try {
    // The pre-login routes are gated on attestation + a live challenge; the
    // check-in route is gated on the invigilator's session, so send it when we
    // have one.
    const headers = new Headers();
    const token = getToken();
    if (token) headers.set("authorization", `Bearer ${token}`);
    const res = await fetch(`/api${path}?${new URLSearchParams(params).toString()}`, { headers });
    if (!res.ok) return null;
    return (await res.json()) as EnrolmentTemplates;
  } catch {
    return null;
  }
}

/**
 * Ask the daemon to measure, and to sign what it measured.
 *
 * Every abnormal path — no daemon, no camera, no reader, no face, more than one
 * face, liveness below the floor, no attestation key — ends as a
 * `CaptureFailure` or as a signed envelope carrying zeros. There is no degraded
 * "assume human" mode and no client-side threshold.
 */
async function capture(
  path: "/attest/verify" | "/attest/enrol",
  body: Record<string, unknown>,
): Promise<CaptureOutcome> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), CAPTURE_TIMEOUT_MS);
  try {
    const res = await postJson(`${BIOMETRIC_BASE}${path}`, body, ctl.signal);
    if (!res) {
      return { reason: "The biometric unit did not answer (zuup-biometricd on 127.0.0.1:7700)." };
    }
    if (res.status === 503) {
      const j = (await res.json().catch(() => ({}))) as { reason?: string };
      return {
        reason: j.reason === "NO_ATTESTATION_KEY"
          ? "This station has no biometric attestation key — it has not been commissioned."
          : "The camera or fingerprint reader is unavailable on this station.",
      };
    }
    if (!res.ok) return { reason: `The biometric unit refused the capture (HTTP ${res.status}).` };
    const json = (await res.json()) as SignedEnvelope;
    if (!json?.sig || !json?.envelope) return { reason: "The biometric unit returned an unsigned capture." };
    return json;
  } finally {
    clearTimeout(timer);
  }
}

export interface LoginVerdict {
  ok: boolean;
  failures?: string[];
}

/**
 * One privileged login: challenge → enrolment → signed capture → verdict.
 *
 * A failure at any step is reported as itself. Collapsing "the reader is
 * unplugged" into "face below threshold" is how an operator ends up scanning
 * their face twenty times at a station whose problem is a cable.
 */
async function privilegedLogin(path: string, terminalId: string): Promise<LoginVerdict> {
  const nonce = await loginChallenge(terminalId);
  if (!nonce) return { ok: false, failures: ["EDGE_UNREACHABLE"] };

  const enrolment = await fetchEnrolment("/station/enrolment", { terminalId, challengeNonce: nonce });
  if (!enrolment) return { ok: false, failures: ["NO_ENROLMENT_FOR_STATION"] };

  const captured = await capture("/attest/verify", {
    nonce,
    subject: "LOGIN",
    enrolled_embedding_hex: enrolment.faceEmbeddingHash,
    enrolled_template_hex: enrolment.fingerprintTemplate,
  });
  if (!isCaptured(captured)) return { ok: false, failures: [captured.reason] };

  try {
    const res = await fetch(`/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ terminalId, challengeNonce: nonce, bio: captured }),
    });
    const json = await res.json();
    if (res.ok && json.ok && json.token) {
      setToken(json.token);
      return { ok: true };
    }
    return { ok: false, failures: json.failures ?? [json.reason ?? "DENIED"] };
  } catch (e) {
    if (e instanceof EdgeError) return { ok: false, failures: e.body.failures ?? [e.message] };
    return { ok: false, failures: ["EDGE_UNREACHABLE"] }; // fail closed (INV-10)
  }
}

export const invigilatorLogin = (terminalId: string) => privilegedLogin("/invigilator/login", terminalId);

// ── §9.2 registration (steps 3 + 7) ───────────────────────────────────────
/**
 * Step 3 — enrol at this station; the account is created PENDING_APPROVAL.
 *
 * The centre, the bound IP and the bound station are NOT sent: the Edge takes
 * them from the machine's registry row and the connection. This form can
 * therefore only ever file a registration for the centre it is standing in.
 */
export async function registerStaff(
  path: "/invigilator/register" | "/centeradmin/register",
  input: { terminalId: string; fullName: string },
): Promise<{ requestId: string } | { error: string }> {
  const nonce = await loginChallenge(input.terminalId);
  if (!nonce) return { error: "EDGE_UNREACHABLE" };

  const captured = await capture("/attest/enrol", { nonce });
  if (!isCaptured(captured)) return { error: captured.reason };

  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fullName: input.fullName,
      terminalId: input.terminalId,
      challengeNonce: nonce,
      enrol: captured,
    }),
  });
  const json = await res.json();
  if (!res.ok) return { error: (json.failures ?? [json.reason ?? `HTTP ${res.status}`]).join(", ") };
  return { requestId: json.requestId };
}

/**
 * Step 7 — activate with the one-time code AND a re-supplied fingerprint.
 *
 * The fingerprint is captured and matched against the applicant's own
 * enrolment, bound to this request id. It used to be `fingerprintMatch: true`
 * in the request body: a boolean the applicant's browser filled in about the
 * applicant's own finger.
 */
export async function activateWithCode(input: {
  requestId: string;
  code: string;
  terminalId: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const nonce = await loginChallenge(input.terminalId);
  if (!nonce) return { ok: false, reason: "EDGE_UNREACHABLE" };

  const enrolment = await fetchEnrolment("/activation/enrolment", {
    requestId: input.requestId,
    terminalId: input.terminalId,
    challengeNonce: nonce,
  });
  if (!enrolment) return { ok: false, reason: "ENROLMENT_UNAVAILABLE" };

  const captured = await capture("/attest/verify", {
    nonce,
    subject: `activate:${input.requestId}`,
    enrolled_embedding_hex: enrolment.faceEmbeddingHash,
    enrolled_template_hex: enrolment.fingerprintTemplate,
  });
  if (!isCaptured(captured)) return { ok: false, reason: captured.reason };

  const res = await fetch("/api/staff/activate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: input.requestId,
      code: input.code,
      terminalId: input.terminalId,
      challengeNonce: nonce,
      bio: captured,
    }),
  });
  const json = await res.json();
  return res.ok ? { ok: true } : { ok: false, reason: json.reason ?? `HTTP ${res.status}` };
}

// ── §9.5 candidate check-in, captured at the invigilator's desk ────────────
/**
 * Measure the candidate in front of the desk, bound to THEIR roll.
 *
 * The subject is what stops one genuine capture from seating a whole hall: an
 * envelope measured for R-1001 is refused for R-1002. The console used to send
 * two constants for every candidate.
 */
export async function captureCheckin(input: {
  stationId: string;
  examId: string;
  roll: string;
}): Promise<{ nonce: string; bio: SignedEnvelope } | { error: string }> {
  const nonce = await loginChallenge(input.stationId);
  if (!nonce) return { error: "The Centre Edge did not issue a capture challenge." };

  const enrolment = await fetchEnrolment("/candidate/enrolment", {
    examId: input.examId,
    roll: input.roll,
  });
  if (!enrolment) return { error: "No enrolment on file for this roll at this centre." };

  const captured = await capture("/attest/verify", {
    nonce,
    subject: `checkin:${input.roll}`,
    enrolled_embedding_hex: enrolment.faceEmbeddingHash,
    enrolled_template_hex: enrolment.fingerprintTemplate,
  });
  if (!isCaptured(captured)) return { error: captured.reason };
  return { nonce, bio: captured };
}
