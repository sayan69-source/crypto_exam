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
 *   leaf        = SHA-256(0x00 ‖ len(id)‖id ‖ len(iv)‖iv ‖ len(ct)‖ct ‖ len(tag)‖tag)
 *   root        = Merkle over leaves, pair = SHA-256(0x01 ‖ left ‖ right)
 *
 * The tags and length prefixes are load-bearing; see LEAF_TAG below.
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

/**
 * Domain tags and length prefixes for the question commitment.
 *
 * The old construction was `SHA-256(id ‖ iv ‖ ct ‖ tag)` with two
 * variable-length fields, no separators and no tag. Two consequences, both real:
 *
 *  1. **The leaf was not injective.** Slide the id/iv boundary one byte left and
 *     let `ct` absorb it: ("Q17", iv, ct, tag) and ("Q1", "7"‖iv[0..11],
 *     iv[11]‖ct, tag) hash identically, and both are structurally valid items.
 *     `question_id` is what the per-question key derives from and what the
 *     candidate is shown, so one Merkle proof "committed" to more than one
 *     question. Moving the ct/tag boundary is the same trick and the item still
 *     decrypts.
 *  2. **Leaves and internal nodes were indistinguishable.** An internal node is
 *     SHA-256 over exactly 64 bytes; an attacker picks the field lengths, so a
 *     64-byte leaf preimage IS an internal node — the classic Merkle
 *     second-preimage weakness. Verified by construction: with id="" (0) +
 *     iv(12) + ct(36) + tag(16) the leaf hash equals SHA-256(left‖right).
 *
 * A 4-byte big-endian length before each field makes the encoding injective; the
 * 0x00/0x01 tags make a leaf preimage unable to collide with an internal one.
 */
const LEAF_TAG = 0x00;
const NODE_TAG = 0x01;

function u32be(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

/** Length-prefixed, domain-separated question leaf. */
export async function questionLeaf(
  id: string, iv: Uint8Array, ct: Uint8Array, tag: Uint8Array,
): Promise<Uint8Array> {
  const idBytes = enc.encode(id);
  return sha256(concat(
    new Uint8Array([LEAF_TAG]),
    u32be(idBytes.length), idBytes,
    u32be(iv.length), iv,
    u32be(ct.length), ct,
    u32be(tag.length), tag,
  ));
}

/** Domain-separated internal node. */
export async function hashNode(left: Uint8Array, right: Uint8Array): Promise<Uint8Array> {
  return sha256(concat(new Uint8Array([NODE_TAG]), left, right));
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
      const leftLeaves = idxMap[i]!;

      // An odd node is promoted unchanged, NOT duplicated.
      //
      // `right = level[i]` on an odd level is CVE-2012-2459: [A,B,C] and
      // [A,B,C,C] hash to the same root, so `questionsRoot` did not uniquely
      // commit to the question set — a 3-question paper and a 4-question paper
      // could share a root. Carrying the orphan up a level keeps the tree
      // unambiguous and costs nothing.
      if (!hasRight) {
        next.push(left);
        nextIdx.push([...leftLeaves]);
        continue;
      }

      const right = level[i + 1]!;
      const rightLeaves = idxMap[i + 1]!;
      // every leaf under `left` gets the right node as a right-sibling, & vice versa
      for (const li of leftLeaves) proofs[li]!.push({ hash: toHex(right), position: "right" });
      for (const ri of rightLeaves) proofs[ri]!.push({ hash: toHex(left), position: "left" });
      next.push(await hashNode(left, right));
      nextIdx.push([...leftLeaves, ...rightLeaves]);
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
    const leaf = await questionLeaf(q.id, iv, ct, tag);
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
