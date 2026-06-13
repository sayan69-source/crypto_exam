/**
 * CryptoExam Core — Setter Dashboard
 * Dark sidebar layout, 4 KPI cards, exam pipeline
 */
'use client';

import Link from 'next/link';
import { mockExams, mockBlockchainEvents } from '@/lib/api/mock-data';
import styles from './dashboard.module.css';

const STATUS_PIPELINE = ['DRAFT', 'GENERATING', 'PROOF_PENDING', 'LOCKED', 'DISTRIBUTED', 'LIVE', 'COMPLETED', 'AUDITED'];

export default function SetterDashboard() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Setter Dashboard</h1>

      {/* KPI Cards */}
      <div className={styles.kpiGrid}>
        {[
          { label: 'Questions in Bank', value: '2,847', icon: '', trend: '+124 this week' },
          { label: 'Exams This Cycle', value: '3', icon: '', trend: '1 live, 1 locked' },
          { label: 'ZK Proofs Generated', value: '7', icon: '', trend: 'All verified ✓' },
          { label: 'Avg IRT Accuracy', value: '97.3%', icon: '', trend: '↑ 2.1% from last' },
        ].map(kpi => (
          <div key={kpi.label} className={styles.kpiCard}>
            <span className={styles.kpiIcon}>{kpi.icon}</span>
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
          {STATUS_PIPELINE.map(status => (
            <div key={status} className={styles.pipelineStep}>
              <span className={styles.pipelineDot} />
              <span className={styles.pipelineLabel}>{status.replace('_', ' ')}</span>
            </div>
          ))}
        </div>
        <div className={styles.examList}>
          {mockExams.map(exam => (
            <div key={exam.id} className={styles.examRow}>
              <div className={styles.examInfo}>
                <span className={styles.examName}>{exam.name}</span>
                <span className={styles.examBody}>{exam.exam_body}</span>
              </div>
              <span className={`${styles.statusPill} ${styles[`pill-${exam.status}`]}`}>
                {exam.status}
              </span>
              <span className={styles.examCandidates}>
                {exam.candidate_count?.toLocaleString('en-IN')} candidates
              </span>
              <span className={styles.examDate}>
                {new Date(exam.scheduled_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
              </span>
              <div className={styles.examActions}>
                <Link href={`/setter/proofs/${exam.id}`} className={styles.actionBtn}>ZK Proof</Link>
                <Link href={`/setter/irt/${exam.id}`} className={styles.actionBtn}>IRT</Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Recent Activity */}
      <div className={styles.activityGrid}>
        <section className={styles.section}>
          <h2>Recent ZK Proofs</h2>
          <div className={styles.activityList}>
            {mockBlockchainEvents.filter(e => e.type === 'ZKProofSubmitted' || e.type === 'PaperLocked').map(ev => (
              <div key={ev.tx_hash} className={styles.activityItem}>
                <span className={styles.activityIcon}>{ev.type === 'ZKProofSubmitted' ? '' : ''}</span>
                <div>
                  <span className={styles.activityType}>{ev.type}</span>
                  <span className={styles.activityTime}>
                    {new Date(ev.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })} IST
                  </span>
                </div>
                <span className={styles.activityStatus}>✓ Confirmed</span>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <h2>Agent Activity</h2>
          <div className={styles.activityList}>
            {[
              { agent: 'GeneratorAgent', action: 'Generated 45 Physics questions', time: '2m ago' },
              { agent: 'IRTScorerAgent', action: 'Scored batch — 42/45 accepted', time: '5m ago' },
              { agent: 'BalancerAgent', action: 'Rebalanced Set A ↔ Set C (2 swaps)', time: '8m ago' },
              { agent: 'ValidatorAgent', action: 'Rejected 3 questions (IRT out-of-range)', time: '12m ago' },
            ].map((item, i) => (
              <div key={i} className={styles.activityItem}>
                <span className={styles.activityIcon}></span>
                <div>
                  <span className={styles.activityType}>{item.agent}</span>
                  <span className={styles.activityTime}>{item.action}</span>
                </div>
                <span className={styles.activityMeta}>{item.time}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
