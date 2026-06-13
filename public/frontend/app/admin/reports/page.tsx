/**
 * CryptoExam Core — Admin Reports & Analytics
 * Wired to live data: Overview + System Health from /admin/dashboard,
 * DPDP Audit from /admin/audit/dpdp. No fabricated figures.
 */
'use client';

import { useEffect, useState } from 'react';
import { adminApi, type AdminDashboard, type DpdpLog } from '@/lib/api/admin';

const TABS = ['Overview', 'System Health', 'DPDP Audit'] as const;
type Tab = typeof TABS[number];

const HEALTH_OK = new Set(['healthy', 'connected', 'up', 'ready']);

export default function AdminReportsPage() {
  const [tab, setTab] = useState<Tab>('Overview');
  const [dash, setDash] = useState<AdminDashboard | null>(null);
  const [logs, setLogs] = useState<DpdpLog[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [d, a] = await Promise.all([
          adminApi.dashboard(),
          adminApi.dpdpAudit().catch(() => ({ items: [] as DpdpLog[], total: 0, page: 1, per_page: 0 })),
        ]);
        if (!alive) return;
        setDash(d);
        setLogs(a.items);
        setAuditTotal(a.total);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load reports');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const totalExams = dash ? Object.values(dash.exams).reduce((a, b) => a + b, 0) : 0;
  const completed = dash?.exams.COMPLETED ?? 0;
  const completionRate = totalExams ? ((completed / totalExams) * 100).toFixed(1) : '—';

  return (
    <div style={{ animation: 'fadeIn 300ms ease forwards' }}>
      <h1 style={{ fontSize: 22, color: 'var(--color-navy-900)', marginBottom: 8 }}>Reports &amp; Analytics</h1>
      <p style={{ fontSize: 13, color: 'var(--color-navy-500)', marginBottom: 20 }}>
        {loading ? 'Loading live metrics…' : 'Live from the backend.'}
      </p>

      {error && (
        <div style={{ padding: 16, border: '1px solid rgba(200,32,32,0.35)', background: 'rgba(200,32,32,0.06)', borderRadius: 12, color: 'var(--color-danger)', marginBottom: 16 }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: 'var(--color-navy-50)', padding: 4, borderRadius: 12 }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: '8px 16px', fontSize: 13, fontWeight: tab === t ? 600 : 400, fontFamily: 'var(--font-sans)', border: 'none', borderRadius: 8, cursor: 'pointer', background: tab === t ? 'var(--color-navy-600)' : 'transparent', color: tab === t ? 'white' : 'var(--color-navy-600)', transition: 'all 150ms ease' }}>{t}</button>
        ))}
      </div>

      {tab === 'Overview' && dash && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {[
            { label: 'Exams (total)', value: String(totalExams), sub: `${dash.exams.LIVE ?? 0} live · ${completed} completed` },
            { label: 'Completion Rate', value: `${completionRate}%`, sub: `${completed}/${totalExams} reached COMPLETED` },
            { label: 'Total Enrollments', value: dash.total_enrollments.toLocaleString(), sub: `${dash.users.CANDIDATE ?? 0} candidates registered` },
            { label: 'Active Sessions', value: dash.active_sessions.toLocaleString(), sub: `${dash.hardware_nodes.online}/${dash.hardware_nodes.total} nodes online` },
          ].map((stat) => (
            <div key={stat.label} style={card}>
              <span style={cardLabel}>{stat.label}</span>
              <span style={cardValue}>{stat.value}</span>
              <span style={cardSub}>{stat.sub}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'System Health' && dash && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {Object.entries(dash.system_health).map(([component, state]) => (
            <div key={component} style={card}>
              <span style={cardLabel}>{component}</span>
              <span style={{ ...cardValue, color: HEALTH_OK.has(state) ? 'var(--color-success)' : 'var(--color-warning)' }}>{state}</span>
              <span style={cardSub}>{HEALTH_OK.has(state) ? 'Operational' : 'Needs attention'}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'DPDP Audit' && (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-soft)', fontSize: 13, color: 'var(--color-navy-600)' }}>
            DPDP Act 2023 audit trail · {auditTotal} record(s)
          </div>
          {logs.length === 0 ? (
            <div style={{ padding: 20, color: 'var(--color-navy-500)', fontSize: 13 }}>No audit events recorded yet.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--color-navy-500)' }}>
                  <th style={th}>Time</th><th style={th}>Action</th><th style={th}>Resource</th><th style={th}>IP</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} style={{ borderTop: '1px solid var(--border-soft)' }}>
                    <td style={td}>{new Date(l.created_at).toLocaleString('en-IN')}</td>
                    <td style={{ ...td, fontWeight: 600, color: 'var(--color-navy-800)' }}>{l.action}</td>
                    <td style={td}>{l.resource_type ?? '—'}{l.resource_id ? ` · ${l.resource_id.slice(0, 8)}` : ''}</td>
                    <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>{l.ip_address ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

const card: React.CSSProperties = { background: '#fff', border: '1px solid var(--border-soft)', borderRadius: 12, padding: 20 };
const cardLabel: React.CSSProperties = { fontSize: 12, color: 'var(--color-navy-500)', display: 'block' };
const cardValue: React.CSSProperties = { fontSize: 28, fontWeight: 700, color: 'var(--color-navy-900)', fontFamily: 'var(--font-mono)', display: 'block', marginTop: 4 };
const cardSub: React.CSSProperties = { fontSize: 11, color: 'var(--color-navy-400)', marginTop: 4, display: 'block' };
const th: React.CSSProperties = { padding: '10px 16px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '10px 16px', color: 'var(--color-navy-600)' };
