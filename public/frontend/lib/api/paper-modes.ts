/**
 * CryptoExam Core — § 28 Question Setting Portal API client.
 *
 * Multipart upload to the FastAPI `/api/v1/question-modes/*` endpoints plus a
 * pipeline-status poller. Falls back to a realistic local simulation when
 * NEXT_PUBLIC_USE_MOCK is on (default), so the setter UI works without a backend.
 */

import { getAuthToken, USE_MOCK } from './client';
import { describeApiError } from './errors';

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
  ): Promise<{ taskId: string; result: Record<string, unknown> }> {
    const form = new FormData();
    for (const [k, f] of Object.entries(files)) if (f) form.append(k, f, f.name);
    for (const [k, v] of Object.entries(fields)) form.append(k, String(v));

    const started = await postMultipart(mode, form);
    // There used to be a `mockRun` fallback here that invented a 75-question
    // result with plausible IRT figures whenever the backend was unreachable.
    // A setter could not tell it from a real run — and would then try to lock
    // a paper that did not exist. An unreachable pipeline is an error.
    if (!started) {
      throw new Error(
        'The generation service did not accept the upload. Check that the backend is running and that you are signed in as a setter.',
      );
    }

    return new Promise((resolve, reject) => {
      const iv = setInterval(async () => {
        const st = await pollStatus(started.task_id);
        if (!st) return;
        onProgress(st.progress, st.message);
        if (st.status === 'SUCCESS') {
          clearInterval(iv);
          resolve({ taskId: started.task_id, result: st.result || {} });
        } else if (st.status === 'FAILURE') {
          clearInterval(iv);
          reject(new Error(st.error || 'Pipeline failed'));
        }
      }, 800);
    });
  },

  /**
   * Commit a finished pipeline run to a real exam: persist the questions, seal
   * them under per-question keys, and generate the difficulty proof.
   *
   * This is what the "Finalize & Lock" buttons call. Before it existed those
   * buttons had no handler at all — a setter pressed the one control the whole
   * screen is built around and nothing happened, with no error.
   */
  async finalize(taskId: string, examId: string) {
    const token = getAuthToken();
    const res = await fetch(`${API_BASE}/question-modes/finalize`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ task_id: taskId, exam_id: examId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(describeApiError(body, res.status));
    }
    return body as {
      ok: boolean;
      examId: string;
      questionsStored: number;
      status: string;
      steps: { step: string; ok: boolean; detail: string }[];
    };
  },
};

export default paperModesApi;
