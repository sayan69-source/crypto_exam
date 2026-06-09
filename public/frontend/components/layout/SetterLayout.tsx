/**
 * CryptoExam Core — Setter Layout
 * Light sidebar (260px) + main content area.
 * "Professional Workbench" — clean, light, data-forward.
 */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Icon from '@/components/marketing/LucideIcon';
import styles from './SetterLayout.module.css';

const NAV_ITEMS = [
  { href: '/setter/dashboard', label: 'Dashboard', icon: 'radar' },
  { href: '/setter/create', label: 'New Exam', icon: 'plus' },
  { href: '/setter/paper-modes', label: 'Paper Modes', icon: 'file-check' },
  { href: '/setter/questions', label: 'Question Bank', icon: 'boxes' },
  { href: '/setter/generate', label: 'AI Generate', icon: 'cpu' },
  { href: '/setter/irt', label: 'IRT Analytics', icon: 'git-branch' },
  { href: '/setter/proofs', label: 'ZK Proofs', icon: 'binary' },
];

interface SetterLayoutProps {
  children: React.ReactNode;
  userName?: string;
}

export default function SetterLayout({ children, userName = 'Dr. Raghav Iyer' }: SetterLayoutProps) {
  const pathname = usePathname();

  return (
    <div className={styles.container}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <Link href="/" className={styles.logo}>
            <span className={styles.logoMark}>
              <Icon name="shield-check" size={16} strokeWidth={1.8} />
            </span>
            <span className={styles.logoText}>CryptoExam<b>Core</b></span>
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
                <Icon name={item.icon} size={17} strokeWidth={1.7} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className={styles.sidebarFooter}>
          <Link href="/" className={styles.backLink}>
            <Icon name="arrow-right" size={13} strokeWidth={1.7} />
            Back to Portal
          </Link>
        </div>
      </aside>

      <main className={styles.main}>
        {children}
      </main>
    </div>
  );
}
