/**
 * HQ Answer Vault (§11.4 steps 1–5, §13.5) — the SYSTEM ADMIN / Tier-0 side.
 *
 * ⚠ This module models the HQ workstation, NOT the centre Edge appliance. The
 * Edge entrypoint (index.ts / http.ts) never imports it. It is co-located here
 * only so the decrypt path is byte-exact with the seal path and fully tested;
 * in production this logic runs at HQ behind the HSM (the private key lives in
 * the HSM and never reaches software), and the public-website backend exposes
 * the §13.5 endpoints. It is the only place a plaintext answer ever exists.
 *
 * Ingest does, in order:
 *   1. verify the centre node signature over the manifest (tamper in transit)
 *   2. re-walk each exam's Merkle hash-chain (INV-9: tamper at rest)
 *   3. HSM-unwrap the data key, AES-GCM-open the record (the only decrypt)
 *   4. emit a NO-PII anchor payload {centre_id_hash, exam_id, answer_root,
 *      count, node_pubkey} for Polygon (§11.5, DPDP)
 */
import { open, type Sealed } from "../lib/envelope.ts";
import { verifyChain, type ChainRecord } from "../lib/merkle-chain.ts";
import { verifyRootSig } from "../lib/node-sign.ts";
import { sha256, toHex, fromHex, fromUtf8, canonicalJson, utf8 } from "../lib/crypto.ts";

export interface ExportRecord {
  examId: string;
  seatNo: string | null;
  leafIndex: number;
  leaf: string;
  prevRoot: string;
  chainRoot: string;
  nodeRootSig: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  wrappedDk: string;
}

export interface SyncBundle {
  manifest: { centreId: string; count: number; records: ExportRecord[]; exportedAt: number };
  manifestHash: string;
  nodeSig: string;
  nodePubkey: string;
}

/** What HQ anchors on Polygon (§11.5). Roots/counts/hashes ONLY — no PII. */
export interface AnchorPayload {
  centreIdHash: string; // SHA-256(centreId) — never the raw centre id
  examId: string;
  answerRoot: string;   // final chain root for this (centre, exam)
  count: number;
  nodePubkey: string;
}

/** A decrypted answer the System Admin DB receives (the only plaintext copy). */
export interface DecryptedAnswer {
  examId: string;
  seatNo: string | null;
  leafIndex: number;
  record: unknown; // the §11.2 record R
}

export interface IngestResult {
  centreIdHash: string;
  decrypted: DecryptedAnswer[];
  anchors: AnchorPayload[];
}

export class IngestError extends Error {}

function recordToChain(rs: ExportRecord[]): ChainRecord[] {
  return rs
    .slice()
    .sort((a, b) => a.leafIndex - b.leafIndex)
    .map((r) => ({
      index: r.leafIndex,
      leaf: fromHex(r.leaf),
      prevRoot: fromHex(r.prevRoot),
      root: fromHex(r.chainRoot),
    }));
}

/**
 * Verify + decrypt a centre sync bundle with the HQ private key.
 * `systemAdminPrivKeyPem` stands in for the HSM unwrap; in production the key
 * never leaves the HSM and this call is an HSM operation.
 */
export function ingest(bundle: SyncBundle, systemAdminPrivKeyPem: string): IngestResult {
  // 1 — manifest integrity: the centre node signed exactly these bytes.
  const manifestBytes = utf8.encode(canonicalJson(bundle.manifest));
  const manifestHash = sha256(manifestBytes);
  if (toHex(manifestHash) !== bundle.manifestHash) throw new IngestError("MANIFEST_HASH_MISMATCH");
  if (!verifyRootSig(fromHex(bundle.nodePubkey), manifestHash, fromHex(bundle.nodeSig))) {
    throw new IngestError("NODE_SIGNATURE_INVALID");
  }

  const { centreId, records } = bundle.manifest;
  const centreIdHash = toHex(sha256(utf8.encode(centreId)));

  // group by exam so each exam has its own chain + anchor
  const byExam = new Map<string, ExportRecord[]>();
  for (const r of records) {
    const list = byExam.get(r.examId) ?? [];
    list.push(r);
    byExam.set(r.examId, list);
  }

  const decrypted: DecryptedAnswer[] = [];
  const anchors: AnchorPayload[] = [];

  for (const [examId, rs] of byExam) {
    // 2 — re-walk the chain (INV-9). Any tampered leaf/root fails here.
    const chain = recordToChain(rs);
    const verdict = verifyChain(chain);
    if (!verdict.ok) throw new IngestError(`CHAIN_BROKEN_AT_${verdict.brokenAt}`);

    // every leaf must equal SHA-256(ct‖iv‖tag‖wrapped_DK) of its envelope
    for (const r of rs) {
      const recomputed = sha256(fromHex(r.ciphertext), fromHex(r.iv), fromHex(r.authTag), fromHex(r.wrappedDk));
      if (toHex(recomputed) !== r.leaf) throw new IngestError(`LEAF_ENVELOPE_MISMATCH@${r.leafIndex}`);
    }

    // 3 — HSM unwrap + AES-GCM open (the only place plaintext exists).
    for (const r of rs) {
      const sealed: Sealed = {
        ct: fromHex(r.ciphertext), iv: fromHex(r.iv),
        tag: fromHex(r.authTag), wrappedDk: fromHex(r.wrappedDk), leaf: fromHex(r.leaf),
      };
      const pt = open(sealed, systemAdminPrivKeyPem);
      decrypted.push({ examId, seatNo: r.seatNo, leafIndex: r.leafIndex, record: JSON.parse(fromUtf8.decode(pt)) });
    }

    // 4 — NO-PII anchor payload (§11.5). The answer_root is the final root.
    const last = chain[chain.length - 1]!;
    anchors.push({
      centreIdHash,
      examId,
      answerRoot: toHex(last.root),
      count: rs.length,
      nodePubkey: bundle.nodePubkey,
    });
  }

  return { centreIdHash, decrypted, anchors };
}

/**
 * Guard: prove an anchor payload carries no PII before it is broadcast on a
 * public chain (DPDP / §11.6). Throws if any field looks like an identifier.
 */
export function assertNoPii(anchor: AnchorPayload): void {
  const blob = JSON.stringify(anchor).toLowerCase();
  for (const forbidden of ["roll", "name", "aadhaar", "dob", "ciphertext", "seat"]) {
    if (blob.includes(forbidden)) throw new IngestError(`ANCHOR_CARRIES_PII:${forbidden}`);
  }
  // only hex hashes/ids + a count are allowed
  for (const k of ["centreIdHash", "answerRoot", "nodePubkey"] as const) {
    if (!/^[0-9a-f]+$/.test(anchor[k])) throw new IngestError(`ANCHOR_FIELD_NOT_HASH:${k}`);
  }
}
