/**
 * CryptoExam Core — Admin Candidate Roster
 * Wired to the live backend (/admin/candidates). No mock data.
 */
'use client';

import { useEffect, useState } from 'react';
import { adminApi, type AdminCandidate } from '@/lib/api/admin';

export default function AdminCandidatesPage() {
  const [rows, setRows] = useState<AdminCandidate[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    adminApi.candidates()
      .then((r) => { if (alive) { setRows(r.items); setTotal(r.total); } })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Failed to load candidates'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <div style={{ animation: 'fadeIn 300ms ease forwards' }}>
      <h1 style={{ fontSize: 22, color: 'var(--color-navy-900)', marginBottom: 8 }}>Candidate Roster</h1>
      <p style={{ fontSize: 13, color: 'var(--color-navy-500)', marginBottom: 24 }}>
        {loading ? 'Loading candidates…' : `${total} candidate(s) · live from the backend`}
      </p>

      {error && (
        <div style={{ padding: 16, border: '1px solid rgba(200,32,32,0.35)', background: 'rgba(200,32,32,0.06)', borderRadius: 12, color: 'var(--color-danger)' }}>{error}</div>
      )}

      {!loading && !error && rows.length === 0 && (
        <p style={{ color: 'var(--color-navy-500)' }}>No candidates enrolled.</p>
      )}

      {rows.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid var(--border-soft)', borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1.4fr 1fr 1fr auto', gap: 16, padding: '12px 18px', borderBottom: '2px solid var(--border-soft)', fontSize: 11, fontWeight: 600, color: 'var(--color-navy-500)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            <span>Candidate</span><span>Roll Number</span><span>Centre</span><span>State</span><span>Status</span>
          </div>
          {rows.map((c) => (
            <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '1.3fr 1.4fr 1fr 1fr auto', gap: 16, padding: '12px 18px', borderBottom: '1px solid var(--border-soft)', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-navy-900)' }}>{c.name}</span>
              <code style={{ fontSize: 12, color: 'var(--color-navy-600)', background: 'none', padding: 0 }}>{c.rollNumber ?? '—'}{c.setLabel ? ` · Set ${c.setLabel}` : ''}</code>
              <span style={{ fontSize: 12, color: 'var(--color-navy-600)' }}>{c.centreName ?? '—'}</span>
              <span style={{ fontSize: 12, color: 'var(--color-navy-600)' }}>{c.state ?? '—'}</span>
              <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 9999, background: c.enrollmentStatus ? 'rgba(26,122,76,0.12)' : 'rgba(107,114,128,0.12)', color: c.enrollmentStatus ? 'var(--color-success)' : 'var(--color-navy-500)' }}>
                {c.enrollmentStatus ?? 'NOT ENROLLED'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
