/**
 * The public ↔ private bridge — and the ONLY thing that crosses it.
 *
 * A centre terminal never calls the public website's API, shares no database
 * with it, and holds no shared secret. To obtain an exam it does exactly three
 * things, in order:
 *
 *   1. READ THE CHAIN   — look up the exam's on-chain record (committed by the
 *                         public side's lockExam): { questionsRoot, bundleCid,
 *                         drandRound }.
 *   2. FETCH BY CID      — pull the opaque, keyless sealed bundle from a public
 *                         content-addressed store (IPFS) using bundleCid. The
 *                         bundle is ciphertext + Merkle proofs only.
 *   3. VERIFY VS CHAIN   — recompute and check every question against the
 *                         on-chain questionsRoot. If anything mismatches, the
 *                         bundle is rejected. Trust comes from the chain, never
 *                         from whoever served the bytes.
 *
 * Because the only inputs are (a) public chain state and (b) a content-addressed
 * blob whose hash is pinned on that chain, a malicious or impersonated public
 * server cannot feed the terminal a doctored paper: a changed bundle changes the
 * CID (fails step 2's address) or the root (fails step 3's proof).
 *
 * Decryption keys never traverse this bridge. They are derived ON the terminal
 * at T₀ from the public drand beacon — see ./question-crypto.ts.
 */

import { verifyBundleAgainstRoot, type SealedBundle } from '@/lib/question-crypto';

/** The on-chain record the terminal reads to discover an exam. */
export interface ChainExamRecord {
  examId: string;
  questionsRoot: string;   // 0x-prefixed Merkle root
  bundleCid: string;       // ipfs://… — content id of the sealed bundle
  drandRound: number;      // round whose beacon unlocks T₀
  chainTx?: string;        // lockExam transaction (for display / audit links)
}

/** A read-only view of the chain. In production this is an RPC `eth_call` to the
 *  CryptoExamCore contract; injectable so it can be swapped for tests/airgap. */
export interface ChainReader {
  getExamRecord(examId: string): Promise<ChainExamRecord>;
}

/** A read-only content-addressed fetch (IPFS gateway). Injectable. */
export interface ContentReader {
  getByCid(cid: string): Promise<SealedBundle>;
}

export class BridgeError extends Error {}

/**
 * Load a sealed bundle for `examId` through the bridge, returning it ONLY if it
 * verifies against the on-chain root. This is the single entry point the
 * terminal uses to obtain exam content.
 */
export async function loadVerifiedBundle(
  examId: string,
  chain: ChainReader,
  content: ContentReader,
): Promise<{ record: ChainExamRecord; bundle: SealedBundle }> {
  // 1. READ THE CHAIN — the authoritative commitment.
  const record = await chain.getExamRecord(examId);
  if (!record?.questionsRoot || !record?.bundleCid) {
    throw new BridgeError(`Exam ${examId} has no on-chain seal commitment yet.`);
  }

  // 2. FETCH BY CID — opaque, keyless bytes from a public store.
  const bundle = await content.getByCid(record.bundleCid);

  // 3. VERIFY VS CHAIN — the bytes are only trusted if they match the chain.
  const ok = await verifyBundleAgainstRoot(bundle, record.questionsRoot);
  if (!ok) {
    throw new BridgeError(
      `Bundle for ${examId} does not match the on-chain root ${record.questionsRoot.slice(0, 14)}…. ` +
      `Rejecting — the chain is authoritative, not the server that delivered these bytes.`,
    );
  }
  return { record, bundle };
}

// ──────────────────────────────────────────────────────────────────────────
// Default readers.
//
// A live deployment injects an RPC-backed ChainReader and an IPFS-backed
// ContentReader. Until the centre OS image wires those up, these defaults read
// from a public IPFS gateway and a public read-only RPC. They are intentionally
// READ-ONLY and unauthenticated — the terminal needs no credentials to read
// public chain state or public content.
// ──────────────────────────────────────────────────────────────────────────

/** Reads the sealed bundle from a public IPFS gateway by CID. */
export class IpfsContentReader implements ContentReader {
  constructor(private gateway = 'https://ipfs.io/ipfs/') {}
  async getByCid(cid: string): Promise<SealedBundle> {
    const path = cid.startsWith('ipfs://') ? cid.slice('ipfs://'.length) : cid;
    const res = await fetch(this.gateway + path, { cache: 'no-store' });
    if (!res.ok) throw new BridgeError(`Content fetch failed for ${cid} (${res.status}).`);
    return (await res.json()) as SealedBundle;
  }
}

/**
 * Reads the on-chain exam record. A real implementation performs an
 * `eth_call` against CryptoExamCore.exams(keccak(examId)) and decodes the
 * { questionHash, constraintSpecIPFS, drandRound } fields. That belongs to the
 * OS image's signed RPC config, so it is left as an injection point rather than
 * hard-coding an endpoint here.
 */
export class UnconfiguredChainReader implements ChainReader {
  async getExamRecord(): Promise<ChainExamRecord> {
    throw new BridgeError(
      'No ChainReader configured. The centre OS image must inject an RPC-backed ' +
      'ChainReader; the terminal will not invent exam state.',
    );
  }
}
