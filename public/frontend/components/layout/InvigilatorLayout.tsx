/**
 * CryptoExam Core — Invigilator Layout
 * "Calm Authority": light shell, professional top bar, left nav.
 * Hindi labels on every critical action; large touch targets for tablets.
 */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth/AuthContext';
import Icon from '@/components/marketing/LucideIcon';
import styles from '@/app/invigilator/invigilator.module.css';

const NAV_ITEMS = [
  { href: '/invigilator/dashboard', label: 'Dashboard', hi: 'डैशबोर्ड', icon: 'radar' },
  { href: '/invigilator/verify', label: 'Verify Candidate', hi: 'सत्यापन', icon: 'scan-face' },
  { href: '/invigilator/roster', label: 'Roster', hi: 'सूची', icon: 'clipboard-list' },
  { href: '/invigilator/alerts', label: 'Alerts', hi: 'चेतावनी', icon: 'siren' },
  { href: '/invigilator/report', label: 'Incident Report', hi: 'रिपोर्ट', icon: 'file-signature' },
];

const DEFAULT_CENTER_ID = 'ctr-001';

export default function InvigilatorLayout({
  children,
  centreName = 'CryptoExam Center New Delhi',
}: {
  children: React.ReactNode;
  centreName?: string;
}) {
  const pathname = usePathname();
  const { session, logout } = useAuth();

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>
            <Icon name="badge-check" size={18} strokeWidth={1.7} />
          </span>
          <div>
            <div className={styles.brandTitle}>CryptoExam Core</div>
            <div className={styles.brandSub}>Centre Invigilator Gateway · केंद्र निरीक्षक</div>
          </div>
        </div>
        <div className={styles.topMeta}>
          <span className={styles.centreTag}>
            <Icon name="map-pin" size={13} strokeWidth={1.7} />
            {centreName}
          </span>
          <span className={styles.topUser}>{session?.name ?? 'Invigilator'}</span>
          <button className={styles.logoutBtn} onClick={logout}>
            Logout · लॉगआउट
          </button>
        </div>
      </header>

      <div className={styles.body}>
        <nav className={styles.nav}>
          {NAV_ITEMS.map((item) => {
            const href = item.href === '/invigilator/verify'
              ? `/invigilator/verify/${DEFAULT_CENTER_ID}`
              : item.href;
            const active = pathname === href || pathname?.startsWith(item.href + '/') || pathname === item.href;
            return (
              <Link key={item.href} href={href} className={`${styles.navLink} ${active ? styles.navActive : ''}`}>
                <Icon name={item.icon} size={18} strokeWidth={1.7} className={styles.navIcon} />
                <span>
                  {item.label}
                  <span className={styles.navHi}>{item.hi}</span>
                </span>
              </Link>
            );
          })}
        </nav>
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
