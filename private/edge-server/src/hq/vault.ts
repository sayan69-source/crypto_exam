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

/** A record that verified structurally but could not be opened. */
export interface QuarantinedRecord {
  examId: string;
  seatNo: string | null;
  leafIndex: number;
  reason: string;
}

export interface IngestResult {
  centreIdHash: string;
  decrypted: DecryptedAnswer[];
  anchors: AnchorPayload[];
  /** Non-empty means some answers need manual attention — never silently lost. */
  quarantined: QuarantinedRecord[];
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
 * The centre signing keys HQ recognises, keyed by centre id.
 *
 * Registered during provisioning over a channel that is NOT the channel the
 * bundle travels on. Without this, `ingest` had to take the verifying key from
 * `bundle.nodePubkey` — i.e. from the object it was authenticating — which
 * proves only that the sender can run Ed25519. Anyone able to hand HQ a bundle
 * generated a keypair, signed their own fabricated manifest, passed, and then
 * had their key anchored on-chain as the centre's.
 */
export type CentreKeyRegistry = ReadonlyMap<string, Uint8Array>;

/**
 * Verify + decrypt a centre sync bundle with the HQ private key.
 * `systemAdminPrivKeyPem` stands in for the HSM unwrap; in production the key
 * never leaves the HSM and this call is an HSM operation.
 *
 * `centreKeys` is required: an unregistered centre is refused rather than
 * trusted. Callers that genuinely have no registry yet must say so explicitly
 * by passing one — there is no "trust the bundle" default.
 */
export function ingest(
  bundle: SyncBundle,
  systemAdminPrivKeyPem: string,
  centreKeys: CentreKeyRegistry,
): IngestResult {
  // 1 — manifest integrity: the centre node signed exactly these bytes, with
  // the key HQ registered for that centre — never the one the bundle offers.
  const manifestBytes = utf8.encode(canonicalJson(bundle.manifest));
  const manifestHash = sha256(manifestBytes);
  if (toHex(manifestHash) !== bundle.manifestHash) throw new IngestError("MANIFEST_HASH_MISMATCH");

  const expectedKey = centreKeys.get(bundle.manifest.centreId);
  if (!expectedKey) throw new IngestError("UNKNOWN_CENTRE");
  // A bundle may still carry its key; if it disagrees with the registry it is
  // a forgery attempt, and saying so is more useful than ignoring the field.
  if (bundle.nodePubkey && bundle.nodePubkey.toLowerCase() !== toHex(expectedKey)) {
    throw new IngestError("NODE_PUBKEY_NOT_REGISTERED_FOR_CENTRE");
  }
  if (!verifyRootSig(expectedKey, manifestHash, fromHex(bundle.nodeSig))) {
    throw new IngestError("NODE_SIGNATURE_INVALID");
  }
  const registeredPubkey = toHex(expectedKey);

  const { centreId, records } = bundle.manifest;
  const centreIdHash = toHex(sha256(utf8.encode(centreId)));

  // A hash-chain proves nothing about records that were never in it. Dropping
  // the last N candidates before export re-walks perfectly clean, so the count
  // the centre declared is the only in-band signal that anything is missing —
  // check it, then rely on the pre-export anchored root for the rest.
  if (bundle.manifest.count !== records.length) {
    throw new IngestError(
      `MANIFEST_COUNT_MISMATCH:declared=${bundle.manifest.count},present=${records.length}`,
    );
  }

  // group by exam so each exam has its own chain + anchor
  const byExam = new Map<string, ExportRecord[]>();
  for (const r of records) {
    const list = byExam.get(r.examId) ?? [];
    list.push(r);
    byExam.set(r.examId, list);
  }

  const decrypted: DecryptedAnswer[] = [];
  const anchors: AnchorPayload[] = [];
  const quarantined: QuarantinedRecord[] = [];

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
    //
    // Quarantine per record: `open` throws on a malformed envelope, and one
    // unopenable row used to abort the whole call — so a single junk submission
    // blocked every other candidate in the exam from being decrypted.
    //
    // But a batch where NOTHING opens is not a data problem, it is a key
    // problem — the wrong HSM key, or a bundle sealed to a different HQ — and
    // quietly returning "0 decrypted, N quarantined" would present a
    // misconfiguration as a corrupt centre. That still throws.
    const examQuarantined: QuarantinedRecord[] = [];
    for (const r of rs) {
      const sealed: Sealed = {
        ct: fromHex(r.ciphertext), iv: fromHex(r.iv),
        tag: fromHex(r.authTag), wrappedDk: fromHex(r.wrappedDk), leaf: fromHex(r.leaf),
      };
      try {
        const pt = open(sealed, systemAdminPrivKeyPem);
        decrypted.push({ examId, seatNo: r.seatNo, leafIndex: r.leafIndex, record: JSON.parse(fromUtf8.decode(pt)) });
      } catch (e) {
        examQuarantined.push({
          examId, seatNo: r.seatNo, leafIndex: r.leafIndex,
          reason: (e as Error).message.slice(0, 200),
        });
      }
    }
    if (rs.length > 0 && examQuarantined.length === rs.length) {
      throw new IngestError(
        `HSM_DECRYPT_FAILED_FOR_ALL@${examId}: ${examQuarantined[0]!.reason}`,
      );
    }
    quarantined.push(...examQuarantined);

    // 4 — NO-PII anchor payload (§11.5). The answer_root is the final root.
    const last = chain[chain.length - 1]!;
    anchors.push({
      centreIdHash,
      examId,
      answerRoot: toHex(last.root),
      count: rs.length,
      // The REGISTERED key, not the one the bundle carried — anchoring the
      // latter would publish an attacker's key as the centre's attestation key.
      nodePubkey: registeredPubkey,
    });
  }

  return { centreIdHash, decrypted, anchors, quarantined };
}

/**
 * Guard: prove an anchor payload carries no PII before it is broadcast on a
 * public chain (DPDP / §11.6). Throws if any field looks like an identifier.
 */
export function assertNoPii(anchor: AnchorPayload): void {
  // Structure first. The substring blocklist below can only ever fire on a
  // free-text field, and `examId` was the one such field AND the one excluded
  // from the format check — so the guard was checking three hex strings for
  // words that cannot be written in hex, and waving the only field that could
  // carry a name straight through. Pin every field's shape instead.
  for (const k of ["centreIdHash", "answerRoot", "nodePubkey"] as const) {
    if (!/^[0-9a-f]+$/.test(anchor[k])) throw new IngestError(`ANCHOR_FIELD_NOT_HASH:${k}`);
  }
  if (!/^[0-9a-fA-F-]{1,64}$/.test(anchor.examId)) {
    throw new IngestError("ANCHOR_FIELD_NOT_OPAQUE_ID:examId");
  }
  if (!Number.isInteger(anchor.count) || anchor.count < 0) {
    throw new IngestError("ANCHOR_FIELD_NOT_COUNT:count");
  }
  if (Object.keys(anchor).length !== 5) {
    throw new IngestError("ANCHOR_HAS_UNEXPECTED_FIELDS");
  }

  // Belt and braces, now that it can actually reach free text.
  const blob = JSON.stringify(anchor).toLowerCase();
  for (const forbidden of ["roll", "name", "aadhaar", "dob", "ciphertext", "seat"]) {
    if (blob.includes(forbidden)) throw new IngestError(`ANCHOR_CARRIES_PII:${forbidden}`);
  }
}
