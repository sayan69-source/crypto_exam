"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import Footer from "@/components/marketing/Footer";
import Icon from "@/components/marketing/LucideIcon";
import { api } from "@/lib/api/client";
import s from "./page.module.css";

// Same origin the rest of the site uses. Not hardcoded to a host: a deployed
// build sets NEXT_PUBLIC_API_URL and the form follows it.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

export default function ContactPage() {
  const formRef = useRef<HTMLFormElement>(null);
  const [sent, setSent] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
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

  /**
   * Step 1 — the visitor has typed an email but has not proven they own it.
   * A string that merely looks like an email must never be treated as
   * verified, so nothing is sent to the HQ queue yet: only a one-time code
   * to that address.
   */
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
      setSubmitError(err instanceof Error ? err.message : 'Could not send a verification code.');
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Step 2 — the code matched, so the email is proven. Only now do we act:
   * /contact/ sends the team notification + the sender's acknowledgement
   * (both real, via the shared EmailService), and /enquiries records the
   * lead with a reference the sender can quote later. Neither endpoint does
   * the other's job, so both are called; this used to be a single
   * `setSent(true)` with no request behind it at all.
   */
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

      const contactRes = await fetch(`${API_BASE}/contact/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: get('first'),
          lastName: get('last'),
          email,
          organisation: get('org'),
          role: get('role'),
          scale: get('scale'),
          message: get('message'),
          email_verification_token: verificationToken,
        }),
      });
      const contactBody = await contactRes.json().catch(() => ({}));
      if (!contactRes.ok) {
        throw new Error(contactBody?.detail?.message ?? contactBody?.detail ?? 'We could not send your enquiry.');
      }

      const enquiryRes = await fetch(`${API_BASE}/enquiries`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          full_name: [get("first"), get("last")].filter(Boolean).join(" "),
          email,
          organisation: get("org") || null,
          role_title: get("role") || null,
          topic: "BRIEFING",
          // The scale question is context for whoever answers, so it travels
          // with the message rather than being dropped on the floor.
          message: [get("message"), get("scale") ? `\n\nExpected scale: ${get("scale")}` : ""].join(""),
        }),
      });
      const enquiryBody = await enquiryRes.json().catch(() => ({}));
      if (!enquiryRes.ok) {
        throw new Error(
          enquiryBody?.detail?.message ??
            (enquiryRes.status === 429
              ? "Several enquiries have already come from this network in the last hour."
              : "Your enquiry was emailed but could not be recorded for tracking."),
        );
      }

      setReference(enquiryBody.reference ?? null);
      setDevPreview(contactBody.ackEmailDevPreview ?? contactBody.teamEmailDevPreview ?? null);
      setSent(true);
      setStep('FORM');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'We could not record your enquiry.');
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
                {/* These were three invented mailboxes on a domain nobody owns
                    and an office address for a company that is not registered.
                    A contact page whose contacts do not exist is worse than one
                    with none — someone writes to it and hears nothing back. The
                    form on this page is the channel that genuinely works: it
                    lands in the HQ queue with a reference. */}
                {[
                  { icon: "mail", label: "Programme enquiries", value: "Use the form on this page", isText: true },
                  { icon: "clock", label: "Response time", value: "Within two working days", isText: true },
                  { icon: "search-check", label: "Audit & press", value: "Use the form - choose Press", isText: true },
                  { icon: "shield", label: "Your enquiry", value: "Recorded with a quotable reference", isText: true },
                ].map((ch) => (
                  <div className={s.channel} key={ch.label}>
                    <span className={`icon-chip ${s.channelChip}`}>
                      <Icon name={ch.icon} size={17} strokeWidth={1.7} />
                    </span>
                    <div>
                      <div className={s.ctLabel}>{ch.label}</div>
                      {/* No mailto branch any more: every channel here is
                          descriptive text now that the invented mailboxes are
                          gone, and TypeScript correctly narrowed the unused
                          branch to `never`. */}
                      <div className={s.ctVal}>{ch.value}</div>
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
                  {submitError && (
                    <div className={s.formError} role="alert">
                      <Icon name="alert-triangle" size={17} strokeWidth={1.8} />
                      <div>
                        <strong>Your enquiry was not sent.</strong>
                        <span>{submitError}</span>
                      </div>
                    </div>
                  )}
                  <div className={s.formActions}>
                    <span className={s.formMeta}>
                      <span className="dot" style={{ background: "var(--color-success)" }} />
                      Encrypted in transit · TLS 1.3
                    </span>
                    <button className="btn btn-primary btn-lg" type="submit" disabled={submitting}>
                      {submitting ? 'Verifying…' : <span>Verify Email & Send <Icon name="arrow-right" size={16} /></span>}
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
                  <h3>Thank you — your enquiry has been received.</h3>
                  <p>A member of the programme team will be in touch within two working days.</p>
                  {reference && (
                    <p className={s.sentRef}>
                      Your reference is <code>{reference}</code>. Quote it in any follow-up —
                      it is how we find your enquiry without asking for your details again.
                    </p>
                  )}
                  {devPreview && (
                    <div className={s.formError} role="status" style={{ textAlign: "left", marginTop: 16 }}>
                      <strong>Dev mode — no SMTP configured.</strong>
                      <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, marginTop: 8 }}>{devPreview}</pre>
                    </div>
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
