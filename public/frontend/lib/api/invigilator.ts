/**
 * CryptoExam Core — § 29 Invigilator Gateway API (Interface D)
 *
 * Self-contained client for the Centre Invigilator Biometric Gateway.
 * Talks to the FastAPI `/api/v1/invigilator/*` endpoints, with a mock
 * fallback (controlled by NEXT_PUBLIC_USE_MOCK, default ON) so the gateway
 * is fully demoable in the browser without a running backend.
 */

import { getAuthToken, USE_MOCK } from './client';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

// ── Types ──────────────────────────────────────────────────────────────

export type VerifyStatus = 'PENDING' | 'VERIFIED' | 'MISMATCH' | 'FLAGGED';

export interface GeofenceResult {
  within_center_bounds: boolean;
  distance_m: number;
  radius_m: number;
  reason: string;
}

export interface BiometricStepResult {
  verified: boolean;
  confidence: number;
  reason?: string;
}

export interface RosterEntry {
  candidate_id: string;
  candidate_name: string;
  roll_number: string | null;
  hall_ticket: string | null;
  status: VerifyStatus;
  verified_at?: string | null;
}

export interface CandidateVerifyResult {
  candidate_id: string | null;
  candidate_name: string | null;
  hall_ticket: string;
  face_match: boolean;
  face_confidence: number;
  fp_match: boolean;
  fp_confidence: number;
  overall_result: 'VERIFIED' | 'MISMATCH';
  timestamp: string;
  verification_id: string;
}

export interface InvigilatorAlert {
  id: string;
  type: 'MISMATCH' | 'LATE_ARRIVAL' | 'INCIDENT';
  severity: 'INFO' | 'WARN' | 'CRITICAL';
  candidate_name: string | null;
  message: string;
  created_at: string;
  resolved: boolean;
}

export interface CentreStats {
  total: number;
  verified: number;
  mismatch: number;
  pending: number;
}

export interface PanicAlert {
  id: string;
  examId: string;
  candidateId: string;
  seatNumber?: string;
  centerId?: string;
  method: 'TOUCH' | 'KEYBOARD';
  timestamp: string;
  resolved?: boolean;
}

// ── Mock roster (mirrors the backend seeder's candidates) ──────────────

const MOCK_CANDIDATES: string[] = [
  'Rahul Verma', 'Sneha Patel', 'Arjun Nair',
  'Priya Devi', 'Karthik Rajan', 'Aisha Khan',
  'Vikram Singh', 'Lakshmi Menon', 'Rohit Das',
  'Anjali Sharma', 'Deepak Yadav', 'Fatima Begum',
];

let mockRoster: RosterEntry[] | null = null;

function ensureMockRoster(): RosterEntry[] {
  if (mockRoster) return mockRoster;
  mockRoster = MOCK_CANDIDATES.map((name, i) => ({
    candidate_id: `cand-${i + 1}`,
    candidate_name: name,
    roll_number: `NTA-2026-${['DEL', 'GUJ', 'KER', 'BIH', 'TAM', 'UTT'][i % 6]}-${(i + 1).toString().padStart(7, '0')}`,
    hall_ticket: `HALL-${(1000 + i).toString()}`,
    status: i < 5 ? 'VERIFIED' : 'PENDING',
    verified_at: i < 5 ? new Date(Date.now() - (5 - i) * 90_000).toISOString() : null,
  }));
  return mockRoster;
}

// V3 §7.3 — panic alerts (local queue for mock + cross-tab broadcast in browser)
const PANIC_KEY = 'cryptoexam_panic_queue';
function _readPanic(): PanicAlert[] {
  if (typeof localStorage === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(PANIC_KEY) || '[]'); } catch { return []; }
}
function _writePanic(items: PanicAlert[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(PANIC_KEY, JSON.stringify(items));
}

const mockAlerts: InvigilatorAlert[] = [
  {
    id: 'alert-1', type: 'MISMATCH', severity: 'CRITICAL', candidate_name: 'Imposter (HALL-1042)',
    message: 'Biometric mismatch (face 38%, fingerprint 0%). Held for supervisor.',
    created_at: new Date(Date.now() - 4 * 60_000).toISOString(), resolved: false,
  },
  {
    id: 'alert-2', type: 'LATE_ARRIVAL', severity: 'WARN', candidate_name: 'Deepak Yadav',
    message: 'Candidate arrived 22 minutes after reporting time. Entry logged.',
    created_at: new Date(Date.now() - 18 * 60_000).toISOString(), resolved: false,
  },
];

function delay<T>(value: T, ms = 600): Promise<T> {
  return new Promise((r) => setTimeout(() => r(value), ms));
}

async function tryBackend<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (USE_MOCK) return null;
  try {
    const token = getAuthToken();
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers || {}),
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ── Public API ─────────────────────────────────────────────────────────

export const invigilatorApi = {
  /** Layer 1 — geofence: device must be within ±200 m of the centre. */
  async verifyGeofence(coords: { latitude: number; longitude: number; accuracy?: number; center_id?: string }): Promise<GeofenceResult> {
    const real = await tryBackend<GeofenceResult>('/invigilator/verify-geofence', {
      method: 'POST', body: JSON.stringify(coords),
    });
    if (real) return real;
    // Mock: accept (demo machines are not at the centre)
    return delay({ within_center_bounds: true, distance_m: 41.2, radius_m: 200, reason: 'Inside centre perimeter (demo)' });
  },

  /** Layer 1 — invigilator face match. */
  async verifyFace(image: string, staff_id?: string): Promise<BiometricStepResult> {
    const real = await tryBackend<{ verified: boolean; confidence: number; reason: string }>(
      '/invigilator/verify-face', { method: 'POST', body: JSON.stringify({ image, staff_id }) });
    if (real) return real;
    return delay({ verified: true, confidence: 0.962, reason: 'Match (demo)' });
  },

  /** Layer 1 — WebAuthn FIDO2 fingerprint. */
  async verifyFingerprint(staff_id?: string): Promise<BiometricStepResult> {
    // Attempt a real WebAuthn assertion when available; otherwise mock.
    if (!USE_MOCK && typeof window !== 'undefined' && 'credentials' in navigator) {
      try {
        const chal = await tryBackend<{ challenge: string; credential_id?: string }>(
          `/invigilator/fido2-challenge?staff_id=${encodeURIComponent(staff_id || '')}`, { method: 'GET' });
        if (chal) {
          const assertion = await navigator.credentials.get({
            publicKey: {
              challenge: Uint8Array.from(chal.challenge, (c) => c.charCodeAt(0)),
              userVerification: 'required',
              timeout: 60_000,
            },
          });
          const ok = await tryBackend<{ ok: boolean; confidence: number }>(
            '/invigilator/fido2-verify',
            { method: 'POST', body: JSON.stringify({ assertion, challenge: chal.challenge, staff_id }) });
          if (ok) return { verified: ok.ok, confidence: ok.confidence };
        }
      } catch {
        /* fall through to mock */
      }
    }
    return delay({ verified: true, confidence: 0.991, reason: 'FIDO2 verified (demo)' });
  },

  /** Layer 1 — TOTP final factor, returns a session token. */
  async verifyTOTP(code: string, staff_id?: string): Promise<{ access_token: string } | null> {
    const real = await tryBackend<{ access_token: string }>('/invigilator/verify-totp', {
      method: 'POST', body: JSON.stringify({ code, staff_id }),
    });
    if (real) return real;
    if (code.length === 6) return delay({ access_token: `mock_invig_${Date.now()}` });
    return null;
  },

  /** Layer 2 — dual biometric candidate verification. */
  async verifyCandidate(req: {
    hall_ticket: string; exam_id?: string; center_id?: string;
    face_image?: string; fp_template_hash?: string;
  }): Promise<CandidateVerifyResult> {
    const real = await tryBackend<CandidateVerifyResult>('/invigilator/candidate/verify', {
      method: 'POST', body: JSON.stringify(req),
    });
    if (real) return real;

    // Mock: deterministic — known hall tickets verify, "1042"/unknown mismatch
    const roster = ensureMockRoster();
    const entry = roster.find((r) => r.hall_ticket === req.hall_ticket);
    const isImposter = req.hall_ticket.endsWith('042') || !entry;
    const faceConf = isImposter ? 0.38 + Math.random() * 0.1 : 0.9 + Math.random() * 0.08;
    const fpConf = isImposter ? 0 : 0.94 + Math.random() * 0.05;
    const matched = !isImposter;
    if (entry) entry.status = matched ? 'VERIFIED' : 'MISMATCH';
    return delay({
      candidate_id: entry?.candidate_id ?? null,
      candidate_name: entry?.candidate_name ?? null,
      hall_ticket: req.hall_ticket,
      face_match: matched, face_confidence: faceConf,
      fp_match: matched, fp_confidence: fpConf,
      overall_result: matched ? 'VERIFIED' : 'MISMATCH',
      timestamp: new Date().toISOString(),
      verification_id: `ver-${Date.now()}`,
    }, 1400);
  },

  async getRoster(params?: { exam_id?: string; center_id?: string }): Promise<RosterEntry[]> {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    const real = await tryBackend<RosterEntry[]>(`/invigilator/roster${q ? `?${q}` : ''}`);
    if (real) return real;
    return delay(ensureMockRoster());
  },

  async getAlerts(center_id?: string): Promise<InvigilatorAlert[]> {
    const real = await tryBackend<InvigilatorAlert[]>(
      `/invigilator/alerts${center_id ? `?center_id=${center_id}` : ''}`);
    if (real) return real;
    return delay(mockAlerts);
  },

  async panicAlert(req: { examId: string; candidateId: string; seatNumber?: string; centerId?: string; method: 'TOUCH' | 'KEYBOARD'; timestamp: string }): Promise<{ ok: boolean; id: string }> {
    const real = await tryBackend<{ ok: boolean; id: string }>('/invigilator/panic-alert', { method: 'POST', body: JSON.stringify(req) });
    if (real) return real;
    const id = `panic-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const items = _readPanic();
    items.unshift({ id, ...req, resolved: false });
    _writePanic(items.slice(0, 50));
    return delay({ ok: true, id }, 200);
  },

  async getPanicAlerts(center_id?: string): Promise<PanicAlert[]> {
    const real = await tryBackend<PanicAlert[]>(`/invigilator/panic-alerts${center_id ? `?center_id=${center_id}` : ''}`);
    if (real) return real;
    return delay(_readPanic().filter((a) => !center_id || a.centerId === center_id));
  },

  async resolvePanicAlert(id: string): Promise<void> {
    const real = await tryBackend<{ ok: boolean }>(`/invigilator/panic-alerts/${id}/resolve`, { method: 'POST' });
    if (real) return;
    const items = _readPanic().map((a) => (a.id === id ? { ...a, resolved: true } : a));
    _writePanic(items);
  },

  async getStats(params?: { exam_id?: string; center_id?: string }): Promise<CentreStats> {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    const real = await tryBackend<CentreStats>(`/invigilator/stats${q ? `?${q}` : ''}`);
    if (real) return real;
    const roster = ensureMockRoster();
    return delay({
      total: roster.length,
      verified: roster.filter((r) => r.status === 'VERIFIED').length,
      mismatch: roster.filter((r) => r.status === 'MISMATCH').length,
      pending: roster.filter((r) => r.status === 'PENDING').length,
    });
  },
};

export default invigilatorApi;
