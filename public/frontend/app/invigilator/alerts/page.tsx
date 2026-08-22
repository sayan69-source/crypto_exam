/**
 * CryptoExam Core — § 29.6 Centre Alerts (Interface D)
 * Mismatches, late arrivals and incidents requiring invigilator action.
 */
'use client';

import { useEffect, useState } from 'react';
import InvigilatorLayout from '@/components/layout/InvigilatorLayout';
import { invigilatorApi, type InvigilatorAlert, type PanicAlert } from '@/lib/api/invigilator';
import styles from '../invigilator.module.css';

const CENTER_ID = 'ctr-001';

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<InvigilatorAlert[]>([]);
  const [panics, setPanics] = useState<PanicAlert[]>([]);

  async function refresh() {
    const [a, p] = await Promise.all([
      invigilatorApi.getAlerts(CENTER_ID),
      invigilatorApi.getPanicAlerts(),
    ]);
    setAlerts(a); setPanics(p);
  }

  useEffect(() => {
    void refresh();
    // Re-sync periodically + when localStorage changes (cross-tab panic alerts)
    const iv = setInterval(refresh, 4000);
    const onStorage = (e: StorageEvent) => { if (e.key === 'cryptoexam_panic_queue') void refresh(); };
    if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
    return () => { clearInterval(iv); if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage); };
  }, []);

  function resolve(id: string) {
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, resolved: true } : a)));
  }

  async function resolvePanic(id: string) {
    await invigilatorApi.resolvePanicAlert(id);
    setPanics((prev) => prev.map((p) => (p.id === id ? { ...p, resolved: true } : p)));
  }

  const openPanics = panics.filter((p) => !p.resolved);
  const resolvedPanics = panics.filter((p) => p.resolved);

  const open = alerts.filter((a) => !a.resolved);
  const resolved = alerts.filter((a) => a.resolved);

  return (
    <InvigilatorLayout>
      <h1 className={styles.pageTitle}>Alerts</h1>
      <p className={styles.pageSub}>{open.length + openPanics.length} open · चेतावनियाँ requiring attention</p>

      {/* V3 §7.3 — Panic alerts (silent candidate distress signals) */}
      {openPanics.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <h3 className={styles.cardTitle} style={{ color: '#C82020' }}>Panic Alerts — Candidate Distress Signals</h3>
          {openPanics.map((p) => (
            <div key={p.id} className={`${styles.alert} ${styles.alertCritical}`}>
              <span className={styles.alertIcon}></span>
              <div style={{ flex: 1 }}>
                <p className={styles.alertTitle}>Seat {p.seatNumber ?? '—'} · Exam: {p.examId}</p>
                <p className={styles.alertMsg}>
                  Candidate triggered the silent panic button via <b>{p.method === 'TOUCH' ? '3-finger hold' : 'Ctrl+Shift+H'}</b>.
                  Visit them immediately. The exam timer continues running.
                </p>
                <p className={styles.alertTime}>{new Date(p.timestamp).toLocaleString('en-IN')}</p>
              </div>
              <button className={styles.btnGhost} style={{ minHeight: 48 }} onClick={() => resolvePanic(p.id)}>Mark Attended</button>
            </div>
          ))}
        </div>
      )}

      {open.length === 0 ? (
        <div className={styles.card}><div className={styles.empty}>✓ No open alerts. Centre is operating normally.</div></div>
      ) : open.map((a) => (
        <div key={a.id} className={`${styles.alert} ${a.severity === 'CRITICAL' ? styles.alertCritical : a.severity === 'WARN' ? styles.alertWarn : styles.alertInfo}`}>
          <span className={styles.alertIcon}>{a.severity === 'CRITICAL' ? '' : a.severity === 'WARN' ? '' : 'ℹ'}</span>
          <div style={{ flex: 1 }}>
            <p className={styles.alertTitle}>{a.type.replace('_', ' ')} — {a.candidate_name}</p>
            <p className={styles.alertMsg}>{a.message}</p>
            <p className={styles.alertTime}>{new Date(a.created_at).toLocaleString('en-IN')}</p>
          </div>
          <button className={styles.btnGhost} style={{ minHeight: 48 }} onClick={() => resolve(a.id)}>Mark Resolved</button>
        </div>
      ))}

      {resolved.length > 0 && (
        <>
          <h3 className={styles.cardTitle} style={{ marginTop: 28 }}>Resolved</h3>
          {resolved.map((a) => (
            <div key={a.id} className={`${styles.alert} ${styles.alertInfo}`} style={{ opacity: 0.6 }}>
              <span className={styles.alertIcon}>✓</span>
              <div><p className={styles.alertTitle}>{a.candidate_name}</p><p className={styles.alertMsg}>{a.message}</p></div>
            </div>
          ))}
        </>
      )}
    </InvigilatorLayout>
  );
}
