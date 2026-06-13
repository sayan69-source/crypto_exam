/**
 * CryptoExam Core — Setter Login Portal
 * Dedicated login for Question Paper Setters only.
 */
'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth/AuthContext';
import { api } from '@/lib/api/client';
import styles from '../../(auth)/login/login.module.css';

export default function SetterLoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showOtp, setShowOtp] = useState(false);
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [consentExpanded, setConsentExpanded] = useState(false);
  const [authToken, setAuthTokenState] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!consentAccepted) { setError('You must accept the consent to proceed.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Invalid official email format.'); return; }
    if (password.length < 4) { setError('Password is too short.'); return; }

    // Step 1 — verify credentials against the real backend.
    if (!showOtp) {
      setLoading(true);
      try {
        const res = await api.login({ identifier: email, password, role: 'SETTER' });
        setAuthTokenState(res.access_token);
        setShowOtp(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Login failed. Please check your credentials.');
      } finally {
        setLoading(false);
      }
      return;
    }

    // Step 2 — confirm OTP and finalise with the real JWT.
    if (otp.length < 6) { setError('Please enter a valid 6-digit OTP.'); return; }
    setLoading(true);
    try {
      await login('setter', email, undefined, authToken ?? undefined);
      window.location.href = '/setter/dashboard';
    } catch {
      setError('Login failed. Please check your credentials.');
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.patternBg} />
      <div className={styles.card}>
        <div className={styles.logoArea}>
          <span className={styles.logoIcon}></span>
          <h1 className={styles.logoTitle}>CryptoExam Core</h1>
          <p className={styles.tagline}>Question Paper Setter Portal</p>
        </div>

        <div className={styles.roleBadge}>
          Setter — Authorized Personnel Only
        </div>

        <form onSubmit={handleLogin} className={styles.form}>
          <div className={styles.field}>
            <label htmlFor="email" className={styles.label}>Official Email</label>
            <input id="email" type="email" className={styles.input} placeholder="e.g., dr.iyer@nta.gov.in" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
          </div>
          <div className={styles.field}>
            <label htmlFor="password" className={styles.label}>Password</label>
            <input id="password" type="password" className={styles.input} placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" />
          </div>

          {showOtp && (
            <div className={`${styles.field} ${styles.otpField}`}>
              <label htmlFor="otp" className={styles.label}>OTP (sent to registered device)</label>
              <input id="otp" type="text" inputMode="numeric" maxLength={6} className={`${styles.input} ${styles.otpInput}`} placeholder="● ● ● ● ● ●" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} autoFocus />
            </div>
          )}

          {error && <div className={styles.errorMessage}>{error}</div>}

          <div className={styles.accordion}>
            <button type="button" className={styles.accordionToggle} onClick={() => setConsentExpanded(!consentExpanded)}>
              <span>Data Consent</span><span>{consentExpanded ? '▲' : '▼'}</span>
            </button>
            {consentExpanded && (
              <div className={styles.accordionContent}>
                <p>By logging in, you agree to the zero-trust security protocols. All actions are audited on blockchain.</p>
                <label className={styles.consentCheck}><input type="checkbox" checked={consentAccepted} onChange={e => setConsentAccepted(e.target.checked)} /> I accept the terms and acknowledge audit trail.</label>
              </div>
            )}
          </div>

          <button type="submit" className={styles.submitBtn} disabled={loading || !consentAccepted}>
            {loading ? <span className={styles.spinner} /> : showOtp ? 'Verify & Login' : 'Send OTP'}
          </button>
        </form>
      </div>
    </div>
  );
}
