/**
 * One-time authorisation codes (§9.4) — a real security primitive, not a
 * decoration.
 *
 *  • Generation: 128-bit CSPRNG → Crockford base32 (no ambiguous chars),
 *    rendered as a short grouped code, e.g. `7-3K9-Q2-…`.
 *  • Storage: only an **Argon2id hash** of the code is persisted; the cleartext
 *    exists only in the approver's portal view for its TTL.
 *  • Verification: recompute Argon2id with the stored salt/params and compare
 *    in constant time.
 *
 * Single-use + TTL + "fingerprint authorised" pairing are enforced by the
 * service/DB around this module (so an issued code verifies at most once,
 * before expiry — INV-8). This module is the hashing/format primitive.
 */
import { rand } from "./crypto.ts";
import { argonHash, argonVerify, type ArgonParams, DEFAULT_ARGON } from "./argon-hash.ts";

export { DEFAULT_ARGON };
export type { ArgonParams };

// Crockford base32 alphabet — excludes I, L, O, U to avoid transcription errors.
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Generate a fresh one-time code with 128 bits of entropy, grouped for human
 * hand-off. Returns the cleartext — show it ONLY in the approver portal.
 */
export function generateCode(): string {
  const bytes = rand(16); // 128-bit
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  // Group as 2-3-3-3-3-3-3-3-3 → "7-3K9-Q2-…" style; keep first group short.
  const groups = [out.slice(0, 1)];
  for (let i = 1; i < out.length; i += 3) groups.push(out.slice(i, i + 3));
  return groups.join("-");
}

/** Normalise for hashing: strip separators, uppercase, map look-alikes. */
function normalize(code: string): string {
  return code
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/U/g, "V");
}

/** Argon2id-hash a code for storage. Returns bytes for the `code_hash` BYTEA. */
export function hashCode(code: string, params: ArgonParams = DEFAULT_ARGON): Uint8Array {
  return argonHash(normalize(code), params);
}

/** Verify a submitted code against the stored Argon2id hash. Constant-time. */
export function verifyCode(code: string, storedBytes: Uint8Array): boolean {
  return argonVerify(normalize(code), storedBytes);
}
