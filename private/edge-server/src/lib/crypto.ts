/**
 * Small crypto helpers built on Node's built-in `node:crypto` (FIPS-capable,
 * no third-party dependency). Used by the one-time-code, Merkle-chain, and
 * envelope modules. Everything here is constant-time where it compares secrets.
 */
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const utf8 = new TextEncoder();
export const fromUtf8 = new TextDecoder();

export function sha256(...parts: Uint8Array[]): Uint8Array {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
}

export function hmacSha256(key: Uint8Array, ...parts: Uint8Array[]): Uint8Array {
  const h = createHmac("sha256", Buffer.from(key));
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
}

export function rand(n: number): Uint8Array {
  return new Uint8Array(randomBytes(n));
}

/** Constant-time equality. Returns false on length mismatch without leaking. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function toHex(b: Uint8Array): string {
  return Buffer.from(b).toString("hex");
}

export function fromHex(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "hex"));
}

/**
 * Deterministic JSON (sorted keys) so the same logical record always serialises
 * to the same bytes — required for stable leaf hashes and reproducible sealing.
 * The spec names CBOR(R); canonical JSON is the dependency-free equivalent and
 * is symmetric (round-trips), which is all the pipeline needs.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
