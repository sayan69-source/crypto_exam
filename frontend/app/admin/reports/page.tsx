'use client';

import { useState } from 'react';

const TABS = ['Performance', 'Security', 'Health', 'Blockchain', 'DPDP'];

export default function AdminReportsPage() {
  const [activeTab, setActiveTab] = useState('Performance');

  return (
    <div style={{ animation: 'fadeIn 300ms ease forwards' }}>
      <h1 style={{ fontSize: 22, color: 'white', marginBottom: 24 }}>📊 Reports & Analytics</h1>

      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: 'rgba(255,255,255,0.04)', padding: 4, borderRadius: 12 }}>
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{ flex: 1, padding: '8px 16px', fontSize: 13, fontWeight: activeTab === tab ? 600 : 400, fontFamily: 'var(--font-sans)', border: 'none', borderRadius: 8, cursor: 'pointer', background: activeTab === tab ? 'var(--color-navy-600)' : 'transparent', color: activeTab === tab ? 'white' : 'var(--color-navy-300)', transition: 'all 150ms ease' }}>{tab}</button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {[
          { label: 'Completion Rate', value: '98.2%', trend: '↑ 0.3% from last cycle' },
          { label: 'Avg. Answer Time', value: '2m 14s', trend: '↓ 8s improvement' },
          { label: 'Anomaly Rate', value: '0.13%', trend: '↓ 0.02% (better)' },
          { label: 'Blockchain Commits', value: '5/5', trend: 'All verified ✅' },
        ].map(stat => (
          <div key={stat.label} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-navy-700)', borderRadius: 12, padding: 20 }}>
            <span style={{ fontSize: 12, color: 'var(--color-navy-400)', display: 'block' }}>{stat.label}</span>
            <span style={{ fontSize: 28, fontWeight: 700, color: 'white', fontFamily: 'var(--font-mono)', display: 'block', marginTop: 4 }}>{stat.value}</span>
            <span style={{ fontSize: 11, color: 'var(--color-navy-400)', marginTop: 4, display: 'block' }}>{stat.trend}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
