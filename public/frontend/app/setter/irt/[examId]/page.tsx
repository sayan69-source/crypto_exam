'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { setterApi, type SetterQuestion } from '@/lib/api/setter';

const SUBJECT_COLOR = (s: string | null) =>
  s === 'Physics' ? '#60a5fa' : s === 'Chemistry' ? '#a78bfa' : s === 'Biology' ? '#4ade80' : '#f59e0b';

export default function SetterIRTPage() {
  const params = useParams<{ examId: string }>();
  const examId = params.examId;
  const [examName, setExamName] = useState<string>('');
  const [questions, setQuestions] = useState<SetterQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!examId) return;
    setterApi
      .questions(examId)
      .then((r) => {
        setExamName(r.exam_name);
        setQuestions(r.questions);
      })
      .catch((e) => setError(e.message));
  }, [examId]);

  // IRT params present (some drafts have none yet).
  const scored = (questions ?? []).filter((q) => q.irt_b != null && q.irt_a != null);
  const bs = scored.map((q) => q.irt_b as number);
  const meanB = bs.length ? bs.reduce((a, b) => a + b, 0) / bs.length : 0;
  const stdB = bs.length
    ? Math.sqrt(bs.reduce((a, b) => a + (b - meanB) ** 2, 0) / bs.length)
    : 0;
  const validations = [
    { label: 'Mean b in [-1, 1]', ok: meanB >= -1 && meanB <= 1 },
    { label: 'Std b ≤ 1.0', ok: stdB <= 1.0 },
    { label: 'All a ≥ 0.5', ok: scored.every((q) => (q.irt_a as number) >= 0.5) },
    { label: 'All c ≤ 0.25', ok: scored.every((q) => (q.irt_c ?? 0) <= 0.25) },
  ];

  return (
    <div style={{ animation: 'fadeIn 300ms ease forwards' }}>
      <h1 style={{ fontSize: 24, color: 'white', marginBottom: 8 }}>IRT Parameter Analysis</h1>
      <p style={{ fontSize: 13, color: 'var(--color-navy-400)', marginBottom: 24 }}>
        Item Response Theory analysis for {examName || '…'}
        {questions && ` · ${scored.length}/${questions.length} items scored`}
      </p>

      {error && (
        <div style={{ padding: 16, borderRadius: 10, background: 'rgba(248,113,113,0.1)', color: '#f87171', fontSize: 13 }}>
          {error}
        </div>
      )}
      {questions === null && !error && <p style={{ color: 'var(--color-navy-400)', fontSize: 13 }}>Loading questions…</p>}
      {questions && scored.length === 0 && !error && (
        <p style={{ color: 'var(--color-navy-400)', fontSize: 13 }}>
          No IRT-scored questions yet for this exam.
        </p>
      )}

      {scored.length > 0 && (
        <>
          {/* Validation bar — computed from real parameters */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
            {validations.map((v) => (
              <div key={v.label} style={{ padding: '8px 16px', borderRadius: 12, background: v.ok ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)', border: `1px solid ${v.ok ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)'}`, fontSize: 12, fontWeight: 500, color: v.ok ? '#4ade80' : '#f87171' }}>
                {v.ok ? '✓' : '✗'} {v.label}
              </div>
            ))}
            <div style={{ padding: '8px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.05)', fontSize: 12, color: 'var(--color-navy-300)', fontFamily: 'var(--font-mono)' }}>
              mean b = {meanB.toFixed(2)} · std b = {stdB.toFixed(2)}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
            {/* Question list */}
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-navy-700)', borderRadius: 16, overflow: 'hidden', maxHeight: 500, overflowY: 'auto' }}>
              {scored.map((q) => (
                <div key={q.id} style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--color-navy-200)' }}>
                    {q.set_label}·Q{q.sequence_number}
                  </span>
                  <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--color-navy-300)' }}>b={(q.irt_b as number).toFixed(2)}</span>
                  <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--color-navy-400)' }}>a={(q.irt_a as number).toFixed(2)}</span>
                </div>
              ))}
            </div>

            {/* Scatter — real points */}
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-navy-700)', borderRadius: 16, padding: 24, position: 'relative', minHeight: 400 }}>
              <h3 style={{ fontSize: 14, color: 'var(--color-navy-200)', marginBottom: 16 }}>Difficulty (b) vs. Discrimination (a)</h3>
              <div style={{ position: 'relative', width: '100%', height: 320, background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px dashed var(--color-navy-600)' }}>
                <span style={{ position: 'absolute', bottom: -20, left: '50%', transform: 'translateX(-50%)', fontSize: 10, color: 'var(--color-navy-400)' }}>Difficulty (b)</span>
                <span style={{ position: 'absolute', left: -20, top: '50%', transform: 'translateY(-50%) rotate(-90deg)', fontSize: 10, color: 'var(--color-navy-400)' }}>Discrimination (a)</span>
                {scored.map((q) => (
                  <div key={q.id} style={{
                    position: 'absolute',
                    left: `${Math.max(0, Math.min(100, (((q.irt_b as number) + 3) / 6) * 100))}%`,
                    bottom: `${Math.max(0, Math.min(100, ((q.irt_a as number) / 3) * 100))}%`,
                    width: 10, height: 10, borderRadius: '50%',
                    background: SUBJECT_COLOR(q.subject),
                    transform: 'translate(-50%, 50%)',
                    boxShadow: `0 0 6px ${SUBJECT_COLOR(q.subject)}66`,
                  }} title={`${q.set_label}·Q${q.sequence_number} (${q.subject}): b=${q.irt_b}, a=${q.irt_a}`} />
                ))}
                <div style={{ position: 'absolute', left: '35%', right: '35%', bottom: '15%', top: '40%', background: 'rgba(41,66,166,0.08)', border: '1px dashed var(--color-navy-500)', borderRadius: 8 }}>
                  <span style={{ position: 'absolute', top: -16, left: '50%', transform: 'translateX(-50%)', fontSize: 9, color: 'var(--color-navy-400)' }}>Target Zone</span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
