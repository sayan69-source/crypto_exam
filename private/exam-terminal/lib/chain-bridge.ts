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

// Relative + extensioned: this module is imported both by the Next build and
// directly by `node --test`, and only this form resolves in both.
import { verifyBundleAgainstRoot, type SealedBundle } from './question-crypto.ts';

/** The on-chain record the terminal reads to discover an exam. */
export interface ChainExamRecord {
  examId: string;
  questionsRoot: string;   // 0x-prefixed Merkle root
  bundleCid: string;       // ipfs://… — content id of the sealed bundle
  drandRound: number;      // round whose beacon unlocks T₀
  chainTx?: string;        // lockExam transaction (for display / audit links)
  chainKey?: string;       // bytes32 slot in CryptoExamCore.exams (keccak of examId)
}

/** A read-only view of the chain. In production this is an RPC `eth_call` to the
 *  CryptoExamCore contract; injectable so it can be swapped for tests/airgap. */
export interface ChainReader {
  /** `chainKey` is the bytes32 slot the exam lives under — see `chainExamKey`. */
  getExamRecord(examId: string, chainKey?: string): Promise<ChainExamRecord>;
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
  // Explicit fields rather than TypeScript parameter properties: this module is
  // exercised directly by `node --test`, whose type-stripping loader rejects
  // that syntax. Keeping it plain means the bridge is testable without a build.
  private gateway: string;
  constructor(gateway = 'https://ipfs.io/ipfs/') {
    this.gateway = gateway;
  }
  async getByCid(cid: string): Promise<SealedBundle> {
    const path = cid.startsWith('ipfs://') ? cid.slice('ipfs://'.length) : cid;
    const res = await fetch(this.gateway + path, { cache: 'no-store' });
    if (!res.ok) throw new BridgeError(`Content fetch failed for ${cid} (${res.status}).`);
    return (await res.json()) as SealedBundle;
  }
}

/**
 * Reads the on-chain exam record over plain JSON-RPC `eth_call`.
 *
 * No web3 library: this runs inside a kiosk browser on a locked image, where
 * every added dependency is added attack surface for one read of one view
 * function. The call is `exams(bytes32)` — the public mapping's generated
 * getter, which returns the whole ExamRecord. `verifyExam()` is the friendlier
 * signature but omits `constraintSpecIPFS`, and that field is where the public
 * side's delivery pipeline puts the sealed bundle's content id.
 *
 * Read-only and unauthenticated by construction: reading public chain state
 * needs no key, so this reader cannot spend, sign, or write anything.
 */
export class RpcChainReader implements ChainReader {
  private rpcUrl: string;
  private contract: string;
  private selector: string;

  constructor(
    rpcUrl: string,
    contract: string,
    /** keccak256("exams(bytes32)")[0..4] — the selector for the mapping getter. */
    selector = '0x99341a8a',
  ) {
    this.rpcUrl = rpcUrl;
    this.contract = contract;
    this.selector = selector;
  }

  async getExamRecord(examId: string, chainKey?: string): Promise<ChainExamRecord> {
    const key = chainExamKey(examId, chainKey);
    const res = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: this.contract, data: this.selector + key.slice(2) }, 'latest'],
      }),
      cache: 'no-store',
    });
    if (!res.ok) throw new BridgeError(`RPC ${this.rpcUrl} returned HTTP ${res.status}.`);
    const json = (await res.json()) as { result?: string; error?: { message: string } };
    if (json.error) throw new BridgeError(`RPC error: ${json.error.message}`);
    if (!json.result || json.result === '0x') {
      throw new BridgeError(`Exam ${examId} is not on chain (empty eth_call result).`);
    }
    return decodeExamRecord(examId, json.result);
  }
}

/**
 * The bytes32 key an exam lives under in `CryptoExamCore.exams`.
 *
 * The public side writes it as `keccak256(examId_uuid_string)`. The terminal
 * deliberately does NOT recompute that: keccak is not in WebCrypto, so deriving
 * it here would mean shipping a hashing library into a kiosk browser on a
 * signed, locked image — new attack surface bought for one lookup. The chain
 * coordinates are provisioning data, so they travel WITH the exam (the Edge's
 * bundle response carries them), and this function just accepts the key.
 */
export function chainExamKey(examId: string, chainKey?: string): string {
  const candidate = chainKey ?? examId;
  if (/^0x[0-9a-fA-F]{64}$/.test(candidate)) return candidate.toLowerCase();
  throw new BridgeError(
    `No on-chain key for exam ${examId}. The chain key is keccak256 of the exam id and is ` +
    `computed by the public side at seal time — it must be provisioned with the exam, not ` +
    `derived on the terminal.`,
  );
}

/**
 * ABI-decode the `exams(bytes32)` return data.
 *
 * Layout: 12 head words, of which words 3 and 4 are byte OFFSETS to the two
 * dynamic strings (measured from the start of the return data). Everything else
 * is a value word. Only the three fields the bridge needs are decoded; the rest
 * are skipped deliberately rather than half-parsed.
 */
function decodeExamRecord(examId: string, data: string): ChainExamRecord {
  const body = data.startsWith('0x') ? data.slice(2) : data;
  const word = (i: number) => body.slice(i * 64, i * 64 + 64);
  if (body.length < 12 * 64) throw new BridgeError('Malformed exam record (return data too short).');

  const questionsRoot = '0x' + word(0);           // questionHash
  const cidOffset = Number(BigInt('0x' + word(4))); // constraintSpecIPFS
  const drandRound = Number(BigInt('0x' + word(6)));

  // A zeroed questionHash means the mapping slot was never written: Solidity
  // returns the zero value for an absent key rather than reverting, so this is
  // the only way to tell "no such exam" from "an exam sealed to nothing".
  if (/^0x0+$/.test(questionsRoot)) {
    throw new BridgeError(`Exam ${examId} has no on-chain seal commitment yet.`);
  }

  const lenAt = cidOffset * 2;
  const len = Number(BigInt('0x' + body.slice(lenAt, lenAt + 64)));
  const bytes = body.slice(lenAt + 64, lenAt + 64 + len * 2);
  let bundleCid = '';
  for (let i = 0; i < bytes.length; i += 2) bundleCid += String.fromCharCode(parseInt(bytes.slice(i, i + 2), 16));

  return { examId, questionsRoot, bundleCid, drandRound };
}

/** Still exported: a terminal with no configured chain must not invent state. */
export class UnconfiguredChainReader implements ChainReader {
  async getExamRecord(): Promise<ChainExamRecord> {
    throw new BridgeError(
      'No ChainReader configured. The centre OS image must inject an RPC-backed ' +
      'ChainReader; the terminal will not invent exam state.',
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Independent verification of what the Edge served (the point of all of this)
// ──────────────────────────────────────────────────────────────────────────

/** Where the root a bundle was checked against actually came from. */
export type RootProvenance =
  | { kind: 'CHAIN'; questionsRoot: string; chainTx?: string; drandRound: number }
  | { kind: 'PINNED'; questionsRoot: string }
  | { kind: 'EDGE_ONLY'; questionsRoot: string; reason: string };

/**
 * Confirm the root the Edge reported is the root the chain committed.
 *
 * This is the check that gives the bundle its meaning. The terminal already
 * verifies each question against `questionsRoot` — but that root arrives in the
 * SAME response as the bundle, so on its own it only proves the Edge is
 * self-consistent. A centre that wanted to swap the paper would simply swap
 * both. The root has to come from somewhere the centre does not control.
 *
 * Three sources, strongest first:
 *   CHAIN     — an eth_call confirms it. Only possible when the terminal has a
 *               route out, i.e. before the hall is sealed, or in a demo.
 *   PINNED    — the root was baked in at provisioning, before exam day, and is
 *               under the image signature. This is the air-gapped answer.
 *   EDGE_ONLY — neither was available. Returned, never thrown: the caller
 *               decides, and the surface must SAY SO rather than implying an
 *               on-chain guarantee it does not have.
 */
export async function verifyRootProvenance(
  examId: string,
  edgeReportedRoot: string,
  opts: { chain?: ChainReader; pinnedRoots?: Record<string, string>; chainTx?: string } = {},
): Promise<RootProvenance> {
  const want = edgeReportedRoot.toLowerCase();

  const pinned = opts.pinnedRoots?.[examId]?.toLowerCase();
  if (pinned && pinned !== want) {
    throw new BridgeError(
      `The centre served root ${want.slice(0, 14)}… but this terminal was provisioned with ` +
      `${pinned.slice(0, 14)}… for exam ${examId}. Refusing — the provisioned root wins.`,
    );
  }

  if (opts.chain) {
    try {
      const record = await opts.chain.getExamRecord(examId);
      if (record.questionsRoot.toLowerCase() !== want) {
        throw new BridgeError(
          `The centre served root ${want.slice(0, 14)}… but the chain commits ` +
          `${record.questionsRoot.slice(0, 14)}…. Refusing to render this paper.`,
        );
      }
      return { kind: 'CHAIN', questionsRoot: want, chainTx: opts.chainTx, drandRound: record.drandRound };
    } catch (e) {
      if (e instanceof BridgeError && /Refusing/.test(e.message)) throw e; // a real mismatch
      if (pinned) return { kind: 'PINNED', questionsRoot: want };
      return { kind: 'EDGE_ONLY', questionsRoot: want, reason: (e as Error).message };
    }
  }

  if (pinned) return { kind: 'PINNED', questionsRoot: want };
  return { kind: 'EDGE_ONLY', questionsRoot: want, reason: 'no chain reader and no provisioned root' };
}
