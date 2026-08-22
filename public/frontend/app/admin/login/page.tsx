/**
 * CryptoExam Core — Admin Login Portal
 * Dedicated login for Platform Administrators only.
 */
'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth/AuthContext';
import { api } from '@/lib/api/client';
import styles from '../../(auth)/login/login.module.css';

export default function AdminLoginPage() {
  const { login } = useAuth();
  const [adminId, setAdminId] = useState('');
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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminId)) { setError('Invalid admin email format.'); return; }
    if (password.length < 4) { setError('Password is too short.'); return; }

    // Step 1 — verify the password; the backend then sends a real OTP to the
    // registered phone and returns a challenge to complete.
    if (!showOtp) {
      setLoading(true);
      try {
        const res = await api.login({ identifier: adminId, password, role: 'ADMIN' });
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

    // Step 2 — verify the OTP; the backend returns the real JWT.
    if (otp.length < 6) { setError('Please enter the 6-digit code sent to your phone.'); return; }
    setLoading(true);
    try {
      const auth = await api.verifyOtp({ challenge_id: challengeId!, code: otp });
      await login('admin', adminId, undefined, auth.access_token);
      window.location.href = '/admin/dashboard';
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
          <p className={styles.tagline}>Platform Administration</p>
        </div>

        <div className={styles.roleBadge}>
          Admin — Restricted Access
        </div>

        <form onSubmit={handleLogin} className={styles.form}>
          <div className={styles.field}>
            <label htmlFor="adminId" className={styles.label}>Admin Email</label>
            <input id="adminId" type="email" className={styles.input} placeholder="e.g., admin@cryptoexam.in" value={adminId} onChange={e => setAdminId(e.target.value)} required autoComplete="email" />
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
              <span>Security Acknowledgement</span><span>{consentExpanded ? '▲' : '▼'}</span>
            </button>
            {consentExpanded && (
              <div className={styles.accordionContent}>
                <p>All administrative actions are permanently logged on-chain. Unauthorized access is a criminal offence under IT Act 2000.</p>
                <label className={styles.consentCheck}><input type="checkbox" checked={consentAccepted} onChange={e => setConsentAccepted(e.target.checked)} /> I acknowledge the security protocols and accept full audit liability.</label>
              </div>
            )}
          </div>

          <button type="submit" className={styles.submitBtn} disabled={loading || !consentAccepted}>
            {loading ? <span className={styles.spinner} /> : showOtp ? 'Verify & Login' : 'Authenticate'}
          </button>
        </form>
      </div>
    </div>
  );
}
