'use client';

/**
 * /login — the single sign-in destination for all four roles.
 *
 * Previously each role had its own login page and there was no way to reach
 * one from another: a setter who landed on the candidate login had to know
 * the URL of theirs. This page puts all four behind one switcher.
 *
 * The four forms are NOT reimplemented here. Each is the original component,
 * with its own flow intact — candidate roll+DOB, setter and admin
 * password→OTP with consent, and the invigilator's five-step biometric
 * sequence (geofence → face → fingerprint → OTP). The role routes
 * (/setter/login and friends) still exist and render the same components, so
 * every existing link and every post-logout redirect keeps working.
 *
 * ?role=setter preselects a tab, which is what those routes and the role hubs
 * link to.
 */

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Icon from '@/components/marketing/LucideIcon';
import CandidateLoginForm from '@/components/auth/CandidateLoginForm';
import SetterLoginForm from '@/components/auth/SetterLoginForm';
import InvigilatorLoginForm from '@/components/auth/InvigilatorLoginForm';
import AdminLoginForm from '@/components/auth/AdminLoginForm';
import s from './login-hub.module.css';

type RoleId = 'candidate' | 'setter' | 'invigilator' | 'admin';

const ROLES: {
  id: RoleId;
  label: string;
  icon: string;
  credential: string;
}[] = [
  { id: 'candidate',   label: 'Candidate',   icon: 'graduation-cap', credential: 'Roll number and date of birth' },
  { id: 'setter',      label: 'Setter',      icon: 'pen-tool',       credential: 'Official email, password, then a code by SMS' },
  { id: 'invigilator', label: 'Invigilator', icon: 'user-check',     credential: 'Staff ID, then location, face and fingerprint' },
  { id: 'admin',       label: 'Admin',       icon: 'shield',         credential: 'Admin email, password, then a code by SMS' },
];

function LoginHub() {
  const params = useSearchParams();
  const [role, setRole] = useState<RoleId>('candidate');

  // Deep links (/login?role=admin) and the role hubs preselect a tab.
  useEffect(() => {
    const r = params.get('role');
    if (r && ROLES.some((x) => x.id === r)) setRole(r as RoleId);
  }, [params]);

  const active = ROLES.find((r) => r.id === role)!;

  return (
    <main className={s.main}>
      <div className={s.shell}>
        <header className={s.head}>
          <span className="eyebrow">Sign in</span>
          <h1 className={s.h1}>Which portal do you need?</h1>
          <p className={s.sub}>
            Four roles, four different checks. Pick yours — every route below is the same
            sign-in the portal itself uses.
          </p>
        </header>

        <div className={s.switcher} role="tablist" aria-label="Choose your role">
          {ROLES.map((r) => (
            <button
              key={r.id}
              role="tab"
              type="button"
              aria-selected={role === r.id}
              aria-controls="login-panel"
              className={`${s.roleBtn} ${role === r.id ? s.roleOn : ''}`}
              onClick={() => setRole(r.id)}
            >
              <Icon name={r.icon} size={18} strokeWidth={1.8} />
              <span>{r.label}</span>
            </button>
          ))}
        </div>

        <p className={s.credential} aria-live="polite">
          <Icon name="key-round" size={14} strokeWidth={2} />
          {active.credential}
        </p>

        {/* Each role keeps its own form and its own flow, unchanged. */}
        <div className={s.panel} id="login-panel" role="tabpanel" aria-label={`${active.label} sign in`}>
          {role === 'candidate' && <CandidateLoginForm />}
          {role === 'setter' && <SetterLoginForm />}
          {role === 'invigilator' && <InvigilatorLoginForm />}
          {role === 'admin' && <AdminLoginForm />}
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary during prerender.
  return (
    <Suspense fallback={null}>
      <LoginHub />
    </Suspense>
  );
}
