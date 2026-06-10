/**
 * Centre Edge append-only Merkle hash-chain (§11.3) — the local "blockchain".
 *
 *   leaf_n  = SHA-256(ct || iv || tag || wrapped_DK)     (computed by the seal)
 *   root_n  = SHA-256(root_{n-1} || leaf_n)              (rolling chain root)
 *   sig_n   = TPM_sign(centre_node, root_n)              (added by answer-store)
 *
 * Tampering with any stored leaf changes its root and every root after it, so
 * a full re-walk detects the break (INV-9). The candidate receipt is the
 * inclusion witness {leaf, prevRoot, root} — verifiable against the anchored
 * root without revealing any other answer.
 */
import { sha256, constantTimeEqual } from "./crypto.ts";

/** The genesis root: 32 zero bytes. */
export const GENESIS: Uint8Array = new Uint8Array(32);

export interface ChainRecord {
  index: number;
  leaf: Uint8Array;
  prevRoot: Uint8Array;
  root: Uint8Array;
}

export function nextRoot(prevRoot: Uint8Array, leaf: Uint8Array): Uint8Array {
  return sha256(prevRoot, leaf);
}

/** Append a leaf to an in-order record list, returning the new record. */
export function appendLeaf(records: ChainRecord[], leaf: Uint8Array): ChainRecord {
  const prevRoot = records.length === 0 ? GENESIS : records[records.length - 1]!.root;
  const root = nextRoot(prevRoot, leaf);
  return { index: records.length, leaf, prevRoot, root };
}

export interface VerifyResult {
  ok: boolean;
  brokenAt: number | null; // first index whose recomputed root != stored root
}

/**
 * Re-walk the chain from genesis and confirm every stored root matches the
 * recomputed root. Any edited leaf or root surfaces here (INV-9).
 */
export function verifyChain(records: ChainRecord[]): VerifyResult {
  let prevRoot = GENESIS;
  for (const rec of records) {
    if (!constantTimeEqual(rec.prevRoot, prevRoot)) {
      return { ok: false, brokenAt: rec.index };
    }
    const root = nextRoot(prevRoot, rec.leaf);
    if (!constantTimeEqual(rec.root, root)) {
      return { ok: false, brokenAt: rec.index };
    }
    prevRoot = rec.root;
  }
  return { ok: true, brokenAt: null };
}

export interface InclusionWitness {
  index: number;
  leaf: Uint8Array;
  prevRoot: Uint8Array;
  root: Uint8Array;
}

export function inclusionWitness(rec: ChainRecord): InclusionWitness {
  return { index: rec.index, leaf: rec.leaf, prevRoot: rec.prevRoot, root: rec.root };
}

/** Verify a receipt's inclusion witness: root == SHA-256(prevRoot || leaf). */
export function verifyInclusion(w: InclusionWitness): boolean {
  return constantTimeEqual(w.root, nextRoot(w.prevRoot, w.leaf));
}
