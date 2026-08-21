"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import Footer from "@/components/marketing/Footer";
import Icon from "@/components/marketing/LucideIcon";
import { api } from "@/lib/api/client";
import s from "./page.module.css";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

export default function ContactPage() {
  const formRef = useRef<HTMLFormElement>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [devPreview, setDevPreview] = useState<string | null>(null);
  
  const [step, setStep] = useState<'FORM' | 'OTP'>('FORM');
  const [formData, setFormData] = useState<FormData | null>(null);
  const [emailChallengeId, setEmailChallengeId] = useState<string | null>(null);
  const [emailOtp, setEmailOtp] = useState('');
  
  // Timer state
  const [timeLeft, setTimeLeft] = useState(120);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Clear timer when leaving OTP step
  if (step !== 'OTP' && timerRef.current) {
    clearInterval(timerRef.current);
    timerRef.current = null;
  }

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!formRef.current?.checkValidity()) {
      formRef.current?.reportValidity();
      return;
    }
    const data = new FormData(formRef.current!);
    setFormData(data);
    setSubmitting(true);
    setSubmitError(null);
    try {
      const email = data.get('email') as string;
      const res = await api.requestEmailVerification({ email, purpose: 'CONTACT' });
      setEmailChallengeId(res.challenge_id);
      setStep('OTP');
      setTimeLeft(120);
      
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current!);
            setStep('FORM');
            setSubmitError('OTP expired. Please try again.');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err) {
      setSubmitError((err as Error).message);
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
      const email = formData!.get('email') as string;
      
      const verifyRes = await api.verifyEmailOtp({ challenge_id: emailChallengeId!, email, code: emailOtp });
      const verificationToken = verifyRes.verification_token;
      
      const res = await fetch(`${API_BASE}/contact/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: formData!.get('first'),
          lastName: formData!.get('last'),
          email: formData!.get('email'),
          organisation: formData!.get('org'),
          role: formData!.get('role'),
          scale: formData!.get('scale'),
          message: formData!.get('message'),
          email_verification_token: verificationToken,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.detail || `Submission failed (${res.status})`);
      if (j.ackEmailDevPreview) setDevPreview(j.ackEmailDevPreview);
      setSent(true);
      setStep('FORM');
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <section className={s.contact}>
        <div className="wrap">
          <div className={s.contactGrid}>
            {/* LEFT — DARK */}
            <aside className={s.contactAside}>
              <span className="eyebrow on-dark">Contact</span>
              <h1>
                Request a briefing on <em>provable examinations.</em>
              </h1>
              <p className={s.asideLead}>
                We work with examining bodies, universities, and certification authorities
                preparing high-stakes examinations. Tell us about your programme and we will
                respond within two working days.
              </p>

              <div className={s.channels}>
                {[
                  { icon: "mail", label: "Programme enquiries", value: "manabdelhi1@gmail.com" },
                  { icon: "building-2", label: "Examining bodies", value: "manabdelhi1@gmail.com" },
                  { icon: "search-check", label: "Audit & press", value: "somab2159@gmail.com" },
                  { icon: "map-pin", label: "Registered office", value: "Bengaluru · Karnataka · India", isText: true },
                ].map((ch) => (
                  <div className={s.channel} key={ch.label}>
                    <span className={`icon-chip ${s.channelChip}`}>
                      <Icon name={ch.icon} size={17} strokeWidth={1.7} />
                    </span>
                    <div>
                      <div className={s.ctLabel}>{ch.label}</div>
                      <div className={s.ctVal}>
                        {"isText" in ch ? (
                          ch.value
                        ) : (
                          <a href={`mailto:${ch.value}`}>{ch.value}</a>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className={s.assurance}>
                <Icon name="shield" size={16} strokeWidth={1.7} />
                <div>
                  Form submissions are encrypted in transit and never used for marketing.
                  Compliant with the Digital Personal Data Protection Act, 2023.
                </div>
              </div>
            </aside>

            {/* RIGHT — FORM */}
            <div className={s.contactForm}>
              <div className={s.formHead}>
                <h2>Tell us about your examination.</h2>
                <p>The more we know about your context, the faster we can respond meaningfully.</p>
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
                    <label htmlFor="first">First name</label>
                    <input id="first" name="first" type="text" placeholder="Arjun" required />
                  </div>
                  <div className={s.field}>
                    <label htmlFor="last">Last name</label>
                    <input id="last" name="last" type="text" placeholder="Mehta" required />
                  </div>
                  <div className={s.field}>
                    <label htmlFor="email">Work email</label>
                    <input id="email" name="email" type="email" placeholder="arjun@yourorganisation.in" required />
                  </div>
                  <div className={s.field}>
                    <label htmlFor="org">Organisation</label>
                    <input id="org" name="org" type="text" placeholder="Examining body, university, ministry" required />
                  </div>
                  <div className={s.field}>
                    <label htmlFor="role">Your role</label>
                    <select id="role" name="role" required defaultValue="">
                      <option value="" disabled>Select a role</option>
                      <option>Examination Controller / Registrar</option>
                      <option>Director / Vice-Chancellor</option>
                      <option>Head of Technology</option>
                      <option>Security / Audit lead</option>
                      <option>Journalist / Researcher</option>
                      <option>Other</option>
                    </select>
                  </div>
                  <div className={s.field}>
                    <label htmlFor="scale">Annual candidate volume</label>
                    <select id="scale" name="scale" required defaultValue="">
                      <option value="" disabled>Choose a range</option>
                      <option>Under 10,000</option>
                      <option>10,000 – 100,000</option>
                      <option>100,000 – 1,000,000</option>
                      <option>Over 1,000,000</option>
                    </select>
                  </div>
                  <div className={`${s.field} ${s.fieldFull}`}>
                    <label htmlFor="message">What examination would you like to protect?</label>
                    <textarea
                      id="message"
                      name="message"
                      placeholder="Tell us about the examination, its scale, and the specific integrity questions you are trying to answer."
                      required
                    />
                  </div>
                  <label className={s.consent}>
                    <input type="checkbox" required />
                    <span>
                      I consent to CryptoExam Core processing this information to respond to my
                      enquiry, in line with the DPDP Act, 2023.
                    </span>
                  </label>
                  <div className={s.formActions}>
                    <span className={s.formMeta}>
                      <span className="dot" style={{ background: "var(--color-success)" }} />
                      Encrypted in transit · TLS 1.3
                    </span>
                    <button className="btn btn-primary btn-lg" type="submit" disabled={submitting}>
                      {submitting ? 'Verifying…' : <span>Verify Email & Send <Icon name="arrow-right" size={16} /></span>}
                    </button>
                  </div>
                  {submitError && (
                    <p style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 8 }}>
                      ⚠ {submitError}
                    </p>
                  )}
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
                    <p style={{ fontSize: 12, color: 'var(--color-navy-600)', marginTop: 8 }}>
                      Time remaining: {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
                    </p>
                  </div>
                  <div className={s.formActions}>
                    <button className="btn btn-primary btn-lg" type="submit" disabled={submitting}>
                      {submitting ? 'Submitting…' : 'Submit Enquiry'}
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
                  <h3>Thank you — your enquiry has been sent.</h3>
                  <p>A member of the programme team will be in touch within two working days.</p>
                  {devPreview && (
                    <details style={{ marginTop: 12, fontSize: 12, textAlign: 'left' }}>
                      <summary style={{ cursor: 'pointer', color: '#605d52' }}>📧 Dev-mode email preview (SMTP not configured)</summary>
                      <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap', background: '#f8f4f0', padding: 12, borderRadius: 8, fontSize: 11 }}>{devPreview}</pre>
                    </details>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ===== SHORT FAQ ===== */}
      <section className={`${s.contactFaq} reveal reveal-rise`}>
        <div className="wrap">
          <div className={s.faqGrid}>
            <div>
              <span className="eyebrow">Before you write</span>
              <h2 style={{ fontSize: "var(--fs-h2)", marginTop: "var(--space-md)", letterSpacing: "var(--tracking-tight)" }}>
                A few things we are often asked.
              </h2>
            </div>
            <div>
              {[
                { q: "Do you work with small examination bodies?", a: "Yes. The platform is designed to scale from a single professional certification to a national civil-service examination." },
                { q: "How long does an integration take?", a: "A pilot programme — including the key ceremony, setter onboarding and a sample audit — typically takes six to twelve weeks." },
                { q: "Can we keep our existing centres?", a: "Yes. CryptoExam Core deploys to existing examination centres. We provision hardware-attested devices and integrate with your roll number and result publication systems." },
              ].map((item) => (
                <div className={s.qaRow} key={item.q}>
                  <h4>{item.q}</h4>
                  <p>{item.a}</p>
                </div>
              ))}
              <div className={s.qaRow}>
                <h4>Where can I read more before reaching out?</h4>
                <p>
                  The{" "}
                  <Link href="/platform" className={s.qaLink}>platform overview</Link>{" "}
                  covers each role and the{" "}
                  <Link href="/platform#architecture" className={s.qaLink}>architecture</Link>{" "}
                  describes the cryptographic layers.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
