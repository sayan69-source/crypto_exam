/**
 * § 30.1 — Print-kiosk T0 unlock.
 *
 * Two paths to the same 32-byte AES-256 master key, matching the two
 * connectivity scenarios a print-mode centre can be in at T0:
 *
 *   PATH A (preferred) — a brief connectivity window existed shortly before
 *   T0 (see § 30 sequence diagram, "T-15min re-connect"). The edge server
 *   pre-fetched the drand beacon for the T0 round and cached it locally.
 *   Deriving the key at T0 is then a pure local HKDF computation, byte-
 *   identical to what `public/backend/crypto/drand_client.py::derive_exam_key`
 *   does server-side and what `paper-delivery.ts` does client-side for the
 *   CBT path (§27.5). This file's `deriveFromCachedBeacon` MUST produce the
 *   same output as those two — verify with a shared test vector before
 *   trusting it.
 *
 *   PATH B (fallback) — no connectivity window was available at all (rural
 *   centre, ISP outage). The master key is instead reconstructed from local
 *   Shamir shards held by k-of-n on-site parties (Centre Admin + Invigilator
 *   + a pre-issued HQ envelope shard), matching `ShamirPaperGuardian` /
 *   `shamir_sss.py`'s secp256k1-prime GF(p) scheme on the Python side.
 *
 * ── IMPORTANT — this file is a NEW port, not a copy of existing code ──
 * `edge-server` currently has NO Shamir implementation (grep confirms it —
 * shamir.py / shamir_sss.py exist only on the Python backend, which is
 * unreachable during the air-gapped window). `reconstructFromShards` below
 * is a from-scratch TS port of the same secp256k1-prime Lagrange
 * interpolation. Before this goes anywhere near a real exam:
 *
 *   1. Generate shares in Python: `split_aes_key(known_key, k=3, n=5)`.
 *   2. Reconstruct with THIS file's `reconstructFromShards` on the same
 *      shares.
 *   3. Assert the output equals `known_key`.
 *   4. Add that as the first case in `print-unlock.test.ts`. Do not proceed
 *      past this test failing.
 *
 * This module deliberately holds no plaintext key longer than one function
 * call's scope — callers should derive, use immediately, and let the
 * `Uint8Array` fall out of scope (see `render-paper.ts` for the zeroization
 * pattern on the decrypted question data itself).
 */

import { sha256, toHex } from "./crypto.ts";
import { deriveMasterSeed } from "./question-seal.ts";

// ── secp256k1 prime — MUST match public/backend/app/services/crypto/shamir_sss.py::PRIME ──
const PRIME: bigint = BigInt(
  "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F",
);

export interface CachedBeacon {
  examId: string;
  drandRound: number;
  beaconRandomness: Uint8Array; // raw beacon bytes, fetched + verified before air-gap began
  hkdfSalt: Uint8Array; // matches the salt paper-delivery.ts broadcasts alongside beaconHash
}

export interface ShardPoint {
  x: number; // share index, 1..n
  y: bigint; // GF(p) value
}

export type UnlockPath = "drand-cached" | "shamir-local";

export interface UnlockResult {
  masterKey: Uint8Array; // 32 bytes
  path: UnlockPath;
  derivedAt: number; // Date.now(), for the audit log
}

/**
 * PATH A — pure local computation from a beacon fetched before air-gap.
 * Mirrors drand_client.py::derive_exam_key (HKDF-SHA256, salt=exam_id,
 * info left as default per RFC5869 — confirm this matches the Python side's
 * `salt=exam_id.encode('utf-8')` argument order; the Python HKDF from
 * pycryptodome takes (master, key_len, salt, hashmod), Node's hkdfSync takes
 * (digest, ikm, salt, info, keyLen) — the ARGUMENT POSITIONS differ even
 * though the algorithm is the same RFC. Get a cross-language test vector
 * before trusting this.
 */
export async function deriveFromCachedBeacon(cached: CachedBeacon): Promise<Uint8Array> {
  // Delegates to question-seal.ts rather than re-deriving. That is the entire
  // fix for the concern this file's header raised, and it is stronger than
  // getting the argument order right once:
  //
  // The port originally computed HKDF(beacon, salt=hkdfSalt, info=examId).
  // Three conventions exist in this repo and it matched NONE of them —
  //
  //   drand_client.py   HKDF(beacon, salt=exam_id,  info="")
  //   question-seal.ts  HKDF(beacon, salt=hkdfSalt, info="cryptoexam:"+examId)
  //   this port (was)   HKDF(beacon, salt=hkdfSalt, info=examId)
  //
  // — differing by the "cryptoexam:" prefix, which is invisible on inspection
  // and produces a completely different 32 bytes. Proven, not assumed: for a
  // fixed beacon the Python convention yields 727372cb… and the port yielded
  // e91ba0ed….
  //
  // The kiosk opens the SAME sealed bundle the Edge stages, so the Edge's
  // derivation is the only correct one. Calling it means the two can no longer
  // drift apart — a future change to the scheme changes both at once.
  return deriveMasterSeed(cached.beaconRandomness, cached.hkdfSalt, cached.examId);
}

/**
 * PATH B — Lagrange interpolation at x=0 over GF(PRIME), matching
 * shamir_sss.py's reconstruction. `shards` must contain >= k points; any
 * k of the original n reconstruct the same secret.
 */
export function reconstructFromShards(shards: ShardPoint[]): Uint8Array {
  if (shards.length < 2) {
    throw new Error("Need at least 2 shards (k >= 2) to attempt reconstruction");
  }

  let secret = 0n;
  for (let i = 0; i < shards.length; i++) {
    const { x: xi, y: yi } = shards[i]!;
    let num = 1n;
    let den = 1n;
    for (let j = 0; j < shards.length; j++) {
      if (i === j) continue;
      const xj = BigInt(shards[j]!.x);
      num = mod(num * -xj, PRIME);
      den = mod(den * (BigInt(xi) - xj), PRIME);
    }
    const term = mod(yi * num * modInverse(den, PRIME), PRIME);
    secret = mod(secret + term, PRIME);
  }

  // secret is a bigint reconstruction of the 256-bit AES key. Serialize as
  // 32 big-endian bytes. If shamir_sss.py encodes differently (e.g. via a
  // different byte-order convention when converting the AES key to/from an
  // integer for splitting), THIS is where a mismatch will show up in the
  // cross-language test vector — check split_aes_key's int-encoding step
  // before assuming this line is correct.
  let hex = secret.toString(16);
  if (hex.length > 64) hex = hex.slice(-64); // defensive; should not happen for a valid 256-bit secret
  hex = hex.padStart(64, "0");
  return new Uint8Array(Buffer.from(hex, "hex"));
}

function mod(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

function modInverse(a: bigint, p: bigint): bigint {
  // Extended Euclidean algorithm, mirrors ShamirPaperGuardian._mod_inverse.
  let [oldR, r] = [mod(a, p), p];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  if (oldR !== 1n) throw new Error("Modular inverse does not exist");
  return mod(oldS, p);
}

/**
 * Top-level entry point print-kiosk callers should use. Tries the cached
 * beacon first (cheaper, no reliance on a 2-of-3 human quorum being
 * physically present); falls back to shard reconstruction only if no
 * cached beacon exists for this exam.
 */
export async function unlockPrintMasterKey(
  cached: CachedBeacon | null,
  shards: ShardPoint[] | null,
): Promise<UnlockResult> {
  if (cached) {
    return {
      masterKey: await deriveFromCachedBeacon(cached),
      path: "drand-cached",
      derivedAt: Date.now(),
    };
  }
  if (shards && shards.length >= 2) {
    return {
      masterKey: reconstructFromShards(shards),
      path: "shamir-local",
      derivedAt: Date.now(),
    };
  }
  throw new Error(
    "No cached drand beacon and insufficient Shamir shards — cannot unlock. " +
      "This centre needed either a pre-T0 connectivity window or an on-site quorum; neither was available.",
  );
}

/** For the audit log — never log the key itself, only its fingerprint. */
export function keyFingerprint(key: Uint8Array): string {
  return toHex(sha256(key)).slice(0, 16);
}
