/**
 * CryptoExam Core — § 29.6 Candidate Roster (Interface D)
 * Full roster with live verification status + filter.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import InvigilatorLayout from '@/components/layout/InvigilatorLayout';
import { invigilatorApi, type RosterEntry, type VerifyStatus } from '@/lib/api/invigilator';
import styles from '../invigilator.module.css';

const CENTER_ID = 'ctr-001';
const FILTERS: Array<{ key: 'ALL' | VerifyStatus; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'VERIFIED', label: 'Verified' },
  { key: 'MISMATCH', label: 'Mismatch' },
];

function badgeClass(s: VerifyStatus) {
  return s === 'VERIFIED' ? styles.badgeVerified
    : s === 'MISMATCH' ? styles.badgeMismatch
    : s === 'FLAGGED' ? styles.badgeFlagged
    : styles.badgePending;
}

export default function RosterPage() {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [filter, setFilter] = useState<'ALL' | VerifyStatus>('ALL');
  const [q, setQ] = useState('');

  useEffect(() => { invigilatorApi.getRoster({ center_id: CENTER_ID }).then(setRoster); }, []);

  const filtered = useMemo(() => roster.filter((r) =>
    (filter === 'ALL' || r.status === filter) &&
    (q === '' || r.candidate_name.toLowerCase().includes(q.toLowerCase()) || (r.hall_ticket ?? '').toLowerCase().includes(q.toLowerCase()))
  ), [roster, filter, q]);

  return (
    <InvigilatorLayout>
      <h1 className={styles.pageTitle}>Candidate Roster</h1>
      <p className={styles.pageSub}>{roster.length} candidates assigned to this centre · अभ्यर्थी सूची</p>

      <div className={styles.card}>
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className={styles.input} style={{ maxWidth: 280 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / hall ticket" />
          <div style={{ display: 'flex', gap: 8 }}>
            {FILTERS.map((f) => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={filter === f.key ? styles.btnGhost : styles.btnGhost}
                style={filter === f.key ? { borderColor: 'var(--color-navy-600)', color: 'var(--color-navy-800)', minHeight: 44 } : { minHeight: 44 }}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? <div className={styles.empty}>No candidates match.</div> : (
          <table className={styles.table}>
            <thead><tr><th></th><th>Candidate</th><th>Hall Ticket</th><th>Roll Number</th><th>Status</th><th>Verified At</th><th></th></tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.candidate_id}>
                  <td className={styles.rowEmoji}>{r.photo_emoji ?? '🧑'}</td>
                  <td>{r.candidate_name}</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{r.hall_ticket}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{r.roll_number}</td>
                  <td><span className={`${styles.badge} ${badgeClass(r.status)}`}>{r.status}</span></td>
                  <td>{r.verified_at ? new Date(r.verified_at).toLocaleTimeString('en-IN') : '—'}</td>
                  <td>{r.status === 'PENDING' && <Link href={`/invigilator/verify/${CENTER_ID}`} className={styles.btnGhost} style={{ minHeight: 40, padding: '0 14px' }}>Verify →</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </InvigilatorLayout>
  );
}
