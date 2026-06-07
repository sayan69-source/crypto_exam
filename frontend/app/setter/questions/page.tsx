'use client';

import { mockQuestions } from '@/lib/api/mock-data';

export default function SetterQuestionsPage() {
  return (
    <div style={{ animation: 'fadeIn 300ms ease forwards' }}>
      <h1 style={{ fontSize: 24, color: 'white', marginBottom: 8 }}>📚 Question Bank</h1>
      <p style={{ fontSize: 13, color: 'var(--color-navy-400)', marginBottom: 24 }}>2,847 questions across all subjects</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {['All', 'Physics', 'Chemistry', 'Biology'].map(f => (
          <button key={f} style={{ padding: '6px 14px', fontSize: 12, fontFamily: 'var(--font-sans)', fontWeight: 500, background: f === 'All' ? 'var(--color-navy-600)' : 'rgba(255,255,255,0.06)', color: f === 'All' ? 'white' : 'var(--color-navy-300)', border: 'none', borderRadius: 9999, cursor: 'pointer' }}>{f}</button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {mockQuestions.slice(0, 10).map((q, i) => (
          <div key={q.id} style={{ padding: '14px 18px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-navy-700)', borderRadius: 12, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-navy-400)', fontFamily: 'var(--font-mono)', minWidth: 28 }}>Q{q.sequence_number}</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13, color: 'var(--color-navy-200)', lineHeight: 1.5, margin: 0 }}>{q.text.slice(0, 120)}{q.text.length > 120 ? '...' : ''}</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 9999, background: 'rgba(255,255,255,0.06)', color: 'var(--color-navy-300)' }}>{q.subject}</span>
                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 9999, background: 'rgba(255,255,255,0.06)', color: 'var(--color-navy-300)' }}>L{q.blooms_level}</span>
                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 9999, background: 'rgba(255,255,255,0.06)', color: 'var(--color-navy-300)' }}>b={q.irt_b}</span>
                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 9999, background: q.is_accepted ? 'rgba(74,222,128,0.15)' : 'rgba(245,158,11,0.15)', color: q.is_accepted ? '#4ade80' : '#f59e0b' }}>{q.is_accepted ? '✅ Accepted' : '⏳ Review'}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
