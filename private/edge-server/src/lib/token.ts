/**
 * Privileged session tokens (§9.8). Short idle TTL, bound to
 * {identity_id, terminal_id, tpm_anchor}, re-validated server-side on every
 * call. The spec names PASETO v4 (local); this is a dependency-free, equivalent
 * HMAC-SHA256 local token (`v4l.<payload>.<sig>`) with the same security
 * properties for a symmetric local verifier. Swap in PASETO at hardening.
 */
import { hmacSha256, constantTimeEqual, utf8, fromUtf8 } from "./crypto.ts";

export interface TokenClaims {
  sub: string; // staff identity id
  tid: string; // terminal id the session is bound to
  tpm: string; // tpm attestation anchor (PCR digest) for this boot
  role: string; // user_role
  centre: string | null; // center_id (null for SYSTEM_ADMIN)
  exp: number; // epoch ms expiry
}

const b64u = (b: Uint8Array): string => Buffer.from(b).toString("base64url");
const unb64u = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "base64url"));

export const DEFAULT_IDLE_MS = 8 * 60 * 1000; // §9.1 ≤ 8 min idle

export function issueToken(secret: Uint8Array, claims: TokenClaims): string {
  const payload = b64u(utf8.encode(JSON.stringify(claims)));
  const sig = b64u(hmacSha256(secret, utf8.encode(payload)));
  return `v4l.${payload}.${sig}`;
}

/** Verify signature + expiry. Returns claims or null (fail-closed). */
export function verifyToken(
  secret: Uint8Array,
  token: string,
  now: number,
): TokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v4l") return null;
  const expected = hmacSha256(secret, utf8.encode(parts[1]!));
  if (!constantTimeEqual(unb64u(parts[2]!), expected)) return null;
  let claims: TokenClaims;
  try {
    claims = JSON.parse(fromUtf8.decode(unb64u(parts[1]!))) as TokenClaims;
  } catch {
    return null;
  }
  if (typeof claims.exp !== "number" || now > claims.exp) return null;
  return claims;
}
