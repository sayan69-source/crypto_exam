/**
 * CryptoExam Core — Admin Candidate Roster
 * Wired to the live backend (/admin/candidates). No mock data.
 */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminApi, type AdminCandidate } from '@/lib/api/admin';
import {
  AdminPage, PageHeader, Card, Badge, Button, Table, Toolbar, Chip,
  ErrorState, EmptyState, SkeletonRows, toneForStatus, cellMono, cellStrong,
} from '@/components/admin/AdminUI';

export default function AdminCandidatesPage() {
  const [rows, setRows] = useState<AdminCandidate[]>([]);
  const [total, setTotal] = useState(0);
  const [demoCount, setDemoCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<string>('ALL');

  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    adminApi.candidates()
      .then((r) => { setRows(r.items); setTotal(r.total); setDemoCount(r.demoCount ?? 0); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load candidates'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  async function approve(candidateId: string) {
    setBusy((b) => ({ ...b, [candidateId]: true }));
    setActionError(null);
    try {
      await adminApi.approveCandidate(candidateId);
      load();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy((b) => ({ ...b, [candidateId]: false }));
    }
  }

  async function reject(candidateId: string) {
    if (!rejectReason.trim()) { setActionError('Rejection reason is required.'); return; }
    setBusy((b) => ({ ...b, [candidateId]: true }));
    setActionError(null);
    try {
      await adminApi.rejectCandidate(candidateId, rejectReason);
      setRejectTarget(null);
      setRejectReason('');
      load();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy((b) => ({ ...b, [candidateId]: false }));
    }
  }

  // Filter client-side: the roster endpoint returns the page in one shot, and a
  // state filter that needs a round trip would feel worse than one that doesn't.
  const states = useMemo(() => {
    const seen = new Map<string, number>();
    for (const c of rows) {
      const k = c.state ?? 'Unknown';
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const visible = state === 'ALL' ? rows : rows.filter((c) => (c.state ?? 'Unknown') === state);

  return (
    <AdminPage>
      <PageHeader
        eyebrow="Enrolment"
        title="Candidate Roster"
        subtitle={
          loading
            ? 'Loading candidates…'
            : `${total} enrolled${demoCount > 0 ? ` (${demoCount} seeded for demo)` : ''}. Names and roll numbers are personal data under the DPDP Act — this view is audit-logged.`
        }
        actions={<Button onClick={load} disabled={loading}>Refresh</Button>}
      />

      {states.length > 1 && (
        <Toolbar>
          <Chip active={state === 'ALL'} count={rows.length} onClick={() => setState('ALL')}>All states</Chip>
          {states.slice(0, 6).map(([st, n]) => (
            <Chip key={st} active={state === st} count={n} onClick={() => setState(st)}>{st}</Chip>
          ))}
        </Toolbar>
      )}

      {error && <ErrorState message={error} onRetry={load} />}
      {actionError && <ErrorState message={actionError} onRetry={() => setActionError(null)} />}

      {/* Reject reason modal */}
      {rejectTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: 'min(480px,90vw)' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Reject candidate enrolment</h3>
            <p style={{ fontSize: 13, color: '#605d52', margin: '0 0 12px' }}>Provide a clear reason (stored in the audit log and visible to the candidate on request).</p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
              style={{ width: '100%', borderRadius: 8, border: '1px solid #c5c0b1', padding: '10px 12px', fontSize: 13, resize: 'vertical' }}
              placeholder="e.g. Duplicate face descriptor detected - possible impersonation attempt."
            />
            {actionError && <p style={{ color: 'var(--color-danger)', fontSize: 12, marginTop: 6 }}>{actionError}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <Button onClick={() => reject(rejectTarget)} variant="primary" disabled={busy[rejectTarget]}>
                {busy[rejectTarget] ? 'Rejecting…' : 'Confirm Rejection'}
              </Button>
              <Button onClick={() => { setRejectTarget(null); setActionError(null); setRejectReason(''); }} disabled={busy[rejectTarget]}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {!error && (
        <Card flush>
          <Table head={['Candidate', 'Roll & Set', 'Centre', 'State', 'Status', 'Actions']}>
            {loading && <SkeletonRows rows={6} cols={6} />}

            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: 0, borderBottom: 0 }}>
                  <EmptyState
                    title="No candidates enrolled"
                    hint="Candidates appear here after enrolling on the public site and being synced to a centre."
                  />
                </td>
              </tr>
            )}

            {!loading && visible.map((c) => (
              <tr key={c.id}>
                <td className={cellStrong}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span>{c.name}</span>
                    <span style={{ fontSize: 11, color: '#605d52', fontWeight: 400 }}>{c.email || '—'}</span>
                  </div>
                </td>
                <td className={cellMono}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span>{c.rollNumber ?? '—'}{c.setLabel ? ` · Set ${c.setLabel}` : ''}</span>
                    {c.registrationYear && <span style={{ fontSize: 11, color: '#605d52', fontWeight: 400 }}>Reg: {c.registrationYear}</span>}
                  </div>
                </td>
                <td>{c.centreName ?? '—'}</td>
                <td>{c.state ?? '—'}</td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexDirection: 'column', alignItems: 'flex-start' }}>
                    <Badge tone={c.enrollmentStatus ? toneForStatus(c.enrollmentStatus) : 'neutral'}>
                      {c.enrollmentStatus ?? 'Not enrolled'}
                    </Badge>
                    <Badge tone={c.approvalStatus ? toneForStatus(c.approvalStatus) : 'neutral'}>
                      {c.approvalStatus ?? 'No status'}
                    </Badge>
                  </div>
                </td>
                <td>
                  {c.approvalStatus === 'PENDING' && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button onClick={() => approve(c.id)} disabled={busy[c.id]} variant="primary">
                        {busy[c.id] ? '…' : 'Approve'}
                      </Button>
                      <Button onClick={() => setRejectTarget(c.id)} disabled={busy[c.id]}>
                        Reject
                      </Button>
                    </div>
                  )}
                  {c.approvalStatus === 'APPROVED' && <span style={{ color: 'var(--color-success)', fontSize: 13, fontWeight: 500 }}>Approved</span>}
                  {c.approvalStatus === 'REJECTED' && <span style={{ color: 'var(--color-danger)', fontSize: 13, fontWeight: 500 }}>Rejected</span>}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </AdminPage>
  );
}
