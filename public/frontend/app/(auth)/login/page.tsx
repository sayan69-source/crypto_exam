/**
 * CryptoExam Core — Candidate Login Portal
 * This is STRICTLY for candidates. Setters and Admins have separate portals.
 */
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth/AuthContext';
import { api } from '@/lib/api/client';
import styles from './login.module.css';

export default function CandidateLoginPage() {
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showOtp, setShowOtp] = useState(false);
  const [otp, setOtp] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [phoneMasked, setPhoneMasked] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consentExpanded, setConsentExpanded] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [whatIsExpanded, setWhatIsExpanded] = useState(false);
  const [language, setLanguage] = useState('en');

  const taglines: Record<string, string> = {
    en: 'Your answers. Mathematically protected.',
    hi: 'आपके उत्तर। गणितीय रूप से सुरक्षित।',
    bn: 'আপনার উত্তর। গাণিতিকভাবে সুরক্ষিত।',
    te: 'మీ సమాధానాలు. గణిత శాస్త్రపరంగా రక్షించబడ్డాయి.',
    ta: 'உங்கள் விடைகள். கணிதரீதியாக பாதுகாக்கப்பட்டவை.',
    mr: 'तुमची उत्तरे. गणितीयदृष्ट्या संरक्षित.',
  };

  const validateForm = () => {
    setError(null);
    if (!identifier.trim()) {
      setError('Enter your exam roll number.');
      return false;
    }
    if (password.length < 4) {
      setError('Enter your password.');
      return false;
    }
    return true;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consentAccepted) {
      setError('You must accept the DPDP Act 2023 consent to proceed.');
      return;
    }
    if (!validateForm()) return;

    // Step 1 — verify roll number + password; backend sends a real OTP to the
    // candidate's registered phone.
    if (!showOtp) {
      setLoading(true);
      try {
        const res = await api.login({ identifier: identifier.trim(), password, role: 'CANDIDATE' });
        setChallengeId(res.challenge_id);
        setPhoneMasked(res.phone_masked);
        setDevCode(res.dev_code ?? null);
        setShowOtp(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Login failed. Check your roll number and password.');
      } finally {
        setLoading(false);
      }
      return;
    }

    // Step 2 — verify OTP; backend returns the real JWT.
    if (otp.length < 6) {
      setError('Please enter the 6-digit code sent to your phone.');
      return;
    }
    setLoading(true);
    try {
      const auth = await api.verifyOtp({ challenge_id: challengeId!, code: otp });
      await login('candidate', identifier, undefined, auth.access_token);
      window.location.href = '/exam/system-check';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Incorrect code. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.patternBg} />

      {/* Language selector */}
      <div className={styles.langSelector}>
        {[
          { code: 'en', label: 'EN' },
          { code: 'hi', label: 'हिंदी' },
          { code: 'bn', label: 'বাংলা' },
          { code: 'te', label: 'తెలుగు' },
          { code: 'ta', label: 'தமிழ்' },
          { code: 'mr', label: 'मराठी' },
        ].map(l => (
          <button
            key={l.code}
            className={`${styles.langBtn} ${language === l.code ? styles.langActive : ''}`}
            onClick={() => setLanguage(l.code)}
          >
            {l.label}
          </button>
        ))}
      </div>

      <div className={styles.card}>
        {/* Logo */}
        <div className={styles.logoArea}>
          <span className={styles.logoIcon}></span>
          <h1 className={styles.logoTitle}>CryptoExam Core</h1>
          <p className={styles.tagline}>{taglines[language] || taglines.en}</p>
        </div>

        {/* Role Badge */}
        <div className={styles.roleBadge}>
          Candidate Examination Portal
        </div>

        {/* Login Form */}
        <form onSubmit={handleLogin} className={styles.form}>
          <div className={styles.field}>
            <label htmlFor="identifier" className={styles.label}>
              Exam Roll Number
            </label>
            <input
              id="identifier"
              type="text"
              className={styles.input}
              placeholder="e.g., NEET-2026-BIH-0847291"
              value={identifier}
              onChange={e => setIdentifier(e.target.value.toUpperCase())}
              required
              autoComplete="username"
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="password" className={styles.label}>Password</label>
            <input
              id="password"
              type="password"
              className={styles.input}
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          {/* OTP Field */}
          {showOtp && (
            <div className={`${styles.field} ${styles.otpField}`}>
              <label htmlFor="otp" className={styles.label}>OTP sent to {phoneMasked ?? 'your registered mobile'}</label>
              <input
                id="otp"
                type="text"
                inputMode="numeric"
                maxLength={6}
                className={`${styles.input} ${styles.otpInput}`}
                placeholder="● ● ● ● ● ●"
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                autoFocus
              />
              {devCode && <p style={{ fontSize: 11, color: '#92400e', marginTop: 6 }}>Dev mode (no SMS gateway configured): code is <b>{devCode}</b></p>}
            </div>
          )}

          {error && (
            <div className={styles.errorMessage}>
              {error}
            </div>
          )}

          {/* DPDP Consent */}
          <div className={styles.accordion}>
            <button
              type="button"
              className={styles.accordionToggle}
              onClick={() => setConsentExpanded(!consentExpanded)}
            >
              <span>DPDP Act 2023 Data Consent</span>
              <span>{consentExpanded ? '▲' : '▼'}</span>
            </button>
            {consentExpanded && (
              <div className={styles.accordionContent}>
                <p>Your data is processed under the Digital Personal Data Protection Act 2023 (India). You have the right to access, correct, and erase your data.</p>
                <p><strong>Biometric data (facial embeddings) is NEVER stored</strong> — only a mathematical fingerprint is used for verification and then discarded immediately.</p>
                <p>All exam answers are cryptographically hashed and committed to a public blockchain. Your personal identity is never linked to on-chain data.</p>
                <label className={styles.consentCheck}>
                  <input
                    type="checkbox"
                    checked={consentAccepted}
                    onChange={e => setConsentAccepted(e.target.checked)}
                  />
                  I have read and agree to the data processing terms under DPDP Act 2023
                </label>
              </div>
            )}
          </div>

          <button
            type="submit"
            className={styles.submitBtn}
            disabled={loading || !consentAccepted}
          >
            {loading ? (
              <span className={styles.spinner} />
            ) : showOtp ? (
              'Verify & Login'
            ) : (
              'Send OTP'
            )}
          </button>
        </form>

        {/* What is CryptoExam? */}
        <div className={styles.accordion}>
          <button
            type="button"
            className={styles.accordionToggle}
            onClick={() => setWhatIsExpanded(!whatIsExpanded)}
          >
            <span>What is CryptoExam Core?</span>
            <span>{whatIsExpanded ? '▲' : '▼'}</span>
          </button>
          {whatIsExpanded && (
            <div className={styles.accordionContent}>
              <p>CryptoExam Core is a zero-trust examination platform that uses advanced cryptography to protect your exam.</p>
              <p>Think of it as a <strong>sealed, notarised vault</strong> — the government cannot open it before exam time, and cannot modify it after. Your answers are mathematically locked on a public blockchain that anyone can verify.</p>
              <p>No official, no hacker, and no insider can modify your answers after submission. The math is the proof.</p>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <Link href="/exam/audit" className={styles.auditLink}>
            Public Audit Portal — Verify any exam (No Login Required)
          </Link>
        </div>
      </div>
    </div>
  );
}
