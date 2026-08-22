/**
 * CryptoExam Core — Setter Self-Registration
 * A prospective question-setter applies for access. Creates a real INACTIVE
 * setter account (pending admin approval); login stays gated until approved.
 */
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { setterApi } from '@/lib/api/setter';
import { TRUSTED_INSTITUTIONS } from '@/lib/data/trusted-institutions';
import styles from '../../(auth)/login/login.module.css';

export default function SetterRegisterPage() {
  const [form, setForm] = useState({ full_name: '', email: '', password: '', institution: '', phone: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.full_name.trim().length < 2) { setError('Enter your full name.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) { setError('Enter a valid official email.'); return; }
    if (form.password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setLoading(true);
    try {
      const res = await setterApi.signup({
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        password: form.password,
        institution: form.institution || undefined,
        phone: form.phone || undefined,
      });
      setDone(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.patternBg} />
      <div className={styles.card}>
        <div className={styles.logoArea}>
          <span className={styles.logoIcon} />
          <h1 className={styles.logoTitle}>CryptoExam Core</h1>
          <p className={styles.tagline}>Question Paper Setter — Apply for Access</p>
        </div>

        <div className={styles.roleBadge}>New Setter Registration</div>

        {done ? (
          <div style={{ textAlign: 'center', padding: '8px 4px' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>✓</div>
            <p style={{ fontSize: 14, color: 'var(--color-navy-200, #334155)', lineHeight: 1.6 }}>{done}</p>
            <Link href="/setter/login" className={styles.submitBtn} style={{ display: 'inline-block', marginTop: 18, textDecoration: 'none' }}>
              Back to Setter Login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.field}>
              <label htmlFor="name" className={styles.label}>Full Name</label>
              <input id="name" type="text" className={styles.input} placeholder="Prof. Arvind Krishnamurthy" value={form.full_name} onChange={set('full_name')} required />
            </div>
            <div className={styles.field}>
              <label htmlFor="email" className={styles.label}>Official Email</label>
              <input id="email" type="email" className={styles.input} placeholder="name@iitb.ac.in" value={form.email} onChange={set('email')} required autoComplete="email" />
            </div>
            <div className={styles.field}>
              <label htmlFor="institution" className={styles.label}>Institution</label>
              <select id="institution" className={styles.input} value={form.institution} onChange={set('institution')}>
                <option value="">Select your institution…</option>
                {TRUSTED_INSTITUTIONS.map((i) => (
                  <option key={i.id} value={i.name}>{i.short_name} — {i.location}</option>
                ))}
                <option value="Other">Other</option>
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="phone" className={styles.label}>Phone (for login OTP)</label>
              <input id="phone" type="tel" className={styles.input} placeholder="+91 90000 00000" value={form.phone} onChange={set('phone')} />
            </div>
            <div className={styles.field}>
              <label htmlFor="password" className={styles.label}>Password</label>
              <input id="password" type="password" className={styles.input} placeholder="At least 8 characters" value={form.password} onChange={set('password')} required autoComplete="new-password" />
            </div>

            {error && <div className={styles.errorMessage}>{error}</div>}

            <button type="submit" className={styles.submitBtn} disabled={loading}>
              {loading ? <span className={styles.spinner} /> : 'Apply for Setter Access'}
            </button>

            <p style={{ fontSize: 12, color: 'var(--color-navy-400, #64748b)', textAlign: 'center', marginTop: 12 }}>
              Already approved? <Link href="/setter/login" style={{ color: 'var(--color-india-saffron, #FF9933)' }}>Sign in</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
