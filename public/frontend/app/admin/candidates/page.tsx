'use client';

const MOCK_CANDIDATES = [
  { name: 'Priya Sharma', roll: 'NEET-2026-BIH-0847291', state: 'Bihar', status: 'present', anomalies: 0 },
  { name: 'Rahul Yadav', roll: 'NEET-2026-UP-1392847', state: 'Uttar Pradesh', status: 'present', anomalies: 2 },
  { name: 'Ananya Ghosh', roll: 'NEET-2026-WB-2847103', state: 'West Bengal', status: 'present', anomalies: 3 },
  { name: 'Siddharth Patil', roll: 'NEET-2026-MH-4521098', state: 'Maharashtra', status: 'present', anomalies: 1 },
  { name: 'Meera Kapoor', roll: 'NEET-2026-DL-7834561', state: 'Delhi', status: 'present', anomalies: 1 },
  { name: 'Arjun Nair', roll: 'NEET-2026-KL-9012345', state: 'Kerala', status: 'absent', anomalies: 0 },
];

export default function AdminCandidatesPage() {
  return (
    <div style={{ animation: 'fadeIn 300ms ease forwards' }}>
      <h1 style={{ fontSize: 22, color: 'white', marginBottom: 8 }}>Candidate Roster</h1>
      <p style={{ fontSize: 13, color: 'var(--color-navy-400)', marginBottom: 24 }}>NEET UG 2026 — Phase I · 2,400,000 candidates</p>

      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-navy-700)', borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto auto', gap: 16, padding: '12px 18px', borderBottom: '2px solid var(--color-navy-700)', fontSize: 11, fontWeight: 600, color: 'var(--color-navy-400)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          <span>Candidate</span><span>Roll Number</span><span>State</span><span>Status</span><span>Anomalies</span>
        </div>
        {MOCK_CANDIDATES.map((c, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto auto', gap: 16, padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.04)', alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'white' }}>{c.name}</span>
            <code style={{ fontSize: 12, color: 'var(--color-navy-300)', background: 'none', padding: 0 }}>{c.roll}</code>
            <span style={{ fontSize: 12, color: 'var(--color-navy-300)' }}>{c.state}</span>
            <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 9999, background: c.status === 'present' ? 'rgba(74,222,128,0.15)' : 'rgba(107,114,128,0.15)', color: c.status === 'present' ? '#4ade80' : '#6b7280' }}>{c.status.toUpperCase()}</span>
            <span style={{ fontSize: 12, color: c.anomalies > 0 ? '#f59e0b' : 'var(--color-navy-400)' }}>{c.anomalies > 0 ? `${c.anomalies}` : '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
