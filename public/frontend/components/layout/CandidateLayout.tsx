/**
 * CryptoExam Core — Candidate Layout
 * Clean header + main + minimal footer. Light theme (examBg).
 * "Calm Institutionalism" — like a trusted government document come to life.
 */
'use client';

import Link from 'next/link';
import styles from './CandidateLayout.module.css';

interface CandidateLayoutProps {
  children: React.ReactNode;
  userName?: string;
  showNav?: boolean;
}

export default function CandidateLayout({ children, userName, showNav = true }: CandidateLayoutProps) {
  return (
    <div className={styles.container}>
      {showNav && (
        <header className={styles.header}>
          <div className={styles.headerInner}>
            <div className={styles.left}>
              <Link href="/" className={styles.logo}>
                <span className={styles.logoMark}>🔐</span>
                <span className={styles.logoText}>CryptoExam</span>
              </Link>
              <span className={styles.roleBadge}>Candidate Portal</span>
            </div>
            <nav className={styles.nav}>
              <Link href="/exam/dashboard" className={styles.navLink}>Dashboard</Link>
              <Link href="/exam/audit" className={styles.navLink}>🔍 Public Audit</Link>
            </nav>
            <div className={styles.right}>
              {userName ? (
                <span className={styles.userName}>{userName}</span>
              ) : (
                <Link href="/(auth)/login" className={styles.loginBtn}>Login</Link>
              )}
            </div>
          </div>
          {/* India tricolour stripe */}
          <div className={styles.tricolour}>
            <div className={styles.saffronStripe} />
            <div className={styles.whiteStripe} />
            <div className={styles.greenStripe} />
          </div>
        </header>
      )}

      <main className={styles.main}>{children}</main>

      <footer className={styles.footer}>
        <p>CryptoExam Core · Your answers are mathematically protected</p>
        <p className={styles.footerSub}>DPDP Act 2023 Compliant · Polygon PoS · CIRCOM Groth16</p>
      </footer>
    </div>
  );
}
