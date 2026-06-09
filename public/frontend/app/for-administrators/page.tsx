import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/marketing/Navbar";
import Footer from "@/components/marketing/Footer";
import Icon from "@/components/marketing/LucideIcon";
import s from "./page.module.css";

export const metadata: Metadata = {
  title: "Administrator Console — CryptoExam Core",
  description:
    "Mission control for examination administrators — real-time oversight of centres, candidates, hardware nodes and emergencies, with dual-control authorisation for every sensitive action.",
};

export default function AdminLanding() {
  return (
    <main>
      <Navbar />

      <section className={s.hero}>
        <div className="wrap">
          <span className="eyebrow on-dark">For administrators</span>
          <h1 className={s.h1}>
            One console for the entire examination, <em>under dual control.</em>
          </h1>
          <p className={s.lead}>
            CryptoExam Core gives examination administrators a single real-time command surface for
            centres, candidates, hardware nodes and emergencies — with two-party authorisation on
            every action that could change the outcome of an examination.
          </p>
          <div className={s.cta}>
            <Link className="btn btn-on-dark btn-lg" href="/admin/login">
              Sign in to mission control <Icon name="arrow-right" size={16} />
            </Link>
            <Link className="btn btn-quiet-dark btn-lg" href="/platform#admin">
              See the admin flow
            </Link>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="heading-block">
            <span className="eyebrow">What you watch</span>
            <h2>Every signal that matters, on one screen.</h2>
          </div>
          <div className={s.grid}>
            {[
              { icon: "map", title: "Centres", desc: "Live status of every examination centre — connectivity tier, node health, candidate roster, and incident reports." },
              { icon: "users-round", title: "Candidates", desc: "Realtime check-in rates, biometric pass-rates, and per-centre throughput. Drill into any candidate's submission state." },
              { icon: "cpu", title: "Hardware nodes", desc: "TPM 2.0 attestation status, GPS posture, tamper signals. ARMED, DECRYPTING, COMPLETE — at a glance, at every centre." },
              { icon: "siren", title: "Emergencies", desc: "Pause, abort, or extend an examination under dual control. Every action signed, time-stamped, and added to the audit ledger." },
            ].map((c) => (
              <article className={`card ${s.card}`} key={c.title}>
                <span className="icon-chip"><Icon name={c.icon} size={18} strokeWidth={1.7} /></span>
                <h3>{c.title}</h3>
                <p>{c.desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={s.bandCream}>
        <div className="wrap">
          <div className={s.principles}>
            <div>
              <span className="eyebrow">Operating principle</span>
              <h2 className={s.bandH2}>No single party can change an examination outcome.</h2>
              <p className={s.bandLead}>
                Every sensitive operation — pausing a paper, extending a session, releasing an
                emergency key — requires two administrators to sign. The console reflects this:
                you initiate, your colleague confirms, and both signatures are appended to the
                immutable audit trail before the action commits.
              </p>
            </div>
            <ul className={s.checks}>
              {[
                "Dual-control authorisation on every state change",
                "Signed, time-stamped audit entry for every action",
                "Role-scoped views — see only what your role permits",
                "On-chain anchors for every emergency action",
              ].map((t) => (
                <li key={t}><Icon name="check" size={18} /> <span>{t}</span></li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className={`section-sm ${s.finalCta}`}>
        <div className="wrap">
          <h2>Take command of your next examination.</h2>
          <p>Sign in to the console with your administrator credentials, or request a briefing.</p>
          <div className={s.cta}>
            <Link className="btn btn-primary btn-lg" href="/admin/login">
              Sign in <Icon name="arrow-right" size={16} />
            </Link>
            <Link className="btn btn-ghost btn-lg" href="/contact">
              Request a briefing
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
