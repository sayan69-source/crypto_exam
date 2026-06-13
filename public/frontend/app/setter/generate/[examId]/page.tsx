'use client';

import { useState, useEffect } from 'react';

const SLOT_DATA = [
  { subject: 'Physics', topic: 'Mechanics', target: 8, generated: 8, accepted: 7 },
  { subject: 'Physics', topic: 'Optics', target: 5, generated: 5, accepted: 5 },
  { subject: 'Chemistry', topic: 'Organic', target: 10, generated: 10, accepted: 9 },
  { subject: 'Chemistry', topic: 'Inorganic', target: 8, generated: 6, accepted: 5 },
  { subject: 'Biology', topic: 'Genetics', target: 12, generated: 12, accepted: 11 },
  { subject: 'Biology', topic: 'Ecology', target: 10, generated: 8, accepted: 7 },
];

export default function SetterGeneratePage() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setProgress(p => Math.min(100, p + 2)), 300);
    return () => clearInterval(timer);
  }, []);

  return (
    <div style={{ animation: 'fadeIn 300ms ease forwards' }}>
      <h1 style={{ fontSize: 24, color: 'white', marginBottom: 8 }}>AI Question Generation</h1>
      <p style={{ fontSize: 13, color: 'var(--color-navy-400)', marginBottom: 32 }}>Generating questions for NEET UG 2026 — Phase I</p>

      {/* Overall progress */}
      <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-navy-700)', borderRadius: 16, padding: 24, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'white' }}>Overall Progress</span>
          <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'white' }}>{progress}%</span>
        </div>
        <div style={{ height: 8, background: 'var(--color-navy-700)', borderRadius: 9999, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg, var(--color-navy-500), var(--color-india-saffron))', borderRadius: 9999, transition: 'width 300ms ease' }} />
        </div>
      </div>

      {/* Slot table */}
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-navy-700)', borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto auto', gap: 16, padding: '12px 18px', borderBottom: '2px solid var(--color-navy-700)', fontSize: 11, fontWeight: 600, color: 'var(--color-navy-400)', textTransform: 'uppercase' }}>
          <span>Subject</span><span>Topic</span><span>Target</span><span>Generated</span><span>Accepted</span>
        </div>
        {SLOT_DATA.map((slot, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto auto', gap: 16, padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.04)', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--color-navy-200)' }}>{slot.subject}</span>
            <span style={{ fontSize: 13, color: 'var(--color-navy-300)' }}>{slot.topic}</span>
            <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--color-navy-300)', textAlign: 'center', width: 60 }}>{slot.target}</span>
            <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: slot.generated >= slot.target ? '#4ade80' : '#f59e0b', textAlign: 'center', width: 60 }}>{slot.generated}</span>
            <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: slot.accepted >= slot.target ? '#4ade80' : 'var(--color-navy-300)', textAlign: 'center', width: 60 }}>{slot.accepted}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
