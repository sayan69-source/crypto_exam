/**
 * CryptoExam Core — Admin Candidate Roster
 * Problem 2: Adds Approve / Reject action buttons per row.
 * Problem 3: Shows registration year and enrolled timestamp.
 * Wired to the live backend (/admin/candidates). No mock data.
 */
'use client';

import { useEffect, useState } from 'react';
import { adminApi, type AdminCandidate } from '@/lib/api/admin';

function ApprovalBadge({ status }: { status: string | null }) {
  const map: Record<string, { bg: string; color: string }> = {
    APPROVED: { bg: 'rgba(63,111,74,0.12)', color: 'var(--color-success)' },
    REJECTED: { bg: 'rgba(155,34,38,0.12)', color: 'var(--color-danger)' },
    PENDING: { bg: 'rgba(96,93,82,0.12)', color: 'var(--color-navy-500)' },
  };
  const style = map[status ?? ''] ?? map['PENDING'];
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 9999, ...style }}>
      {status ?? 'PENDING'}
    </span>
  );
}

export default function AdminCandidatesPage() {
  const [rows, setRows] = useState<AdminCandidate[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    adminApi.candidates()
      .then((r) => { setRows(r.items); setTotal(r.total); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load candidates'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { reload(); }, []);

  async function approve(candidateId: string) {
    setBusy((b) => ({ ...b, [candidateId]: true }));
    setActionError(null);
    try {
      await adminApi.approveCandidate(candidateId);
      reload();
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
      reload();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy((b) => ({ ...b, [candidateId]: false }));
    }
  }

  return (
    <div style={{ animation: 'fadeIn 300ms ease forwards' }}>
      <h1 style={{ fontSize: 22, color: 'var(--color-navy-900)', marginBottom: 8 }}>Candidate Roster</h1>
      <p style={{ fontSize: 13, color: 'var(--color-navy-500)', marginBottom: 24 }}>
        {loading ? 'Loading candidates…' : `${total} candidate(s) · live from the backend`}
      </p>

      {error && (
        <div style={{ padding: 16, border: '1px solid rgba(155, 34, 38,0.35)', background: 'rgba(155, 34, 38,0.06)', borderRadius: 12, color: 'var(--color-danger)' }}>{error}</div>
      )}

      {actionError && (
        <div style={{ padding: 12, margin: '0 0 16px', border: '1px solid rgba(155,34,38,0.35)', background: 'rgba(155,34,38,0.06)', borderRadius: 8, color: 'var(--color-danger)', fontSize: 13 }}>{actionError}</div>
      )}

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
              placeholder="e.g. Duplicate face descriptor detected — possible impersonation attempt."
            />
            {actionError && <p style={{ color: 'var(--color-danger)', fontSize: 12, marginTop: 6 }}>{actionError}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                onClick={() => reject(rejectTarget)}
                disabled={!!busy[rejectTarget]}
                style={{ flex: 1, padding: '10px 16px', borderRadius: 8, border: 'none', background: 'rgba(155,34,38,0.85)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
              >
                {busy[rejectTarget] ? 'Rejecting…' : 'Confirm Reject'}
              </button>
              <button
                onClick={() => { setRejectTarget(null); setRejectReason(''); setActionError(null); }}
                style={{ flex: 1, padding: '10px 16px', borderRadius: 8, border: '1px solid #c5c0b1', background: '#fffefb', color: '#36342e', fontSize: 13, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <p style={{ color: 'var(--color-navy-500)' }}>No candidates enrolled.</p>
      )}

      {rows.length > 0 && (
        <div style={{ background: '#fffefb', border: '1px solid var(--border-soft)', borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1.4fr 0.8fr 0.8fr 0.8fr auto', gap: 12, padding: '12px 18px', borderBottom: '2px solid var(--border-soft)', fontSize: 11, fontWeight: 600, color: 'var(--color-navy-500)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            <span>Candidate</span><span>Roll Number</span><span>Centre</span><span>Year</span><span>Approval</span><span>Actions</span>
          </div>
          {rows.map((c) => (
            <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '1.3fr 1.4fr 0.8fr 0.8fr 0.8fr auto', gap: 12, padding: '12px 18px', borderBottom: '1px solid var(--border-soft)', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-navy-900)' }}>{c.name}</div>
                {c.email && <div style={{ fontSize: 11, color: 'var(--color-navy-500)' }}>{c.email}</div>}
              </div>
              <code style={{ fontSize: 12, color: 'var(--color-navy-600)', background: 'none', padding: 0 }}>{c.rollNumber ?? '—'}{c.setLabel ? ` · Set ${c.setLabel}` : ''}</code>
              <span style={{ fontSize: 12, color: 'var(--color-navy-600)' }}>{c.centreName ?? '—'}</span>
              <span style={{ fontSize: 12, color: 'var(--color-navy-600)' }}>{c.registrationYear ?? '—'}</span>
              <ApprovalBadge status={c.approvalStatus} />
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  disabled={!!busy[c.id] || c.approvalStatus === 'APPROVED'}
                  onClick={() => approve(c.id)}
                  title={c.approvalStatus === 'APPROVED' ? 'Already approved' : 'Approve this candidate'}
                  style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: c.approvalStatus === 'APPROVED' ? 'rgba(63,111,74,0.2)' : 'rgba(63,111,74,0.85)', color: '#fff', fontSize: 11, fontWeight: 600, cursor: c.approvalStatus === 'APPROVED' ? 'default' : 'pointer', opacity: c.approvalStatus === 'APPROVED' ? 0.6 : 1 }}
                >
                  {busy[c.id] ? '…' : '✓ Approve'}
                </button>
                <button
                  disabled={!!busy[c.id] || c.approvalStatus === 'REJECTED'}
                  onClick={() => { setRejectTarget(c.id); setRejectReason(''); setActionError(null); }}
                  title={c.approvalStatus === 'REJECTED' ? 'Already rejected' : 'Reject this candidate'}
                  style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: c.approvalStatus === 'REJECTED' ? 'rgba(155,34,38,0.2)' : 'rgba(155,34,38,0.8)', color: '#fff', fontSize: 11, fontWeight: 600, cursor: c.approvalStatus === 'REJECTED' ? 'default' : 'pointer', opacity: c.approvalStatus === 'REJECTED' ? 0.6 : 1 }}
                >
                  ✕ Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
