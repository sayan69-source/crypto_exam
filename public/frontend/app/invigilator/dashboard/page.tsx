/**
 * CryptoExam Core — § 29.6 Invigilator Dashboard (Interface D)
 * Centre status overview: verification counts, recent activity, quick actions.
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import InvigilatorLayout from '@/components/layout/InvigilatorLayout';
import { invigilatorApi, type CentreStats, type RosterEntry, type InvigilatorAlert } from '@/lib/api/invigilator';
import styles from '../invigilator.module.css';

const CENTER_ID = 'ctr-001';

export default function InvigilatorDashboardPage() {
  const [stats, setStats] = useState<CentreStats | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [alerts, setAlerts] = useState<InvigilatorAlert[]>([]);

  useEffect(() => {
    invigilatorApi.getStats({ center_id: CENTER_ID }).then(setStats);
    invigilatorApi.getRoster({ center_id: CENTER_ID }).then(setRoster);
    invigilatorApi.getAlerts(CENTER_ID).then(setAlerts);
  }, []);

  const recent = [...roster]
    .filter((r) => r.verified_at)
    .sort((a, b) => (b.verified_at! > a.verified_at! ? 1 : -1))
    .slice(0, 6);

  return (
    <InvigilatorLayout>
      <h1 className={styles.pageTitle}>Centre Dashboard</h1>
      <p className={styles.pageSub}>NEET UG 2026 · Session 1 · {new Date().toLocaleString('en-IN')}</p>

      <div className={styles.statsRow}>
        <div className={styles.stat}><div className={styles.statNum}>{stats?.total ?? '—'}</div><div className={styles.statLabel}>Candidates Assigned · कुल</div></div>
        <div className={`${styles.stat} ${styles.statVerified}`}><div className={styles.statNum}>{stats?.verified ?? '—'}</div><div className={styles.statLabel}>Verified · सत्यापित</div></div>
        <div className={`${styles.stat} ${styles.statPending}`}><div className={styles.statNum}>{stats?.pending ?? '—'}</div><div className={styles.statLabel}>Pending · शेष</div></div>
        <div className={`${styles.stat} ${styles.statMismatch}`}><div className={styles.statNum}>{stats?.mismatch ?? '—'}</div><div className={styles.statLabel}>Mismatch · असंगति</div></div>
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <Link href={`/invigilator/verify/${CENTER_ID}`} className={styles.btnPrimary}>Verify Next Candidate · अगला अभ्यर्थी</Link>
        <Link href="/invigilator/roster" className={styles.btnGhost}>Open Roster</Link>
        <Link href="/invigilator/alerts" className={styles.btnGhost}>Alerts ({alerts.filter((a) => !a.resolved).length})</Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 20 }}>
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Recent Verifications</h3>
          {recent.length === 0 ? <div className={styles.empty}>No verifications yet.</div> : (
            <table className={styles.table}>
              <thead><tr><th></th><th>Candidate</th><th>Hall Ticket</th><th>Status</th><th>Time</th></tr></thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.candidate_id}>
                    <td className={styles.rowEmoji}>{(r.candidate_name ?? '?').charAt(0)}</td>
                    <td>{r.candidate_name}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{r.hall_ticket}</td>
                    <td><span className={`${styles.badge} ${r.status === 'VERIFIED' ? styles.badgeVerified : r.status === 'MISMATCH' ? styles.badgeMismatch : styles.badgePending}`}>{r.status}</span></td>
                    <td>{r.verified_at ? new Date(r.verified_at).toLocaleTimeString('en-IN') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Open Alerts</h3>
          {alerts.length === 0 ? <div className={styles.empty}>No alerts. केंद्र सामान्य।</div> : alerts.slice(0, 3).map((a) => (
            <div key={a.id} className={`${styles.alert} ${a.severity === 'CRITICAL' ? styles.alertCritical : a.severity === 'WARN' ? styles.alertWarn : styles.alertInfo}`}>
              <span className={styles.alertIcon}>{a.severity === 'CRITICAL' ? '' : a.severity === 'WARN' ? '' : 'ℹ'}</span>
              <div>
                <p className={styles.alertTitle}>{a.candidate_name}</p>
                <p className={styles.alertMsg}>{a.message}</p>
                <p className={styles.alertTime}>{new Date(a.created_at).toLocaleTimeString('en-IN')}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </InvigilatorLayout>
  );
}
