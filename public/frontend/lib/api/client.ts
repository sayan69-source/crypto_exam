/**
 * CryptoExam Core — API Client
 * Centralized HTTP client with JWT auth, mock data fallback
 */

import type { ApiResponse, AuthResponse, OtpChallengeResponse, PaginatedResponse } from './types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== 'false'; // default: mock enabled

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
  if (token && typeof window !== 'undefined') {
    localStorage.setItem('cryptoexam_token', token);
  } else if (typeof window !== 'undefined') {
    localStorage.removeItem('cryptoexam_token');
  }
}

export function getAuthToken(): string | null {
  if (authToken) return authToken;
  if (typeof window !== 'undefined') {
    return localStorage.getItem('cryptoexam_token');
  }
  return null;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: { noAuth?: boolean } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const token = getAuthToken();
  if (token && !options.noAuth) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: 'Request failed' }));
    throw new Error(error.detail || `API Error: ${res.status}`);
  }

  return res.json();
}

// ── API Methods ──

export const api = {
  // Auth — step 1 (password) returns an OTP challenge; step 2 verifies it.
  login: (credentials: { identifier: string; password: string; role?: string }) =>
    request<OtpChallengeResponse>('POST', '/auth/login', credentials, { noAuth: true }),

  verifyOtp: (data: { challenge_id: string; code: string }) =>
    request<AuthResponse>('POST', '/auth/verify-otp', data, { noAuth: true }),

  me: () => request<ApiResponse<import('./types').User>>('GET', '/auth/me'),

  // Exams
  listExams: (page = 1, perPage = 20) =>
    request<PaginatedResponse<import('./types').Exam>>('GET', `/exams?page=${page}&per_page=${perPage}`),

  getExam: (id: string) =>
    request<ApiResponse<import('./types').Exam>>('GET', `/exams/${id}`),

  createExam: (data: Partial<import('./types').Exam>) =>
    request<ApiResponse<import('./types').Exam>>('POST', '/exams', data),

  verifyExam: (id: string) =>
    request<ApiResponse<import('./types').IntegrityReport>>('GET', `/exams/${id}/verify`),

  // Sessions
  startSession: (examId: string) =>
    request<ApiResponse<import('./types').Session>>('POST', '/sessions/start', { exam_id: examId }),

  submitAnswer: (sessionId: string, questionId: string, answer: string) =>
    request<ApiResponse<void>>('POST', '/sessions/answer', { session_id: sessionId, question_id: questionId, answer }),

  submitExam: (sessionId: string) =>
    request<ApiResponse<import('./types').CryptoReceipt>>('POST', '/sessions/submit', { session_id: sessionId }),

  getReceipt: (sessionId: string) =>
    request<ApiResponse<import('./types').CryptoReceipt>>('GET', `/sessions/receipt/${sessionId}`),

  // Crypto
  encryptPaper: (examId: string) =>
    request<ApiResponse<void>>('POST', `/crypto/encrypt/${examId}`),

  generateProof: (examId: string) =>
    request<ApiResponse<{ task_id: string }>>('POST', `/crypto/generate-proof`, { exam_id: examId }),

  // Blockchain
  verifyOnChain: (examId: string) =>
    request<ApiResponse<import('./types').IntegrityReport>>('GET', `/blockchain/verify/${examId}`, undefined, { noAuth: true }),

  getBlockchainStatus: () =>
    request<ApiResponse<{ block_number: number; tps: number; gas_gwei: number }>>('GET', '/blockchain/status'),

  // Admin
  getDashboard: () =>
    request<ApiResponse<import('./types').DashboardMetrics>>('GET', '/admin/dashboard'),

  getNodes: () =>
    request<ApiResponse<import('./types').HardwareNode[]>>('GET', '/admin/nodes'),

  emergencyPause: (data: { exam_id?: string; reason: string }) =>
    request<ApiResponse<void>>('POST', '/admin/emergency/pause', data),

  emergencyAbort: (data: { exam_id: string; reason: string }) =>
    request<ApiResponse<void>>('POST', '/admin/emergency/abort', data),
};

export { USE_MOCK };
export default api;
