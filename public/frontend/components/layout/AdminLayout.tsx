/**
 * CryptoExam Core — Admin Layout
 * Light top bar + light sidebar + main content.
 * "Professional Mission Control" — clean SaaS dashboard.
 */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import Icon from '@/components/marketing/LucideIcon';
import styles from './AdminLayout.module.css';

const NAV_ITEMS = [
  { href: '/admin/dashboard', label: 'Mission Control', icon: 'radar' },
  { href: '/admin/exams', label: 'Exams', icon: 'clipboard-list' },
  { href: '/admin/centers', label: 'Centers Map', icon: 'map' },
  { href: '/admin/nodes', label: 'Hardware Nodes', icon: 'cpu' },
  { href: '/admin/blockchain', label: 'Blockchain', icon: 'link' },
  { href: '/admin/candidates', label: 'Candidates', icon: 'users-round' },
  { href: '/admin/emergency', label: 'Emergency', icon: 'siren', emergency: true },
  { href: '/admin/roles', label: 'Roles', icon: 'key-round' },
  { href: '/admin/reports', label: 'Reports', icon: 'file-check' },
];

interface AdminLayoutProps {
  children: React.ReactNode;
  userName?: string;
  alertCount?: number;
}

export default function AdminLayout({ children, userName = 'Vikram S. Rathore', alertCount = 4 }: AdminLayoutProps) {
  const pathname = usePathname();
  const [clockTime, setClockTime] = useState(new Date());

  // Live clock
  if (typeof window !== 'undefined') {
    setTimeout(() => setClockTime(new Date()), 1000);
  }

  const formattedTime = clockTime.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });

  const formattedDate = clockTime.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
  });

  return (
    <div className={styles.container}>
      {/* Top Bar */}
      <header className={styles.topBar}>
        <div className={styles.topLeft}>
          <Link href="/" className={styles.logo}>
            <span className={styles.logoMark}>
              <Icon name="shield-check" size={16} strokeWidth={1.8} />
            </span>
            <span className={styles.logoText}>CryptoExam<b>Core</b></span>
          </Link>
          <span className={styles.roleBadge}>Admin Console</span>
        </div>
        <div className={styles.topCenter}>
          <span className={styles.liveBadge}>
            <span className={styles.liveDot} />
            1 LIVE
          </span>
          <span className={styles.healthBadge}>
            <Icon name="check-circle-2" size={14} strokeWidth={1.7} />
            System Healthy
          </span>
        </div>
        <div className={styles.topRight}>
          <div className={styles.clock}>
            <span className={styles.clockTime}>{formattedTime}</span>
            <span className={styles.clockDate}>{formattedDate} IST</span>
          </div>
          {alertCount > 0 && (
            <span className={styles.alertBadge}>{alertCount}</span>
          )}
          <div className={styles.adminUser}>
            <div className={styles.adminAvatar}>{userName.charAt(0)}</div>
            <span className={styles.adminName}>{userName}</span>
          </div>
        </div>
      </header>

      <div className={styles.body}>
        {/* Sidebar */}
        <aside className={styles.sidebar}>
          <nav className={styles.nav}>
            {NAV_ITEMS.map(item => {
              const active = pathname?.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${styles.navItem} ${active ? styles.active : ''} ${item.emergency ? styles.emergency : ''}`}
                >
                  <Icon name={item.icon} size={17} strokeWidth={1.7} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </aside>

        {/* Main */}
        <main className={styles.main}>
          {children}
        </main>
      </div>
    </div>
  );
}
