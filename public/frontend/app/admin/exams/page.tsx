/**
 * CryptoExam Core — Admin Exam Lifecycle Manager
 * Wired to the live backend (/exams). No mock fixtures.
 */
'use client';

import { useEffect, useState } from 'react';
import { adminApi, type AdminExam } from '@/lib/api/admin';

const STATUS_COLORS: Record<string, string> = {
  LIVE: '#6fa678', LOCKED: '#939084', COMPLETED: '#a8c9a5', DRAFT: '#605d52',
  GENERATING: '#d9a441', PROOF_PENDING: '#b07d1a', DISTRIBUTED: '#939084',
  AUDITED: '#6fa678', ABORTED: '#c25a48', PAUSED: '#b07d1a',
};

export default function AdminExamsPage() {
  const [exams, setExams] = useState<AdminExam[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    adminApi.exams()
      .then((r) => { if (alive) setExams(r.items); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Failed to load exams'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <div style={{ animation: 'fadeIn 300ms ease forwards' }}>
      <h1 style={{ fontSize: 22, color: 'var(--color-navy-900)', marginBottom: 8 }}>Exam Lifecycle Manager</h1>
      <p style={{ fontSize: 13, color: 'var(--color-navy-500)', marginBottom: 24 }}>
        {loading ? 'Loading exams…' : `${exams.length} exam(s) · live from the backend`}
      </p>

      {error && (
        <div style={{ padding: 16, border: '1px solid #631518', background: 'rgba(99, 21, 24,0.15)', borderRadius: 12, color: '#d99a8e' }}>
          Could not reach the backend: {error}
        </div>
      )}

      {!loading && !error && exams.length === 0 && (
        <p style={{ color: 'var(--color-navy-400)' }}>No exams found.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {exams.map((exam) => (
          <div key={exam.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', alignItems: 'center', gap: 16, padding: '14px 18px', background: '#fffefb', borderRadius: 12, border: '1px solid var(--border-soft)', borderLeft: `3px solid ${STATUS_COLORS[exam.status] || '#605d52'}` }}>
            <div>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-navy-900)', display: 'block' }}>{exam.name}</span>
              <span style={{ fontSize: 12, color: 'var(--color-navy-500)' }}>{exam.exam_body} · {exam.exam_type} · {exam.sets_count} set(s)</span>
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 9999, background: `${STATUS_COLORS[exam.status]}20`, color: STATUS_COLORS[exam.status] }}>{exam.status}</span>
            <span style={{ fontSize: 12, color: 'var(--color-navy-600)' }}>{new Date(exam.scheduled_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
            <span style={{ fontSize: 12, color: 'var(--color-navy-500)' }}>{exam.duration_minutes}min</span>
          </div>
        ))}
      </div>
    </div>
  );
}
