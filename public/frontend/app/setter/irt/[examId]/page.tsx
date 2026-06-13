'use client';

import { mockQuestions } from '@/lib/api/mock-data';

export default function SetterIRTPage() {
  const questions = mockQuestions.slice(0, 15);

  return (
    <div style={{ animation: 'fadeIn 300ms ease forwards' }}>
      <h1 style={{ fontSize: 24, color: 'white', marginBottom: 8 }}>IRT Parameter Editor</h1>
      <p style={{ fontSize: 13, color: 'var(--color-navy-400)', marginBottom: 24 }}>Item Response Theory analysis for NEET UG 2026</p>

      {/* Validation bar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Mean b in range', ok: true },
          { label: 'Std b ≤ 1.0', ok: true },
          { label: 'All a ≥ 0.5', ok: true },
          { label: 'All c ≤ 0.25', ok: false },
        ].map(v => (
          <div key={v.label} style={{ padding: '8px 16px', borderRadius: 12, background: v.ok ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)', border: `1px solid ${v.ok ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)'}`, fontSize: 12, fontWeight: 500, color: v.ok ? '#4ade80' : '#f87171' }}>
            {v.ok ? '✓' : '✗'} {v.label}
          </div>
        ))}
      </div>

      {/* IRT Scatter (simplified table) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
        {/* Question list */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-navy-700)', borderRadius: 16, overflow: 'hidden', maxHeight: 500, overflowY: 'auto' }}>
          {questions.map(q => (
            <div key={q.id} style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', justifyContent: 'space-between', cursor: 'pointer', transition: 'background 150ms' }}>
              <span style={{ fontSize: 12, color: 'var(--color-navy-200)' }}>Q{q.sequence_number}</span>
              <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--color-navy-300)' }}>b={q.irt_b.toFixed(2)}</span>
              <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--color-navy-400)' }}>a={q.irt_a.toFixed(2)}</span>
            </div>
          ))}
        </div>

        {/* Scatter placeholder */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-navy-700)', borderRadius: 16, padding: 24, position: 'relative', minHeight: 400 }}>
          <h3 style={{ fontSize: 14, color: 'var(--color-navy-200)', marginBottom: 16 }}>Difficulty vs. Discrimination</h3>
          <div style={{ position: 'relative', width: '100%', height: 320, background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px dashed var(--color-navy-600)' }}>
            {/* Axis labels */}
            <span style={{ position: 'absolute', bottom: -20, left: '50%', transform: 'translateX(-50%)', fontSize: 10, color: 'var(--color-navy-400)' }}>Difficulty (b)</span>
            <span style={{ position: 'absolute', left: -20, top: '50%', transform: 'translateY(-50%) rotate(-90deg)', fontSize: 10, color: 'var(--color-navy-400)' }}>Discrimination (a)</span>
            {/* Plot points */}
            {questions.map(q => (
              <div key={q.id} style={{
                position: 'absolute',
                left: `${((q.irt_b + 3) / 6) * 100}%`,
                bottom: `${((q.irt_a) / 3) * 100}%`,
                width: 10, height: 10, borderRadius: '50%',
                background: q.subject === 'Physics' ? '#60a5fa' : q.subject === 'Chemistry' ? '#a78bfa' : '#4ade80',
                transform: 'translate(-50%, 50%)', cursor: 'pointer',
                boxShadow: `0 0 6px ${q.subject === 'Physics' ? 'rgba(96,165,250,0.4)' : q.subject === 'Chemistry' ? 'rgba(167,139,250,0.4)' : 'rgba(74,222,128,0.4)'}`,
              }} title={`Q${q.sequence_number}: b=${q.irt_b}, a=${q.irt_a}`} />
            ))}
            {/* Target zone */}
            <div style={{ position: 'absolute', left: '35%', right: '35%', bottom: '15%', top: '40%', background: 'rgba(41,66,166,0.08)', border: '1px dashed var(--color-navy-500)', borderRadius: 8 }}>
              <span style={{ position: 'absolute', top: -16, left: '50%', transform: 'translateX(-50%)', fontSize: 9, color: 'var(--color-navy-400)' }}>Target Zone</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
