/**
 * HQ Answer Vault — the SYSTEM ADMIN portal's server-side ingest (§11.4,
 * §13.5). This is the ONLY place in the entire estate where a sealed answer
 * becomes plaintext: the route handler that calls this runs at HQ with the
 * System Admin private key (the HSM stand-in — in production the unwrap is an
 * HSM operation and the key never exists in software).
 *
 * Self-contained on `node:crypto` (no Edge imports — this app must never gain
 * a dependency path into a centre's code). Byte-compatibility with the Edge's
 * seal/export format is proven by
 * `edge-server/src/test/sysadmin-vault-compat.test.ts`, the same way the
 * terminal's WebCrypto sealer is proven by `seal-compat.test.ts`.
 *
 * Ingest verifies BEFORE it decrypts, in order:
 *   1. manifest hash + centre node signature  (tamper in transit)
 *   2. per-exam Merkle hash-chain re-walk     (tamper at rest, INV-9)
 *   3. leaf == SHA-256(ct‖iv‖tag‖wrappedDK)   (envelope ↔ chain binding)
 *   4. RSA-OAEP unwrap + AES-256-GCM open     (the only decrypt)
 *   5. NO-PII anchor payloads for the public chain (§11.5, DPDP)
 */
import {
  createDecipheriv,
  createHash,
  createPublicKey,
  privateDecrypt,
  timingSafeEqual,
  verify as edVerify,
  constants,
} from "node:crypto";

// ── §11.2 wire format helpers (must match edge-server/src/lib/crypto.ts) ──
const utf8 = new TextEncoder();

function sha256(...parts: Uint8Array[]): Uint8Array {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
}

const toHex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const fromHex = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "hex"));

function ctEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Deterministic JSON (sorted keys) — byte-identical to the Edge's canonicalJson. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

// Raw Ed25519 SPKI scaffold (RFC 8410) — same as edge lib/node-sign.ts.
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function verifyNodeSig(publicKey32: Uint8Array, msg: Uint8Array, sig: Uint8Array): boolean {
  if (publicKey32.length !== 32 || sig.length !== 64) return false;
  const pub = createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKey32)]),
    format: "der",
    type: "spki",
  });
  return edVerify(null, Buffer.from(msg), pub, Buffer.from(sig));
}

const GENESIS: Uint8Array = new Uint8Array(32);
const nextRoot = (prevRoot: Uint8Array, leaf: Uint8Array): Uint8Array => sha256(prevRoot, leaf);

// ── §13.4 export bundle shape (as produced by /api/admin/ledger/export) ───
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

export interface AnchorPayload {
  centreIdHash: string;
  examId: string;
  answerRoot: string;
  count: number;
  nodePubkey: string;
}

export interface DecryptedAnswer {
  examId: string;
  seatNo: string | null;
  leafIndex: number;
  record: unknown; // the §11.2 record R (questions + the candidate's responses)
}

/** One verification step, for the operator-visible audit trail in the portal. */
export interface IngestStep {
  name: string;
  ok: boolean;
  detail: string;
}

export interface IngestResult {
  ok: boolean;
  centreIdHash: string;
  steps: IngestStep[];
  decrypted: DecryptedAnswer[];
  anchors: AnchorPayload[];
  /** Set when ok=false: which check refused the bundle. */
  refusedBy?: string;
}

/**
 * Verify + decrypt one centre sync bundle. Fail-closed: the first failing
 * check stops the ingest with zero decrypts — a bundle that cannot prove its
 * integrity never reaches the private key.
 */
export function ingestBundle(bundle: SyncBundle, systemAdminPrivKeyPem: string): IngestResult {
  const steps: IngestStep[] = [];
  const refuse = (name: string, detail: string): IngestResult => {
    steps.push({ name, ok: false, detail });
    return { ok: false, centreIdHash: "", steps, decrypted: [], anchors: [], refusedBy: name };
  };

  // 1 — manifest integrity: the centre node signed exactly these bytes.
  const manifestBytes = utf8.encode(canonicalJson(bundle.manifest));
  const manifestHash = sha256(manifestBytes);
  if (toHex(manifestHash) !== bundle.manifestHash) {
    return refuse("MANIFEST_HASH", "recomputed manifest hash does not match the bundle's");
  }
  steps.push({ name: "MANIFEST_HASH", ok: true, detail: `sha256 ${bundle.manifestHash.slice(0, 16)}…` });

  if (!verifyNodeSig(fromHex(bundle.nodePubkey), manifestHash, fromHex(bundle.nodeSig))) {
    return refuse("NODE_SIGNATURE", "centre node signature over the manifest is invalid");
  }
  steps.push({ name: "NODE_SIGNATURE", ok: true, detail: `Ed25519 by node ${bundle.nodePubkey.slice(0, 16)}…` });

  const { centreId, records } = bundle.manifest;
  const centreIdHash = toHex(sha256(utf8.encode(centreId)));

  // group by exam — each exam has its own chain + anchor
  const byExam = new Map<string, ExportRecord[]>();
  for (const r of records) {
    const list = byExam.get(r.examId) ?? [];
    list.push(r);
    byExam.set(r.examId, list);
  }

  const decrypted: DecryptedAnswer[] = [];
  const anchors: AnchorPayload[] = [];

  for (const [examId, rs] of byExam) {
    rs.sort((a, b) => a.leafIndex - b.leafIndex);

    // 2 — re-walk the chain (INV-9). Any tampered leaf/root fails here.
    let prevRoot = GENESIS;
    for (const r of rs) {
      if (!ctEqual(fromHex(r.prevRoot), prevRoot)) {
        return refuse("CHAIN_WALK", `exam ${examId}: prevRoot mismatch at leaf ${r.leafIndex}`);
      }
      const root = nextRoot(prevRoot, fromHex(r.leaf));
      if (!ctEqual(fromHex(r.chainRoot), root)) {
        return refuse("CHAIN_WALK", `exam ${examId}: chain broken at leaf ${r.leafIndex}`);
      }
      prevRoot = root;
    }
    steps.push({ name: "CHAIN_WALK", ok: true, detail: `exam ${examId.slice(0, 8)}…: ${rs.length} leaves re-walked from genesis` });

    // 3 — every leaf must equal SHA-256(ct‖iv‖tag‖wrappedDK) of its envelope.
    for (const r of rs) {
      const recomputed = sha256(fromHex(r.ciphertext), fromHex(r.iv), fromHex(r.authTag), fromHex(r.wrappedDk));
      if (toHex(recomputed) !== r.leaf) {
        return refuse("LEAF_ENVELOPE", `exam ${examId}: envelope does not match leaf ${r.leafIndex}`);
      }
    }
    steps.push({ name: "LEAF_ENVELOPE", ok: true, detail: `exam ${examId.slice(0, 8)}…: all envelopes bound to their leaves` });

    // 4 — HSM unwrap + AES-256-GCM open (the only place plaintext exists).
    for (const r of rs) {
      let pt: Buffer;
      try {
        const dk = privateDecrypt(
          { key: systemAdminPrivKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
          Buffer.from(fromHex(r.wrappedDk)),
        );
        const decipher = createDecipheriv("aes-256-gcm", dk, Buffer.from(fromHex(r.iv)));
        decipher.setAuthTag(Buffer.from(fromHex(r.authTag)));
        pt = Buffer.concat([decipher.update(Buffer.from(fromHex(r.ciphertext))), decipher.final()]);
      } catch {
        return refuse("HSM_DECRYPT", `exam ${examId}: leaf ${r.leafIndex} failed to open (wrong key or tampered ciphertext)`);
      }
      decrypted.push({ examId, seatNo: r.seatNo, leafIndex: r.leafIndex, record: JSON.parse(pt.toString("utf8")) });
    }
    steps.push({ name: "HSM_DECRYPT", ok: true, detail: `exam ${examId.slice(0, 8)}…: ${rs.length} records opened` });

    // 5 — NO-PII anchor payload (§11.5): roots/counts/hashes only.
    const last = rs[rs.length - 1]!;
    anchors.push({ centreIdHash, examId, answerRoot: last.chainRoot, count: rs.length, nodePubkey: bundle.nodePubkey });
  }

  // DPDP guard: refuse to emit an anchor that smells like PII (§11.6).
  for (const a of anchors) {
    const guard = piiGuard(a);
    if (guard) return refuse("NO_PII_ANCHOR", guard);
  }
  steps.push({ name: "NO_PII_ANCHOR", ok: true, detail: `${anchors.length} anchor payload(s) carry hashes + counts only` });

  return { ok: true, centreIdHash, steps, decrypted, anchors };
}

/** Returns a reason string if the anchor payload carries anything PII-like. */
function piiGuard(anchor: AnchorPayload): string | null {
  const blob = JSON.stringify(anchor).toLowerCase();
  for (const forbidden of ["roll", "name", "aadhaar", "dob", "ciphertext", "seat"]) {
    if (blob.includes(forbidden)) return `anchor carries forbidden field content: ${forbidden}`;
  }
  for (const k of ["centreIdHash", "answerRoot", "nodePubkey"] as const) {
    if (!/^[0-9a-f]+$/.test(anchor[k])) return `anchor field is not a bare hash: ${k}`;
  }
  return null;
}
