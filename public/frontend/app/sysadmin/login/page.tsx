/**
 * CryptoExam Core — System Admin (tier-0) sign-in.
 *
 * Password, then this machine's fingerprint. The server will not issue a
 * tier-0 token on a password alone, and an account with no enrolled credential
 * is refused rather than falling back — see backend/app/api/v1/sysadmin_auth.py.
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { sysadminApi, type SysAdminStatus } from '@/lib/api/sysadmin';
import { setAuthToken } from '@/lib/api/client';
import s from '../sysadmin.module.css';

export default function SysAdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [stage, setStage] = useState<'idle' | 'password' | 'fingerprint'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SysAdminStatus | null>(null);
  const [hasSensor, setHasSensor] = useState<boolean | null>(null);

  useEffect(() => {
    sysadminApi.status().then(setStatus).catch(() => {});
    sysadminApi.platformAuthenticatorAvailable().then(setHasSensor);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStage('password');
    try {
      // The browser prompt appears during this call — say so before it does,
      // or the sensor popping up looks like something went wrong.
      setStage('fingerprint');
      const r = await sysadminApi.login(email.trim().toLowerCase(), password);
      setAuthToken(r.access_token);
      router.push('/sysadmin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
      setStage('idle');
    }
  }

  return (
    <main className={s.shell}>
      <div className={s.panel}>
        <span className={s.tier}>Tier 0</span>
        <h1 className={s.h1}>System Administration</h1>
        <p className={s.lead}>
          The only tier that can decrypt answers. Sign-in requires this machine&rsquo;s
          fingerprint in addition to your password — a password alone will not do.
        </p>

        {hasSensor === false && (
          <div className={s.warn}>
            No fingerprint sensor (platform authenticator) is available in this browser.
            Tier-0 sign-in cannot complete here. Use the enrolled workstation.
          </div>
        )}

        {status?.already_enrolled === false && (
          <div className={s.warn}>
            No System Admin has been enrolled yet.{' '}
            <Link href="/sysadmin/register">Enrol the first one</Link>.
          </div>
        )}

        <form onSubmit={submit} className={s.form}>
          <label className={s.field}>
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label className={s.field}>
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error && <p className={s.error} role="alert">{error}</p>}

          <button className={s.primary} type="submit" disabled={stage !== 'idle' || hasSensor === false}>
            {stage === 'fingerprint'
              ? 'Waiting for your fingerprint…'
              : stage === 'password'
                ? 'Checking…'
                : 'Sign in with fingerprint'}
          </button>
        </form>

        <p className={s.foot}>
          Registrations from the public site are approved here. A Centre Admin can only be
          approved by this tier; invigilators are approved by their own Centre Admin inside
          the locked OS at the centre.
        </p>
      </div>
    </main>
  );
}
