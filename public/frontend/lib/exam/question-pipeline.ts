/**
 * CryptoExam Core — §10.7 Per-question sealing & lazy decryption (client-side).
 *
 * This is the WebCrypto twin of `backend/crypto/question_sealing.py`. The byte
 * layout and key-derivation scheme are identical, so a bundle sealed by the
 * backend opens here and vice-versa.
 *
 * The candidate terminal uses this to decrypt ONE question at a time, only when
 * the candidate opens it — never the whole paper at once (the TCS-iON pattern).
 *
 *   masterSeed  = HKDF-SHA256(beacon,     salt=hkdfSalt, info="cryptoexam:"+examId)
 *   questionKey = HKDF-SHA256(masterSeed,  salt=examId,   info="cryptoexam:q:"+id)
 *   cipher      = AES-GCM-256, 12-byte IV, 16-byte tag (stored separately)
 *   leaf        = SHA-256(utf8(id) ‖ iv ‖ ct ‖ tag)
 *
 * Before T₀ the terminal holds only ciphertext + Merkle proofs — it physically
 * cannot read any question until the T₀ beacon yields the master seed.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export interface SealedItem {
  question_id: string;
  sequence_number?: number;
  iv: string;   // hex
  ct: string;   // hex
  tag: string;  // hex
  leaf: string; // hex
  proof: { hash: string; position: 'left' | 'right' }[];
}

export interface SealedBundle {
  examId: string;
  questionsRoot: string; // 0x-hex
  count: number;
  items: SealedItem[];
}

// ── hex helpers ──────────────────────────────────────────────────────────
export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ── HKDF key derivation ────────────────────────────────────────────────────
async function hkdf(master: Uint8Array, salt: Uint8Array, info: string, bytes = 32): Promise<Uint8Array> {
  const ikm = await crypto.subtle.importKey('raw', master as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: enc.encode(info) },
    ikm,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

/** The single secret released at T₀, derived from the public drand beacon. */
export async function deriveMasterSeed(beaconHex: string, hkdfSaltHex: string, examId: string): Promise<Uint8Array> {
  return hkdf(fromHex(beaconHex), fromHex(hkdfSaltHex), `cryptoexam:${examId}`, 32);
}

async function questionAesKey(masterSeed: Uint8Array, examId: string, questionId: string): Promise<CryptoKey> {
  const raw = await hkdf(masterSeed, enc.encode(examId), `cryptoexam:q:${questionId}`, 32);
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// ── SHA-256 Merkle (mirrors backend/crypto/merkle.py) ───────────────────────
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));
}
async function hashPair(left: Uint8Array, right: Uint8Array): Promise<Uint8Array> {
  return sha256(concat(left, right));
}

export async function questionLeaf(questionId: string, sealed: { iv: string; ct: string; tag: string }): Promise<Uint8Array> {
  return sha256(concat(enc.encode(questionId), fromHex(sealed.iv), fromHex(sealed.ct), fromHex(sealed.tag)));
}

async function buildTree(leaves: Uint8Array[]): Promise<{ root: Uint8Array; proofs: SealedItem['proof'][] }> {
  let n = 1;
  while (n < leaves.length) n <<= 1;
  const padded = [...leaves];
  while (padded.length < n) padded.push(new Uint8Array(32));

  const layers: Uint8Array[][] = [padded];
  let cur = padded;
  while (cur.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < cur.length; i += 2) next.push(await hashPair(cur[i], cur[i + 1] ?? new Uint8Array(32)));
    layers.push(next);
    cur = next;
  }
  const root = layers[layers.length - 1][0];

  const proofs: SealedItem['proof'][] = [];
  for (let idx = 0; idx < leaves.length; idx++) {
    const path: SealedItem['proof'] = [];
    let pos = idx;
    for (let l = 0; l < layers.length - 1; l++) {
      const layer = layers[l];
      const sib = pos ^ 1;
      path.push({
        hash: toHex(sib < layer.length ? layer[sib] : new Uint8Array(32)),
        position: pos % 2 === 0 ? 'right' : 'left',
      });
      pos >>= 1;
    }
    proofs.push(path);
  }
  return { root, proofs };
}

export async function verifyInclusion(leaf: Uint8Array, proof: SealedItem['proof'], rootHex: string): Promise<boolean> {
  let cur = leaf;
  for (const step of proof) {
    const sib = fromHex(step.hash);
    cur = step.position === 'right' ? await hashPair(cur, sib) : await hashPair(sib, cur);
  }
  return toHex(cur) === (rootHex.startsWith('0x') ? rootHex.slice(2) : rootHex);
}

// ── seal / open ─────────────────────────────────────────────────────────────
async function sealOne(plaintext: unknown, key: CryptoKey): Promise<{ iv: string; ct: string; tag: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = enc.encode(JSON.stringify(plaintext));
  const combined = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, data as BufferSource));
  // WebCrypto appends the 16-byte tag to the ciphertext; store them separately.
  const ct = combined.slice(0, combined.length - 16);
  const tag = combined.slice(combined.length - 16);
  return { iv: toHex(iv), ct: toHex(ct), tag: toHex(tag) };
}

async function unsealOne(sealed: { iv: string; ct: string; tag: string }, key: CryptoKey): Promise<unknown> {
  const combined = concat(fromHex(sealed.ct), fromHex(sealed.tag)); // re-append tag for WebCrypto
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromHex(sealed.iv) as BufferSource }, key, combined as BufferSource);
  return JSON.parse(dec.decode(plain));
}

/** Seal a full set of questions (used by the in-browser demo / setter preview). */
export async function sealExamQuestions(
  questions: Record<string, unknown>[],
  masterSeed: Uint8Array,
  examId: string,
): Promise<SealedBundle> {
  const sealed: Omit<SealedItem, 'proof'>[] = [];
  const leaves: Uint8Array[] = [];
  for (const q of questions) {
    const qid = String(q.id);
    const key = await questionAesKey(masterSeed, examId, qid);
    const s = await sealOne(q, key);
    const leaf = await questionLeaf(qid, s);
    sealed.push({ question_id: qid, sequence_number: q.sequence_number as number | undefined, ...s, leaf: toHex(leaf) });
    leaves.push(leaf);
  }
  const { root, proofs } = await buildTree(leaves);
  return {
    examId,
    questionsRoot: '0x' + toHex(root),
    count: sealed.length,
    items: sealed.map((s, i) => ({ ...s, proof: proofs[i] })),
  };
}

export class QuestionIntegrityError extends Error {}
export class QuestionDecryptError extends Error {}

/**
 * Lazy-open a SINGLE question — the one the candidate just selected.
 *  1. verify the ciphertext is part of the on-chain committed root, else refuse;
 *  2. derive this question's key on demand and decrypt only this question.
 */
export async function openQuestion(
  item: SealedItem,
  masterSeed: Uint8Array,
  examId: string,
  questionsRoot: string,
): Promise<Record<string, unknown>> {
  const leaf = await questionLeaf(item.question_id, item);
  if (!(await verifyInclusion(leaf, item.proof, questionsRoot))) {
    throw new QuestionIntegrityError(
      `Question ${item.question_id.slice(0, 8)}… is not part of the on-chain committed set — refusing to render.`,
    );
  }
  const key = await questionAesKey(masterSeed, examId, item.question_id);
  try {
    return (await unsealOne(item, key)) as Record<string, unknown>;
  } catch {
    throw new QuestionDecryptError('Question failed AES-GCM verification — the sealed ciphertext was altered.');
  }
}
