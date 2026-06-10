/**
 * The §8.2 "match-all" intersection rule for a privileged login (Invigilator,
 * Centre Admin). A session is created IFF every clause that applies passes
 * inside one bounded login transaction. There is no partial pass (INV-4).
 *
 *   privileged_login_ok :=
 *         face_match(score ≥ τ_face)
 *     AND fingerprint_match(score ≥ τ_fp)
 *     AND source_ip == bound_ip(identity)
 *     AND tpm_attestation_valid(terminal)
 *     AND identity.status == ACTIVE
 *     AND not identity.revoked
 *     AND within_login_time_box(≤ 20 s from challenge)
 *
 * This module is pure: given the captured factors and the enrolled facts, it
 * returns a verdict and the exact list of failed clauses (for the incident
 * log). The biometric scores themselves are produced on-device/on-Edge (§8);
 * this is the gate that combines them.
 */
export interface MatchAllFactors {
  faceScore: number; // cosine similarity, 0..1
  fpScore: number; // vendor match score, 0..1 (normalised)
  sourceIp: string; // tunnel source IP the Edge observed
  tpmValid: boolean; // golden-PCR attestation passed this boot
  elapsedMs: number; // ms since the login challenge was issued
}

export interface IdentityFacts {
  boundIp: string | null; // fixed LAN IP bound to this identity/terminal
  status: string; // identity_status
  revoked: boolean;
}

export interface MatchAllPolicy {
  tauFace: number; // default 0.82 (§8.1)
  tauFp: number;
  maxLoginBoxMs: number; // default 20_000 (§8.2)
}

export const DEFAULT_POLICY: MatchAllPolicy = {
  tauFace: 0.82,
  tauFp: 0.6,
  maxLoginBoxMs: 20_000,
};

export interface MatchAllResult {
  ok: boolean;
  failures: string[];
}

export function evaluateMatchAll(
  f: MatchAllFactors,
  id: IdentityFacts,
  policy: MatchAllPolicy = DEFAULT_POLICY,
): MatchAllResult {
  const failures: string[] = [];

  if (!(f.faceScore >= policy.tauFace)) failures.push("FACE_BELOW_THRESHOLD");
  if (!(f.fpScore >= policy.tauFp)) failures.push("FINGERPRINT_BELOW_THRESHOLD");
  if (id.boundIp === null) failures.push("NO_BOUND_IP");
  else if (f.sourceIp !== id.boundIp) failures.push("SOURCE_IP_MISMATCH");
  if (!f.tpmValid) failures.push("TPM_ATTESTATION_INVALID");
  if (id.status !== "ACTIVE") failures.push("IDENTITY_NOT_ACTIVE");
  if (id.revoked) failures.push("IDENTITY_REVOKED");
  if (!(f.elapsedMs <= policy.maxLoginBoxMs)) failures.push("LOGIN_BOX_EXPIRED");

  return { ok: failures.length === 0, failures };
}
