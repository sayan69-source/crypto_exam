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
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [phoneMasked, setPhoneMasked] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!consentAccepted) { setError('You must accept the consent to proceed.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Invalid official email format.'); return; }
    if (password.length < 4) { setError('Password is too short.'); return; }

    // Step 1 — verify the password; backend sends a real OTP to the phone.
    if (!showOtp) {
      setLoading(true);
      try {
        const res = await api.login({ identifier: email, password, role: 'SETTER' });
        setChallengeId(res.challenge_id);
        setPhoneMasked(res.phone_masked);
        setDevCode(res.dev_code ?? null);
        setShowOtp(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Login failed. Please check your credentials.');
      } finally {
        setLoading(false);
      }
      return;
    }

    // Step 2 — verify the OTP; backend returns the real JWT.
    if (otp.length < 6) { setError('Please enter the 6-digit code sent to your phone.'); return; }
    setLoading(true);
    try {
      const auth = await api.verifyOtp({ challenge_id: challengeId!, code: otp });
      await login('setter', email, undefined, auth.access_token);
      window.location.href = '/setter/dashboard';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Incorrect code. Please try again.');
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
              <label htmlFor="otp" className={styles.label}>OTP sent to {phoneMasked ?? 'your phone'}</label>
              <input id="otp" type="text" inputMode="numeric" maxLength={6} className={`${styles.input} ${styles.otpInput}`} placeholder="● ● ● ● ● ●" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} autoFocus />
              {devCode && <p style={{ fontSize: 11, color: '#92400e', marginTop: 6 }}>Dev mode (no SMS gateway configured): code is <b>{devCode}</b></p>}
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

          <p style={{ fontSize: 12, color: 'var(--color-navy-400, #64748b)', textAlign: 'center', marginTop: 12 }}>
            New setter? <a href="/setter/register" style={{ color: 'var(--color-india-saffron, #FF9933)' }}>Apply for access</a>
          </p>
        </form>
      </div>
    </div>
  );
}
