/**
 * CryptoExam Core — System Admin (tier-0) enrolment.
 *
 * Restricted to an operator-controlled address. The page asks the server which
 * address it sees, so an operator can allowlist themselves rather than guess
 * why a 403 happened.
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { sysadminApi, setEnrolmentToken, type SysAdminStatus } from '@/lib/api/sysadmin';
import s from '../sysadmin.module.css';

export default function SysAdminRegisterPage() {
  const router = useRouter();
  const [status, setStatus] = useState<SysAdminStatus | null>(null);
  const [hasSensor, setHasSensor] = useState<boolean | null>(null);
  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirm: '' });
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    sysadminApi.status().then(setStatus).catch((e) => setError(String(e.message)));
    sysadminApi.platformAuthenticatorAvailable().then(setHasSensor);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.password !== form.confirm) return setError('The two passwords do not match.');
    if (form.password.length < 12) return setError('Use at least 12 characters for a tier-0 password.');

    setBusy(true);
    try {
      setEnrolmentToken(token);
      await sysadminApi.register({
        email: form.email.trim().toLowerCase(),
        fullName: form.fullName.trim(),
        password: form.password,
      });
      setDone(true);
      setTimeout(() => router.push('/sysadmin/login'), 2600);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enrolment failed.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <main className={s.shell}>
        <div className={s.panel}>
          <span className={s.tier}>Tier 0</span>
          <h1 className={s.h1}>Enrolled</h1>
          <p className={s.lead}>
            Your fingerprint is now bound to this machine and this account. From here on,
            signing in requires it — a password alone will not produce a tier-0 token.
          </p>
          <p className={s.foot}>Taking you to sign-in…</p>
        </div>
      </main>
    );
  }

  const blocked = status && !status.enrolment_open;

  return (
    <main className={s.shell}>
      <div className={s.panel}>
        <Link href="/" className={s.back}>← CryptoExam Core</Link>
        <span className={s.tier}>Tier 0</span>
        <h1 className={s.h1}>Enrol the System Administrator</h1>
        <p className={s.lead}>
          This is the root of trust: the only tier that can approve Centre Admins and
          decrypt answers. Enrolment happens once, from an approved machine, and binds
          the account to that machine&rsquo;s fingerprint sensor.
        </p>

        {status && (
          <div className={status.enrolment_open ? s.ok : s.warn}>
            <strong>This request came from {status.your_ip}</strong>
            <br />
            {status.hint}
            {!status.enrolment_open && !status.already_enrolled && (
              <>
                <br />
                {/* On a hosted platform the address is not stable, so leading
                    with the allowlist sends operators down a route that will
                    keep failing. The token is the one that works. */}
                <code className={s.code}>SYSTEM_ADMIN_ENROLMENT_TOKEN=&lt;a long random value&gt;</code>
                <br />
                <span style={{ fontSize: 11.5, opacity: 0.85 }}>
                  Set that on the API service, redeploy, then paste the same value below.
                  Enrolling from a fixed office address instead? Use{' '}
                  <code className={s.code}>SYSTEM_ADMIN_ALLOWED_IPS={status.your_ip}</code>
                </span>
              </>
            )}
          </div>
        )}

        {hasSensor === false && (
          <div className={s.warn}>
            No fingerprint sensor is available in this browser, so enrolment cannot
            complete here — the credential must live in a real secure element.
          </div>
        )}

        {status?.already_enrolled && (
          <div className={s.warn}>
            A System Admin already exists, so enrolment is closed.{' '}
            <Link href="/sysadmin/login">Sign in instead</Link>.
          </div>
        )}

        <form onSubmit={submit} className={s.form}>
          <label className={s.field}>
            <span>Full name</span>
            <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Your full legal name" autoComplete="name" required />
          </label>
          <label className={s.field}>
            <span>Email</span>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@organisation.in" autoComplete="username" required />
          </label>
          <label className={s.field}>
            <span>Password <em>(12+ characters)</em></span>
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 12 characters" autoComplete="new-password" minLength={12} required />
          </label>
          {status && !status.enrolment_open && !status.already_enrolled && (
            <label className={s.field}>
              <span>Enrolment token <em>(from the server environment)</em></span>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste SYSTEM_ADMIN_ENROLMENT_TOKEN"
                autoComplete="off"
              />
            </label>
          )}
          <label className={s.field}>
            <span>Confirm password</span>
            <input type="password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} placeholder="Type it again" autoComplete="new-password" required />
          </label>

          {error && <p className={s.error} role="alert">{error}</p>}

          <button className={s.primary} type="submit" disabled={busy || hasSensor === false || status?.already_enrolled === true}>
            {busy ? 'Touch the sensor…' : 'Enrol with fingerprint'}
          </button>
        </form>

        <p className={s.foot}>
          Your fingerprint never leaves this device. The server stores only the public
          half of the credential, so a stolen database cannot impersonate you.
        </p>
      </div>
    </main>
  );
}
