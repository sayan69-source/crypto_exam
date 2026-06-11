/**
 * Question sealer — the INVERSE of the terminal's question-crypto.ts, used to
 * stage a real, verifiable sealed bundle into the Edge cache (seed + tests).
 *
 * In production the PUBLIC website seals the paper (delivery.py) and the bundle
 * reaches the Edge as opaque bytes pinned by an on-chain root; the Edge never
 * seals. This module exists so the LAN pipeline can be exercised end-to-end
 * here WITHOUT the public stack — every byte it emits is decrypted, unchanged,
 * by exam-terminal/lib/question-crypto.ts (proven by question-seal.test.ts).
 *
 * Scheme (identical to question-crypto.ts):
 *   masterSeed  = HKDF-SHA256(beacon, salt=hkdfSalt, info="cryptoexam:"+examId)
 *   questionKey = HKDF-SHA256(masterSeed, salt=examId, info="cryptoexam:q:"+id)
 *   cipher      = AES-GCM-256, 12-byte IV, 16-byte tag (stored separately)
 *   leaf        = SHA-256(utf8(id) ‖ iv ‖ ct ‖ tag)
 *   root        = Merkle over leaves, pair = SHA-256(left ‖ right)
 */
const enc = new TextEncoder();
const subtle = globalThis.crypto.subtle;

export interface SealedItem {
  question_id: string;
  sequence_number: number;
  iv: string;
  ct: string;
  tag: string;
  leaf: string;
  proof: { hash: string; position: "left" | "right" }[];
}
export interface SealedBundle {
  examId: string;
  questionsRoot: string;
  count: number;
  items: SealedItem[];
}

const toHex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function sha256(d: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle.digest("SHA-256", d as BufferSource));
}
async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: string, bytes = 32): Promise<Uint8Array> {
  const key = await subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: enc.encode(info) },
    key, bytes * 8,
  );
  return new Uint8Array(bits);
}

export async function deriveMasterSeed(beacon: Uint8Array, hkdfSalt: Uint8Array, examId: string): Promise<Uint8Array> {
  return hkdf(beacon, hkdfSalt, `cryptoexam:${examId}`, 32);
}

/** Build a Merkle tree + per-leaf inclusion proofs that verifyInclusion walks. */
async function merkle(leaves: Uint8Array[]): Promise<{ root: Uint8Array; proofs: { hash: string; position: "left" | "right" }[][] }> {
  if (leaves.length === 0) throw new Error("no leaves");
  const proofs: { hash: string; position: "left" | "right" }[][] = leaves.map(() => []);
  let level: Uint8Array[] = leaves.slice();
  let idxMap: number[][] = leaves.map((_, i) => [i]); // leaf indices feeding each node
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    const nextIdx: number[][] = [];
    for (let i = 0; i < level.length; i += 2) {
      const hasRight = i + 1 < level.length;
      const left = level[i]!;
      const right = hasRight ? level[i + 1]! : level[i]!; // duplicate last if odd
      const leftLeaves = idxMap[i]!;
      const rightLeaves = hasRight ? idxMap[i + 1]! : idxMap[i]!;
      // every leaf under `left` gets the right node as a right-sibling, & vice versa
      for (const li of leftLeaves) proofs[li]!.push({ hash: toHex(right), position: "right" });
      if (hasRight) for (const ri of rightLeaves) proofs[ri]!.push({ hash: toHex(left), position: "left" });
      next.push(await sha256(concat(left, right)));
      nextIdx.push(hasRight ? [...leftLeaves, ...rightLeaves] : [...leftLeaves]);
    }
    level = next;
    idxMap = nextIdx;
  }
  return { root: level[0]!, proofs };
}

/** Seal a paper to a bundle the terminal can verify + lazily decrypt at T₀. */
export async function sealExam(
  examId: string,
  questions: Array<Record<string, unknown> & { id: string }>,
  masterSeed: Uint8Array,
): Promise<SealedBundle> {
  const items: Omit<SealedItem, "proof">[] = [];
  const leaves: Uint8Array[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    const raw = await hkdf(masterSeed, enc.encode(examId), `cryptoexam:q:${q.id}`, 32);
    const key = await subtle.importKey("raw", raw as BufferSource, { name: "AES-GCM" }, false, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const pt = enc.encode(JSON.stringify(q));
    const sealed = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, pt as BufferSource));
    const ct = sealed.slice(0, sealed.length - 16);
    const tag = sealed.slice(sealed.length - 16);
    const leaf = await sha256(concat(enc.encode(q.id), iv, ct, tag));
    leaves.push(leaf);
    items.push({ question_id: q.id, sequence_number: i + 1, iv: toHex(iv), ct: toHex(ct), tag: toHex(tag), leaf: toHex(leaf) });
  }
  const { root, proofs } = await merkle(leaves);
  return {
    examId,
    questionsRoot: toHex(root),
    count: items.length,
    items: items.map((it, i) => ({ ...it, proof: proofs[i]! })),
  };
}
