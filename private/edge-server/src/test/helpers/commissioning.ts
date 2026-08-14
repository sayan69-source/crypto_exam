/**
 * Test commissioning kit — the material a real terminal is built with, made
 * reproducible in a test.
 *
 * A commissioned terminal is a row in the registry plus two key pairs it can
 * prove it holds: the TPM Attestation Key (§7.1) and the biometric daemon's
 * signing key (§8.4). Without both, nothing in the estate can log in — which is
 * exactly the state the whole estate was in, so the fixtures that stand in for
 * them are worth writing once, carefully, here.
 *
 * The TPMS_ATTEST layout below is the ONE place in this repo where the
 * structure from TPM 2.0 Library Part 2 §10.12.8 is written out besides the
 * parser it feeds; `tpm-quote.test.ts` drives the parser with it, and the
 * integration tests drive the whole HTTP flow with it.
 *
 * Not a test file (no `.test.ts`), so the runner does not execute it.
 */
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import { canonicalJson, sha256, fromHex, toHex, utf8 } from "../../lib/crypto.ts";

/** The PCRs a ZUUP-OS terminal is commissioned against (see zuup-attest.sh). */
export const GOLDEN_INDICES = [0, 4, 7, 8, 9, 14];

export interface StationKeys {
  akPrivate: KeyObject;
  akPubkeyPem: string;
  bioPrivate: KeyObject;
  bioPubkeyPem: string;
  goldenPcr: Record<string, string>;
}

/**
 * One machine's commissioning material.
 *
 * RSA for the AK (tpm2_createak's default) and Ed25519 for the daemon, so both
 * signature families used in production are exercised.
 */
export function makeStationKeys(salt = "golden"): StationKeys {
  const ak = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const bio = generateKeyPairSync("ed25519");
  return {
    akPrivate: ak.privateKey,
    akPubkeyPem: ak.publicKey.export({ type: "spki", format: "pem" }).toString(),
    bioPrivate: bio.privateKey,
    bioPubkeyPem: bio.publicKey.export({ type: "spki", format: "pem" }).toString(),
    goldenPcr: goldenPcrSet(salt),
  };
}

/** A distinct, stable digest per PCR index — a different salt is a different boot. */
export const pcrValue = (i: number, salt = "golden"): string =>
  toHex(sha256(utf8.encode(`${salt}:pcr${i}`)));

export const goldenPcrSet = (salt = "golden"): Record<string, string> =>
  Object.fromEntries(GOLDEN_INDICES.map((i) => [String(i), pcrValue(i, salt)]));

// ── TPMS_ATTEST, byte for byte ──────────────────────────────────────────────
const u16 = (n: number): Buffer => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};
const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};
const sized = (bytes: Buffer): Buffer => Buffer.concat([u16(bytes.length), bytes]);

function pcrBitmap(indices: number[]): Buffer {
  const bytes = Buffer.alloc(3);
  for (const i of indices) bytes[i >> 3] = (bytes[i >> 3] ?? 0) | (1 << (i & 7));
  return bytes;
}

export function buildQuote(opts: {
  nonce: Uint8Array;
  pcrs: Record<string, string>;
  selected?: number[];
  magic?: number;
  type?: number;
  pcrDigestOverride?: Uint8Array;
}): Uint8Array {
  const selected = (opts.selected ?? GOLDEN_INDICES).slice().sort((a, b) => a - b);
  const digest =
    opts.pcrDigestOverride ?? sha256(...selected.map((i) => fromHex(opts.pcrs[String(i)] ?? "")));

  return new Uint8Array(
    Buffer.concat([
      u32(opts.magic ?? 0xff544347),   // magic — "\xFFTCG"
      u16(opts.type ?? 0x8018),        // TPM_ST_ATTEST_QUOTE
      sized(Buffer.alloc(34, 0xa1)),   // qualifiedSigner (TPM2B_NAME)
      sized(Buffer.from(opts.nonce)),  // extraData — the Edge's nonce
      Buffer.alloc(17, 0),             // clockInfo
      Buffer.alloc(8, 0),              // firmwareVersion
      u32(1),                          // one TPMS_PCR_SELECTION
      u16(0x000b),                     // TPM_ALG_SHA256
      Buffer.from([3]),                // sizeofSelect
      pcrBitmap(selected),
      sized(Buffer.from(digest)),      // pcrDigest
    ]),
  );
}

export const signQuote = (quote: Uint8Array, key: KeyObject): Uint8Array =>
  new Uint8Array(cryptoSign("sha256", Buffer.from(quote), { key, dsaEncoding: "ieee-p1363" }));

// ── the daemon's side ───────────────────────────────────────────────────────
export interface BioFields {
  terminalId: string;
  nonce: string;
  subject: string;
  faceScoreBp: number;
  fpScoreBp: number;
  capturedAt?: number;
}

/** What zuup-biometricd emits: the measurement, signed over canonical bytes. */
export function signBio(key: KeyObject, fields: BioFields): { envelope: object; sig: string } {
  const envelope = { ...fields, capturedAt: fields.capturedAt ?? Date.now() };
  return {
    envelope,
    sig: toHex(new Uint8Array(cryptoSign(null, Buffer.from(utf8.encode(canonicalJson(envelope))), key))),
  };
}

export function signEnrol(
  key: KeyObject,
  fields: { terminalId: string; nonce: string; faceEmbeddingHash: string; fingerprintTemplate: string },
): { envelope: object; sig: string } {
  const envelope = { ...fields, subject: "ENROL", capturedAt: Date.now() };
  return {
    envelope,
    sig: toHex(new Uint8Array(cryptoSign(null, Buffer.from(utf8.encode(canonicalJson(envelope))), key))),
  };
}

// ── driving the HTTP flows ──────────────────────────────────────────────────
interface Injectable {
  inject(opts: { method: string; url: string; payload?: unknown; headers?: Record<string, string> }): Promise<{ statusCode: number; payload: string }>;
}

const J = (res: { payload: string }) => JSON.parse(res.payload);

/** Register a commissioned terminal exactly as the provisioning bundle would. */
export async function commissionTerminal(
  pool: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  t: { id: string; centreId: string; seatNo: string; capability: string; boundIp?: string | null; keys: StationKeys },
): Promise<void> {
  await pool.query(
    `INSERT INTO terminals (id, center_id, seat_no, capability, wg_pubkey, bound_ip, golden_pcr, ak_pubkey_pem, bio_pubkey_pem, state)
     VALUES ($1,$2,$3,$4::terminal_cap,$5,$6,$7,$8,$9,'AVAILABLE')`,
    [
      t.id, t.centreId, t.seatNo, t.capability, `wg-${t.seatNo}`, t.boundIp ?? null,
      JSON.stringify(t.keys.goldenPcr), t.keys.akPubkeyPem, t.keys.bioPubkeyPem,
    ],
  );
}

/** Boot-time attestation: challenge → quote → verdict. Returns the Edge's answer. */
export async function attestTerminal(
  app: Injectable,
  terminalId: string,
  keys: StationKeys,
  opts: { pcrs?: Record<string, string> } = {},
): Promise<{ statusCode: number; body: { ok?: boolean; failures?: string[] } }> {
  const challenge = J(
    await app.inject({ method: "POST", url: "/api/terminal/attest/challenge", payload: { terminalId } }),
  );
  const pcrs = opts.pcrs ?? keys.goldenPcr;
  const quote = buildQuote({ nonce: fromHex(challenge.nonce), pcrs });
  const res = await app.inject({
    method: "POST",
    url: "/api/terminal/attest",
    payload: {
      terminalId,
      nonce: challenge.nonce,
      quote: toHex(quote),
      signature: toHex(signQuote(quote, keys.akPrivate)),
      pcrs,
    },
  });
  return { statusCode: res.statusCode, body: J(res) };
}

/**
 * A privileged login the way a station performs one: take a nonce, capture,
 * sign, post. `scores` lets a test drive the deny path with a real signature
 * over a genuinely low score — which is the only way a real reader denies.
 */
export async function stationLogin(
  app: Injectable,
  path: string,
  terminalId: string,
  keys: StationKeys,
  scores: { faceScoreBp: number; fpScoreBp: number } = { faceScoreBp: 9500, fpScoreBp: 9000 },
): Promise<{ statusCode: number; body: { ok?: boolean; token?: string; failures?: string[] } }> {
  const challenge = J(
    await app.inject({ method: "POST", url: "/api/login/challenge", payload: { terminalId } }),
  );
  const bio = signBio(keys.bioPrivate, {
    terminalId, nonce: challenge.nonce, subject: "LOGIN", ...scores,
  });
  const res = await app.inject({
    method: "POST", url: `/api${path}`,
    payload: { terminalId, challengeNonce: challenge.nonce, bio },
  });
  return { statusCode: res.statusCode, body: J(res) };
}

/** Capture for a candidate check-in, bound to their roll (§9.5). */
export async function captureCheckin(
  app: Injectable,
  stationId: string,
  keys: StationKeys,
  roll: string,
  scores: { faceScoreBp: number; fpScoreBp: number } = { faceScoreBp: 9000, fpScoreBp: 8500 },
): Promise<{ challengeNonce: string; bio: { envelope: object; sig: string } }> {
  const challenge = J(
    await app.inject({ method: "POST", url: "/api/login/challenge", payload: { terminalId: stationId } }),
  );
  return {
    challengeNonce: challenge.nonce,
    bio: signBio(keys.bioPrivate, {
      terminalId: stationId, nonce: challenge.nonce, subject: `checkin:${roll}`, ...scores,
    }),
  };
}
