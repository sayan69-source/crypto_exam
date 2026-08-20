/**
 * CryptoExam Core — Admin Layout
 * Light top bar + light sidebar + main content.
 * "Professional Mission Control" — clean SaaS dashboard.
 */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import Icon from '@/components/marketing/LucideIcon';
import styles from './AdminLayout.module.css';
import { useAuth } from '@/lib/auth/AuthContext';
import { adminApi } from '@/lib/api/admin';

const NAV_ITEMS = [
  { href: '/admin/dashboard', label: 'Mission Control', icon: 'radar' },
  { href: '/admin/exams', label: 'Exams', icon: 'clipboard-list' },
  { href: '/admin/centers', label: 'Centers Map', icon: 'map' },
  { href: '/admin/nodes', label: 'Hardware Nodes', icon: 'cpu' },
  { href: '/admin/blockchain', label: 'Blockchain', icon: 'link' },
  { href: '/admin/centre-admin-approvals', label: 'Centre-Admin Approvals', icon: 'user-check' },
  { href: '/admin/answer-vault', label: 'Answer Vault', icon: 'lock' },
  { href: '/admin/candidates', label: 'Candidates', icon: 'users-round' },
  { href: '/admin/enquiries', label: 'Enquiries', icon: 'mail' },
  { href: '/admin/emergency', label: 'Emergency', icon: 'siren', emergency: true },
  { href: '/admin/roles', label: 'Roles', icon: 'key-round' },
  { href: '/admin/reports', label: 'Reports', icon: 'file-check' },
];

interface AdminLayoutProps {
  children: React.ReactNode;
}

/**
 * Everything in this header used to be invented.
 *
 * `userName = 'Vikram S. Rathore'` was a default parameter no caller ever
 * overrode, so every administrator saw a stranger's name as their own.
 * `alertCount = 4` was a permanent red badge counting nothing, "1 LIVE" was a
 * literal, and "System Healthy" was a claim the page made without asking
 * anything. Four pieces of fabricated status on the console whose whole job is
 * to report real state.
 *
 * All four now come from the session and the live backend, and each degrades
 * honestly: an unknown name shows the signed-in identifier, an unreachable
 * backend says so rather than reporting health.
 */
export default function AdminLayout({ children }: AdminLayoutProps) {
  const pathname = usePathname();
  const { session } = useAuth();
  if (pathname === '/admin/login') {
    return <>{children}</>;
  }
  const [clockTime, setClockTime] = useState(new Date());
  const [live, setLive] = useState<number | null>(null);
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [alerts, setAlerts] = useState(0);

  // Real counts: live exams, unanswered enquiries, and whether the API answers.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const d = await adminApi.dashboard();
        if (!alive) return;
        setLive(d.exams?.LIVE ?? 0);
        const h = d.system_health ?? {};
        setHealthy(Object.values(h).every((v) => ['up', 'ok', 'healthy', 'connected'].includes(String(v).toLowerCase())));
      } catch {
        if (alive) setHealthy(false);
      }
      try {
        const e = await adminApi.enquiries();
        if (alive) setAlerts((e.counts?.NEW ?? 0) + (e.counts?.IN_REVIEW ?? 0));
      } catch { /* a failed count must not invent one */ }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const userName = session?.name?.trim() || session?.identifier || 'Signed in';

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
            {live === null ? '— LIVE' : `${live} LIVE`}
          </span>
          <span className={styles.healthBadge}>
            <Icon
              name={healthy === false ? 'alert-triangle' : 'check-circle-2'}
              size={14}
              strokeWidth={1.7}
            />
            {healthy === null ? 'Checking…' : healthy ? 'System Healthy' : 'Backend unreachable'}
          </span>
        </div>
        <div className={styles.topRight}>
          <div className={styles.clock}>
            <span className={styles.clockTime}>{formattedTime}</span>
            <span className={styles.clockDate}>{formattedDate} IST</span>
          </div>
          {alerts > 0 && (
            <Link href="/admin/enquiries" className={styles.alertBadge} title={`${alerts} enquiry(s) awaiting a reply`}>
              {alerts}
            </Link>
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
