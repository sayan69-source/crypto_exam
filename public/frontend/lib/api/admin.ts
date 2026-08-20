/**
 * Admin API — typed fetchers for the System-Admin console, hitting the real
 * FastAPI backend (/api/v1/admin, /exams). These intentionally do NOT fall back
 * to mock data: the admin console shows live backend state or an honest error.
 */
import { getAuthToken } from './client';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

async function get<T>(path: string): Promise<T> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || body.message || `Request failed (${res.status})`);
  }
  return res.json();
}

// ── Shapes (mirror the backend responses) ──

export interface AdminDashboard {
  timestamp: string;
  users: Record<string, number>;
  exams: Record<string, number>;
  total_enrollments: number;
  active_sessions: number;
  hardware_nodes: { total: number; online: number; offline: number };
  system_health: { database: string; redis: string; blockchain: string; ipfs: string };
}

export interface AdminNode {
  id: string;
  serial_number: string | null;
  is_online: boolean;
  firmware_version: string | null;
  last_heartbeat: string | null;
  latitude: number | null;
  longitude: number | null;
  tpm_verified: boolean;
  center_name: string | null;
  state: string | null;
}

export interface AdminNodesResponse {
  total: number;
  nodes: AdminNode[];
}

export interface AdminExam {
  id: string;
  name: string;
  name_hi: string | null;
  exam_body: string;
  exam_type: string;
  duration_minutes: number;
  scheduled_at: string;
  status: string;
  setter_id: string | null;
  sets_count: number;
  negative_marking: number;
  question_hash: string | null;
  zk_proof_hash: string | null;
  answer_merkle_root: string | null;
  created_at: string;
}

export interface AdminExamsResponse {
  items: AdminExam[];
  total: number;
  page: number;
  per_page: number;
}

export interface StaffApproval {
  requestId: string;
  applicantName: string;
  role: string;
  centreName: string;
  centreIdHash: string;
  examName: string | null;
  examYear: number | null;
  status: string;
  fingerprintAuthorised: boolean;
  createdAt: string;
  approvedAt: string | null;
  codeExpiresAt: string | null;
}

async function post<T>(path: string): Promise<T> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || body.message || `Request failed (${res.status})`);
  }
  return res.json();
}

export interface DpdpLog {
  id: string;
  user_id: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

export interface DpdpResponse {
  total: number;
  page: number;
  per_page: number;
  items: DpdpLog[];
}

export interface AdminCandidate {
  id: string;
  name: string;
  email: string | null;
  state: string | null;
  rollNumber: string | null;
  setLabel: string | null;
  enrollmentStatus: string | null;
  approvalStatus: string | null;     // Problem 2: PENDING | APPROVED | REJECTED
  registrationYear: number | null;   // Problem 3
  enrolledAt: string | null;         // Problem 3
  centreName: string | null;
  isActive: boolean;
}
export interface AdminCandidatesResponse { total: number; page: number; per_page: number; items: AdminCandidate[] }

export interface AdminCenter {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  capacity: number | null;
  latitude: number | null;
  longitude: number | null;
  connectivity: string | null;
  invigilatorName: string | null;
  invigilatorPhone: string | null;
  nodesOnline: number;
  nodesTotal: number;
  status: string;
}
export interface AdminCentersResponse { total: number; centers: AdminCenter[] }

export interface AdminRole { role: string; users: number; permissions: string }

export interface BlockchainStatus {
  chainId: number | null;
  latestBlock: number | null;
  contractAddress: string | null;
  deployerAddress: string | null;
  deployerBalance: string | null;
  connected: boolean;
  error?: string;
}

async function postWithBody<T>(path: string, body: unknown): Promise<T> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.detail || b.message || `Request failed (${res.status})`);
  }
  return res.json();
}

export const adminApi = {
  dashboard: () => get<AdminDashboard>('/admin/dashboard'),
  nodes: () => get<AdminNodesResponse>('/admin/nodes'),
  exams: (page = 1, perPage = 50) => get<AdminExamsResponse>(`/exams/?page=${page}&per_page=${perPage}`),
  dpdpAudit: (page = 1, perPage = 50) => get<DpdpResponse>(`/admin/audit/dpdp?page=${page}&per_page=${perPage}`),
  candidates: () => get<AdminCandidatesResponse>('/admin/candidates'),
  centers: () => get<AdminCentersResponse>('/admin/centers'),
  roles: () => get<{ roles: AdminRole[] }>('/admin/roles'),
  blockchainStatus: () => get<BlockchainStatus>('/blockchain/status'),
  // Centre-staff approvals (real, DB-backed)
  staffApprovals: (role = 'CENTER_ADMIN', includeResolved = false) =>
    get<{ pending: StaffApproval[] }>(`/admin/staff-approvals?role=${role}&include_resolved=${includeResolved}`),
  issueStaffCode: (id: string) =>
    post<{ ok: boolean; code: string; expiresAt: string; ttlMinutes: number }>(`/admin/staff-approvals/${id}/issue-code`),
  authoriseStaffFp: (id: string) =>
    post<{ ok: boolean }>(`/admin/staff-approvals/${id}/authorise-fp`),
  // Problem 2: candidate approval
  approveCandidate: (candidateId: string) =>
    post<{ ok: boolean; approvalStatus: string; approvedAt: string }>(`/admin/candidates/${candidateId}/approve`),
  rejectCandidate: (candidateId: string, rejectionReason: string) =>
    postWithBody<{ ok: boolean; approvalStatus: string; rejectedAt: string }>(`/admin/candidates/${candidateId}/reject`, { rejection_reason: rejectionReason }),
};
