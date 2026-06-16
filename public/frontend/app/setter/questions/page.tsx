'use client';

import { useEffect, useMemo, useState } from 'react';
import { setterApi, type SetterQuestion } from '@/lib/api/setter';

type BankItem = SetterQuestion & { examName: string };

export default function SetterQuestionsPage() {
  const [items, setItems] = useState<BankItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState('All');

  useEffect(() => {
    (async () => {
      try {
        const { items: exams } = await setterApi.exams();
        const banks = await Promise.all(
          exams.map((e) =>
            setterApi.questions(e.id).then((r) =>
              r.questions.map((q) => ({ ...q, examName: r.exam_name })),
            ).catch(() => [] as BankItem[]),
          ),
        );
        setItems(banks.flat());
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  const subjects = useMemo(
    () => ['All', ...Array.from(new Set((items ?? []).map((q) => q.subject).filter(Boolean) as string[]))],
    [items],
  );
  const filtered = (items ?? []).filter((q) => subject === 'All' || q.subject === subject);

  return (
    <div style={{ animation: 'fadeIn 300ms ease forwards' }}>
      <h1 style={{ fontSize: 24, color: 'white', marginBottom: 8 }}>Question Bank</h1>
      <p style={{ fontSize: 13, color: 'var(--color-navy-400)', marginBottom: 24 }}>
        {items === null ? 'Loading…' : `${items.length} questions across your ${new Set(items.map((q) => q.examName)).size} exam(s)`}
      </p>

      {error && (
        <div style={{ padding: 16, borderRadius: 10, background: 'rgba(248,113,113,0.1)', color: '#f87171', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {subjects.map((f) => (
          <button key={f} onClick={() => setSubject(f)} style={{ padding: '6px 14px', fontSize: 12, fontFamily: 'var(--font-sans)', fontWeight: 500, background: f === subject ? 'var(--color-navy-600)' : 'rgba(255,255,255,0.06)', color: f === subject ? 'white' : 'var(--color-navy-300)', border: 'none', borderRadius: 9999, cursor: 'pointer' }}>{f}</button>
        ))}
      </div>

      {items !== null && filtered.length === 0 && !error && (
        <p style={{ color: 'var(--color-navy-400)', fontSize: 13 }}>No questions yet. Generate or upload a paper to populate the bank.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.map((q) => (
          <div key={q.id} style={{ padding: '14px 18px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-navy-700)', borderRadius: 12, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-navy-400)', fontFamily: 'var(--font-mono)', minWidth: 36 }}>{q.set_label}·Q{q.sequence_number}</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13, color: 'var(--color-navy-200)', lineHeight: 1.5, margin: 0 }}>{q.text.slice(0, 140)}{q.text.length > 140 ? '…' : ''}</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                {q.subject && <span style={pill}>{q.subject}</span>}
                {q.blooms_level != null && <span style={pill}>L{q.blooms_level}</span>}
                {q.irt_b != null && <span style={pill}>b={q.irt_b.toFixed(2)}</span>}
                <span style={pill}>{q.examName}</span>
                <span style={{ ...pill, background: q.is_accepted ? 'rgba(74,222,128,0.15)' : 'rgba(245,158,11,0.15)', color: q.is_accepted ? '#4ade80' : '#f59e0b' }}>{q.is_accepted ? '✓ Accepted' : '… Review'}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const pill: React.CSSProperties = { fontSize: 10, padding: '2px 8px', borderRadius: 9999, background: 'rgba(255,255,255,0.06)', color: 'var(--color-navy-300)' };
