/**
 * Centre terminal — per-question decryption & verification (WebCrypto).
 *
 * This is the PRIVATE side's own implementation of the §10.7 sealing scheme.
 * It is deliberately a standalone copy, not an import from the public website:
 * the public and private halves of CryptoExam share no code and no runtime
 * channel. They agree only on a published wire format (documented below), and
 * the blockchain is the sole thing that crosses the boundary.
 *
 * The terminal can only ever DECRYPT and VERIFY — it never seals. It cannot
 * read any question until the T₀ drand beacon yields the master seed, and it
 * refuses to render any question that fails its Merkle proof against the
 * on-chain questions root.
 *
 *   masterSeed  = HKDF-SHA256(beacon, salt=hkdfSalt, info="cryptoexam:"+examId)
 *   questionKey = HKDF-SHA256(masterSeed, salt=examId, info="cryptoexam:q:"+id)
 *   cipher      = AES-GCM-256, 12-byte IV, 16-byte tag (stored separately)
 *   leaf        = SHA-256(utf8(id) ‖ iv ‖ ct ‖ tag)
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export interface SealedItem {
  question_id: string;
  sequence_number?: number;
  iv: string;
  ct: string;
  tag: string;
  leaf: string;
  proof: { hash: string; position: 'left' | 'right' }[];
}

export interface SealedBundle {
  examId: string;
  questionsRoot: string;
  count: number;
  items: SealedItem[];
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
function toHex(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function hkdf(master: Uint8Array, salt: Uint8Array, info: string, bytes = 32): Promise<Uint8Array> {
  const ikm = await crypto.subtle.importKey('raw', master as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: enc.encode(info) },
    ikm, bytes * 8,
  );
  return new Uint8Array(bits);
}

/** The single secret released at T₀, derived from the public drand beacon. */
export async function deriveMasterSeed(beaconHex: string, hkdfSaltHex: string, examId: string): Promise<Uint8Array> {
  return hkdf(fromHex(beaconHex), fromHex(hkdfSaltHex), `cryptoexam:${examId}`, 32);
}

async function questionAesKey(masterSeed: Uint8Array, examId: string, questionId: string): Promise<CryptoKey> {
  const raw = await hkdf(masterSeed, enc.encode(examId), `cryptoexam:q:${questionId}`, 32);
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, ['decrypt']);
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));
}
/**
 * Domain tags + length prefixes. MUST stay byte-identical to
 * edge-server/src/lib/question-seal.ts — the two are deliberate independent
 * implementations, which is good design and also means a one-sided change
 * silently breaks the pipeline. `question-seal.test.ts` pins them together.
 *
 * Why they exist: `SHA-256(id ‖ iv ‖ ct ‖ tag)` over two variable-length fields
 * with no separators is not injective (slide the id/iv boundary and a different
 * question_id yields the same leaf), and an untagged 64-byte leaf preimage is
 * indistinguishable from an internal node — the Merkle second-preimage
 * weakness. Both were demonstrated against the old construction.
 */
const LEAF_TAG = 0x00;
const NODE_TAG = 0x01;

function u32be(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

async function hashPair(l: Uint8Array, r: Uint8Array): Promise<Uint8Array> {
  return sha256(concat(new Uint8Array([NODE_TAG]), l, r));
}

async function questionLeaf(id: string, s: { iv: string; ct: string; tag: string }): Promise<Uint8Array> {
  const idBytes = enc.encode(id);
  const iv = fromHex(s.iv), ct = fromHex(s.ct), tag = fromHex(s.tag);
  return sha256(concat(
    new Uint8Array([LEAF_TAG]),
    u32be(idBytes.length), idBytes,
    u32be(iv.length), iv,
    u32be(ct.length), ct,
    u32be(tag.length), tag,
  ));
}

async function verifyInclusion(leaf: Uint8Array, proof: SealedItem['proof'], rootHex: string): Promise<boolean> {
  let cur = leaf;
  for (const step of proof) {
    const sib = fromHex(step.hash);
    cur = step.position === 'right' ? await hashPair(cur, sib) : await hashPair(sib, cur);
  }
  return toHex(cur) === (rootHex.startsWith('0x') ? rootHex.slice(2) : rootHex);
}

/**
 * Verify EVERY question in a bundle is committed to `root` (no decryption).
 *
 * `maxProofSteps` bounds the work a hostile bundle can demand: each step is a
 * SHA-256, and nothing capped the array, so a multi-million-step proof was a
 * free CPU stall on a kiosk that has an exam to run. A genuine proof is at most
 * ⌈log₂(count)⌉ steps.
 */
export async function verifyBundleAgainstRoot(bundle: SealedBundle, rootHex: string): Promise<boolean> {
  if ((bundle.questionsRoot || '').toLowerCase() !== rootHex.toLowerCase()) return false;
  // The declared count must match what arrived, or `count` commits to nothing.
  if (typeof bundle.count !== 'number' || bundle.count !== bundle.items.length) return false;

  const maxProofSteps = Math.ceil(Math.log2(Math.max(2, bundle.items.length))) + 1;
  for (const item of bundle.items) {
    if (!Array.isArray(item.proof) || item.proof.length > maxProofSteps) return false;
    const leaf = await questionLeaf(item.question_id, item);
    if (!(await verifyInclusion(leaf, item.proof, rootHex))) return false;
  }
  return true;
}

export class QuestionIntegrityError extends Error {}
export class QuestionDecryptError extends Error {}

/**
 * Lazy-open the ONE question the candidate just selected:
 *   1. verify it is part of the on-chain committed root, else refuse;
 *   2. derive its key from the T₀ master seed and decrypt only this question.
 */
export async function openQuestion(
  item: SealedItem, masterSeed: Uint8Array, examId: string, questionsRoot: string,
): Promise<Record<string, unknown>> {
  const leaf = await questionLeaf(item.question_id, item);
  if (!(await verifyInclusion(leaf, item.proof, questionsRoot))) {
    throw new QuestionIntegrityError(
      `Question ${item.question_id.slice(0, 8)}… is not in the on-chain committed set — refusing to render.`,
    );
  }
  const key = await questionAesKey(masterSeed, examId, item.question_id);
  try {
    const combined = concat(fromHex(item.ct), fromHex(item.tag));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromHex(item.iv) as BufferSource }, key, combined as BufferSource);
    return JSON.parse(dec.decode(plain)) as Record<string, unknown>;
  } catch {
    throw new QuestionDecryptError('Question failed AES-GCM verification — sealed ciphertext was altered.');
  }
}
