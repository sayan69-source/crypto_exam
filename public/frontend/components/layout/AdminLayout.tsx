/**
 * CryptoExam Core — Admin Layout
 * Top bar + sidebar + main + notification drawer
 * "Mission Control" — darkest, real-time everything
 */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import styles from './AdminLayout.module.css';

const NAV_ITEMS = [
  { href: '/admin/dashboard', label: 'Mission Control', icon: '🖥️' },
  { href: '/admin/exams', label: 'Exams', icon: '📝' },
  { href: '/admin/centers', label: 'Centers Map', icon: '🗺️' },
  { href: '/admin/nodes', label: 'Hardware Nodes', icon: '🔧' },
  { href: '/admin/blockchain', label: 'Blockchain', icon: '⛓️' },
  { href: '/admin/candidates', label: 'Candidates', icon: '👥' },
  { href: '/admin/emergency', label: '🚨 Emergency', icon: '' },
  { href: '/admin/roles', label: 'Roles', icon: '🔑' },
  { href: '/admin/reports', label: 'Reports', icon: '📊' },
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
    <div className={`${styles.container} dark-scrollbar`}>
      {/* Top Bar */}
      <header className={styles.topBar}>
        <div className={styles.topLeft}>
          <Link href="/" className={styles.logo}>
            <span>🔐</span>
            <span className={styles.logoText}>CryptoExam</span>
          </Link>
          <span className={styles.roleBadge}>Admin Console</span>
        </div>
        <div className={styles.topCenter}>
          <span className={styles.liveBadge}>● 1 LIVE</span>
          <span className={styles.healthBadge}>System: Healthy</span>
        </div>
        <div className={styles.topRight}>
          <div className={styles.clock}>
            <span className={styles.clockTime}>{formattedTime}</span>
            <span className={styles.clockDate}>{formattedDate} IST</span>
          </div>
          {alertCount > 0 && (
            <span className={styles.alertBadge}>{alertCount}</span>
          )}
          <span className={styles.adminName}>{userName}</span>
        </div>
      </header>

      <div className={styles.body}>
        {/* Sidebar */}
        <aside className={styles.sidebar}>
          <nav className={styles.nav}>
            {NAV_ITEMS.map(item => {
              const active = pathname?.startsWith(item.href);
              const isEmergency = item.href.includes('emergency');
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${styles.navItem} ${active ? styles.active : ''} ${isEmergency ? styles.emergency : ''}`}
                >
                  {item.icon && <span className={styles.navIcon}>{item.icon}</span>}
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
