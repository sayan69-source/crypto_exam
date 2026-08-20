/**
 * Signed biometric attestation (§8.4) — the face and fingerprint factors of the
 * §8.2 match-all rule, made into facts.
 *
 * Until now these two were the hole left open by the security remediation, and
 * it was documented rather than closed: `gatherFactors` measured the source IP,
 * the elapsed time and the TPM verdict itself, but read `faceScore` and
 * `fpScore` straight out of the request body. Anything that could reach the Edge
 * could therefore assert `{"faceScore":1,"fpScore":1}` and satisfy both
 * biometric clauses without a camera in the room. The same held for candidate
 * check-in, where the invigilator console sent two constants.
 *
 * The fix is the same shape as the TPM one: the component that actually
 * performs the measurement signs it, and the Edge verifies the signature
 * against a key registered at commissioning.
 *
 *   zuup-biometricd owns the camera and the reader. It never exports an image
 *   or a template (INV-6); it emits a score, and now an envelope that binds that
 *   score to (a) the terminal that captured it, (b) a nonce the Edge issued
 *   moments ago, and (c) WHO it is a claim about.
 *
 * (c) is what stops the most natural attack on check-in: without a subject, a
 * single genuine "0.95 / 0.91" envelope captured once could seat all 487
 * candidates. The subject binds the envelope to one roll, so a score measured
 * for one candidate is worthless for the next.
 *
 * Pure module: no I/O, no database. `http.ts` supplies the registered key.
 */
import { createPublicKey, createVerify, verify as verifyOneShot, type KeyObject } from "node:crypto";
import { canonicalJson, fromHex, utf8 } from "./crypto.ts";

/** What zuup-biometricd signs. Field names are part of the wire contract. */
export interface BioEnvelope {
  /** The terminal whose hardware performed the capture. */
  terminalId: string;
  /** Hex nonce from POST /api/login/challenge — freshness, one-shot. */
  nonce: string;
  /**
   * Who this measurement is about:
   *   "LOGIN"            — the operator logging in at this station
   *   "checkin:<roll>"   — the candidate being verified at the desk
   */
  subject: string;
  /**
   * Cosine similarity against the enrolled face embedding, in BASIS POINTS
   * (0–10000, integer).
   *
   * Integers, not floats, because the daemon is Python and the verifier is
   * JavaScript and both must produce the same signed bytes. `json.dumps(1.0)`
   * is `1.0` and `JSON.stringify(1.0)` is `1` — a perfect face match would have
   * been the one score whose signature never verified, on the day of the exam,
   * with no way to tell that apart from an impostor.
   */
  faceScoreBp: number;
  /** Vendor match score against the enrolled finger template, basis points. */
  fpScoreBp: number;
  /** Daemon clock, ms epoch — bounds how long an envelope stays usable. */
  capturedAt: number;
}

/** Basis points → the 0..1 scale the §8.2 thresholds are written in. */
export const BP_SCALE = 10_000;

export interface SignedBio {
  envelope: BioEnvelope;
  /** Hex signature over `canonicalJson(envelope)`. */
  sig: string;
}

export interface BioExpectation {
  /** SPKI PEM registered for this terminal at commissioning. */
  bioPubkeyPem: string | null;
  terminalId: string;
  nonce: string;
  subject: string;
  now: number;
  /** How old a capture may be when it reaches us. Defaults to the §8.2 box. */
  maxAgeMs?: number;
}

export interface BioVerdict {
  ok: boolean;
  failures: string[];
  /**
   * The scores to feed the match-all rule. ZERO unless every clause passed, so a
   * caller that forgets to check `ok` still denies rather than admits.
   */
  faceScore: number;
  fpScore: number;
}

const DEFAULT_MAX_AGE_MS = 20_000;
const DENY = (failures: string[]): BioVerdict => ({ ok: false, failures, faceScore: 0, fpScore: 0 });

/** A score must be a whole number of basis points; NaN, 1.5 and "9500" are refusals. */
const validScoreBp = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= BP_SCALE;

function signatureVerifies(message: Uint8Array, sigHex: string, key: KeyObject): boolean {
  let sig: Uint8Array;
  try {
    sig = fromHex(sigHex);
  } catch {
    return false;
  }
  // `fromHex` is lenient about non-hex input (Buffer.from stops at the first bad
  // pair), so an empty result from a non-empty string means it was not hex.
  if (sig.length === 0) return false;
  if (key.asymmetricKeyType === "ed25519" || key.asymmetricKeyType === "ed448") {
    // EdDSA signs the message itself — there is no separate digest step.
    try {
      return verifyOneShot(null, Buffer.from(message), key, Buffer.from(sig));
    } catch {
      return false;
    }
  }
  // Each encoding gets its own attempt: a DER signature checked as raw r‖s
  // makes OpenSSL throw rather than return false, and one shared try/catch
  // would swallow the first attempt and never make the second.
  const attempt = (dsaEncoding: "ieee-p1363" | "der"): boolean => {
    try {
      const v = createVerify("sha256");
      v.update(Buffer.from(message));
      v.end();
      return v.verify({ key, dsaEncoding }, Buffer.from(sig));
    } catch {
      return false;
    }
  };
  return attempt("ieee-p1363") || attempt("der");
}

/**
 * Verify a capture envelope. Fail-closed on every abnormal path: an
 * uncommissioned terminal, an unreadable key, a bad signature, an envelope for
 * another terminal/nonce/subject, a stale capture, or scores that are not
 * numbers all deny with zeroed scores.
 */
export function verifyBioEnvelope(signed: SignedBio | null | undefined, exp: BioExpectation): BioVerdict {
  if (!exp.bioPubkeyPem) return DENY(["NO_BIOMETRIC_KEY_REGISTERED"]);
  if (!signed || typeof signed !== "object" || !signed.envelope || typeof signed.sig !== "string") {
    // No envelope at all is the old, unsigned request shape. It is not accepted
    // in any configuration — there is no "unsigned scores allowed" mode to
    // forget to turn off.
    return DENY(["BIOMETRIC_ENVELOPE_MISSING"]);
  }

  let key: KeyObject;
  try {
    key = createPublicKey(exp.bioPubkeyPem);
  } catch {
    return DENY(["BIOMETRIC_KEY_UNREADABLE"]);
  }

  const env = signed.envelope;
  const failures: string[] = [];

  // Signature over the canonical bytes of exactly what we are about to read.
  if (!signatureVerifies(utf8.encode(canonicalJson(env)), signed.sig, key)) {
    failures.push("BIOMETRIC_SIGNATURE_INVALID");
  }

  if (env.terminalId !== exp.terminalId) failures.push("BIOMETRIC_TERMINAL_MISMATCH");
  if (typeof env.nonce !== "string" || env.nonce !== exp.nonce) failures.push("BIOMETRIC_NONCE_MISMATCH");
  if (env.subject !== exp.subject) failures.push("BIOMETRIC_SUBJECT_MISMATCH");

  const maxAge = exp.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const age = exp.now - env.capturedAt;
  // A capture from the future is a clock problem or a forgery; both deny. One
  // second of tolerance covers ordinary skew between the daemon and the Edge.
  if (!Number.isFinite(env.capturedAt) || age > maxAge || age < -1_000) {
    failures.push("BIOMETRIC_CAPTURE_STALE");
  }

  if (!validScoreBp(env.faceScoreBp) || !validScoreBp(env.fpScoreBp)) failures.push("BIOMETRIC_SCORES_MALFORMED");

  if (failures.length) return DENY(failures);
  return {
    ok: true,
    failures: [],
    faceScore: env.faceScoreBp / BP_SCALE,
    fpScore: env.fpScoreBp / BP_SCALE,
  };
}

/** The subject string for a candidate check-in. Keep both sides using this. */
export const checkinSubject = (roll: string): string => `checkin:${roll}`;
/** The subject string for a privileged login at a station. */
export const LOGIN_SUBJECT = "LOGIN";
/** The subject string for a first-time biometric enrolment (§9.2 step 3). */
export const ENROL_SUBJECT = "ENROL";
/**
 * The subject for enrolling ONE candidate's fingerprint at the centre (§9.5).
 *
 * Bound to the roll for the same reason `checkinSubject` is: a signed capture
 * carrying only the constant "ENROL" is a capture of *somebody*, and an
 * invigilator holding one could replay it to enrol their own finger against any
 * candidate on the roster. Binding the subject means a capture proves whose
 * finger it is, not merely that a finger was read.
 */
export const candidateEnrolSubject = (roll: string): string => `enrol:candidate:${roll}`;
/**
 * The subject for the fingerprint re-supplied at activation (§9.2 step 7).
 *
 * Bound to the request id so a capture taken for one applicant cannot activate
 * another — and so it cannot be a login capture reused. The client used to send
 * `fingerprintMatch: true` as a plain boolean, which is to say the applicant's
 * own browser decided whether their fingerprint matched.
 */
export const activateSubject = (requestId: string): string => `activate:${requestId}`;

/**
 * A first-time enrolment capture (§9.2 step 3).
 *
 * Registration is a different act from login — there is nothing to match
 * against yet — so it carries templates rather than scores. It needs the same
 * signature for the same reason: the browser used to post two literal constants
 * (`"aa".repeat(32)`, `"bb".repeat(32)`) as the applicant's face and finger, so
 * a "registration" recorded no biometric at all and anyone on the LAN could file
 * one against any station in any centre.
 *
 * Only hashes and vendor templates cross this line. No image, no raw minutiae
 * (DPDP; INV-6).
 */
export interface EnrolEnvelope {
  terminalId: string;
  nonce: string;
  subject: typeof ENROL_SUBJECT;
  /** Hex sha256 of the enrolled face embedding. */
  faceEmbeddingHash: string;
  /** Hex vendor template for the enrolled finger. */
  fingerprintTemplate: string;
  capturedAt: number;
}

export interface SignedEnrol {
  envelope: EnrolEnvelope;
  sig: string;
}

export interface EnrolVerdict {
  ok: boolean;
  failures: string[];
  /** Present only when ok — an enrolment is all-or-nothing. */
  faceEmbeddingHash: Uint8Array | null;
  fingerprintTemplate: Uint8Array | null;
}

/** Hex of at least 16 bytes; a shorter "template" is a placeholder, not a finger. */
function templateBytes(hexValue: unknown): Uint8Array | null {
  if (typeof hexValue !== "string" || !/^[0-9a-fA-F]+$/.test(hexValue) || hexValue.length % 2 !== 0) return null;
  const b = fromHex(hexValue);
  return b.length >= 16 ? b : null;
}

export function verifyEnrolEnvelope(
  signed: SignedEnrol | null | undefined,
  // `subject` is optional and defaults to the plain ENROL constant, so existing
  // staff enrolment is unchanged; a caller enrolling one named person passes the
  // bound subject instead.
  exp: Omit<BioExpectation, "subject"> & { subject?: string },
): EnrolVerdict {
  const deny = (failures: string[]): EnrolVerdict => ({
    ok: false, failures, faceEmbeddingHash: null, fingerprintTemplate: null,
  });

  if (!exp.bioPubkeyPem) return deny(["NO_BIOMETRIC_KEY_REGISTERED"]);
  if (!signed || typeof signed !== "object" || !signed.envelope || typeof signed.sig !== "string") {
    return deny(["ENROLMENT_ENVELOPE_MISSING"]);
  }

  let key: KeyObject;
  try {
    key = createPublicKey(exp.bioPubkeyPem);
  } catch {
    return deny(["BIOMETRIC_KEY_UNREADABLE"]);
  }

  const env = signed.envelope;
  const failures: string[] = [];
  if (!signatureVerifies(utf8.encode(canonicalJson(env)), signed.sig, key)) {
    failures.push("ENROLMENT_SIGNATURE_INVALID");
  }
  if (env.terminalId !== exp.terminalId) failures.push("BIOMETRIC_TERMINAL_MISMATCH");
  if (typeof env.nonce !== "string" || env.nonce !== exp.nonce) failures.push("BIOMETRIC_NONCE_MISMATCH");
  if (env.subject !== (exp.subject ?? ENROL_SUBJECT)) failures.push("BIOMETRIC_SUBJECT_MISMATCH");

  const age = exp.now - env.capturedAt;
  if (!Number.isFinite(env.capturedAt) || age > (exp.maxAgeMs ?? DEFAULT_MAX_AGE_MS) || age < -1_000) {
    failures.push("BIOMETRIC_CAPTURE_STALE");
  }

  const face = templateBytes(env.faceEmbeddingHash);
  const finger = templateBytes(env.fingerprintTemplate);
  if (!face || !finger) failures.push("ENROLMENT_TEMPLATES_MALFORMED");

  if (failures.length) return deny(failures);
  return { ok: true, failures: [], faceEmbeddingHash: face, fingerprintTemplate: finger };
}
