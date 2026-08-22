import Link from "next/link";
import styles from "./audit-detail.module.css";

export const metadata = {
  title: "CryptoExam — Public Audit",
  description: "Verify exam integrity without login.",
};

export default function AuditDetailPage({ params }: { params: { examId: string } }) {
  // Mock data for the audit report
  const examId = params.examId || "e1a2b3c4-5678-90ab-cdef-1234567890ab";
  
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Link href="/" className={styles.logo}>CryptoExam</Link>
          <span className={styles.headerBadge}>Public Audit</span>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.reportCard}>
          <div className={styles.reportHeader}>
            <h1 className={styles.title}>Exam Integrity Report</h1>
            <p className={styles.examId}>Exam ID: {examId}</p>
          </div>

          <div className={styles.verdictBox}>
            <div className={styles.verdictIcon}>✓</div>
            <div className={styles.verdictText}>
              <h2>INTEGRITY VERIFIED</h2>
              <p>All cryptographic proofs match. The mathematics confirm the exam was conducted securely and fairly.</p>
            </div>
          </div>

          <div className={styles.checklist}>
            <div className={styles.checkItem}>
              <span className={styles.checkIcon}>✓</span>
              <div className={styles.checkContent}>
                <h3>Question Hash Commitment</h3>
                <p>Matches on-chain commitment exactly.</p>
              </div>
            </div>
            <div className={styles.checkItem}>
              <span className={styles.checkIcon}>✓</span>
              <div className={styles.checkContent}>
                <h3>ZK Difficulty Proof (Groth16)</h3>
                <p>Verified on Polygon. The difficulty distribution was within the required parameters before the exam started.</p>
              </div>
            </div>
            <div className={styles.checkItem}>
              <span className={styles.checkIcon}>✓</span>
              <div className={styles.checkContent}>
                <h3>Time-Lock Integrity</h3>
                <p>Paper was locked at least 72 hours prior to scheduled T₀.</p>
              </div>
            </div>
            <div className={styles.checkItem}>
              <span className={styles.checkIcon}>✓</span>
              <div className={styles.checkContent}>
                <h3>Answer Merkle Root</h3>
                <p>Root hash committed to the blockchain immediately post-exam.</p>
              </div>
            </div>
          </div>

          <div className={styles.candidateAudit}>
            <h3>Candidate Specific Verification</h3>
            <p>To verify if a specific candidate's answers were included in the Merkle Root without tampering, enter their Roll Number.</p>
            <div className={styles.candidateForm}>
              <input type="text" placeholder="Enter Roll Number" className={styles.input} />
              <button className={styles.verifyBtn}>Verify Inclusion</button>
            </div>
          </div>

        </div>
      </main>

      <footer className={styles.footer}>
         <p>This report is cryptographically generated and cannot be falsified.</p>
      </footer>
    </div>
  );
}
