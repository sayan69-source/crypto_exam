/**
 * CryptoExam Core — Setter Section Landing
 * Shared index/landing for setter sections that previously only had a
 * per-exam ([examId]) page — AI Generate, IRT Analytics, ZK Proofs.
 * The sidebar nav links point at the section root (e.g. /setter/proofs),
 * so without an index page those links dead-ended on a 404. This lists
 * the exam catalogue and routes into the per-exam view.
 */
'use client';

import Link from 'next/link';
import styles from './SectionLanding.module.css';

/** Minimal exam shape this landing needs — works for both the rich catalogue
 *  Exam and the live SetterExam from the backend. */
export interface LandingExam {
  id: string;
  name: string;
  status: string;
  exam_body?: string | null;
  sets_count?: number | null;
  candidate_count?: number | null;
  zk_proof_hash?: string | null;
}

const PILL: Record<string, { bg: string; color: string }> = {
  LIVE: { bg: '#eef3ea', color: '#2f5438' },
  LOCKED: { bg: 'var(--color-navy-50, #f8f4f0)', color: 'var(--color-navy-600, #3d332c)' },
  COMPLETED: { bg: '#eef3ea', color: '#2f5438' },
  DRAFT: { bg: 'var(--color-navy-50, #f8f4f0)', color: 'var(--color-navy-400, #605d52)' },
  GENERATING: { bg: '#fdf6e8', color: '#7d5610' },
  PROOF_PENDING: { bg: '#fdf6e8', color: '#7d5610' },
  DISTRIBUTED: { bg: '#f2ede5', color: '#4a3f34' },
};

interface SectionLandingProps {
  icon: string;
  title: string;
  subtitle: string;
  intro: string;
  exams: LandingExam[];
  basePath: string;
  ctaLabel: string;
  meta?: (exam: LandingExam) => string;
}

export default function SetterSectionLanding({
  icon, title, subtitle, intro, exams, basePath, ctaLabel, meta,
}: SectionLandingProps) {
  return (
    <div className={styles.landing}>
      <h1 className={styles.title}>{icon} {title}</h1>
      <p className={styles.subtitle}>{subtitle}</p>

      <div className={styles.intro}>
        {intro}
      </div>

      <h2 className={styles.sectionLabel}>
        Select an exam
      </h2>

      {exams.length === 0 ? (
        <div className={styles.emptyState}>
          No exams in your catalogue yet. Create one from{' '}
          <Link href="/setter/create" className={styles.emptyLink}>New Exam</Link>.
        </div>
      ) : (
        <div className={styles.list}>
          {exams.map(exam => {
            const pill = PILL[exam.status] ?? PILL.DRAFT;
            return (
              <Link
                key={exam.id}
                href={`${basePath}/${exam.id}`}
                className={styles.card}
              >
                <div className={styles.cardInfo}>
                  <span className={styles.cardName}>{exam.name}</span>
                  <span className={styles.cardMeta}>
                    {exam.exam_body ?? '—'}
                    {exam.candidate_count != null ? ` · ${exam.candidate_count.toLocaleString('en-IN')} candidates` : ''}
                    {meta ? ` · ${meta(exam)}` : ''}
                  </span>
                </div>
                <span className={styles.pill} style={{ background: pill.bg, color: pill.color }}>
                  {exam.status}
                </span>
                <span className={styles.cta}>{ctaLabel} →</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
