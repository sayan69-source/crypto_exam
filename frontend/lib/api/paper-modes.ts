/**
 * CryptoExam Core — § 28 Question Setting Portal API client.
 *
 * Multipart upload to the FastAPI `/api/v1/question-modes/*` endpoints plus a
 * pipeline-status poller. Falls back to a realistic local simulation when
 * NEXT_PUBLIC_USE_MOCK is on (default), so the setter UI works without a backend.
 */

import { getAuthToken, USE_MOCK } from './client';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

export type PipelineStatus = 'PENDING' | 'PROGRESS' | 'SUCCESS' | 'FAILURE' | 'NOT_FOUND';

export interface PipelineState {
  task_id: string;
  status: PipelineStatus;
  progress: number;
  message: string;
  result: Record<string, unknown> | null;
  error?: string | null;
}

export type Mode = 'mode1' | 'mode2' | 'mode3';

const ENDPOINT: Record<Mode, string> = {
  mode1: '/question-modes/mode1/upload-and-generate',
  mode2: '/question-modes/mode2/upload-and-upgrade',
  mode3: '/question-modes/mode3/upload-human-paper',
};

async function postMultipart(mode: Mode, form: FormData): Promise<{ task_id: string } | null> {
  if (USE_MOCK) return null;
  try {
    const token = getAuthToken();
    const res = await fetch(`${API_BASE}${ENDPOINT[mode]}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function pollStatus(taskId: string): Promise<PipelineState | null> {
  if (USE_MOCK) return null;
  try {
    const res = await fetch(`${API_BASE}/question-modes/pipeline-status/${taskId}`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Mock pipeline: emits realistic progress + a representative result. */
function mockRun(mode: Mode, onProgress: (p: number, msg: string) => void): Promise<Record<string, unknown>> {
  const steps: Record<Mode, [number, string][]> = {
    mode3: [[20, 'Extracting questions from PDF…'], [45, 'Validating answer-key completeness…'], [70, 'Estimating IRT parameters…'], [90, 'Encrypting answer key (AES-GCM-256)…'], [100, 'Parsing complete.']],
    mode2: [[20, 'Parsing uploaded paper…'], [45, 'Analysing distractor quality…'], [70, 'Checking syllabus alignment…'], [90, 'Estimating IRT…'], [100, 'Analysis complete.']],
    mode1: [[15, 'Reading seed style…'], [40, 'Building blueprint…'], [65, 'Generating questions…'], [90, 'Calibrating IRT…'], [100, 'Generation complete.']],
  };
  return new Promise((resolve) => {
    const seq = steps[mode];
    let i = 0;
    const tick = () => {
      if (i < seq.length) {
        const [p, m] = seq[i++];
        onProgress(p, m);
        setTimeout(tick, 700);
      } else {
        resolve({
          status: 'READY_FOR_REVIEW',
          mode,
          question_count: 75,
          subjects: { Physics: 25, Chemistry: 25, Biology: 25 },
          irt: { distribution: { easy: 18, medium: 42, hard: 15, mean_b: 0.21 } },
          encrypted_answer_key: mode === 'mode3' ? { alg: 'AES-GCM-256', count: 75 } : undefined,
        });
      }
    };
    tick();
  });
}

export const paperModesApi = {
  /**
   * Submit files for a mode and drive progress to completion.
   * `files` keys depend on mode:
   *   mode1: { questions_pdf, syllabus_pdf }
   *   mode2: { question_paper_pdf, syllabus_pdf? }
   *   mode3: { question_paper_pdf, answer_key_pdf }
   */
  async run(
    mode: Mode,
    files: Record<string, File | undefined>,
    fields: Record<string, string | number> = {},
    onProgress: (p: number, msg: string) => void = () => {},
  ): Promise<Record<string, unknown>> {
    const form = new FormData();
    for (const [k, f] of Object.entries(files)) if (f) form.append(k, f, f.name);
    for (const [k, v] of Object.entries(fields)) form.append(k, String(v));

    const started = await postMultipart(mode, form);
    if (!started) return mockRun(mode, onProgress);

    // Poll until terminal
    return new Promise((resolve, reject) => {
      const iv = setInterval(async () => {
        const st = await pollStatus(started.task_id);
        if (!st) return;
        onProgress(st.progress, st.message);
        if (st.status === 'SUCCESS') { clearInterval(iv); resolve(st.result || {}); }
        else if (st.status === 'FAILURE') { clearInterval(iv); reject(new Error(st.error || 'Pipeline failed')); }
      }, 800);
    });
  },
};

export default paperModesApi;
