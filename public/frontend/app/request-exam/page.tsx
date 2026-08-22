"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import Footer from "@/components/marketing/Footer";
import Icon from "@/components/marketing/LucideIcon";
import { api } from "@/lib/api/client";
import s from "./page.module.css";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

export default function RequestExamPage() {
  const formRef = useRef<HTMLFormElement>(null);
  const [sent, setSent] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [step, setStep] = useState<'FORM' | 'OTP'>('FORM');
  const [formData, setFormData] = useState<FormData | null>(null);
  const [emailChallengeId, setEmailChallengeId] = useState<string | null>(null);
  const [emailOtp, setEmailOtp] = useState('');
  const [resendCount, setResendCount] = useState(0);

  const [locations, setLocations] = useState([{ name: '', city: '', capacity: 100 }]);
  const [subjects, setSubjects] = useState([{ name: '', compulsory: true }]);

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
    setFormData(data);
    setSubmitting(true);
    setSubmitError(null);
    try {
      const email = data.get('contactEmail') as string;
      const res = await api.requestEmailVerification({ email, purpose: 'CONTACT' });
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
      const email = get('contactEmail');

      const verifyRes = await api.verifyEmailOtp({ challenge_id: emailChallengeId!, email, code: emailOtp });
      const verificationToken = verifyRes.verification_token;

      const payload = {
        examName: get('examName'),
        organisation: get('organisation'),
        contactName: get('contactName'),
        contactEmail: email,
        durationMinutes: parseInt(get('durationMinutes') || '180', 10),
        administrator: {
          fullName: get('adminName'),
          email: get('adminEmail'),
        },
        locations: locations.filter(l => l.name.trim() !== ''),
        subjects: subjects.filter(s => s.name.trim() !== ''),
        emailVerificationToken: verificationToken,
      };

      const res = await fetch(`${API_BASE}/exam-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.detail?.message ?? body?.detail ?? 'We could not submit your request.');
      }

      setReference(body.reference ?? null);
      setSent(true);
      setStep('FORM');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'We could not submit your request.');
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
              <span className="eyebrow on-dark">Conduct an Exam</span>
              <h1>
                Request to conduct a <em>provable examination.</em>
              </h1>
              <p className={s.asideLead}>
                Submit the details of your examination. Once approved by the System Administrator, 
                your designated Exam Administrator will be able to register and manage the exam.
              </p>
            </aside>

            <div className={s.contactForm}>
              <div className={s.formHead}>
                <h2>Examination Details</h2>
                <p>Provide the basic parameters for your exam.</p>
              </div>

              {!sent && step === 'FORM' && (
                <form
                  ref={formRef}
                  className={s.form}
                  id="cec-form"
                  noValidate
                  onSubmit={handleRequestOtp}
                >
                  <div className={s.field}>
                    <label htmlFor="examName">Exam Name</label>
                    <input id="examName" name="examName" type="text" placeholder="e.g. National Entrance Test 2026" required />
                  </div>
                  <div className={s.field}>
                    <label htmlFor="organisation">Organisation</label>
                    <input id="organisation" name="organisation" type="text" placeholder="Examining body or University" required />
                  </div>
                  
                  <h3 style={{marginTop: '2rem', marginBottom: '1rem'}}>Contact Person</h3>
                  <div className={s.field}>
                    <label htmlFor="contactName">Your Name</label>
                    <input id="contactName" name="contactName" type="text" required />
                  </div>
                  <div className={s.field}>
                    <label htmlFor="contactEmail">Your Email (Verification required)</label>
                    <input id="contactEmail" name="contactEmail" type="email" required />
                  </div>

                  <h3 style={{marginTop: '2rem', marginBottom: '1rem'}}>Exam Administrator</h3>
                  <p style={{fontSize: 14, color: 'var(--color-navy-500)', marginBottom: '1rem'}}>
                    This person will be granted access to the admin portal once approved.
                  </p>
                  <div className={s.field}>
                    <label htmlFor="adminName">Administrator Name</label>
                    <input id="adminName" name="adminName" type="text" required />
                  </div>
                  <div className={s.field}>
                    <label htmlFor="adminEmail">Administrator Email</label>
                    <input id="adminEmail" name="adminEmail" type="email" required />
                  </div>

                  <h3 style={{marginTop: '2rem', marginBottom: '1rem'}}>Locations & Subjects</h3>
                  <div className={s.field}>
                    <label>Duration (Minutes)</label>
                    <input name="durationMinutes" type="number" defaultValue="180" required />
                  </div>
                  
                  <div className={s.field}>
                    <label>Examination Centers</label>
                    {locations.map((loc, i) => (
                      <div key={i} style={{display: 'flex', gap: '8px', marginBottom: '8px'}}>
                        <input 
                          type="text" 
                          placeholder="Center Name (e.g. Mumbai Hub)" 
                          value={loc.name} 
                          onChange={e => setLocations(locations.map((l, idx) => idx === i ? {...l, name: e.target.value} : l))}
                          required 
                        />
                        <input 
                          type="text" 
                          placeholder="City" 
                          value={loc.city} 
                          onChange={e => setLocations(locations.map((l, idx) => idx === i ? {...l, city: e.target.value} : l))}
                        />
                      </div>
                    ))}
                    <button type="button" onClick={() => setLocations([...locations, {name: '', city: '', capacity: 100}])} style={{background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', textAlign: 'left', padding: 0}}>+ Add Center</button>
                  </div>

                  <div className={s.field}>
                    <label>Subjects</label>
                    {subjects.map((sub, i) => (
                      <div key={i} style={{display: 'flex', gap: '8px', marginBottom: '8px'}}>
                        <input 
                          type="text" 
                          placeholder="Subject Name" 
                          value={sub.name} 
                          onChange={e => setSubjects(subjects.map((s, idx) => idx === i ? {...s, name: e.target.value} : s))}
                          required 
                        />
                      </div>
                    ))}
                    <button type="button" onClick={() => setSubjects([...subjects, {name: '', compulsory: true}])} style={{background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', textAlign: 'left', padding: 0}}>+ Add Subject</button>
                  </div>

                  {submitError && (
                    <div className={s.formError} role="alert">
                      <Icon name="alert-triangle" size={17} strokeWidth={1.8} />
                      <div>
                        <strong>Your request could not be sent.</strong>
                        <span>{submitError}</span>
                      </div>
                    </div>
                  )}
                  <div className={s.formActions} style={{marginTop: '2rem'}}>
                    <button className="btn btn-primary btn-lg" type="submit" disabled={submitting}>
                      {submitting ? 'Verifying…' : <span>Verify Email & Request Exam <Icon name="arrow-right" size={16} /></span>}
                    </button>
                  </div>
                </form>
              )}
              
              {!sent && step === 'OTP' && (
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
                      {submitting ? 'Submitting…' : 'Submit Request'}
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

              {sent && (
                <div className={`${s.sentState} ${s.sentStateShow}`}>
                  <Icon name="check-circle-2" size={40} />
                  <h3>Your exam request has been submitted.</h3>
                  <p>Our System Administrators will review your request shortly.</p>
                  {reference && (
                    <p className={s.sentRef}>
                      Your reference is <code>{reference}</code>. You will receive an automated email once the exam is Live.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
