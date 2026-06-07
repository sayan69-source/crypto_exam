/**
 * CryptoExam Core — Setter Layout
 * Fixed dark sidebar (260px) + main content area
 * "Bloomberg Terminal Energy" — dense, dark, data-forward
 */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './SetterLayout.module.css';

const NAV_ITEMS = [
  { href: '/setter/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/setter/create', label: 'New Exam', icon: '➕' },
  { href: '/setter/questions', label: 'Question Bank', icon: '📚' },
  { href: '/setter/generate', label: 'AI Generate', icon: '🤖' },
  { href: '/setter/irt', label: 'IRT Analytics', icon: '📈' },
  { href: '/setter/proofs', label: 'ZK Proofs', icon: '🔬' },
];

interface SetterLayoutProps {
  children: React.ReactNode;
  userName?: string;
}

export default function SetterLayout({ children, userName = 'Dr. Raghav Iyer' }: SetterLayoutProps) {
  const pathname = usePathname();

  return (
    <div className={`${styles.container} dark-scrollbar`}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <Link href="/" className={styles.logo}>
            <span className={styles.logoIcon}>🔐</span>
            <span className={styles.logoText}>CryptoExam</span>
          </Link>
          <span className={styles.roleBadge}>Exam Setter</span>
        </div>

        <div className={styles.userCard}>
          <div className={styles.avatar}>{userName.charAt(0)}</div>
          <div className={styles.userInfo}>
            <span className={styles.userName}>{userName}</span>
            <span className={styles.userInst}>National Testing Agency</span>
          </div>
        </div>

        <nav className={styles.nav}>
          {NAV_ITEMS.map(item => {
            const active = pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navItem} ${active ? styles.active : ''}`}
              >
                <span className={styles.navIcon}>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className={styles.sidebarFooter}>
          <Link href="/" className={styles.backLink}>← Back to Portal</Link>
        </div>
      </aside>

      <main className={styles.main}>
        {children}
      </main>
    </div>
  );
}
