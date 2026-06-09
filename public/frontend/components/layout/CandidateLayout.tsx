/**
 * CryptoExam Core — Candidate Layout
 * "Calm Institutionalism" — Light, warm, professional.
 * Premium header with brand icon, clean nav, refined footer.
 */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Icon from '@/components/marketing/LucideIcon';
import styles from './CandidateLayout.module.css';

interface CandidateLayoutProps {
  children: React.ReactNode;
  userName?: string;
  showNav?: boolean;
}

export default function CandidateLayout({ children, userName, showNav = true }: CandidateLayoutProps) {
  const pathname = usePathname();

  return (
    <div className={styles.container}>
      {showNav && (
        <>
          <div className={styles.tricolour}>
            <span /><span /><span />
          </div>
          <header className={styles.header}>
            <div className={styles.headerInner}>
              <div className={styles.left}>
                <Link href="/" className={styles.logo}>
                  <span className={styles.logoMark}>
                    <Icon name="shield-check" size={16} strokeWidth={1.8} />
                  </span>
                  <span className={styles.logoText}>CryptoExam<b>Core</b></span>
                </Link>
                <span className={styles.roleBadge}>Candidate Portal</span>
              </div>
              <nav className={styles.nav}>
                <Link
                  href="/exam/dashboard"
                  className={`${styles.navLink} ${pathname?.startsWith('/exam/dashboard') ? styles.navActive : ''}`}
                >
                  <Icon name="graduation-cap" size={15} strokeWidth={1.7} />
                  Dashboard
                </Link>
                <Link
                  href="/exam/audit"
                  className={`${styles.navLink} ${pathname?.startsWith('/exam/audit') ? styles.navActive : ''}`}
                >
                  <Icon name="search-check" size={15} strokeWidth={1.7} />
                  Public Audit
                </Link>
              </nav>
              <div className={styles.right}>
                {userName ? (
                  <span className={styles.userName}>{userName}</span>
                ) : (
                  <Link href="/login" className={styles.loginBtn}>Login</Link>
                )}
              </div>
            </div>
          </header>
        </>
      )}

      <main className={styles.main}>{children}</main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <p>CryptoExam Core · Your answers are mathematically protected</p>
          <p className={styles.footerSub}>
            <span className={styles.footerDot} />
            DPDP Act 2023 Compliant · Polygon PoS · CIRCOM Groth16
          </p>
        </div>
      </footer>
    </div>
  );
}
