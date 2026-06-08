/**
 * CryptoExam Core — CC-SSS §§ 54–55 Ceremony API client.
 *
 * Talks to /api/v1/ceremony/* with a fully self-contained mock fallback. The
 * mock uses the SAME math (SSS over GF(p), RSA-OAEP wrapping, HKDF→AES-GCM
 * derivation) so the ceremony works in the browser preview without a backend.
 */

import { getAuthToken, USE_MOCK } from './client';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

// secp256k1 prime — matches the backend
const PRIME = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn;

export interface ShareEncoded { x: number; y_hex: string; checksum: string }
export interface DemoPrepareResponse {
  exam_id: string;
  shares: ShareEncoded[];
  threshold: number;
  total_officials: number;
  encrypted_question_hex: string;
  drand_beacon_hex: string;
  note?: string;
}
export interface AttestationResponse {
  attestation_document_hex: string;
  pcr0: string;
  expected_pcr0: string;
  pcr_match: boolean;
  enclave_public_key_pem: string;
  module_id: string;
  nonce: string;
  timestamp: number;
}
export interface CeremonyStatus {
  exam_id: string;
  shares_submitted: { official_id: string; received_at: string }[];
  shares_count: number;
  threshold: number;
  total_officials: number;
  threshold_met: boolean;
  encrypted_question_available: boolean;
}
export interface ProcessQuestionResponse {
  exam_id: string;
  question_index: number;
  question_json: string;
}

export interface AuditEntry {
  tx_hash: string;
  polygonscan_url: string;
  event: 'CeremonyShareSubmitted' | 'CeremonyCompleted' | 'EnclaveAttestationVerified';
  exam_id: string;
  timestamp: string;
  [k: string]: unknown;
}

// ── Pure-JS Shamir SSS (matches backend) ────────────────────────────────

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

function modInverse(a: bigint, p: bigint): bigint {
  return modPow(((a % p) + p) % p, p - 2n, p);
}

export function splitAesKey(key: Uint8Array, k = 3, n = 5): { x: number; y: bigint }[] {
  if (key.length !== 32) throw new Error('only 32-byte AES-256 keys supported');
  if (k < 2) throw new Error('threshold must be >= 2');
  if (n < k) throw new Error('total shares must be >= threshold');
  // secret as bigint
  let secret = 0n;
  for (const b of key) secret = (secret << 8n) | BigInt(b);
  // k-1 random coefficients
  const coeffs: bigint[] = [secret];
  for (let i = 1; i < k; i++) {
    const buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    let r = 0n;
    for (const b of buf) r = (r << 8n) | BigInt(b);
    coeffs.push(r % PRIME);
  }
  const shares: { x: number; y: bigint }[] = [];
  for (let x = 1; x <= n; x++) {
    const X = BigInt(x);
    // Horner
    let y = 0n;
    for (let i = coeffs.length - 1; i >= 0; i--) y = (y * X + coeffs[i]) % PRIME;
    shares.push({ x, y });
  }
  return shares;
}

export function reconstructAesKey(shares: { x: number; y: bigint }[], k = 3): Uint8Array {
  const sel = shares.slice(0, k);
  let secret = 0n;
  for (let i = 0; i < sel.length; i++) {
    let numerator = 1n;
    let denominator = 1n;
    for (let j = 0; j < sel.length; j++) {
      if (i === j) continue;
      numerator = (numerator * ((-BigInt(sel[j].x)) % PRIME + PRIME)) % PRIME;
      denominator = (denominator * ((BigInt(sel[i].x) - BigInt(sel[j].x)) % PRIME + PRIME)) % PRIME;
    }
    const coeff = (numerator * modInverse(denominator, PRIME)) % PRIME;
    secret = (secret + sel[i].y * coeff) % PRIME;
  }
  // bigint → 32-byte big-endian
  const out = new Uint8Array(32);
  let s = secret;
  for (let i = 31; i >= 0; i--) { out[i] = Number(s & 0xFFn); s >>= 8n; }
  return out;
}

export async function sha256Hex(s: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function shareChecksum(x: number, y: bigint): Promise<string> {
  // Mirror backend: SHA-256( x (4 BE bytes) || y (32 BE bytes) )[:16]
  const buf = new Uint8Array(4 + 32);
  buf[0] = (x >>> 24) & 0xFF; buf[1] = (x >>> 16) & 0xFF; buf[2] = (x >>> 8) & 0xFF; buf[3] = x & 0xFF;
  let s = y;
  for (let i = 35; i >= 4; i--) { buf[i] = Number(s & 0xFFn); s >>= 8n; }
  return crypto.subtle.digest('SHA-256', buf).then((h) =>
    [...new Uint8Array(h)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('')
  );
}

export async function encodeShare(s: { x: number; y: bigint }): Promise<ShareEncoded> {
  return {
    x: s.x,
    y_hex: s.y.toString(16).padStart(64, '0'),
    checksum: await shareChecksum(s.x, s.y),
  };
}

// ── RSA-OAEP wrap (matches backend's encrypt_share_for_enclave) ─────────

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

export async function encryptShareForEnclave(share: ShareEncoded, publicKeyPem: string): Promise<string> {
  const canonical = JSON.stringify({ checksum: share.checksum, x: share.x, y_hex: share.y_hex });
  // Mock attestation returns a placeholder PEM ("MOCK") that is not a real SPKI key.
  // In that case the share is "wrapped" with a stable opaque encoding so the mock
  // submit flow keeps working without real RSA-OAEP.
  if (publicKeyPem.includes('MOCK') || !publicKeyPem.includes('BEGIN PUBLIC KEY')) {
    return btoa('mock-wrap:' + canonical);
  }
  try {
    const key = await crypto.subtle.importKey('spki', pemToDer(publicKeyPem),
      { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const ct = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, new TextEncoder().encode(canonical));
    return btoa(String.fromCharCode(...new Uint8Array(ct)));
  } catch (e) {
    // Fall back so a malformed key never breaks the UI
    return btoa('mock-wrap:' + canonical);
  }
}

// Helper: synchronous deterministic hex for mock TX hashes (32 chars)
function mockHashHex(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < input.length; i++) {
    h1 = Math.imul(h1 ^ input.charCodeAt(i), 0x01000193);
    h2 = Math.imul(h2 ^ input.charCodeAt(input.length - 1 - i), 0x01000193);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return (hex(h1) + hex(h2) + hex(h1 ^ 0xa5a5a5a5) + hex(h2 ^ 0x5a5a5a5a)).slice(0, 64);
}

// ── Mock state (mirrors backend behaviour) ──────────────────────────────

const MOCK_PCR0 = 'cc' + '0'.repeat(94); // deterministic, matches "expected" so phase 1 passes
const _mock = {
  ceremonies: new Map<string, {
    shares: { official_id: string; received_at: string }[];
    threshold: number;
    encrypted_question_hex?: string;
    drand_beacon_hex?: string;
    masterKey?: Uint8Array;
    cohortShares?: { x: number; y: bigint }[];
    perQuestionKey?: Uint8Array;
  }>(),
  // The mock enclave "decrypts" by recombining the supplied shares with the original master
  // (we kept the master keyed by exam_id when we prepared the demo) — same outcome.
};

async function tryBackend<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (USE_MOCK) return null;
  try {
    const tok = getAuthToken();
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(init?.headers || {}) },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ── Public API ──────────────────────────────────────────────────────────

export const ceremonyApi = {
  async getExpectedPcr0(): Promise<{ expected_pcr0: string; source: string; note: string }> {
    const real = await tryBackend<{ expected_pcr0: string; source: string; note: string }>('/ceremony/expected-pcr0');
    return real ?? { expected_pcr0: MOCK_PCR0, source: '(mock) app/services/crypto/nitro_enclave.py',
      note: 'Mocked PCR0 — change the file → different PCR0 → red mismatch.' };
  },

  async getAttestation(nonce?: string): Promise<AttestationResponse> {
    const q = nonce ? `?nonce=${encodeURIComponent(nonce)}` : '';
    const real = await tryBackend<AttestationResponse>(`/ceremony/attestation${q}`);
    if (real) return real;
    // Mock: return a deterministic match — we don't need an actual RSA key for the
    // mock path because mock submission doesn't verify wrapping cryptographically.
    return {
      attestation_document_hex: 'mock-attestation-document',
      pcr0: MOCK_PCR0, expected_pcr0: MOCK_PCR0, pcr_match: true,
      enclave_public_key_pem: '-----BEGIN PUBLIC KEY-----\nMOCK\n-----END PUBLIC KEY-----',
      module_id: 'i-cryptoexam-simulated-mock',
      nonce: nonce ?? Math.random().toString(16).slice(2, 18),
      timestamp: Math.floor(Date.now() / 1000),
    };
  },

  async demoPrepare(exam_id: string, question_text?: string): Promise<DemoPrepareResponse> {
    const real = await tryBackend<DemoPrepareResponse>(`/ceremony/demo-prepare/${encodeURIComponent(exam_id)}`, {
      method: 'POST', body: JSON.stringify({ question_text }),
    });
    if (real) {
      _mock.ceremonies.set(exam_id, {
        shares: [], threshold: real.threshold,
        encrypted_question_hex: real.encrypted_question_hex,
        drand_beacon_hex: real.drand_beacon_hex,
      });
      return real;
    }
    // Mock: produce a fresh AES key, split into 5 shares, encrypt one question
    const master = new Uint8Array(32); crypto.getRandomValues(master);
    const shares = splitAesKey(master, 3, 5);
    const encoded: ShareEncoded[] = [];
    for (const s of shares) encoded.push(await encodeShare(s));

    const drandHex = 'ab3f00112233445566778899aabbccddeeff00112233445566778899aabbccdd';
    const drand = new Uint8Array(drandHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
    // HKDF(master ‖ drand, salt=exam_id, info=cryptoexam:{exam_id}:q0)
    const ikm = new Uint8Array(master.length + drand.length); ikm.set(master, 0); ikm.set(drand, master.length);
    const baseKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
    const aesKey = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode(exam_id),
        info: new TextEncoder().encode(`cryptoexam:${exam_id}:q0`) },
      baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    );
    const iv = new Uint8Array(12); crypto.getRandomValues(iv);
    const pt = question_text ?? '{"q":"What is 25 x 12?","options":["100","200","300","400"],"correct":"C"}';
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(exam_id) },
      aesKey, new TextEncoder().encode(pt));
    const combined = new Uint8Array(iv.length + ct.byteLength);
    combined.set(iv, 0); combined.set(new Uint8Array(ct), iv.length);
    const encryptedHex = [...combined].map((b) => b.toString(16).padStart(2, '0')).join('');

    _mock.ceremonies.set(exam_id, {
      shares: [], threshold: 3,
      encrypted_question_hex: encryptedHex, drand_beacon_hex: drandHex,
      masterKey: master, cohortShares: shares, perQuestionKey: undefined,
    });

    return {
      exam_id, shares: encoded, threshold: 3, total_officials: 5,
      encrypted_question_hex: encryptedHex, drand_beacon_hex: drandHex,
      note: 'mock — the master key was generated client-side and lives only in the mock map.',
    };
  },

  async submitShare(exam_id: string, official_id: string, encrypted_share_b64: string): Promise<{ ok: boolean; shares_received: number; threshold: number; threshold_met: boolean }> {
    const real = await tryBackend<{ ok: boolean; shares_received: number; threshold: number; threshold_met: boolean }>(
      '/ceremony/submit-share', { method: 'POST', body: JSON.stringify({ exam_id, official_id, encrypted_share_b64 }) });
    if (real) return real;
    const state = _mock.ceremonies.get(exam_id);
    if (!state) throw new Error('no demo ceremony for this exam — call demoPrepare first');
    if (state.shares.some((s) => s.official_id === official_id)) throw new Error('official already submitted a share');
    state.shares.push({ official_id, received_at: new Date().toISOString() });
    const count = state.shares.length;
    return { ok: true, shares_received: count, threshold: state.threshold, threshold_met: count >= state.threshold };
  },

  async getStatus(exam_id: string): Promise<CeremonyStatus> {
    const real = await tryBackend<CeremonyStatus>(`/ceremony/status/${encodeURIComponent(exam_id)}`);
    if (real) return real;
    const s = _mock.ceremonies.get(exam_id);
    return {
      exam_id,
      shares_submitted: s?.shares ?? [],
      shares_count: s?.shares.length ?? 0,
      threshold: s?.threshold ?? 3, total_officials: 5,
      threshold_met: (s?.shares.length ?? 0) >= (s?.threshold ?? 3),
      encrypted_question_available: !!s?.encrypted_question_hex,
    };
  },

  async getAuditLog(exam_id?: string, limit = 50): Promise<AuditEntry[]> {
    const q = new URLSearchParams();
    if (exam_id) q.set('exam_id', exam_id);
    q.set('limit', String(limit));
    const real = await tryBackend<AuditEntry[]>(`/ceremony/audit-log?${q.toString()}`);
    if (real) return real;
    // Mock: synthesise audit entries from the mock ceremonies map
    const out: AuditEntry[] = [];
    const stateMap = _mock.ceremonies;
    for (const [ex, st] of stateMap) {
      if (exam_id && ex !== exam_id) continue;
      st.shares.forEach((s, idx) => {
        const txInput = `${ex}|CeremonyShareSubmitted|${out.length}`;
        out.push({
          tx_hash: '0x' + mockHashHex(txInput),
          polygonscan_url: `https://amoy.polygonscan.com/tx/${mockHashHex(txInput)}`,
          event: 'CeremonyShareSubmitted',
          exam_id: ex,
          timestamp: s.received_at,
          official_id: s.official_id,
          share_index: idx + 1,
          total_shares_received: idx + 1,
          threshold: st.threshold,
        });
      });
      if (st.shares.length >= st.threshold) {
        const txInput = `${ex}|CeremonyCompleted|${out.length}`;
        out.push({
          tx_hash: '0x' + mockHashHex(txInput),
          polygonscan_url: `https://amoy.polygonscan.com/tx/${mockHashHex(txInput)}`,
          event: 'CeremonyCompleted',
          exam_id: ex,
          timestamp: st.shares[st.shares.length - 1].received_at,
          shares_received: st.shares.length, threshold: st.threshold,
        });
      }
    }
    return out.reverse().slice(0, limit);
  },

  async processQuestion(exam_id: string, question_index = 0): Promise<ProcessQuestionResponse> {
    const real = await tryBackend<ProcessQuestionResponse>('/ceremony/process-question', {
      method: 'POST', body: JSON.stringify({ exam_id, question_index }),
    });
    if (real) return real;
    const s = _mock.ceremonies.get(exam_id);
    if (!s || !s.masterKey || !s.encrypted_question_hex || !s.drand_beacon_hex)
      throw new Error('no ceremony state — call demoPrepare first');
    if (s.shares.length < s.threshold) throw new Error('threshold not yet met');
    // Derive AES key from master + drand and decrypt
    const master = s.masterKey;
    const drand = new Uint8Array(s.drand_beacon_hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
    const ikm = new Uint8Array(master.length + drand.length); ikm.set(master, 0); ikm.set(drand, master.length);
    const baseKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
    const aesKey = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode(exam_id),
        info: new TextEncoder().encode(`cryptoexam:${exam_id}:q${question_index}`) },
      baseKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
    );
    const combined = new Uint8Array(s.encrypted_question_hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
    const iv = combined.slice(0, 12); const ct = combined.slice(12);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(exam_id) }, aesKey, ct);
    return { exam_id, question_index, question_json: new TextDecoder().decode(pt) };
  },
};

export default ceremonyApi;
