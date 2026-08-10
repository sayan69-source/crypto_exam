/**
 * CryptoExam Core — System Admin (tier-0) console.
 *
 * The only tier that may approve a Centre Admin. Invigilators are deliberately
 * NOT approvable here: they belong to their own Centre Admin, whose console
 * runs inside the locked OS on the centre LAN. This page says so rather than
 * silently omitting them, because "where do I approve invigilators?" is the
 * first question an operator asks.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { adminApi, type StaffApproval } from '@/lib/api/admin';
import {
  AdminPage, PageHeader, Card, Badge, Button, Table,
  ErrorState, EmptyState, SkeletonRows, cellMono, cellStrong,
} from '@/components/admin/AdminUI';

export default function SysAdminConsolePage() {
  const [rows, setRows] = useState<StaffApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    adminApi.staffApprovals('CENTER_ADMIN')
      .then((r) => setRows(r.pending))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load approvals'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  async function approve(id: string) {
    setBusy(id);
    try {
      const r = await adminApi.issueStaffCode(id);
      // Shown exactly once — it is never stored in clear, only its hash.
      setIssued((m) => ({ ...m, [id]: r.code }));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not issue the code');
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminPage>
      <PageHeader
        eyebrow="Tier 0 · root of trust"
        title="Centre Admin Approvals"
        subtitle={
          loading
            ? 'Loading pending registrations…'
            : `${rows.length} Centre Admin registration(s) awaiting tier-0 approval. Approving issues a one-time code the applicant redeems IN PERSON at the centre — a web approval alone never creates an active identity.`
        }
        actions={<Button onClick={load} disabled={loading}>Refresh</Button>}
      />

      {error && <ErrorState message={error} onRetry={load} />}

      {!error && (
        <Card flush>
          <Table head={['Applicant', 'Centre', 'Centre id', 'Registered', 'Status', '']}>
            {loading && <SkeletonRows rows={3} cols={6} />}

            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: 0, borderBottom: 0 }}>
                  <EmptyState
                    title="No Centre Admin registrations pending"
                    hint="Applications made on the public site appear here for tier-0 approval."
                  />
                </td>
              </tr>
            )}

            {!loading && rows.map((r) => (
              <tr key={r.requestId}>
                <td className={cellStrong}>{r.applicantName}</td>
                <td>{r.centreName ?? '—'}</td>
                <td className={cellMono}>{(r.centreIdHash ?? '').slice(0, 16)}…</td>
                <td>{r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-IN') : '—'}</td>
                <td><Badge tone={r.status === 'PENDING' ? 'warn' : 'ok'} dot>{r.status}</Badge></td>
                <td style={{ textAlign: 'right' }}>
                  {issued[r.requestId] ? (
                    <code style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em' }}>{issued[r.requestId]}</code>
                  ) : (
                    <Button variant="primary" disabled={busy === r.requestId} onClick={() => approve(r.requestId)}>
                      {busy === r.requestId ? 'Issuing…' : 'Approve'}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <div style={{ marginTop: 'var(--space-xl)' }}>
        <Card title="Looking for invigilator approvals?">
          <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--color-navy-600)', margin: 0 }}>
            They are not here, and that is deliberate. An invigilator is approved by{' '}
            <strong>their own Centre Admin</strong>, from the Centre Admin console that runs
            inside the locked OS on the centre LAN — a network with no route to this site.
            Their registration reaches that centre in the provisioning bundle
            (<code>POST /api/v1/provisioning/sync/&#123;centre&#125;</code>), and the approval,
            the one-time code and the in-person fingerprint enrolment all happen there.{' '}
            <Link href="/center-access">How centre access works</Link>.
          </p>
        </Card>
      </div>
    </AdminPage>
  );
}
