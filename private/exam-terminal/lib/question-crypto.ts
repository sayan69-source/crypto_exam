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
async function hashPair(l: Uint8Array, r: Uint8Array): Promise<Uint8Array> { return sha256(concat(l, r)); }

async function questionLeaf(id: string, s: { iv: string; ct: string; tag: string }): Promise<Uint8Array> {
  return sha256(concat(enc.encode(id), fromHex(s.iv), fromHex(s.ct), fromHex(s.tag)));
}

async function verifyInclusion(leaf: Uint8Array, proof: SealedItem['proof'], rootHex: string): Promise<boolean> {
  let cur = leaf;
  for (const step of proof) {
    const sib = fromHex(step.hash);
    cur = step.position === 'right' ? await hashPair(cur, sib) : await hashPair(sib, cur);
  }
  return toHex(cur) === (rootHex.startsWith('0x') ? rootHex.slice(2) : rootHex);
}

/** Verify EVERY question in a bundle is committed to `root` (no decryption). */
export async function verifyBundleAgainstRoot(bundle: SealedBundle, rootHex: string): Promise<boolean> {
  if ((bundle.questionsRoot || '').toLowerCase() !== rootHex.toLowerCase()) return false;
  for (const item of bundle.items) {
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
