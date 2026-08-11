/**
 * CryptoExam Core — System Admin (tier-0) console.
 *
 * Tier-0 has exactly two jobs, and both are here:
 *
 *   1. Approve Centre Admins. No other role can — a tier-1 administrator
 *      attempting it gets 403 SYSTEM_ADMIN_REQUIRED.
 *   2. Hold the answer-decryption authority: verify a centre's sync bundle,
 *      HSM-decrypt it, and anchor the answer root on-chain.
 *
 * Invigilators are deliberately NOT approvable here — they belong to their own
 * Centre Admin, whose console runs inside the locked OS on the centre LAN.
 * The page says so, because "where do I approve invigilators?" is the first
 * question an operator asks.
 *
 * The approvals list polls, because a registration made on the public site
 * while this page is open must appear without a manual reload.
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { adminApi, type StaffApproval } from '@/lib/api/admin';
import { sysLedgerApi } from '@/lib/api/sys-ledger';
import {
  AdminPage, PageHeader, Card, CardGrid, Stat, Badge, Button, Table,
  ErrorState, EmptyState, SkeletonRows, cellMono, cellStrong,
} from '@/components/admin/AdminUI';

const POLL_MS = 15_000;

export default function SysAdminConsolePage() {
  const [rows, setRows] = useState<StaffApproval[]>([]);
  const [counts, setCounts] = useState<{ centres: number; live: number; candidates: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const first = useRef(true);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [approvals, dash] = await Promise.all([
        adminApi.staffApprovals('CENTER_ADMIN'),
        adminApi.dashboard().catch(() => null),
      ]);
      setRows(approvals.pending);
      if (dash) {
        setCounts({
          centres: dash.hardware_nodes?.total ?? 0,
          live: dash.exams?.LIVE ?? 0,
          candidates: dash.total_enrollments ?? 0,
        });
      }
      setLastSync(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the tier-0 console');
    } finally {
      setLoading(false);
      first.current = false;
    }
  }, []);

  // Poll so a registration made while this page is open shows up on its own.
  useEffect(() => {
    load();
    const t = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  async function approve(id: string) {
    setBusy(id);
    try {
      const r = await adminApi.issueStaffCode(id);
      // Shown exactly once — only its hash is stored.
      setIssued((m) => ({ ...m, [id]: r.code }));
      load(true);
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
        title="System Administration"
        subtitle={
          loading && first.current
            ? 'Loading…'
            : `${rows.length} pending · approval issues a one-time activation code, redeemed in person at the centre`
        }
        actions={
          <>
            {lastSync && (
              <span style={{ fontSize: 11.5, color: 'var(--color-navy-400)' }}>
                updated {lastSync.toLocaleTimeString('en-IN', { hour12: false })}
              </span>
            )}
            <Button onClick={() => load()} disabled={loading}>Refresh</Button>
          </>
        }
      />

      {error && <ErrorState message={error} onRetry={() => load()} />}

      {counts && (
        <div style={{ marginBottom: 'var(--space-xl)' }}>
          <CardGrid minColumn={200}>
            <Stat label="Pending approvals" value={rows.length} />
            <Stat label="Exams live" value={counts.live} />
            <Stat label="Enrolments" value={counts.candidates} />
            <Stat label="Terminals" value={counts.centres} />
          </CardGrid>
        </div>
      )}

      {!error && (
        <Card flush>
          <Table head={['Applicant', 'Centre', 'Centre id', 'Registered', 'Status', '']}>
            {loading && first.current && <SkeletonRows rows={3} cols={6} />}

            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: 0, borderBottom: 0 }}>
                  <EmptyState
                    title="No Centre Admin registrations pending"
                    hint="Applications made on the public site appear here automatically."
                  />
                </td>
              </tr>
            )}

            {rows.map((r) => (
              <tr key={r.requestId}>
                <td className={cellStrong}>{r.applicantName}</td>
                <td>{r.centreName ?? '—'}</td>
                <td className={cellMono}>{(r.centreIdHash ?? '').slice(0, 16)}…</td>
                <td>{r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-IN') : '—'}</td>
                <td><Badge tone={r.status === 'PENDING' ? 'warn' : 'ok'} dot>{r.status}</Badge></td>
                <td style={{ textAlign: 'right' }}>
                  {issued[r.requestId] ? (
                    <span title="Give this to the applicant. It is shown once.">
                      <code style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em' }}>
                        {issued[r.requestId]}
                      </code>
                    </span>
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
        <AnswerVault />
      </div>

      {/* One line of scope, not a lecture. The reader is the root of trust for
          the estate and knows the architecture; the only useful fact is where
          the other queue lives. */}
      <p style={{ marginTop: 'var(--space-lg)', fontSize: 12.5, color: 'var(--color-navy-400)' }}>
        Scope: Centre Admins only. Invigilator approvals are held by each Centre Admin on
        the centre LAN. <Link href="/center-access" style={{ color: 'var(--color-navy-600)' }}>Reference</Link>
      </p>
    </AdminPage>
  );
}

/**
 * The authority that makes this tier tier-0.
 *
 * A centre exports a signed, ciphertext-only bundle. Verification re-walks the
 * hash chain; decryption unwraps the data keys — the only place a plaintext
 * answer ever exists. Both endpoints were gated on ADMIN until now, meaning a
 * tier-1 operations administrator could read answers and this tier could not.
 */
function AnswerVault() {
  const [bundle, setBundle] = useState('');
  const [busy, setBusy] = useState<'verify' | 'decrypt' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(mode: 'verify' | 'decrypt') {
    setBusy(mode);
    setResult(null);
    try {
      const parsed = JSON.parse(bundle);
      if (mode === 'verify') {
        const r = await sysLedgerApi.ingest(parsed);
        setResult({
          ok: true,
          text: `Bundle verified. ${r.records ?? r.count ?? 0} record(s), chain intact, node signature valid against the key registered for this centre.`,
        });
      } else {
        const r = await sysLedgerApi.decrypt(parsed);
        const q = r.quarantined?.length ?? 0;
        setResult({
          ok: true,
          text: `Decrypted ${r.decrypted ?? 0} record(s). ${q ? `${q} quarantined — inspect them.` : 'None quarantined.'}`,
        });
      }
    } catch (e) {
      setResult({
        ok: false,
        text: e instanceof SyntaxError
          ? 'That is not valid JSON. Paste the whole bundle exported by the centre.'
          : e instanceof Error ? e.message : 'Failed.',
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title="Answer Vault — tier-0 only">
      <p style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--color-navy-500)', margin: '0 0 14px' }}>
        Verify re-walks the chain and checks the node signature against the registered centre
        key. Decrypt unwraps the data keys.
      </p>
      <textarea
        value={bundle}
        onChange={(e) => setBundle(e.target.value)}
        placeholder='{"manifest": {...}, "manifestHash": "...", "nodeSig": "...", "nodePubkey": "..."}'
        rows={6}
        style={{
          width: '100%', padding: 12, borderRadius: 9,
          border: '1px solid var(--border-soft)', fontFamily: 'var(--font-mono)',
          fontSize: 12, lineHeight: 1.5, resize: 'vertical',
        }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <Button onClick={() => run('verify')} disabled={!bundle.trim() || busy !== null}>
          {busy === 'verify' ? 'Verifying…' : 'Verify bundle'}
        </Button>
        <Button variant="primary" onClick={() => run('decrypt')} disabled={!bundle.trim() || busy !== null}>
          {busy === 'decrypt' ? 'Decrypting…' : 'Verify & decrypt'}
        </Button>
      </div>
      {result && (
        <p
          role="status"
          style={{
            marginTop: 14, padding: '12px 14px', borderRadius: 9, fontSize: 13, lineHeight: 1.6,
            border: `1px solid ${result.ok ? 'rgba(5,150,105,0.35)' : 'rgba(200,32,32,0.35)'}`,
            background: result.ok ? 'rgba(5,150,105,0.07)' : 'rgba(200,32,32,0.06)',
            color: result.ok ? '#047857' : '#b91c1c',
          }}
        >
          {result.text}
        </p>
      )}
    </Card>
  );
}
