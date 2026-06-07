/**
 * CryptoExam Core — Unified Login Page
 * Navy-950 background with rangoli SVG pattern, white centered card
 * Role tabs: Candidate / Setter / Admin
 */
'use client';

import { useState } from 'react';
import Link from 'next/link';
import styles from './login.module.css';

type AuthRole = 'candidate' | 'setter' | 'admin';

export default function LoginPage() {
  const [role, setRole] = useState<AuthRole>('candidate');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showOtp, setShowOtp] = useState(false);
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consentAccepted) return;
    setLoading(true);
    // Simulate login
    await new Promise(r => setTimeout(r, 1200));
    if (!showOtp) {
      setShowOtp(true);
      setLoading(false);
      return;
    }
    // Redirect based on role
    const paths = { candidate: '/exam/dashboard', setter: '/setter/dashboard', admin: '/admin/dashboard' };
    window.location.href = paths[role];
  };

  const identifierLabels: Record<AuthRole, { label: string; placeholder: string }> = {
    candidate: { label: 'Exam Roll Number', placeholder: 'e.g., NEET-2026-BIH-0847291' },
    setter: { label: 'Official Email', placeholder: 'e.g., dr.iyer@nta.gov.in' },
    admin: { label: 'Admin ID', placeholder: 'e.g., admin@cryptoexam.in' },
  };

  const passwordLabels: Record<AuthRole, string> = {
    candidate: 'Date of Birth (DD/MM/YYYY)',
    setter: 'Password',
    admin: 'Password',
  };

  return (
    <div className={styles.page}>
      {/* Subtle rangoli SVG background pattern */}
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
          <span className={styles.logoIcon}>🔐</span>
          <h1 className={styles.logoTitle}>CryptoExam Core</h1>
          <p className={styles.tagline}>{taglines[language] || taglines.en}</p>
        </div>

        {/* Role tabs */}
        <div className={styles.roleTabs}>
          {(['candidate', 'setter', 'admin'] as AuthRole[]).map(r => (
            <button
              key={r}
              className={`${styles.roleTab} ${role === r ? styles.roleActive : ''}`}
              onClick={() => { setRole(r); setShowOtp(false); }}
            >
              {r === 'candidate' ? '📝 Candidate' : r === 'setter' ? '🔬 Setter' : '🛡️ Admin'}
            </button>
          ))}
        </div>

        {/* Login Form */}
        <form onSubmit={handleLogin} className={styles.form}>
          <div className={styles.field}>
            <label htmlFor="identifier" className={styles.label}>
              {identifierLabels[role].label}
            </label>
            <input
              id="identifier"
              type="text"
              className={styles.input}
              placeholder={identifierLabels[role].placeholder}
              value={identifier}
              onChange={e => setIdentifier(e.target.value)}
              required
              autoComplete="username"
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="password" className={styles.label}>{passwordLabels[role]}</label>
            <input
              id="password"
              type={role === 'candidate' ? 'text' : 'password'}
              className={styles.input}
              placeholder={role === 'candidate' ? 'DD/MM/YYYY' : '••••••••'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete={role === 'candidate' ? 'bday' : 'current-password'}
            />
          </div>

          {/* OTP Field */}
          {showOtp && (
            <div className={`${styles.field} ${styles.otpField}`}>
              <label htmlFor="otp" className={styles.label}>OTP (sent to registered mobile)</label>
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
              <button type="button" className={styles.resendBtn} disabled>
                Resend OTP (60s)
              </button>
            </div>
          )}

          {/* DPDP Consent */}
          <div className={styles.accordion}>
            <button
              type="button"
              className={styles.accordionToggle}
              onClick={() => setConsentExpanded(!consentExpanded)}
            >
              <span>🔒 DPDP Act 2023 Data Consent</span>
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
            <span>❓ What is CryptoExam Core?</span>
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
            🔍 Public Audit Portal — Verify any exam (No Login Required)
          </Link>
        </div>
      </div>
    </div>
  );
}
