/**
 * CryptoExam Core — Admin Login Portal
 * Dedicated login for Platform Administrators only.
 */
'use client';

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth/AuthContext';
import { api } from '@/lib/api/client';
import styles from './login.module.css';

type LoginStep = 'EMAIL_ENTRY' | 'EMAIL_OTP' | 'PASSWORD_ENTRY' | 'SMS_OTP';

export default function AdminLoginForm() {
  const { login } = useAuth();
  const [adminId, setAdminId] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [emailOtp, setEmailOtp] = useState('');
  
  const [step, setStep] = useState<LoginStep>('EMAIL_ENTRY');
  
  const [emailChallengeId, setEmailChallengeId] = useState<string | null>(null);
  const [emailVerificationToken, setEmailVerificationToken] = useState<string | null>(null);
  
  const [timeLeft, setTimeLeft] = useState(120);
  const timerRef = React.useRef<NodeJS.Timeout | null>(null);

  if (step !== 'EMAIL_OTP' && timerRef.current) {
    clearInterval(timerRef.current);
    timerRef.current = null;
  }
  
  const [smsChallengeId, setSmsChallengeId] = useState<string | null>(null);
  const [phoneMasked, setPhoneMasked] = useState<string | null>(null);
  const [smsDevCode, setSmsDevCode] = useState<string | null>(null);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [consentExpanded, setConsentExpanded] = useState(false);

  const handleRequestEmailOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminId)) { setError('Invalid admin email format.'); return; }
    
    setLoading(true);
    try {
      const res = await api.requestEmailVerification({ email: adminId, purpose: 'LOGIN', role: 'ADMIN' });
      setEmailChallengeId(res.challenge_id);
      setStep('EMAIL_OTP');
      setTimeLeft(120);
      
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current!);
            setStep('EMAIL_ENTRY');
            setError('OTP expired. Please try again.');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not request email verification.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyEmailOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (emailOtp.length < 6) { setError('Please enter the 6-digit code sent to your email.'); return; }
    
    setLoading(true);
    try {
      const res = await api.verifyEmailOtp({ challenge_id: emailChallengeId!, email: adminId, code: emailOtp });
      setEmailVerificationToken(res.verification_token);
      setStep('PASSWORD_ENTRY');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Incorrect email verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!consentAccepted) { setError('You must accept the consent to proceed.'); return; }
    if (password.length < 4) { setError('Password is too short.'); return; }

    setLoading(true);
    try {
      const res = await api.login({ identifier: adminId, password, role: 'ADMIN', email_verification_token: emailVerificationToken! });
      setSmsChallengeId(res.challenge_id);
      setPhoneMasked(res.phone_masked);
      setSmsDevCode(res.dev_code ?? null);
      setStep('SMS_OTP');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifySmsOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (otp.length < 6) { setError('Please enter the 6-digit code sent to your phone.'); return; }
    
    setLoading(true);
    try {
      const auth = await api.verifyOtp({ challenge_id: smsChallengeId!, code: otp, email_verification_token: emailVerificationToken! });
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

        {step === 'EMAIL_ENTRY' && (
          <form onSubmit={handleRequestEmailOtp} className={styles.form}>
            <div className={styles.field}>
              <label htmlFor="adminId" className={styles.label}>Admin Email</label>
              <input id="adminId" type="email" className={styles.input} placeholder="e.g., admin@cryptoexam.in" value={adminId} onChange={e => setAdminId(e.target.value)} required autoComplete="email" />
            </div>
            {error && <div className={styles.errorMessage}>{error}</div>}
            <button type="submit" className={styles.submitBtn} disabled={loading}>
              {loading ? <span className={styles.spinner} /> : 'Send Email OTP'}
            </button>
          </form>
        )}

        {step === 'EMAIL_OTP' && (
          <form onSubmit={handleVerifyEmailOtp} className={styles.form}>
            <div className={styles.field}>
              <label htmlFor="emailOtp" className={styles.label}>OTP sent to {adminId}</label>
              <input id="emailOtp" type="text" inputMode="numeric" maxLength={6} className={`${styles.input} ${styles.otpInput}`} placeholder="● ● ● ● ● ●" value={emailOtp} onChange={e => setEmailOtp(e.target.value.replace(/\D/g, ''))} autoFocus />
              <p style={{ fontSize: 11, color: '#7d5610', marginTop: 6 }}>Time remaining: {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}</p>
            </div>
            {error && <div className={styles.errorMessage}>{error}</div>}
            <button type="submit" className={styles.submitBtn} disabled={loading}>
              {loading ? <span className={styles.spinner} /> : 'Verify Email OTP'}
            </button>
          </form>
        )}

        {step === 'PASSWORD_ENTRY' && (
          <form onSubmit={handleVerifyPassword} className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label}>Verified Email</label>
              <input type="text" className={styles.input} value={adminId} disabled />
            </div>
            <div className={styles.field}>
              <label htmlFor="password" className={styles.label}>Password</label>
              <input id="password" type="password" className={styles.input} placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" autoFocus />
            </div>

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

            {error && <div className={styles.errorMessage}>{error}</div>}
            <button type="submit" className={styles.submitBtn} disabled={loading || !consentAccepted}>
              {loading ? <span className={styles.spinner} /> : 'Authenticate'}
            </button>
          </form>
        )}

        {step === 'SMS_OTP' && (
          <form onSubmit={handleVerifySmsOtp} className={styles.form}>
            <div className={`${styles.field} ${styles.otpField}`}>
              <label htmlFor="otp" className={styles.label}>OTP sent to {phoneMasked ?? 'your phone'}</label>
              <input id="otp" type="text" inputMode="numeric" maxLength={6} className={`${styles.input} ${styles.otpInput}`} placeholder="● ● ● ● ● ●" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} autoFocus />
              {smsDevCode && <p style={{ fontSize: 11, color: '#7d5610', marginTop: 6 }}>Dev mode (no SMS gateway configured): code is <b>{smsDevCode}</b></p>}
            </div>
            {error && <div className={styles.errorMessage}>{error}</div>}
            <button type="submit" className={styles.submitBtn} disabled={loading}>
              {loading ? <span className={styles.spinner} /> : 'Verify & Login'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
