import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/marketing/Navbar";
import Footer from "@/components/marketing/Footer";
import Icon from "@/components/marketing/LucideIcon";
import s from "./page.module.css";

export const metadata: Metadata = {
  title: "Centre access — Candidate & Invigilator portals — CryptoExam Core",
  description:
    "The candidate examination portal and the centre invigilator portal are not public web pages. They run only on examination-centre computers under operating-system lockdown. This page explains what they are, for whom, why they're isolated, and how access is granted.",
};

export default function CenterAccessPage() {
  return (
    <main>
      <Navbar />

      {/* ── Editorial hero ───────────────────────────────── */}
      <section className={s.hero}>
        <div className="wrap">
          <span className="eyebrow">Centre access</span>
          <h1 className={s.h1}>
            Two portals you <em>cannot</em> reach from this browser — and why.
          </h1>
          <p className={s.lead}>
            The candidate examination portal and the centre invigilator portal are deliberately
            not public web pages. They run only on examination-centre computers, under
            operating-system lockdown, and become reachable only on a specific exam day for a
            specific candidate. This is what prevents cheating that browser-based controls can&apos;t.
          </p>
          <div className={s.heroPills}>
            <span className={`pill ${s.pillSaffron}`}><span className="dot" style={{ background: "var(--accent-strong)" }} /> Centre-computer only</span>
            <span className={`pill ${s.pillNavy}`}><span className="dot" style={{ background: "var(--color-navy-700)" }} /> OS-level lockdown</span>
            <span className={`pill ${s.pillGreen}`}><span className="dot" style={{ background: "#3a9b6e" }} /> Time-bound activation</span>
          </div>
        </div>
      </section>

      {/* ── What & for whom ──────────────────────────────── */}
      <section className="section">
        <div className="wrap">
          <div className="heading-block">
            <span className="eyebrow">What they are · who uses them</span>
            <h2>Two surfaces, one sealed examination loop.</h2>
          </div>
          <div className={s.cardGrid}>
            <article className={s.portalCard}>
              <span className="icon-chip"><Icon name="graduation-cap" size={20} strokeWidth={1.7} /></span>
              <span className={s.portalTag}>Centre computer only</span>
              <h3>Candidate Examination Portal</h3>
              <p className={s.portalWhom}><strong>For:</strong> the candidate sitting an examination at a centre.</p>
              <p>The candidate&apos;s sealed exam interface. Decrypts the paper at T₀, runs the
                anti-cheat lockdown, hashes every answer into the Merkle tree, and prints the
                cryptographic receipt at the end. <strong>It will not load in a normal browser.</strong></p>
              <ul className={s.portalList}>
                <li><Icon name="check" size={14} /> Loads only on a provisioned centre terminal</li>
                <li><Icon name="check" size={14} /> Activates only at the scheduled T₀</li>
                <li><Icon name="check" size={14} /> Requires biometric pass + attendance mark to enter</li>
              </ul>
            </article>

            <article className={s.portalCard}>
              <span className="icon-chip"><Icon name="badge-check" size={20} strokeWidth={1.7} /></span>
              <span className={s.portalTag}>Centre staff only</span>
              <h3>Centre Invigilator Portal</h3>
              <p className={s.portalWhom}><strong>For:</strong> the invigilator(s) running the examination at a centre.</p>
              <p>The roster, verification and incident interface. Invigilators check candidates
                in with biometric verification, mark attendance, monitor the live roster, and
                raise alerts. <strong>Marking attendance is what unlocks a candidate&apos;s terminal.</strong></p>
              <ul className={s.portalList}>
                <li><Icon name="check" size={14} /> Authenticated against a registered centre device</li>
                <li><Icon name="check" size={14} /> Every action signed and time-stamped</li>
                <li><Icon name="check" size={14} /> Direct channel to the administrator console</li>
              </ul>
            </article>
          </div>
        </div>
      </section>

      {/* ── Why isolated ─────────────────────────────────── */}
      <section className={s.whyBand}>
        <div className="wrap">
          <div className={s.whyGrid}>
            <div>
              <span className="eyebrow on-dark">Why these are not public</span>
              <h2 className={s.whyH2}>Cheating begins where the browser is trusted.</h2>
              <p className={s.whyLead}>
                A browser running on a candidate&apos;s own laptop is an environment we cannot
                inspect: extensions, screen-sharing tools, virtual machines, AI assistants in
                another tab. No amount of JavaScript can rule them out. The candidate and
                invigilator portals therefore run only on examination-centre computers, inside
                a locked operating-system shell, where the platform itself decides what software
                may run.
              </p>
            </div>
            <ul className={s.whyChecks}>
              {[
                { t: "Hardware-attested terminals only", d: "Centre computers carry a TPM 2.0 attestation key — the portal will refuse to load on an unattested device." },
                { t: "OS-level application lockdown", d: "Outside the sealed shell, no other application can run. There is no second window to switch to." },
                { t: "No public URL, no public DNS", d: "The portals are not addressable from the internet. They are reachable only on the centre network." },
                { t: "Activated per examination, per candidate", d: "Each terminal is provisioned for one exam, for one seat — nothing more, nothing earlier, nothing later." },
              ].map((c) => (
                <li key={c.t}>
                  <Icon name="shield" size={18} strokeWidth={1.7} />
                  <div>
                    <h4>{c.t}</h4>
                    <p>{c.d}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── How to access ────────────────────────────────── */}
      <section className="section">
        <div className="wrap">
          <div className="heading-block">
            <span className="eyebrow">How access is granted</span>
            <h2>Six steps from examining body to seated candidate.</h2>
            <p>The portals are unreachable until every one of these gates is satisfied — in order, by the right party, at the right moment.</p>
          </div>
          <ol className={s.steps}>
            {[
              { t: "Examining body engages CryptoExam Core", d: "An examining body contracts us for a specific examination. Without an active contract for an exam, no portal exists for it." },
              { t: "Centre terminals are provisioned", d: "We deliver hardware-attested centre computers running the sealed OS shell. They register their TPM keys with the platform." },
              { t: "Examination is scheduled & sealed", d: "The setter seals the paper. The schedule, paper hash and ZK proof are committed on-chain. Terminals are bound to the schedule." },
              { t: "Candidate arrives at the centre", d: "On the appointed day, the candidate presents themselves at the centre listed on their admit card. No remote attendance is possible." },
              { t: "Invigilator verifies & marks attendance", d: "Centre invigilators use the invigilator portal to verify the candidate biometrically and mark them present. This is the gate." },
              { t: "Candidate terminal auto-redirects", d: "The moment attendance is marked, that candidate&apos;s terminal automatically loads the Candidate Examination Portal — pre-bound to their seat, paper variant and language." },
            ].map((step, i) => (
              <li key={step.t}>
                <span className={s.stepNum}>{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h4>{step.t}</h4>
                  <p>{step.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Pointers ─────────────────────────────────────── */}
      <section className={`section-sm ${s.pointers}`}>
        <div className="wrap">
          <div className="heading-block">
            <span className="eyebrow">What you can do from here</span>
            <h2>You are not locked out — only locked in.</h2>
            <p>The portals are private, but the integrity of every examination is public.</p>
          </div>
          <div className={s.pointGrid}>
            <Link className={`card card-hover ${s.point}`} href="/about#transparency">
              <span className="icon-chip"><Icon name="scale" size={18} strokeWidth={1.7} /></span>
              <h3>Public transparency record</h3>
              <p>See exactly what is public, what is private, and how anyone can independently verify an examination.</p>
              <span className={s.pointLink}>Open transparency report <Icon name="arrow-right" size={14} /></span>
            </Link>
            <Link className={`card card-hover ${s.point}`} href="/exam/audit">
              <span className="icon-chip"><Icon name="search-check" size={18} strokeWidth={1.7} /></span>
              <h3>Public audit portal</h3>
              <p>Verify any past examination on-chain — no account, no API key required.</p>
              <span className={s.pointLink}>Open audit portal <Icon name="arrow-right" size={14} /></span>
            </Link>
            <Link className={`card card-hover ${s.point}`} href="/contact">
              <span className="icon-chip"><Icon name="mail" size={18} strokeWidth={1.7} /></span>
              <h3>Examining body? Talk to us.</h3>
              <p>If you operate a high-stakes examination and want this access model for your candidates, get in touch.</p>
              <span className={s.pointLink}>Request a briefing <Icon name="arrow-right" size={14} /></span>
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
