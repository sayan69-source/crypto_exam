/**
 * CryptoExam Core — Paper Modes Hub
 * Three premium cards for question paper creation workflows
 */
'use client';

import Link from 'next/link';
import styles from './paper-modes.module.css';

export default function PaperModesHub() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>📄 Paper Creation Modes</h1>
      <p className={styles.subtitle}>
        Choose how you want to create the question paper. Each mode offers different levels of control and AI assistance.
      </p>

      <div className={styles.hubGrid}>
        {/* Mode 1: Direct Upload */}
        <Link href="/setter/paper-modes/direct-upload" className={`${styles.modeCard} ${styles.modeCardGold}`}>
          <span className={styles.modeIcon}>🏛️</span>
          <span className={styles.modeName}>Direct Upload</span>
          <span className={styles.modeDesc}>
            Upload a complete question paper directly. Available only for IITs, IISc, ISI, CMI, and other premier institutions with zero paper leak history.
          </span>
          <span className={`${styles.modeBadge} ${styles.badgeTrusted}`}>
            🔒 Trusted Institutions Only
          </span>
          <ul style={{ fontSize: 12, color: 'var(--color-navy-400)', paddingLeft: 16, margin: 0, lineHeight: 1.8 }}>
            <li>Full transparency — setter details shown to students</li>
            <li>Blockchain-locked with timestamp proof</li>
            <li>Institution verification required</li>
          </ul>
        </Link>

        {/* Mode 2: AI-Edited Upload */}
        <Link href="/setter/paper-modes/ai-edited" className={`${styles.modeCard} ${styles.modeCardAI}`}>
          <span className={styles.modeIcon}>🤖</span>
          <span className={styles.modeName}>AI-Edited Upload</span>
          <span className={styles.modeDesc}>
            Upload your question paper and let AI randomly edit it based on your selected difficulty level. Ensures unpredictability while maintaining quality.
          </span>
          <span className={`${styles.modeBadge} ${styles.badgeAI}`}>
            ✨ AI-Powered Editing
          </span>
          <ul style={{ fontSize: 12, color: 'var(--color-navy-400)', paddingLeft: 16, margin: 0, lineHeight: 1.8 }}>
            <li>3 difficulty levels: Easy / Medium / Hard</li>
            <li>Side-by-side diff view for review</li>
            <li>Approve or reject each AI edit</li>
          </ul>
        </Link>

        {/* Mode 3: AI Full Generation */}
        <Link href="/setter/paper-modes/ai-generated" className={`${styles.modeCard} ${styles.modeCardBrain}`}>
          <span className={styles.modeIcon}>🧠</span>
          <span className={styles.modeName}>AI Full Generation</span>
          <span className={styles.modeDesc}>
            Provide previous year questions (PYQs) and syllabus — the AI will generate the entire paper with IRT-calibrated difficulty.
          </span>
          <span className={`${styles.modeBadge} ${styles.badgeSmart}`}>
            🎯 Smart Generation
          </span>
          <ul style={{ fontSize: 12, color: 'var(--color-navy-400)', paddingLeft: 16, margin: 0, lineHeight: 1.8 }}>
            <li>Upload PYQs from multiple years</li>
            <li>Select or upload syllabus</li>
            <li>AI generates with IRT parameters</li>
          </ul>
        </Link>
      </div>

      {/* Info Section */}
      <div className={styles.sectionCard}>
        <h3 className={styles.sectionTitle}>ℹ️ How It Works</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-india-gold)', marginBottom: 8 }}>Mode 1 — Direct Upload</p>
            <p style={{ fontSize: 12, color: 'var(--color-navy-400)', lineHeight: 1.7 }}>
              The paper is uploaded as-is and locked on the blockchain. After the exam, students see full setter details for complete transparency. Only institutions with a verified zero-leak track record can use this mode.
            </p>
          </div>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#a78bfa', marginBottom: 8 }}>Mode 2 — AI-Edited</p>
            <p style={{ fontSize: 12, color: 'var(--color-navy-400)', lineHeight: 1.7 }}>
              You upload the base paper and select a difficulty level. AI randomly modifies 20–80% of questions while preserving topic distribution and marks. You review every change before submission.
            </p>
          </div>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#34d399', marginBottom: 8 }}>Mode 3 — AI Generated</p>
            <p style={{ fontSize: 12, color: 'var(--color-navy-400)', lineHeight: 1.7 }}>
              Upload PYQs and syllabus. The AI analyzes patterns, difficulty curves, and topic distribution to generate a completely new paper calibrated with IRT parameters. Full human review before finalization.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
