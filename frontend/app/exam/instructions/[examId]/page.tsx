/**
 * CryptoExam Core — Pre-Exam Instructions Page
 * Candidates must read and accept before proceeding to System Check → Exam.
 * Dynamically configures based on exam metadata using ExamConfigParser.
 */
'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/AuthContext';
import { mockExams, mockQuestions } from '@/lib/api/mock-data';
import { parseExamConfig } from '@/lib/api/ExamConfigParser';
import styles from './instructions.module.css';

export default function InstructionsPage() {
  const { session } = useAuth();
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);

  // Dynamic config from exam metadata
  const exam = mockExams[0];
  const config = useMemo(() => parseExamConfig(exam, mockQuestions), [exam]);

  const handleProceed = () => {
    router.push('/exam/system-check');
  };

  return (
    <div className={styles.page}>
      {/* Top Bar */}
      <div className={styles.topBar}>
        <div className={styles.topBarLeft}>
          🔐 CryptoExam Core — {config.examName}
        </div>
        <div className={styles.topBarRight}>
          <span>Candidate: {session?.name || 'Priya Sharma'}</span>
          <span>|</span>
          <span>Roll: {session?.identifier || 'NEET-2026-BIH-0847291'}</span>
        </div>
      </div>

      <div className={styles.container}>
        <div className={styles.card}>
          {/* Header */}
          <div className={styles.cardHeader}>
            <h1>General Instructions</h1>
            <p>Please read the following instructions carefully before starting the examination.</p>
          </div>

          {/* Exam Meta Grid — dynamically generated */}
          <div className={styles.metaGrid}>
            <div className={styles.metaItem}>
              <div className={styles.metaLabel}>Total Questions</div>
              <div className={styles.metaValue}>{config.totalQuestions}</div>
            </div>
            <div className={styles.metaItem}>
              <div className={styles.metaLabel}>Total Marks</div>
              <div className={styles.metaValue}>{config.totalMarks}</div>
            </div>
            <div className={styles.metaItem}>
              <div className={styles.metaLabel}>Duration</div>
              <div className={styles.metaValue}>{config.durationFormatted}</div>
            </div>
            <div className={styles.metaItem}>
              <div className={styles.metaLabel}>Marking</div>
              <div className={styles.metaValue}>+{config.positiveMarks} / -{config.negativeMarks}</div>
            </div>
          </div>

          {/* Sections breakdown */}
          <div className={styles.metaGrid}>
            {config.sections.map(s => (
              <div key={s.id} className={styles.metaItem}>
                <div className={styles.metaLabel}>{s.name}</div>
                <div className={styles.metaValue}>{s.questionCount} Qs</div>
              </div>
            ))}
            <div className={styles.metaItem}>
              <div className={styles.metaLabel}>Set</div>
              <div className={styles.metaValue}>{config.setLabel}</div>
            </div>
          </div>

          {/* Instructions List */}
          <div className={styles.instructions}>
            <h2>Read Carefully</h2>
            <ol className={styles.instructionsList}>
              {config.instructions.map((inst, i) => (
                <li key={i}>{inst}</li>
              ))}
            </ol>
          </div>

          {/* Status Palette Legend */}
          <div className={styles.paletteLegend}>
            <div className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.dotNotVisited}`}>1</span>
              Not Visited
            </div>
            <div className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.dotNotAnswered}`}>2</span>
              Not Answered
            </div>
            <div className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.dotAnswered}`}>3</span>
              Answered
            </div>
            <div className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.dotReview}`}>4</span>
              Marked for Review
            </div>
            <div className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.dotReviewAnswered}`}>5</span>
              Answered & Marked for Review
            </div>
          </div>

          {/* Declaration */}
          <div className={styles.declaration}>
            <h3>Declaration</h3>
            <label className={styles.consentLabel}>
              <input
                type="checkbox"
                checked={accepted}
                onChange={e => setAccepted(e.target.checked)}
              />
              I have read and understood all the instructions. I agree that in case of any non-compliance, I will be subject to disqualification. I am aware that this examination is being conducted under strict anti-cheat protocols, and all my actions are being logged.
            </label>
          </div>

          {/* Actions */}
          <div className={styles.actions}>
            <button className={styles.prevBtn} onClick={() => router.push('/exam/dashboard')}>
              ← Back to Dashboard
            </button>
            <button
              className={styles.proceedBtn}
              disabled={!accepted}
              onClick={handleProceed}
            >
              I am ready to begin — Proceed to System Check →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
