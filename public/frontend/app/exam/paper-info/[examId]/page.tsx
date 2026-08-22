/**
 * CryptoExam Core — Paper Information & Setter Transparency
 * Student-facing page showing who set the paper, when, and verification details
 * Only shown for exams using Mode 1 (Direct Upload by trusted institutions)
 */

import Link from 'next/link';
import { mockSetterMetadata, mockTrustedInstitutions, mockExams } from '@/lib/api/mock-data';
import styles from './paper-info.module.css';

export const metadata = {
  title: 'CryptoExam — Paper Setter Information',
  description: 'Transparent information about who set this question paper, when it was created, and blockchain verification.',
};

export default function PaperInfoPage() {
  const setter = mockSetterMetadata;
  const institution = mockTrustedInstitutions.find(i => i.id === setter.setter_institution_id);
  const exam = mockExams[0]; // NEET UG 2026

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Link href="/" className={styles.logo}>CryptoExam</Link>
          <span className={styles.headerBadge}>Paper Transparency</span>
        </div>
      </header>

      <main className={styles.main}>
        <h1 className={styles.pageTitle}>Paper Setter Information</h1>
        <p className={styles.pageSubtitle}>
          This page shows complete transparency about who set the question paper for <strong>{exam.name}</strong>.
          All information is permanently recorded on the Polygon blockchain and cannot be modified.
        </p>

        {/* Setter Details Card */}
        <div className={styles.setterCard}>
          <div className={styles.setterHeader}>
            <div className={styles.setterAvatar}>
              {setter.setter_name.charAt(0)}
            </div>
            <div className={styles.setterInfo}>
              <span className={styles.setterName}>{setter.setter_name}</span>
              <span className={styles.setterDesignation}>{setter.setter_designation}</span>
              <span className={styles.setterDept}>{setter.setter_department}</span>
            </div>
            <span className={styles.verifiedBadge}>✓ Verified Setter</span>
          </div>

          <div className={styles.detailGrid}>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Institution</span>
              <span className={styles.detailValue}>{setter.setter_institution}</span>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Email (Masked)</span>
              <span className={styles.detailValueMono}>{setter.setter_email_masked}</span>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>ID Verification</span>
              <span className={styles.detailValue}>{setter.setter_id_proof_type} · {setter.setter_id_proof_ref_masked}</span>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Exam</span>
              <span className={styles.detailValue}>{exam.name}</span>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Paper Created</span>
              <span className={styles.detailValue}>
                {new Date(setter.paper_created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}
                {' at '}
                {new Date(setter.paper_created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST
              </span>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Paper Locked on Blockchain</span>
              <span className={styles.detailValue}>
                {new Date(setter.paper_locked_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}
                {' at '}
                {new Date(setter.paper_locked_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST
              </span>
            </div>
          </div>
        </div>

        {/* Institution Trust Card */}
        {institution && (
          <div className={styles.trustCard}>
            <h2 className={styles.trustTitle}>
              Institution Trust Score
            </h2>

            <div className={styles.trustScoreContainer}>
              <div className={styles.trustScoreLabel}>
                <span>{institution.name}</span>
                <span className={styles.trustScoreValue}>{setter.institution_trust_score}/100</span>
              </div>
              <div className={styles.trustBar}>
                <div className={styles.trustFill} style={{ width: `${setter.institution_trust_score}%` }} />
              </div>
            </div>

            <div className={styles.trustStats}>
              <div className={styles.trustStat}>
                <span className={styles.trustStatValue}>{setter.institution_track_record_years}</span>
                <span className={styles.trustStatLabel}>Years of Excellence</span>
              </div>
              <div className={styles.trustStat}>
                <span className={styles.trustStatValue}>{institution.exams_conducted}</span>
                <span className={styles.trustStatLabel}>Exams Conducted</span>
              </div>
              <div className={styles.trustStat}>
                <span className={styles.trustStatValue} style={{ color: '#16a34a' }}>{setter.institution_leak_incidents}</span>
                <span className={styles.trustStatLabel}>Paper Leak Incidents</span>
              </div>
            </div>

            <div className={styles.detailGrid} style={{ marginTop: 16 }}>
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Established</span>
                <span className={styles.detailValue}>{institution.established_year}</span>
              </div>
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Location</span>
                <span className={styles.detailValue}>{institution.location}</span>
              </div>
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Verification Status</span>
                <span className={styles.detailValue} style={{ color: '#16a34a', fontWeight: 700 }}>✓ Premier Verified</span>
              </div>
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Verified On</span>
                <span className={styles.detailValue}>
                  {new Date(institution.verification_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Blockchain Verification Card */}
        <div className={styles.blockchainCard}>
          <h2 className={styles.blockchainTitle}>Blockchain Verification</h2>
          <p style={{ fontSize: 13, color: 'var(--color-navy-600)', marginBottom: 16, lineHeight: 1.7 }}>
            All paper creation and locking events are permanently recorded on the Polygon PoS blockchain.
            You can independently verify these transactions on Polygonscan.
          </p>

          <div className={styles.detailGrid}>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Paper Lock Transaction</span>
              <a href={`https://polygonscan.com/tx/${setter.paper_lock_tx}`} target="_blank" rel="noopener noreferrer" className={styles.txLink}>
                {setter.paper_lock_tx.slice(0, 10)}...{setter.paper_lock_tx.slice(-8)}
              </a>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Exam Creation Transaction</span>
              <a href={`https://polygonscan.com/tx/${exam.polygon_exam_tx}`} target="_blank" rel="noopener noreferrer" className={styles.txLink}>
                {exam.polygon_exam_tx?.slice(0, 10)}...{exam.polygon_exam_tx?.slice(-8)}
              </a>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>ZK Proof Transaction</span>
              <a href={`https://polygonscan.com/tx/${exam.polygon_zkproof_tx}`} target="_blank" rel="noopener noreferrer" className={styles.txLink}>
                {exam.polygon_zkproof_tx?.slice(0, 10)}...{exam.polygon_zkproof_tx?.slice(-8)}
              </a>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Question Hash</span>
              <span className={styles.detailValueMono}>{exam.question_hash}</span>
            </div>
          </div>
        </div>

        {/* Notice */}
        <div style={{ background: 'var(--color-navy-50)', border: '1px solid var(--color-navy-200)', borderRadius: 16, padding: '16px 20px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 18 }}>ℹ</span>
          <div>
            <p style={{ fontSize: 13, color: 'var(--color-navy-700)', margin: 0, lineHeight: 1.7 }}>
              <strong>Why this transparency?</strong> This paper was uploaded directly by a trusted institution ({institution?.short_name}).
              CryptoExam Core mandates full transparency for directly uploaded papers — you have the right to know who set
              your exam paper, when it was created, and when it was cryptographically locked.
            </p>
            <p style={{ fontSize: 12, color: 'var(--color-navy-500)', margin: '8px 0 0', lineHeight: 1.6 }}>
              All timestamps are cryptographically verified via the Polygon blockchain and cannot be retroactively altered.
            </p>
          </div>
        </div>
      </main>

      <footer className={styles.footer}>
        <p>CryptoExam Core · Paper Transparency Portal · Blockchain Verified</p>
      </footer>
    </div>
  );
}
