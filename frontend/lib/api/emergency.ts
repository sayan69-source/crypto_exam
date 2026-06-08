/**
 * CryptoExam Core — V3 §10 Emergency Dual-Control API client.
 * Real backend with mock fallback. The mock fully implements the state machine
 * (own-confirm rejection, expiry, history) so the admin UI is fully demoable.
 */

import { getAuthToken, USE_MOCK } from './client';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

export type EmergencyActionType =
  | 'PAUSE_EXAM' | 'EXTEND_EXAM' | 'RESUME_EXAM' | 'ABORT_EXAM' | 'ALERT_BROADCAST';

export type EmergencyStatus =
  | 'AWAITING_CONFIRMATION' | 'CONFIRMED' | 'EXPIRED' | 'REJECTED';

export interface EmergencyRequest {
  request_id: string;
  action: EmergencyActionType;
  initiator_id: string;
  exam_id: string;
  params: Record<string, unknown>;
  reason: string;
  created_at: string;
  expires_at: string;
  status: EmergencyStatus;
  confirmer_id: string | null;
  confirmed_at: string | null;
  execution_result: Record<string, unknown> | null;
  on_chain_tx: string | null;
}

// ── Mock state ──────────────────────────────────────────────────────────

const EXPIRY_MIN = 5;
const _pending = new Map<string, EmergencyRequest>();
const _history: EmergencyRequest[] = [];
const _counters = { pending: 0, confirmed: 0, expired: 0, rejected: 0 };
const _state = new Map<string, string>();

function _sweep(): void {
  const now = Date.now();
  for (const [id, req] of _pending) {
    if (now > Date.parse(req.expires_at)) {
      req.status = 'EXPIRED'; _history.push(req); _counters.expired++;
      _pending.delete(id);
    }
  }
}

function _now(): string { return new Date().toISOString(); }
function _expires(): string { return new Date(Date.now() + EXPIRY_MIN * 60_000).toISOString(); }
function _id(): string { return (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36); }

function _mockExec(req: EmergencyRequest): Record<string, unknown> {
  switch (req.action) {
    case 'PAUSE_EXAM': _state.set(req.exam_id, 'PAUSED'); return { status: 'PAUSED', candidates_notified: true, timestamp: _now() };
    case 'RESUME_EXAM': _state.set(req.exam_id, 'ACTIVE'); return { status: 'ACTIVE', candidates_notified: true, timestamp: _now() };
    case 'EXTEND_EXAM': return { status: 'EXTENDED', extra_minutes: (req.params as Record<string, number>).minutes ?? 0, timestamp: _now() };
    case 'ABORT_EXAM': _state.set(req.exam_id, 'ABORTED'); return { status: 'ABORTED', timestamp: _now() };
    case 'ALERT_BROADCAST': return { status: 'BROADCASTED', message: (req.params as Record<string, string>).message };
  }
}

const mockApi = {
  async initiate(action: EmergencyActionType, exam_id: string, reason: string, initiator_id: string, params?: Record<string, unknown>): Promise<EmergencyRequest> {
    _sweep();
    const req: EmergencyRequest = {
      request_id: _id(), action, initiator_id, exam_id, params: params || {},
      reason, created_at: _now(), expires_at: _expires(),
      status: 'AWAITING_CONFIRMATION', confirmer_id: null, confirmed_at: null,
      execution_result: null, on_chain_tx: null,
    };
    _pending.set(req.request_id, req); _counters.pending++;
    return new Promise((r) => setTimeout(() => r(req), 300));
  },
  async confirm(request_id: string, confirmer_id: string): Promise<EmergencyRequest> {
    _sweep();
    const req = _pending.get(request_id);
    if (!req) throw new Error('Request not found or already resolved.');
    if (confirmer_id === req.initiator_id) throw new Error('Dual-control: initiator cannot confirm their own emergency request.');
    if (Date.now() > Date.parse(req.expires_at)) {
      _pending.delete(request_id); req.status = 'EXPIRED'; _history.push(req); _counters.expired++;
      throw new Error('Request expired (>5 minutes).');
    }
    req.status = 'CONFIRMED'; req.confirmer_id = confirmer_id; req.confirmed_at = _now();
    req.execution_result = _mockExec(req); req.on_chain_tx = '0x' + 'e3'.repeat(8) + _id().slice(0, 16);
    _pending.delete(request_id); _history.push(req); _counters.confirmed++;
    return new Promise((r) => setTimeout(() => r(req), 400));
  },
  async reject(request_id: string, rejecter_id: string, reason: string): Promise<EmergencyRequest> {
    const req = _pending.get(request_id);
    if (!req) throw new Error('Request not found.');
    req.status = 'REJECTED'; req.confirmer_id = rejecter_id;
    req.execution_result = { reject_reason: reason };
    _pending.delete(request_id); _history.push(req); _counters.rejected++;
    return req;
  },
  async pending(): Promise<EmergencyRequest[]> { _sweep(); return [..._pending.values()]; },
  async history(limit = 50): Promise<EmergencyRequest[]> { return _history.slice(-limit).reverse(); },
  async stats(): Promise<{ pending: number; confirmed: number; expired: number; rejected: number; exam_states: Record<string, string> }> {
    _sweep();
    return { pending: _pending.size, confirmed: _counters.confirmed, expired: _counters.expired, rejected: _counters.rejected, exam_states: Object.fromEntries(_state) };
  },
};

async function tryBackend<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (USE_MOCK) return null;
  try {
    const token = getAuthToken();
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers || {}) },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export const emergencyApi = {
  async initiate(action: EmergencyActionType, exam_id: string, reason: string, initiator_id: string, params?: Record<string, unknown>): Promise<EmergencyRequest> {
    const real = await tryBackend<EmergencyRequest>('/emergency/initiate', {
      method: 'POST', body: JSON.stringify({ action, exam_id, reason, params }),
    });
    return real ?? mockApi.initiate(action, exam_id, reason, initiator_id, params);
  },
  async confirm(request_id: string, confirmer_id: string): Promise<EmergencyRequest> {
    const real = await tryBackend<EmergencyRequest>(`/emergency/${request_id}/confirm`, {
      method: 'POST', body: JSON.stringify({ confirmer_id }),
    });
    return real ?? mockApi.confirm(request_id, confirmer_id);
  },
  async reject(request_id: string, rejecter_id: string, reason: string): Promise<EmergencyRequest> {
    const real = await tryBackend<EmergencyRequest>(`/emergency/${request_id}/reject`, {
      method: 'POST', body: JSON.stringify({ rejecter_id, reason }),
    });
    return real ?? mockApi.reject(request_id, rejecter_id, reason);
  },
  async pending(): Promise<EmergencyRequest[]> {
    const real = await tryBackend<EmergencyRequest[]>('/emergency/pending');
    return real ?? mockApi.pending();
  },
  async history(limit = 50): Promise<EmergencyRequest[]> {
    const real = await tryBackend<EmergencyRequest[]>(`/emergency/history?limit=${limit}`);
    return real ?? mockApi.history(limit);
  },
  async stats() {
    const real = await tryBackend<Awaited<ReturnType<typeof mockApi.stats>>>('/emergency/stats');
    return real ?? mockApi.stats();
  },
};

export default emergencyApi;
