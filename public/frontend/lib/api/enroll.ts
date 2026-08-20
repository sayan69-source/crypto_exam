/**
 * Public candidate-enrolment API → real FastAPI backend (/api/v1/enroll).
 * Candidates never log in online; this only captures enrolment (face + details).
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

export interface EnrolExam { id: string; name: string; organisation: string; year: number | null; scheduled_at: string | null }
export interface Organisation { name: string; key: string }
export interface ExamLocationOption { id: string; name: string; city: string | null; state: string | null; address: string | null }
export interface ExamSubjectOption { id: string; name: string; code: string | null; compulsory: boolean }

/** Everything the form needs to know about what this exam lets you choose. */
export interface ExamOptions {
  examId: string;
  name: string;
  organisation: string;
  scheduledAt: string | null;
  durationMinutes: number | null;
  locations: ExamLocationOption[];
  /** False when there is exactly one location — then it is a fact, not a choice. */
  locationChoice: boolean;
  subjects: ExamSubjectOption[];
  subjectChoiceMin: number | null;
  subjectChoiceMax: number | null;
  subjectChoice: boolean;
}

/** FastAPI puts structured refusals in `detail`; flatten to something readable. */
function detailMessage(j: unknown, fallback: string): string {
  const d = (j as { detail?: unknown })?.detail;
  if (typeof d === 'string') return d;
  if (d && typeof d === 'object') {
    const o = d as { message?: string; reason?: string };
    return o.message || o.reason || fallback;
  }
  return fallback;
}

export const enrollApi = {
  async organisations(): Promise<Organisation[]> {
    const res = await fetch(`${API_BASE}/enroll/organisations`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`organisations ${res.status}`);
    return (await res.json()).organisations ?? [];
  },

  /** Exams open to registration, narrowed to one conducting body when given. */
  async exams(organisation?: string): Promise<EnrolExam[]> {
    const q = organisation ? `?organisation=${encodeURIComponent(organisation)}` : '';
    const res = await fetch(`${API_BASE}/enroll/exams${q}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`exams ${res.status}`);
    return (await res.json()).exams ?? [];
  },

  async options(examId: string): Promise<ExamOptions> {
    const res = await fetch(`${API_BASE}/enroll/exams/${examId}/options`, { cache: 'no-store' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(detailMessage(j, `options ${res.status}`));
    return j as ExamOptions;
  },

  async enrol(body: {
    fullName: string; dateOfBirth: string; examId: string;
    /** Ordered best-first. Empty is allowed when the exam has one location. */
    locationPreferences: string[];
    /** Only the OPTIONAL subjects; compulsory ones are added server-side. */
    subjectIds: string[];
    email?: string;
    faceDescriptor: number[];
  }) {
    const res = await fetch(`${API_BASE}/enroll/candidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(detailMessage(j, `enrol ${res.status}`));
    return j as {
      ok: boolean; rollNumber: string; exam: string; organisation: string;
      location: string; locationChoiceRank: number; subjects: string[];
      centre: string | null; note: string;
      registrationYear?: number; emailDelivery?: string; emailDevPreview?: string;
    };
  },

  // Real face match against the enrolled descriptor (server-side distance).
  async verifyFace(roll: string, faceDescriptor: number[]) {
    const res = await fetch(`${API_BASE}/enroll/verify-face`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roll, faceDescriptor }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.detail || `verify ${res.status}`);
    return j as { matched: boolean; distance: number; threshold: number; confidence: number; candidate: string | null };
  },
};
