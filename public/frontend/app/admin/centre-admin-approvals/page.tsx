/**
 * CryptoExam Core — System Admin · Centre-Admin Approvals (ZUUP-OS §9.3 / §10.4)
 *
 * The Tier-0 mirror of the Centre Admin's invigilator-approval screen: here the
 * SYSTEM ADMIN approves CENTRE ADMINS — one per centre. Each approval issues a
 * one-time, time-boxed code (shown only in this authenticated view, never sent)
 * and an "authorise & bind fingerprint" toggle. Activation itself happens on the
 * Centre Admin's own station with the code + a re-supplied fingerprint (§9.4) —
 * the System Admin can never self-activate an identity.
 *
 * Wired in production to GET/POST /api/v1/sys/approvals/* (§13.5). The backend
 * can't run locally (mock fallback), so this renders against local fixtures with
 * the exact shape the endpoint returns.
 */
'use client';

import { useState } from 'react';

interface PendingCentreAdmin {
  requestId: string;
  applicantName: string;
  centreName: string;
  centreIdHash: string;
  fingerprintAuthorised: boolean;
}

// Mock fixtures — shape matches GET /api/v1/sys/approvals/pending.
const INITIAL: PendingCentreAdmin[] = [
  { requestId: 'req-ca-01', applicantName: 'Priya Menon', centreName: 'DL-IITD', centreIdHash: '9f86d081…b0f00a08', fingerprintAuthorised: false },
  { requestId: 'req-ca-02', applicantName: 'Rahul Verma', centreName: 'MH-VJTI', centreIdHash: '2c624232…1cf5b09f', fingerprintAuthorised: false },
];

function genCode(): string {
  // Mirrors the Edge's Crockford-grouped one-time code (display only here).
  const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';
  const groups = Array.from({ length: 4 }, () =>
    Array.from({ length: 3 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(''),
  );
  return groups.join('-');
}

export default function CentreAdminApprovalsPage() {
  const [pending, setPending] = useState(INITIAL);
  const [codes, setCodes] = useState<Record<string, { code: string; expiresAt: number }>>({});

  function issueCode(id: string) {
    setCodes((c) => ({ ...c, [id]: { code: genCode(), expiresAt: Date.now() + 10 * 60_000 } }));
  }
  function authoriseFp(id: string) {
    setPending((p) => p.map((r) => (r.requestId === id ? { ...r, fingerprintAuthorised: true } : r)));
  }

  return (
    <div style={{ animation: 'fadeIn 300ms ease forwards' }}>
      <h1 style={{ fontSize: 22, color: 'white', marginBottom: 8 }}>🛡️ Centre-Admin Approvals</h1>
      <p style={{ fontSize: 13, color: 'var(--color-navy-400)', marginBottom: 24 }}>
        Tier-0 approval of Centre Admins — one per centre (§9.3). Codes are one-time,
        time-boxed, shown only here, and handed over in person — never sent (§9.4).
      </p>

      {pending.length === 0 ? (
        <p style={{ color: 'var(--color-navy-400)' }}>No pending Centre-Admin requests. ✓</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {pending.map((r) => (
            <div
              key={r.requestId}
              style={{
                background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-navy-700)',
                borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 16, color: 'white', fontWeight: 600 }}>{r.applicantName}</span>
                <span style={{ fontSize: 13, color: 'var(--color-navy-300)' }}>centre {r.centreName}</span>
                <code style={{ fontSize: 11, color: 'var(--color-navy-400)', background: 'none', padding: 0 }}>
                  id-hash {r.centreIdHash}
                </code>
                <span style={{ fontSize: 12, color: r.fingerprintAuthorised ? '#4ade80' : '#fbbf24' }}>
                  {r.fingerprintAuthorised ? '✓ fingerprint authorised' : 'fingerprint not yet authorised'}
                </span>
              </div>

              {codes[r.requestId] && (
                <div
                  style={{
                    display: 'inline-flex', flexDirection: 'column', gap: 4, alignSelf: 'flex-start',
                    padding: '10px 16px', borderRadius: 10, border: '1px dashed #6366f1', background: 'rgba(99,102,241,0.1)',
                  }}
                >
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 22, fontWeight: 700, letterSpacing: '0.12em', color: '#a5b4fc' }}>
                    {codes[r.requestId].code}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--color-navy-400)' }}>one-time · single use · expires in 10:00</span>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button onClick={() => issueCode(r.requestId)} style={btnPrimary}>
                  {codes[r.requestId] ? 'Re-issue one-time code' : 'Issue one-time code'}
                </button>
                <button onClick={() => authoriseFp(r.requestId)} disabled={r.fingerprintAuthorised} style={btnGhost(r.fingerprintAuthorised)}>
                  Authorise &amp; bind fingerprint
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p style={{ marginTop: 22, fontSize: 12, color: 'var(--color-navy-500)' }}>
        Final activation happens on the Centre Admin&apos;s own station with the code +
        a re-supplied fingerprint (§9.4). It cannot be done from here. INV-7 enforces
        a single ACTIVE Centre Admin per centre at the data layer.
      </p>
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: '10px 16px', borderRadius: 10, border: 'none',
  background: '#4f46e5', color: 'white', fontWeight: 600, fontSize: 13, cursor: 'pointer',
};
const btnGhost = (disabled: boolean): React.CSSProperties => ({
  padding: '10px 16px', borderRadius: 10, border: '1px solid var(--color-navy-700)',
  background: 'transparent', color: disabled ? 'var(--color-navy-500)' : 'var(--color-navy-200)',
  fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer',
});
