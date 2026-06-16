/**
 * CryptoExam Core — Setter Dashboard
 * Wired to the live backend (/exams, scoped server-side to this setter). KPIs,
 * the exam pipeline and on-chain activity are all DERIVED from the setter's real
 * exams — no fabricated figures.
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { setterApi, EXAM_PIPELINE, type SetterExam } from '@/lib/api/setter';
import styles from './dashboard.module.css';

export default function SetterDashboard() {
  const [exams, setExams] = useState<SetterExam[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setterApi
      .exams()
      .then((r) => setExams(r.items))
      .catch((e) => setError(e.message));
  }, []);

  const byStatus = (exams ?? []).reduce<Record<string, number>>((a, e) => {
    a[e.status] = (a[e.status] ?? 0) + 1;
    return a;
  }, {});
  const anchored = (exams ?? []).filter((e) => e.polygon_exam_tx).length;
  const zkProofs = (exams ?? []).filter((e) => e.zk_proof_hash || e.polygon_zkproof_tx);
  const totalSets = (exams ?? []).reduce((a, e) => a + (e.sets_count ?? 0), 0);
  const statusSummary =
    Object.entries(byStatus)
      .map(([s, n]) => `${n} ${s.toLowerCase()}`)
      .join(', ') || '—';

  const kpis = [
    { label: 'My Exams', value: exams ? String(exams.length) : '…', trend: statusSummary },
    { label: 'Sets Configured', value: exams ? String(totalSets) : '…', trend: 'across all exams' },
    { label: 'ZK Proofs Generated', value: exams ? String(zkProofs.length) : '…', trend: zkProofs.length ? 'verifiable on-chain' : 'none yet' },
    { label: 'Anchored On-Chain', value: exams ? String(anchored) : '…', trend: anchored ? 'Polygon commitments' : 'pending lock' },
  ];

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Setter Dashboard</h1>

      {error && (
        <div style={{ padding: 16, borderRadius: 10, background: '#fef2f2', color: '#991b1b', marginBottom: 20, fontSize: 14 }}>
          Could not load your exams: {error}
        </div>
      )}

      {/* KPI Cards */}
      <div className={styles.kpiGrid}>
        {kpis.map((kpi) => (
          <div key={kpi.label} className={styles.kpiCard}>
            <div className={styles.kpiContent}>
              <span className={styles.kpiValue}>{kpi.value}</span>
              <span className={styles.kpiLabel}>{kpi.label}</span>
              <span className={styles.kpiTrend}>{kpi.trend}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Exam Pipeline */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Exam Pipeline</h2>
          <Link href="/setter/create" className={styles.createBtn}>+ New Exam</Link>
        </div>
        <div className={styles.pipeline}>
          {EXAM_PIPELINE.map((status) => (
            <div key={status} className={styles.pipelineStep}>
              <span className={styles.pipelineDot} />
              <span className={styles.pipelineLabel}>{status.replace('_', ' ')}</span>
            </div>
          ))}
        </div>
        <div className={styles.examList}>
          {exams === null && !error && <p style={{ color: '#9ca3af', fontSize: 14 }}>Loading your exams…</p>}
          {exams !== null && exams.length === 0 && (
            <p style={{ color: '#9ca3af', fontSize: 14 }}>
              No exams yet. <Link href="/setter/create" style={{ color: 'var(--color-india-saffron)' }}>Create your first exam →</Link>
            </p>
          )}
          {(exams ?? []).map((exam) => (
            <div key={exam.id} className={styles.examRow}>
              <div className={styles.examInfo}>
                <span className={styles.examName}>{exam.name}</span>
                <span className={styles.examBody}>{exam.exam_body ?? '—'}</span>
              </div>
              <span className={`${styles.statusPill} ${styles[`pill-${exam.status}`] ?? ''}`}>
                {exam.status}
              </span>
              <span className={styles.examCandidates}>
                {exam.sets_count ?? 0} {exam.sets_count === 1 ? 'set' : 'sets'}
              </span>
              <span className={styles.examDate}>
                {exam.scheduled_at
                  ? new Date(exam.scheduled_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
                  : '—'}
              </span>
              <div className={styles.examActions}>
                <Link href={`/setter/proofs/${exam.id}`} className={styles.actionBtn}>ZK Proof</Link>
                <Link href={`/setter/irt/${exam.id}`} className={styles.actionBtn}>IRT</Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* On-chain activity — derived from the setter's real exams */}
      <div className={styles.activityGrid}>
        <section className={styles.section}>
          <h2>On-Chain Commitments</h2>
          <div className={styles.activityList}>
            {zkProofs.length === 0 && (
              <p style={{ color: '#9ca3af', fontSize: 13, padding: '4px 2px' }}>
                No ZK proofs anchored yet — they appear here once an exam is locked.
              </p>
            )}
            {zkProofs.map((e) => (
              <div key={e.id} className={styles.activityItem}>
                <div>
                  <span className={styles.activityType}>{e.name}</span>
                  <span className={styles.activityTime} style={{ fontFamily: 'var(--font-mono)' }}>
                    {e.polygon_zkproof_tx ? `${e.polygon_zkproof_tx.slice(0, 18)}…` : `hash ${(e.zk_proof_hash ?? '').slice(0, 16)}…`}
                  </span>
                </div>
                <span className={styles.activityStatus}>✓ {e.polygon_zkproof_tx ? 'On-chain' : 'Proven'}</span>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <h2>Recent Exams</h2>
          <div className={styles.activityList}>
            {[...(exams ?? [])]
              .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
              .slice(0, 4)
              .map((e) => (
                <div key={e.id} className={styles.activityItem}>
                  <div>
                    <span className={styles.activityType}>{e.name}</span>
                    <span className={styles.activityTime}>
                      created {e.created_at ? new Date(e.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}
                    </span>
                  </div>
                  <span className={styles.activityMeta}>{e.status}</span>
                </div>
              ))}
            {exams !== null && exams.length === 0 && (
              <p style={{ color: '#9ca3af', fontSize: 13, padding: '4px 2px' }}>Nothing yet.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
