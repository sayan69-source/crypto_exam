/**
 * Public candidate-enrolment API → real FastAPI backend (/api/v1/enroll).
 * Candidates never log in online; this only captures enrolment (face + details).
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

export interface EnrolExam { id: string; name: string; body: string | null; scheduled_at: string | null }

export const enrollApi = {
  async exams(): Promise<EnrolExam[]> {
    const res = await fetch(`${API_BASE}/enroll/exams`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`exams ${res.status}`);
    return (await res.json()).exams ?? [];
  },

  async enrol(body: { fullName: string; dateOfBirth: string; examId: string; centerId: string; faceEmbeddingHash: string }) {
    const res = await fetch(`${API_BASE}/enroll/candidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.detail || `enrol ${res.status}`);
    return j as { ok: boolean; rollNumber: string; centre: string; exam: string; note: string };
  },
};
