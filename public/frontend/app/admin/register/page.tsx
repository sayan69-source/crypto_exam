"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Footer from "@/components/marketing/Footer";
import Icon from "@/components/marketing/LucideIcon";
import { api } from "@/lib/api/client";
import s from "@/app/contact/page.module.css";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

export default function AdminRegistrationPage() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [step, setStep] = useState<'FORM' | 'OTP'>('FORM');
  const [formData, setFormData] = useState<FormData | null>(null);
  const [emailChallengeId, setEmailChallengeId] = useState<string | null>(null);
  const [emailOtp, setEmailOtp] = useState('');
  const [resendCount, setResendCount] = useState(0);

  const [timeLeft, setTimeLeft] = useState(120);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  if (step !== 'OTP' && timerRef.current) {
    clearInterval(timerRef.current);
    timerRef.current = null;
  }

  async function handleRequestOtp(e: React.FormEvent | null, isResend = false) {
    if (e) e.preventDefault();
    if (!formRef.current?.checkValidity()) {
      formRef.current?.reportValidity();
      return;
    }
    const data = new FormData(formRef.current!);
    
    if (data.get('password') !== data.get('confirmPassword')) {
      setSubmitError('Passwords do not match');
      return;
    }
    
    setFormData(data);
    setSubmitting(true);
    setSubmitError(null);
    try {
      const email = data.get('email') as string;
      const res = await api.requestEmailVerification({ email, purpose: 'REGISTER' });
      setEmailChallengeId(res.challenge_id);
      setStep('OTP');
      setTimeLeft(120);
      if (isResend) setResendCount(prev => prev + 1);
      else setResendCount(0);

      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current!);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not send a verification code.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyAndSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (emailOtp.length < 6) {
      setSubmitError('Enter the 6-digit OTP.');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const get = (k: string) => String(formData!.get(k) ?? '').trim();
      const email = get('email');

      const verifyRes = await api.verifyEmailOtp({ challenge_id: emailChallengeId!, email, code: emailOtp });
      const verificationToken = verifyRes.verification_token;

      const payload = {
        full_name: get('fullName'),
        email: email,
        password: get('password'),
        email_verification_token: verificationToken,
      };

      const res = await fetch(`${API_BASE}/auth/register-exam-admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.detail?.message ?? body?.detail ?? 'Registration failed.');
      }

      alert("Registration successful! You can now log in.");
      router.push("/login?role=admin");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <section className={s.contact}>
        <div className="wrap">
          <div className={s.contactGrid}>
            <aside className={s.contactAside}>
              <span className="eyebrow on-dark">Registration</span>
              <h1>
                Exam Administrator <em>Portal Registration.</em>
              </h1>
              <p className={s.asideLead}>
                Once your institution's Exam Request has been approved, register here using the email address designated for the Administrator.
              </p>
            </aside>

            <div className={s.contactForm}>
              <div className={s.formHead}>
                <h2>Claim your Administrator Account</h2>
                <p>You must verify your email address to access the portal.</p>
              </div>

              {step === 'FORM' && (
                <form
                  ref={formRef}
                  className={s.form}
                  id="cec-form"
                  noValidate
                  onSubmit={handleRequestOtp}
                >
                  <div className={s.field}>
                    <label htmlFor="fullName">Full Name</label>
                    <input id="fullName" name="fullName" type="text" placeholder="e.g. Arjun Mehta" required />
                  </div>
                  <div className={s.field}>
                    <label htmlFor="email">Registered Email Address</label>
                    <input id="email" name="email" type="email" placeholder="Must match the approved Exam Request" required />
                  </div>
                  
                  <div className={s.field}>
                    <label htmlFor="password">Create Password</label>
                    <input id="password" name="password" type="password" required minLength={8} />
                  </div>
                  <div className={s.field}>
                    <label htmlFor="confirmPassword">Confirm Password</label>
                    <input id="confirmPassword" name="confirmPassword" type="password" required minLength={8} />
                  </div>

                  {submitError && (
                    <div className={s.formError} role="alert">
                      <Icon name="alert-triangle" size={17} strokeWidth={1.8} />
                      <div>
                        <strong>Registration Error</strong>
                        <span>{submitError}</span>
                      </div>
                    </div>
                  )}
                  <div className={s.formActions} style={{marginTop: '2rem'}}>
                    <button className="btn btn-primary btn-lg" type="submit" disabled={submitting}>
                      {submitting ? 'Verifying…' : <span>Verify Email & Register <Icon name="arrow-right" size={16} /></span>}
                    </button>
                  </div>
                </form>
              )}
              
              {step === 'OTP' && (
                <form className={s.form} onSubmit={handleVerifyAndSubmit}>
                  <div className={s.field}>
                    <label htmlFor="emailOtp">Verification Code</label>
                    <input 
                      id="emailOtp" 
                      name="emailOtp" 
                      type="text" 
                      inputMode="numeric" 
                      maxLength={6} 
                      placeholder="● ● ● ● ● ●" 
                      value={emailOtp} 
                      onChange={e => setEmailOtp(e.target.value.replace(/\D/g, ''))} 
                      required 
                      autoFocus 
                    />
                    {timeLeft > 0 ? (
                      <p style={{ fontSize: 12, color: 'var(--color-navy-600)', marginTop: 8 }}>
                        Time remaining: {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
                      </p>
                    ) : (
                      <div style={{ marginTop: 8 }}>
                        {resendCount < 5 ? (
                          <button type="button" onClick={() => handleRequestOtp(null, true)} style={{ background: 'none', border: 'none', color: '#0056b3', cursor: 'pointer', textDecoration: 'underline', padding: 0, fontSize: 13 }}>Resend Verification Code</button>
                        ) : (
                          <p style={{ color: '#d93025', fontSize: 13, margin: 0 }}>Maximum OTP resend attempts reached. Please restart the registration process.</p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className={s.formActions}>
                    <button className="btn btn-primary btn-lg" type="submit" disabled={submitting}>
                      {submitting ? 'Registering…' : 'Complete Registration'}
                    </button>
                  </div>
                  {submitError && (
                    <p style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 8 }}>
                      ⚠ {submitError}
                    </p>
                  )}
                  <button type="button" onClick={() => setStep('FORM')} style={{ marginTop: 16, background: 'none', border: 'none', color: 'var(--color-navy-500)', cursor: 'pointer', textDecoration: 'underline' }}>
                    Go back
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
