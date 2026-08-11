/**
 * Tier-0 Answer Vault — verify, decrypt and anchor a centre's sync bundle.
 *
 * These are the operations that make tier-0 tier-0. The server enforces
 * SYSTEM_ADMIN on all three; a tier-1 administrator gets 403, which is the
 * whole reason the tiers are separate.
 */
import { getAuthToken } from './client';
import { describeApiError } from './errors';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

async function post<T>(path: string, body: unknown): Promise<T> {
  const token = getAuthToken();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/sys${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(`Cannot reach the API at ${API_BASE}. Is the backend running?`);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(describeApiError(json, res.status));
  return json as T;
}

export interface IngestResult {
  ok?: boolean;
  records?: number;
  count?: number;
  centreIdHash?: string;
}

export interface DecryptResult {
  decrypted?: number;
  quarantined?: { examId: string; seatNo: string | null; leafIndex: number; reason: string }[];
}

export const sysLedgerApi = {
  /** Verify only — signature + hash chain. Never decrypts. */
  ingest: (bundle: unknown) => post<IngestResult>('/ledger/ingest', bundle),
  /** Verify, then HSM-unwrap. The only place a plaintext answer exists. */
  decrypt: (bundle: unknown) => post<DecryptResult>('/ledger/decrypt', bundle),
  /** Publish the answer root on-chain — roots and counts only, never PII. */
  anchor: (payload: unknown) => post<{ ok: boolean; txHash?: string }>('/ledger/anchor', payload),
};
