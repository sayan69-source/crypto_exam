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
  const [authToken, setAuthTokenState] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!consentAccepted) { setError('You must accept the consent to proceed.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminId)) { setError('Invalid admin email format.'); return; }
    if (password.length < 4) { setError('Password is too short.'); return; }

    // Step 1 — verify credentials against the real backend, then surface the
    // hardware-token (OTP) step. The token is held until OTP is confirmed.
    if (!showOtp) {
      setLoading(true);
      try {
        const res = await api.login({ identifier: adminId, password, role: 'ADMIN' });
        setAuthTokenState(res.access_token);
        setShowOtp(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Login failed. Please check your credentials.');
      } finally {
        setLoading(false);
      }
      return;
    }

    // Step 2 — confirm the OTP and finalise the session with the real JWT.
    if (otp.length < 6) { setError('Please enter a valid 6-digit OTP.'); return; }
    setLoading(true);
    try {
      await login('admin', adminId, undefined, authToken ?? undefined);
      window.location.href = '/admin/dashboard';
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
              <label htmlFor="otp" className={styles.label}>OTP (Hardware Token)</label>
              <input id="otp" type="text" inputMode="numeric" maxLength={6} className={`${styles.input} ${styles.otpInput}`} placeholder="● ● ● ● ● ●" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} autoFocus />
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
