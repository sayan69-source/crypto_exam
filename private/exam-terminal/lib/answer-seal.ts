/**
 * Per-submission answer sealing on the terminal (§11.2) — WebCrypto only, so
 * it runs in the kiosk browser with no Node dependency. The terminal holds NO
 * private key: it seals the answer record R to the SYSTEM ADMIN public key and
 * forgets the data key. Neither this terminal nor the Centre Admin store can
 * ever read R again (INV-6) — only the HQ HSM can.
 *
 * Byte format — MUST stay identical to private/edge-server/src/lib/envelope.ts
 * (the Edge recomputes the leaf over these exact bytes, and the HQ vault opens
 * them):
 *
 *   DK          = random 256-bit key                      (per submission)
 *   iv          = random 96-bit GCM nonce
 *   ct, tag     = AES-256-GCM(DK, utf8(canonicalJson(R))) (tag = trailing 16 B)
 *   wrapped_DK  = RSA-OAEP-SHA256(SystemAdminPubKey, DK)
 *   leaf        = SHA-256(ct ‖ iv ‖ tag ‖ wrapped_DK)
 */

const utf8 = new TextEncoder();

// ── §11.2 the record R ─────────────────────────────────────────────────────
export interface ResponseEntry {
  /** The on-chain-verified question leaf — the SA pairs response↔question by hash. */
  question_hash: string;
  chosen_option: string;
  answered_at_ms: number;
  revision_count: number;
}

export interface AnswerRecord {
  exam_id: string;
  /** Pseudonymous candidate ref (roll), never name/Aadhaar (DPDP). */
  subject_ref: string;
  responses: ResponseEntry[];
  timing: { started: string; submitted: string };
  anomaly_summary: { tab_switch: number; face_fail: number; multi_face: number };
  receipt_nonce: string;
}

export interface SealedEnvelope {
  ct: Uint8Array;
  iv: Uint8Array;
  tag: Uint8Array;
  wrappedDk: Uint8Array;
  leaf: Uint8Array;
}

// ── canonical JSON (byte-identical to the Edge's canonicalJson) ───────────
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

// ── helpers ───────────────────────────────────────────────────────────────
function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----(BEGIN|END)[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** Generate the §11.2 receipt nonce (also used as an idempotency handle). */
export function receiptNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return toHex(b);
}

// ── the seal ──────────────────────────────────────────────────────────────
/**
 * Seal R to the System Admin public key (PEM, SPKI). Pure WebCrypto; the DK
 * exists only inside this function's scope and is wrapped before return —
 * nothing retained here can decrypt the answers.
 */
export async function sealRecord(record: AnswerRecord, systemAdminPubKeyPem: string): Promise<SealedEnvelope> {
  const subtle = crypto.subtle;

  // per-submission 256-bit data key
  const dkRaw = new Uint8Array(32);
  crypto.getRandomValues(dkRaw);
  const dk = await subtle.importKey("raw", dkRaw, { name: "AES-GCM" }, false, ["encrypt"]);

  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const plaintext = utf8.encode(canonicalJson(record));
  // WebCrypto returns ct‖tag concatenated; the wire format keeps them separate.
  const ctAndTag = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, dk, plaintext));
  const ct = ctAndTag.slice(0, ctAndTag.length - 16);
  const tag = ctAndTag.slice(ctAndTag.length - 16);

  const rsaPub = await subtle.importKey(
    "spki",
    pemToDer(systemAdminPubKeyPem).slice().buffer,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
  const wrappedDk = new Uint8Array(await subtle.encrypt({ name: "RSA-OAEP" }, rsaPub, dkRaw));

  // burn the raw DK copy we hold (best effort in JS)
  dkRaw.fill(0);

  const leaf = new Uint8Array(await subtle.digest("SHA-256", concat(ct, iv, tag, wrappedDk).slice().buffer));
  return { ct, iv, tag, wrappedDk, leaf };
}
