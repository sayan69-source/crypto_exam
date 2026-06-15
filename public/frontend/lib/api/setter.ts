/**
 * Setter API — typed fetchers for the Question-Setter console, hitting the real
 * FastAPI backend (/exams, /generation, /lifecycle, /question-modes). Like the
 * admin client, these do NOT fall back to mock data: the console shows live
 * backend state (the setter's own exams, scoped server-side by setter_id) or an
 * honest error.
 */
import { getAuthToken } from './client';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.detail || b.message || `Request failed (${res.status})`);
  }
  return res.json();
}

// ── Shapes (mirror the backend ExamResponse) ──

/** The 8-stage paper lifecycle the dashboard pipeline visualises. */
export const EXAM_PIPELINE = [
  'DRAFT', 'GENERATING', 'PROOF_PENDING', 'LOCKED', 'DISTRIBUTED', 'LIVE', 'COMPLETED', 'AUDITED',
] as const;

export interface SetterExam {
  id: string;
  name: string;
  name_hi: string | null;
  exam_body: string | null;
  exam_type: string | null;
  duration_minutes: number | null;
  scheduled_at: string | null;
  status: string;
  setter_id: string | null;
  sets_count: number | null;
  negative_marking: number | null;
  question_hash: string | null;
  zk_proof_hash: string | null;
  polygon_exam_tx: string | null;
  polygon_zkproof_tx: string | null;
  answer_merkle_root: string | null;
  polygon_answer_tx: string | null;
  created_at: string | null;
}

export interface ExamListResponse {
  items: SetterExam[];
  total: number;
  page: number;
  per_page: number;
}

export const setterApi = {
  /** The signed-in setter's own exams (backend filters by setter_id). */
  exams: () => req<ExamListResponse>('GET', '/exams?per_page=100'),
  exam: (id: string) => req<SetterExam>('GET', `/exams/${id}`),
  createExam: (body: Record<string, unknown>) => req<SetterExam>('POST', '/exams', body),
  /** Public, on-chain verification data for an exam (no auth needed). */
  verify: (id: string) =>
    req<Record<string, unknown>>('GET', `/exams/${encodeURIComponent(id)}/verify`),
};
