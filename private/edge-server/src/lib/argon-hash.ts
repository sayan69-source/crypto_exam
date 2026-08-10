/**
 * Argon2id hashing core (pure-JS via @noble/hashes — no native build). Shared
 * by one-time codes (§9.4) and candidate DOB (§9.7). Stores salt + params + hash
 * as a small JSON envelope so verification is self-describing. The cleartext is
 * never recoverable from the stored bytes.
 */
import { argon2id } from "@noble/hashes/argon2";
import { rand, constantTimeEqual, toHex, fromHex, utf8, fromUtf8 } from "./crypto.ts";

export interface ArgonParams {
  timeCost: number; // t
  memoryCostKiB: number; // m (KiB)
  parallelism: number; // p
}

export const DEFAULT_ARGON: ArgonParams = {
  timeCost: 3,
  memoryCostKiB: 65536, // 64 MiB
  parallelism: 1,
};

interface StoredHash {
  v: 1;
  salt: string; // hex
  hash: string; // hex, 32 bytes
  t: number;
  m: number;
  p: number;
}

/** Hash an already-normalised input. Returns bytes for a BYTEA column. */
export function argonHash(input: string, params: ArgonParams = DEFAULT_ARGON): Uint8Array {
  const salt = rand(16);
  const dk = argon2id(utf8.encode(input), salt, {
    t: params.timeCost,
    m: params.memoryCostKiB,
    p: params.parallelism,
    dkLen: 32,
  });
  const stored: StoredHash = {
    v: 1,
    salt: toHex(salt),
    hash: toHex(dk),
    t: params.timeCost,
    m: params.memoryCostKiB,
    p: params.parallelism,
  };
  return utf8.encode(JSON.stringify(stored));
}

/** Verify an already-normalised input against the stored hash. Constant-time. */
export function argonVerify(input: string, storedBytes: Uint8Array): boolean {
  let stored: StoredHash;
  try {
    stored = JSON.parse(fromUtf8.decode(storedBytes)) as StoredHash;
  } catch {
    return false;
  }
  if (stored.v !== 1) return false;
  // The cost parameters come out of storage and go straight into the KDF, so a
  // row claiming m = 2^31 would turn one verify into an out-of-memory kill.
  // Only this module writes the column today, which makes this cheap insurance
  // rather than a live hole — but it is one bad migration from being a remote
  // DoS, and the bounds are three lines.
  if (!Number.isInteger(stored.t) || stored.t < 1 || stored.t > 10) return false;
  if (!Number.isInteger(stored.m) || stored.m < 8 * 1024 || stored.m > 256 * 1024) return false;
  if (!Number.isInteger(stored.p) || stored.p < 1 || stored.p > 4) return false;
  const dk = argon2id(utf8.encode(input), fromHex(stored.salt), {
    t: stored.t,
    m: stored.m,
    p: stored.p,
    dkLen: 32,
  });
  return constantTimeEqual(dk, fromHex(stored.hash));
}
