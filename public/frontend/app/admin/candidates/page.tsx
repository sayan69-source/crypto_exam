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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<string>('ALL');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    adminApi.candidates()
      .then((r) => { setRows(r.items); setTotal(r.total); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load candidates'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

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
            : `${total} enrolled. Names and roll numbers are personal data under the DPDP Act — this view is audit-logged.`
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

      {!error && (
        <Card flush>
          <Table head={['Candidate', 'Roll number', 'Centre', 'State', 'Enrolment']}>
            {loading && <SkeletonRows rows={6} cols={5} />}

            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: 0, borderBottom: 0 }}>
                  <EmptyState
                    title="No candidates enrolled"
                    hint="Candidates appear here after enrolling on the public site and being synced to a centre."
                  />
                </td>
              </tr>
            )}

            {!loading && visible.map((c) => (
              <tr key={c.id}>
                <td className={cellStrong}>{c.name}</td>
                <td className={cellMono}>
                  {c.rollNumber ?? '—'}{c.setLabel ? ` · Set ${c.setLabel}` : ''}
                </td>
                <td>{c.centreName ?? '—'}</td>
                <td>{c.state ?? '—'}</td>
                <td>
                  <Badge tone={c.enrollmentStatus ? toneForStatus(c.enrollmentStatus) : 'neutral'}>
                    {c.enrollmentStatus ?? 'Not enrolled'}
                  </Badge>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </AdminPage>
  );
}
