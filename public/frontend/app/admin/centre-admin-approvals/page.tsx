/**
 * CryptoExam Core — System Admin · Centre-Admin Approvals (ZUUP-OS §9.3)
 *
 * The SYSTEM ADMIN approves CENTRE ADMINS who registered on the public website
 * (/staff-registration). This view is wired to the REAL backend
 * (/admin/staff-approvals) — there are no fabricated rows. Approving issues a
 * real one-time, time-boxed activation code (returned once, shown only here,
 * handed over in person). Activation still happens at the centre with the code
 * + a live fingerprint (§9.4) — this screen can never self-activate an identity.
 */
'use client';

import { useEffect, useState } from 'react';
import { adminApi, type StaffApproval } from '@/lib/api/admin';

export default function CentreAdminApprovalsPage() {
  const [pending, setPending] = useState<StaffApproval[]>([]);
  const [codes, setCodes] = useState<Record<string, { code: string; expiresAt: string }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await adminApi.staffApprovals('CENTER_ADMIN');
      setPending(r.pending);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load approvals');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function issueCode(id: string) {
    setBusy(id);
    try {
      const r = await adminApi.issueStaffCode(id);
      setCodes((c) => ({ ...c, [id]: { code: r.code, expiresAt: r.expiresAt } }));
      setPending((p) => p.map((x) => (x.requestId === id ? { ...x, status: 'APPROVED', approvedAt: new Date().toISOString() } : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to issue code');
    } finally {
      setBusy(null);
    }
  }

  async function authoriseFp(id: string) {
    setBusy(id);
    try {
      await adminApi.authoriseStaffFp(id);
      setPending((p) => p.map((x) => (x.requestId === id ? { ...x, fingerprintAuthorised: true } : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to authorise fingerprint');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ animation: 'fadeIn 300ms ease forwards' }}>
      <h1 style={{ fontSize: 22, color: 'var(--color-navy-900)', marginBottom: 8 }}>Centre-Admin Approvals</h1>
      <p style={{ fontSize: 13, color: 'var(--color-navy-500)', marginBottom: 24 }}>
        Tier-0 approval of Centre Admins who registered on the public site (§9.3). Codes are
        one-time, time-boxed, shown only here, and handed over in person — never sent (§9.4).
      </p>

      {error && (
        <div style={{ padding: 16, border: '1px solid rgba(200,32,32,0.35)', background: 'rgba(200,32,32,0.06)', borderRadius: 12, color: 'var(--color-danger)', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--color-navy-500)' }}>Loading pending requests…</p>
      ) : pending.length === 0 ? (
        <div style={{ padding: 24, border: '1px solid var(--border-soft)', borderRadius: 16, background: '#fff', color: 'var(--color-navy-500)' }}>
          No pending Centre-Admin requests. New registrations from{' '}
          <a href="/staff-registration" style={{ color: 'var(--color-info-text)' }}>the public site</a>{' '}
          appear here for approval.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {pending.map((r) => (
            <div
              key={r.requestId}
              style={{
                background: '#fff', border: '1px solid var(--border-soft)',
                borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 16, color: 'var(--color-navy-900)', fontWeight: 600 }}>{r.applicantName}</span>
                <span style={{ fontSize: 13, color: 'var(--color-navy-600)' }}>centre {r.centreName}</span>
                <code style={{ fontSize: 11, color: 'var(--color-navy-400)', background: 'none', padding: 0 }}>
                  id-hash {r.centreIdHash}
                </code>
                <span style={{ fontSize: 12, color: r.fingerprintAuthorised ? 'var(--color-success)' : 'var(--color-warning)' }}>
                  {r.fingerprintAuthorised ? '✓ fingerprint authorised' : 'fingerprint not yet authorised'}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: r.status === 'APPROVED' ? 'rgba(26,122,76,0.12)' : 'rgba(196,122,30,0.12)', color: r.status === 'APPROVED' ? 'var(--color-success)' : 'var(--color-warning)' }}>{r.status}</span>
              </div>

              {codes[r.requestId] && (
                <div
                  style={{
                    display: 'inline-flex', flexDirection: 'column', gap: 4, alignSelf: 'flex-start',
                    padding: '10px 16px', borderRadius: 10, border: '1px dashed #6366f1', background: 'rgba(99,102,241,0.08)',
                  }}
                >
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 22, fontWeight: 700, letterSpacing: '0.12em', color: '#4f46e5' }}>
                    {codes[r.requestId].code}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--color-navy-500)' }}>
                    one-time · single use · expires {new Date(codes[r.requestId].expiresAt).toLocaleTimeString('en-IN')}
                  </span>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button onClick={() => issueCode(r.requestId)} disabled={busy === r.requestId} style={btnPrimary(busy === r.requestId)}>
                  {codes[r.requestId] ? 'Re-issue one-time code' : 'Approve & issue one-time code'}
                </button>
                <button onClick={() => authoriseFp(r.requestId)} disabled={r.fingerprintAuthorised || busy === r.requestId} style={btnGhost(r.fingerprintAuthorised)}>
                  Authorise &amp; bind fingerprint
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p style={{ marginTop: 22, fontSize: 12, color: 'var(--color-navy-500)' }}>
        Final activation happens on the Centre Admin&apos;s own station with the code +
        a re-supplied fingerprint (§9.4). It cannot be done from here.
      </p>
    </div>
  );
}

const btnPrimary = (disabled: boolean): React.CSSProperties => ({
  padding: '10px 16px', borderRadius: 10, border: 'none',
  background: disabled ? '#a5b4fc' : '#4f46e5', color: 'white', fontWeight: 600, fontSize: 13,
  cursor: disabled ? 'not-allowed' : 'pointer',
});
const btnGhost = (disabled: boolean): React.CSSProperties => ({
  padding: '10px 16px', borderRadius: 10, border: '1px solid var(--border-soft)',
  background: 'transparent', color: disabled ? 'var(--color-navy-400)' : 'var(--color-navy-700)',
  fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer',
});
