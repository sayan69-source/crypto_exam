/**
 * The "Finalize & Lock" step, shared by all three paper modes.
 *
 * Each mode previously ended in a button with no onClick: a setter uploaded a
 * paper, watched it parse, pressed the one control the whole screen is built
 * around, and nothing happened — no request, no error, no navigation. This
 * component is that missing action.
 *
 * It reports each stage separately on purpose. "Questions stored but not
 * sealed" and "sealed but no difficulty proof" are genuinely different states,
 * and a setter who is told only "done" cannot tell which one they are in.
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { paperModesApi } from '@/lib/api/paper-modes';
import { getAuthToken } from '@/lib/api/client';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

interface ExamOption { id: string; name: string; status: string }

type Step = { step: string; ok: boolean; detail: string };

export default function FinalizePanel({
  taskId,
  label,
  disabled,
  disabledReason,
}: {
  taskId: string | null;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [exams, setExams] = useState<ExamOption[]>([]);
  const [examId, setExamId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[] | null>(null);

  // Only DRAFT/GENERATING exams can receive a paper — a locked one is
  // immutable, and that is the guarantee, not a limitation.
  useEffect(() => {
    const token = getAuthToken();
    fetch(`${API_BASE}/exams/?page=1&per_page=100`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Could not list exams'))))
      .then((d) => {
        const list: ExamOption[] = (Array.isArray(d) ? d : d.items ?? d.exams ?? [])
          .filter((e: ExamOption) => ['DRAFT', 'GENERATING'].includes(e.status))
          .map((e: ExamOption) => ({ id: e.id, name: e.name, status: e.status }));
        setExams(list);
        if (list.length === 1) setExamId(list[0].id);
      })
      .catch(() => setExams([]));
  }, []);

  async function lock() {
    if (!taskId) return setError('No completed generation run to lock. Run the pipeline first.');
    if (!examId) return setError('Choose which exam this paper belongs to.');
    setBusy(true);
    setError(null);
    try {
      const r = await paperModesApi.finalize(taskId, examId);
      setSteps(r.steps);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not lock the paper.');
    } finally {
      setBusy(false);
    }
  }

  if (steps) {
    const sealed = steps.find((s) => s.step === 'SEALED');
    return (
      <div style={box}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>
          {sealed?.ok ? 'Paper committed' : 'Paper stored, but not fully committed'}
        </h3>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: '#94a3b8', lineHeight: 1.6 }}>
          {sealed?.ok
            ? 'The questions are sealed under per-question keys and committed to a Merkle root. Nobody — including you — can read the paper back out of this system before T₀.'
            : 'The questions were saved, but sealing did not complete. The paper is NOT yet protected; resolve the failure below before treating it as locked.'}
        </p>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {steps.map((s) => (
            <li key={s.step} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13 }}>
              <span style={{ color: s.ok ? '#4ade80' : '#f87171', fontWeight: 700 }}>{s.ok ? '✓' : '✕'}</span>
              <span>
                <strong style={{ display: 'block' }}>{s.step.replace(/_/g, ' ')}</strong>
                <span style={{ color: '#94a3b8' }}>{s.detail}</span>
              </span>
            </li>
          ))}
        </ul>
        <Link href="/setter/dashboard" style={link}>Back to dashboard →</Link>
      </div>
    );
  }

  return (
    <div style={box}>
      <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>
        Lock this paper into
      </label>
      <select
        value={examId}
        onChange={(e) => setExamId(e.target.value)}
        style={select}
        disabled={busy || exams.length === 0}
      >
        <option value="">
          {exams.length ? 'Choose an exam…' : 'No draft exams available'}
        </option>
        {exams.map((e) => (
          <option key={e.id} value={e.id}>{e.name} · {e.status}</option>
        ))}
      </select>

      {exams.length === 0 && (
        <p style={{ fontSize: 12.5, color: '#94a3b8', margin: '10px 0 0', lineHeight: 1.6 }}>
          A paper has to belong to an exam. <Link href="/setter/create" style={{ color: '#60a5fa' }}>Create one</Link> first —
          it takes a minute, and only DRAFT exams can accept a paper.
        </p>
      )}

      {error && <p style={errBox} role="alert">{error}</p>}

      <button
        onClick={lock}
        disabled={busy || !!disabled || !taskId || !examId}
        title={disabled ? disabledReason : !taskId ? 'Run the pipeline first' : ''}
        style={{ ...btn, opacity: busy || disabled || !taskId || !examId ? 0.5 : 1 }}
      >
        {busy ? 'Sealing and proving…' : label}
      </button>
    </div>
  );
}

const box: React.CSSProperties = {
  marginTop: 24, padding: 20, borderRadius: 12,
  border: '1px solid rgba(148,163,184,0.25)', background: 'rgba(15,23,42,0.35)',
};
const select: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 8,
  border: '1px solid rgba(148,163,184,0.3)', background: 'rgba(2,6,23,0.6)',
  color: '#e2e8f0', fontSize: 14,
};
const btn: React.CSSProperties = {
  marginTop: 16, width: '100%', padding: '13px 18px', borderRadius: 8, border: 0,
  background: '#2563eb', color: '#fff', fontSize: 14.5, fontWeight: 600, cursor: 'pointer',
};
const errBox: React.CSSProperties = {
  marginTop: 12, padding: '10px 12px', borderRadius: 8,
  border: '1px solid rgba(248,113,113,0.4)', background: 'rgba(248,113,113,0.1)',
  color: '#fca5a5', fontSize: 12.5, lineHeight: 1.55,
};
const link: React.CSSProperties = {
  display: 'inline-block', marginTop: 16, color: '#60a5fa', fontSize: 13, textDecoration: 'none',
};
