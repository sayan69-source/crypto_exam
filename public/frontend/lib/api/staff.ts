/**
 * Public centre-staff registration API — talks to the real FastAPI backend
 * (/api/v1/staff). No auth (capture happens before any identity exists).
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

export interface Centre { centerId: string; name: string; state: string | null }

export interface RegisterResult {
  ok: boolean;
  requestId: string;
  status: string;
  approver: string;
}

export const staffApi = {
  async centres(): Promise<Centre[]> {
    const res = await fetch(`${API_BASE}/staff/centres`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`centres ${res.status}`);
    const json = await res.json();
    return json.centres ?? [];
  },

  async register(body: { role: string; centerId: string; fullName: string; faceEmbeddingHash: string }): Promise<RegisterResult> {
    const res = await fetch(`${API_BASE}/staff/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.detail || `register ${res.status}`);
    return json;
  },
};
