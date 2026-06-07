/**
 * CryptoExam Core — Candidate Dashboard
 * Upcoming exams, history, receipts, audit proof links
 */
'use client';

import Link from 'next/link';
import { mockExams, mockUsers } from '@/lib/api/mock-data';
import styles from './dashboard.module.css';

const statusColors: Record<string, string> = {
  LIVE: 'live', LOCKED: 'locked', COMPLETED: 'completed', DRAFT: 'draft',
  DISTRIBUTED: 'locked', PAUSED: 'warning', ABORTED: 'error',
};

export default function CandidateDashboard() {
  const user = mockUsers.candidate;
  const upcoming = mockExams.filter(e => ['LOCKED', 'DISTRIBUTED', 'LIVE'].includes(e.status));
  const past = mockExams.filter(e => ['COMPLETED', 'AUDITED'].includes(e.status));

  return (
    <div className={styles.page}>
      <div className={styles.welcome}>
        <h1>Welcome, {user.full_name}</h1>
        <p className={styles.welcomeSub}>Your answers are mathematically protected on the blockchain.</p>
      </div>

      {/* Upcoming Exams */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>📝 Upcoming Exams</h2>
        <div className={styles.examGrid}>
          {upcoming.map(exam => {
            const examDate = new Date(exam.scheduled_at);
            const now = new Date();
            const diffMs = examDate.getTime() - now.getTime();
            const diffHours = Math.max(0, Math.floor(diffMs / 3600000));
            const diffMins = Math.max(0, Math.floor((diffMs % 3600000) / 60000));

            return (
              <div key={exam.id} className={styles.examCard}>
                <div className={styles.examHeader}>
                  <span className={`${styles.statusBadge} ${styles[statusColors[exam.status] || 'draft']}`}>
                    {exam.status === 'LIVE' ? '● LIVE' : exam.status}
                  </span>
                  <span className={styles.examBody}>{exam.exam_body}</span>
                </div>
                <h3 className={styles.examName}>{exam.name}</h3>
                <div className={styles.examMeta}>
                  <span>⏱ {exam.duration_minutes} min</span>
                  <span>📋 {exam.subject_taxonomy.subjects.reduce((a, s) => a + s.question_count, 0)} questions</span>
                </div>
                {exam.status === 'LIVE' ? (
                  <div className={styles.liveCountdown}>
                    <span className={styles.liveText}>Exam is LIVE</span>
                    <Link href={`/exam/verify/${exam.id}`} className={styles.startBtn}>Enter Exam →</Link>
                  </div>
                ) : (
                  <div className={styles.countdown}>
                    <span className={styles.countdownLabel}>Starts in</span>
                    <span className={styles.countdownValue}>{diffHours}h {diffMins}m</span>
                  </div>
                )}
                {exam.zk_proof_hash && (
                  <div className={styles.cryptoInfo}>
                    <span>🔬 ZK Proof: Verified ✅</span>
                    <span>⛓️ On-chain</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Past Exams */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>📜 Past Exams</h2>
        <div className={styles.examGrid}>
          {past.map(exam => (
            <div key={exam.id} className={`${styles.examCard} ${styles.pastCard}`}>
              <div className={styles.examHeader}>
                <span className={`${styles.statusBadge} ${styles.completed}`}>{exam.status}</span>
                <span className={styles.examBody}>{exam.exam_body}</span>
              </div>
              <h3 className={styles.examName}>{exam.name}</h3>
              <div className={styles.examMeta}>
                <span>📅 {new Date(exam.scheduled_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
              </div>
              <div className={styles.pastActions}>
                <Link href={`/exam/receipt/${exam.id}`} className={styles.receiptBtn}>📄 View Receipt</Link>
                <Link href={`/exam/audit/${exam.id}`} className={styles.auditBtn}>🔍 Audit</Link>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
