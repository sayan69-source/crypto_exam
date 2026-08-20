/**
 * CryptoExam Core — Setter Login Portal
 * Dedicated login for Question Paper Setters only.
 */
'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth/AuthContext';
import { api } from '@/lib/api/client';
import styles from './login.module.css';

type LoginStep = 'EMAIL_ENTRY' | 'EMAIL_OTP' | 'PASSWORD_ENTRY' | 'SMS_OTP';

export default function SetterLoginForm() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [emailOtp, setEmailOtp] = useState('');
  
  const [step, setStep] = useState<LoginStep>('EMAIL_ENTRY');
  
  const [emailChallengeId, setEmailChallengeId] = useState<string | null>(null);
  const [emailDevCode, setEmailDevCode] = useState<string | null>(null);
  const [emailVerificationToken, setEmailVerificationToken] = useState<string | null>(null);
  
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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Invalid official email format.'); return; }
    
    setLoading(true);
    try {
      const res = await api.requestEmailVerification({ email, purpose: 'LOGIN', role: 'SETTER' });
      setEmailChallengeId(res.challenge_id);
      setEmailDevCode(res.dev_code ?? null);
      setStep('EMAIL_OTP');
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
      const res = await api.verifyEmailOtp({ challenge_id: emailChallengeId!, email, code: emailOtp });
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
      const res = await api.login({ identifier: email, password, role: 'SETTER', email_verification_token: emailVerificationToken! });
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

        {step === 'EMAIL_ENTRY' && (
          <form onSubmit={handleRequestEmailOtp} className={styles.form}>
            <div className={styles.field}>
              <label htmlFor="email" className={styles.label}>Official Email</label>
              <input id="email" type="email" className={styles.input} placeholder="e.g., dr.iyer@nta.gov.in" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
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
              <label htmlFor="emailOtp" className={styles.label}>OTP sent to {email}</label>
              <input id="emailOtp" type="text" inputMode="numeric" maxLength={6} className={`${styles.input} ${styles.otpInput}`} placeholder="● ● ● ● ● ●" value={emailOtp} onChange={e => setEmailOtp(e.target.value.replace(/\D/g, ''))} autoFocus />
              {emailDevCode && <p style={{ fontSize: 11, color: '#7d5610', marginTop: 6 }}>Dev mode (no SMTP configured): code is <b>{emailDevCode}</b></p>}
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
              <input type="text" className={styles.input} value={email} disabled />
            </div>
            <div className={styles.field}>
              <label htmlFor="password" className={styles.label}>Password</label>
              <input id="password" type="password" className={styles.input} placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" autoFocus />
            </div>

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

            {error && <div className={styles.errorMessage}>{error}</div>}
            <button type="submit" className={styles.submitBtn} disabled={loading || !consentAccepted}>
              {loading ? <span className={styles.spinner} /> : 'Verify Password'}
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
