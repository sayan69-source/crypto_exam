/**
 * Tier-0 shell.
 *
 * The console page rendered with no chrome at all — no header, no identity, no
 * sign-out — so a successful login landed on what looked like a stray
 * fragment rather than a console.
 *
 * Deliberately NOT the tier-1 AdminLayout: that shell carries twelve
 * operational sections (centres, nodes, candidates, emergencies) which tier-0
 * has no business touching. This tier does two things — approve Centre Admins
 * and hold the decryption authority — and the chrome should say so rather than
 * implying a breadth of power the role does not have.
 *
 * Sign-in and enrolment keep their own full-bleed panels; wrapping them in
 * console chrome would frame them as part of a console the visitor has not
 * entered yet.
 */
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/AuthContext';
import Icon from '@/components/marketing/LucideIcon';
import NotificationBell from '@/components/admin/NotificationBell';
import s from './shell.module.css';

export default function SysAdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, logout } = useAuth();

  // The auth screens are their own full-page surfaces.
  if (pathname === '/sysadmin/login' || pathname === '/sysadmin/register') {
    return <>{children}</>;
  }

  const name = session?.name?.trim() || session?.identifier || 'System Administrator';

  return (
    <div className={s.shell}>
      <header className={s.bar}>
        <div className={s.left}>
          <Link href="/" className={s.brand}>
            <span className={s.mark}><Icon name="shield-check" size={15} strokeWidth={1.9} /></span>
            <span className={s.brandText}>CryptoExam<b>Core</b></span>
          </Link>
        </div>

        <div className={s.right}>
          {/* Lives in the chrome, not on the console page: a delivery that
              lands while the operator is on any other tier-0 screen still has
              to reach them. */}
          <NotificationBell />
          <span className={s.who} title={session?.identifier}>
            <span className={s.avatar}>{name.charAt(0).toUpperCase()}</span>
            {name}
          </span>
          <button
            className={s.signOut}
            onClick={() => { logout(); router.replace('/sysadmin/login'); }}
          >
            Sign out
          </button>
        </div>
      </header>

      <main className={s.main}>{children}</main>

      <footer className={s.foot}>
        Tier 0 · Centre Admin approval and decryption authority.{' '}
        <Link href="/admin/dashboard">Operations console</Link>
      </footer>
    </div>
  );
}
