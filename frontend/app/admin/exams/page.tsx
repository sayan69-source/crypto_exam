'use client';
import { mockExams } from '@/lib/api/mock-data';

const STATUS_COLORS: Record<string, string> = {
  LIVE: '#4ade80', LOCKED: '#a78bfa', COMPLETED: '#6ee7b7', DRAFT: '#6b7280',
  GENERATING: '#fbbf24', PROOF_PENDING: '#c9a84c', DISTRIBUTED: '#6b84d4',
  AUDITED: '#34d399', ABORTED: '#f87171', PAUSED: '#f59e0b',
};

export default function AdminExamsPage() {
  return (
    <div style={{ animation: 'fadeIn 300ms ease forwards' }}>
      <h1 style={{ fontSize: 22, color: 'white', marginBottom: 24 }}>📝 Exam Lifecycle Manager</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {mockExams.map(exam => (
          <div key={exam.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', alignItems: 'center', gap: 16, padding: '14px 18px', background: 'rgba(255,255,255,0.04)', borderRadius: 12, border: '1px solid var(--color-navy-700)', borderLeft: `3px solid ${STATUS_COLORS[exam.status] || '#6b7280'}` }}>
            <div>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'white', display: 'block' }}>{exam.name}</span>
              <span style={{ fontSize: 12, color: 'var(--color-navy-400)' }}>{exam.exam_body} · {exam.candidate_count?.toLocaleString('en-IN')} candidates · {exam.centers_count} centers</span>
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 9999, background: `${STATUS_COLORS[exam.status]}20`, color: STATUS_COLORS[exam.status] }}>{exam.status}</span>
            <span style={{ fontSize: 12, color: 'var(--color-navy-300)' }}>{new Date(exam.scheduled_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
            <span style={{ fontSize: 12, color: 'var(--color-navy-400)' }}>{exam.duration_minutes}min</span>
          </div>
        ))}
      </div>
    </div>
  );
}
