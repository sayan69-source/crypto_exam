/**
 * CryptoExam Core — Candidate Exam Dashboard
 * Displays all available exams from the catalog with category filtering.
 * Each card shows real exam structure (sections, marks, duration, marking scheme).
 */
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth/AuthContext';
import { examCatalog, getExamsByCategory } from '@/lib/api/exam-catalog';
import type { Exam } from '@/lib/api/types';
import styles from './dashboard.module.css';

type Category = 'all' | 'engineering' | 'medical' | 'government' | 'premier';

const categories: { id: Category; label: string; icon: string }[] = [
  { id: 'all', label: 'All Exams', icon: '📋' },
  { id: 'engineering', label: 'Engineering', icon: '⚙️' },
  { id: 'medical', label: 'Medical', icon: '🩺' },
  { id: 'government', label: 'Government', icon: '🏛️' },
  { id: 'premier', label: 'ISI / CMI', icon: '🎓' },
];

export default function CandidateDashboard() {
  const { session, logout } = useAuth();
  const [activeCat, setActiveCat] = useState<Category>('all');

  const exams = activeCat === 'all' ? examCatalog : getExamsByCategory(activeCat);

  const statusClass = (status: string) => {
    if (status === 'LIVE') return styles.statusLive;
    if (status === 'COMPLETED' || status === 'AUDITED') return styles.statusCompleted;
    return styles.statusLocked;
  };

  const formatDuration = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m > 0 ? `${m}m` : ''}` : `${m}m`;
  };

  return (
    <div className={styles.page}>
      {/* Top Bar */}
      <div className={styles.topBar}>
        <div className={styles.topBarLeft}>
          🔐 CryptoExam Core — Examination Portal
        </div>
        <div className={styles.topBarRight}>
          <span style={{ fontSize: 13, opacity: 0.85 }}>{session?.name || 'Candidate'}</span>
          <button className={styles.logoutBtn} onClick={logout}>Logout</button>
        </div>
      </div>

      <div className={styles.container}>
        <h1 className={styles.heading}>Available Examinations</h1>
        <p className={styles.subHeading}>
          Select an examination to view instructions and proceed to the secure exam environment.
        </p>

        {/* Category Tabs */}
        <div className={styles.categoryTabs}>
          {categories.map(cat => (
            <button
              key={cat.id}
              className={`${styles.catTab} ${activeCat === cat.id ? styles.catActive : ''}`}
              onClick={() => setActiveCat(cat.id)}
            >
              {cat.icon} {cat.label}
            </button>
          ))}
        </div>

        {/* Exam Cards Grid */}
        <div className={styles.grid}>
          {exams.map(exam => {
            const totalQ = exam.subject_taxonomy.subjects.reduce((a, s) => a + s.question_count, 0);
            const sectionNames = exam.subject_taxonomy.subjects.map(s => s.name).join(' • ');
            const canEnter = exam.status === 'LIVE';

            return (
              <div key={exam.id} className={styles.examCard}>
                <div className={styles.cardTop}>
                  <div>
                    <div className={styles.cardExamName}>{exam.name}</div>
                    <div className={styles.cardBody}>{exam.exam_body === 'CUSTOM' ? 'Conducting Body' : exam.exam_body}</div>
                  </div>
                  <span className={`${styles.statusBadge} ${statusClass(exam.status)}`}>
                    {exam.status === 'LIVE' ? '● LIVE' : exam.status}
                  </span>
                </div>

                {/* Meta Grid */}
                <div className={styles.cardMeta}>
                  <div className={styles.metaCell}>
                    <div className={styles.metaLabel}>Questions</div>
                    <div className={styles.metaVal}>{totalQ}</div>
                  </div>
                  <div className={styles.metaCell}>
                    <div className={styles.metaLabel}>Total Marks</div>
                    <div className={styles.metaVal}>{exam.total_marks}</div>
                  </div>
                  <div className={styles.metaCell}>
                    <div className={styles.metaLabel}>Duration</div>
                    <div className={styles.metaVal}>{formatDuration(exam.duration_minutes)}</div>
                  </div>
                  <div className={styles.metaCell}>
                    <div className={styles.metaLabel}>Marking</div>
                    <div className={styles.metaVal}>
                      <span style={{ color: '#16a34a' }}>+{exam.positive_marks}</span>
                      {' / '}
                      <span style={{ color: '#dc2626' }}>-{exam.negative_marking}</span>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className={styles.cardFooter}>
                  <span className={styles.cardSections}>{sectionNames}</span>
                  {canEnter ? (
                    <Link href={`/exam/instructions/${exam.id}`}>
                      <button className={styles.enterBtn}>Enter →</button>
                    </Link>
                  ) : (
                    <button className={styles.enterBtn} disabled>
                      {exam.status === 'COMPLETED' ? 'Ended' : 'Upcoming'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
