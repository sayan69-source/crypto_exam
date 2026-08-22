/**
 * Tier-0 view of the centre uplinks (ZUUP-OS §12 / §13.4).
 *
 * The Admin Station in each hall talks to `/api/v1/centre-sync/*` with a
 * per-centre credential and no human logged in. These are the two things a
 * tier-0 operator needs on this side of that link: mint or rotate a centre's
 * credential, and see whether that centre's sealed papers have actually
 * arrived.
 *
 * Everything here is SYSTEM_ADMIN-gated server-side except `hqPubkey`, which is
 * a public key by definition — the offline provisioning host has no credential
 * and still has to pin it.
 */
import { getAuthToken } from './client';
import { describeApiError } from './errors';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

async function call<T>(method: string, path: string): Promise<T> {
  const token = getAuthToken();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/centre-sync${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    throw new Error(`Cannot reach the API at ${API_BASE}. Is the backend running?`);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(describeApiError(json, res.status));
  return json as T;
}

export interface CentreUplink {
  id: string;
  name: string;
  /** A credential has been minted for this centre (only its hash is stored). */
  provisioned: boolean;
  issuedAt: string | null;
  lastSyncAt: string | null;
}

export interface UplinkList {
  ok: boolean;
  /** HQ's provisioning signing key, or null if this deployment signs nothing. */
  hqSigningKey: string | null;
  centres: CentreUplink[];
}

export interface ReceivedGroup {
  centreIdHash: string;
  examId: string;
  count: number;
  decrypted: number;
  firstReceivedAt: string | null;
  lastReceivedAt: string | null;
}

export const centreSyncApi = {
  list: () => call<UplinkList>('GET', '/centres'),
  received: () => call<{ ok: boolean; total: number; groups: ReceivedGroup[] }>('GET', '/received'),
  /** Shown once. HQ keeps only the hash and cannot show it again. */
  mintKey: (centreId: string) =>
    call<{ ok: boolean; rotated: boolean; syncKey: string; centre: { id: string; name: string } }>(
      'POST', `/centres/${centreId}/key`),
  /** Unauthenticated by design — it is a public key. */
  hqPubkey: () =>
    call<{ ok: boolean; signed: boolean; hqPublicKey: string | null; algorithm: string }>(
      'GET', '/hq-pubkey'),
};
