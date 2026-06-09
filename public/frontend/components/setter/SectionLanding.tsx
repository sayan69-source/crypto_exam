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
import type { Exam } from '@/lib/api/types';
import styles from './SectionLanding.module.css';

const PILL: Record<string, { bg: string; color: string }> = {
  LIVE: { bg: '#ECFDF5', color: '#065F46' },
  LOCKED: { bg: 'var(--color-navy-50, #EFF1FA)', color: 'var(--color-navy-600, #213573)' },
  COMPLETED: { bg: '#ECFDF5', color: '#065F46' },
  DRAFT: { bg: 'var(--color-navy-50, #EFF1FA)', color: 'var(--color-navy-400, #5B6478)' },
  GENERATING: { bg: '#FFFBEB', color: '#92400E' },
  PROOF_PENDING: { bg: '#FFFBEB', color: '#92400E' },
  DISTRIBUTED: { bg: '#EFF6FF', color: '#1E40AF' },
};

interface SectionLandingProps {
  icon: string;
  title: string;
  subtitle: string;
  intro: string;
  exams: Exam[];
  basePath: string;
  ctaLabel: string;
  meta?: (exam: Exam) => string;
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
                    {exam.exam_body} · {exam.candidate_count?.toLocaleString('en-IN')} candidates
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
