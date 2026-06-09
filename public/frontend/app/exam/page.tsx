import Link from "next/link";
import styles from "./exam.module.css";

export const metadata = {
  title: "CryptoExam — Candidate Portal",
  description: "Secure exam portal with cryptographic verification.",
};

export default function ExamPortal() {
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Link href="/" className={styles.logo}>CryptoExam</Link>
          <span className={styles.headerBadge}>Candidate Portal</span>
        </div>
        <div className={styles.headerRight}>
          <Link href="/exam/audit" className={styles.auditBtn}>🔍 Public Audit</Link>
          <Link href="/(auth)/login" className={styles.loginBtn}>Login</Link>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <h1 className={styles.title}>Secure Examination Portal</h1>
          <p className={styles.subtitle}>
            Your answers are SHA-256 hashed, included in a Merkle tree, and
            committed to the Polygon blockchain. No one can modify your submission.
          </p>
        </section>

        <section className={styles.steps}>
          <div className={styles.step}>
            <div className={styles.stepNum}>1</div>
            <h3 className={styles.stepTitle}>Authenticate</h3>
            <p className={styles.stepDesc}>Login with your roll number and date of birth. DPDP consent required.</p>
          </div>
          <div className={styles.stepArrow}>→</div>
          <div className={styles.step}>
            <div className={styles.stepNum}>2</div>
            <h3 className={styles.stepTitle}>Take Exam</h3>
            <p className={styles.stepDesc}>Questions decrypt at T₀ from drand beacon. Anti-cheat monitoring active.</p>
          </div>
          <div className={styles.stepArrow}>→</div>
          <div className={styles.step}>
            <div className={styles.stepNum}>3</div>
            <h3 className={styles.stepTitle}>Get Receipt</h3>
            <p className={styles.stepDesc}>Cryptographic receipt with Merkle proof. Verify on Polygonscan.</p>
          </div>
        </section>

        <section className={styles.features}>
          <div className={styles.featureCard}>
            <span className={styles.featureIcon}>
              <Icon name="lock" size={22} strokeWidth={1.7} />
            </span>
            <h3>End-to-End Encrypted</h3>
            <p>AES-GCM-256 encryption. No human can see the paper before T₀.</p>
          </div>
          <div className={styles.featureCard}>
            <span className={styles.featureIcon}>
              <Icon name="languages" size={22} strokeWidth={1.7} />
            </span>
            <h3>11 Indian Languages</h3>
            <p>Hindi, Bengali, Tamil, Telugu, Kannada, Malayalam, Gujarati, Odia, Marathi, English.</p>
          </div>
          <div className={styles.featureCard}>
            <span className={styles.featureIcon}>
              <Icon name="receipt" size={22} strokeWidth={1.7} />
            </span>
            <h3>Court-Admissible Receipt</h3>
            <p>Merkle inclusion proof is mathematical evidence. The math is the affidavit.</p>
          </div>
          <div className={styles.featureCard}>
            <span className={styles.featureIcon}>
              <Icon name="shield" size={22} strokeWidth={1.7} />
            </span>
            <h3>DPDP Compliant</h3>
            <p>Biometric data never stored. Only hash of facial embedding. Consent tracked.</p>
          </div>
          <Link href="/exam/paper-info/e1a2b3c4-5678-90ab-cdef-1234567890ab" className={styles.featureCard} style={{ textDecoration: 'none' }}>
            <span className={styles.featureIcon}>
              <Icon name="eye" size={22} strokeWidth={1.7} />
            </span>
            <h3>Paper Transparency</h3>
            <p>Know who set your paper — setter details, institution trust score, and blockchain proof.</p>
          </Link>
          <Link href="/pipeline" className={styles.featureCard} style={{ textDecoration: 'none' }}>
            <span className={styles.featureIcon}>
              <Icon name="git-branch" size={22} strokeWidth={1.7} />
            </span>
            <h3>Sealed, One-by-One Delivery</h3>
            <p>See how each question stays encrypted from setter to seat and decrypts only when you open it. Runs live.</p>
          </Link>
        </section>
      </main>
    </div>
  );
}
