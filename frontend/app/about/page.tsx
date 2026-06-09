import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/marketing/Navbar";
import Footer from "@/components/marketing/Footer";
import Icon from "@/components/marketing/LucideIcon";
import TransparencyLive from "./TransparencyLive";
import s from "./page.module.css";

export const metadata: Metadata = {
  title: "About — CryptoExam Core",
  description:
    "Built for India. Built so no one has to take our word for it.",
};

export default function AboutPage() {
  return (
    <main>
      <Navbar />

      {/* ===== EDITORIAL HERO ===== */}
      <section className={s.aboutHero}>
        <div className="wrap" style={{ position: "relative" }}>
          <span className="eyebrow">About CryptoExam Core</span>
          <h1>
            We are building examination infrastructure that{" "}
            <em>no one needs to take on faith.</em>
          </h1>
          <p className={s.aboutLead}>
            Every guarantee we make about an examination — how it was sealed, when it was opened,
            what it asked, what was answered — is backed by a proof that anyone can verify,
            without needing to trust us.
          </p>
        </div>
      </section>

      {/* ===== MISSION ===== */}
      <section className={s.mission} id="mission">
        <div className={`wrap ${s.missionWrap}`}>
          <span className="eyebrow on-dark">Our mission</span>
          <h2>
            To make the integrity of every examination publicly provable, in a country where the
            consequences are too high to leave to faith alone.
          </h2>
          <p className={s.missionPull}>
            &ldquo;The math cannot be bribed. The blockchain cannot forget. The hardware cannot
            lie.&rdquo;
          </p>
          <div className={s.missionBody}>
            <p>
              Every year, more than thirty million candidates in India sit examinations that
              determine their entry into universities, services and professions. The systems
              protecting those examinations rest on locked rooms, sealed envelopes, and the
              conduct of everyone in the custody chain. When that chain fails, there is rarely a
              way to prove what actually happened.
            </p>
            <p>
              CryptoExam Core was built to remove the need for faith. We replace institutional
              promises with cryptographic proofs — anchored on a public blockchain, open to any
              candidate, examiner, journalist, or court to inspect.
            </p>
          </div>
        </div>
      </section>

      {/* ===== VALUES ===== */}
      <section className={s.values}>
        <div className="wrap">
          <div className="heading-block">
            <span className="eyebrow">What we believe</span>
            <h2>Three commitments to every candidate.</h2>
          </div>
          <div className={s.valuesGrid}>
            {[
              { num: "VALUE 01", title: "Verifiability before convenience.", desc: "We will not ship a feature that cannot be independently checked. Every claim we make about an examination must produce evidence." },
              { num: "VALUE 02", title: "Transparency without exposure.", desc: "Proofs are public. Personal data is not. Biometrics are processed on-device. Question content stays sealed until T₀." },
              { num: "VALUE 03", title: "Built for India, not retrofitted.", desc: "Eleven languages, on-device biometric processing, DPDP Act 2023 alignment, and centres designed for the operating reality of Indian examination halls." },
            ].map((v) => (
              <article className={s.value} key={v.num}>
                <span className={s.valueNum}>{v.num}</span>
                <h3>{v.title}</h3>
                <p>{v.desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ===== STORY ===== */}
      <section className={s.story}>
        <div className={`wrap ${s.storyGrid}`}>
          <div>
            <span className="eyebrow">Our story</span>
            <h2 style={{ fontSize: "var(--fs-h2)", marginTop: "var(--space-md)", letterSpacing: "var(--tracking-tight)" }}>
              From a paper leak to a public proof.
            </h2>
            <p style={{ marginTop: "var(--space-md)", color: "var(--text-muted)", fontSize: "var(--fs-body)", lineHeight: "var(--lh-relaxed)", maxWidth: 340 }}>
              CryptoExam Core began with a simple question — how would an examination be
              conducted if no one in the chain could be trusted?
            </p>
          </div>
          <div>
            {[
              { when: "2023", title: "The question", desc: "A working group of cryptographers, educators and former examination administrators convened to imagine a system that required zero trust." },
              { when: "2024", title: "The first sealed paper", desc: "The first paper was sealed under AES-GCM-256 and opened only by a public randomness beacon at the appointed second." },
              { when: "2025", title: "On-chain commitments", desc: "Merkle commitments to candidate submissions were anchored on Polygon PoS — making the integrity of an examination publicly checkable." },
              { when: "2026", title: "FAR AWAY Examinations Track", desc: "CryptoExam Core enters the FAR AWAY 2026 Examinations Track — with full hardware attestation, ZK difficulty proofs, and a public audit portal." },
            ].map((m) => (
              <div className={s.ms} key={m.when}>
                <span className={s.msWhen}>{m.when}</span>
                <div>
                  <h4>{m.title}</h4>
                  <p>{m.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== PRINCIPLES ===== */}
      <section className={s.principles}>
        <div className="wrap">
          <div className="heading-block">
            <span className="eyebrow">Operating principles</span>
            <h2>How we work, with examining bodies.</h2>
          </div>
          <div className={s.principlesGrid}>
            {[
              { icon: "scale", title: "We hold no master key.", desc: "Custody of the master key is split among the examining body and independent custodians. We can never act alone." },
              { icon: "eye", title: "Every action is logged.", desc: "Sensitive operations require dual control and produce a signed, time-stamped audit entry." },
              { icon: "file-check", title: "We meet you where you are.", desc: "The platform integrates with existing roll numbers, centre registries and result publication workflows." },
              { icon: "handshake", title: "Public accountability.", desc: "Every claim on this site is verifiable — by you, the candidate, or any journalist with a block explorer." },
            ].map((p) => (
              <div className={s.principle} key={p.title}>
                <span className={`icon-chip ${s.principleChip}`}>
                  <Icon name={p.icon} size={18} strokeWidth={1.7} />
                </span>
                <div>
                  <h4>{p.title}</h4>
                  <p>{p.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== PUBLIC TRANSPARENCY (backend-served, no login) ===== */}
      <TransparencyLive />

      {/* ===== FINAL CTA ===== */}
      <section className={s.finalCta}>
        <div className="wrap">
          <span className="eyebrow" style={{ justifyContent: "center" }}>Talk to us</span>
          <h2 style={{ marginTop: "var(--space-md)" }}>
            If integrity matters, <em>let us prove it.</em>
          </h2>
          <p>
            We work with examining bodies, universities, and certification authorities preparing
            high-stakes examinations.
          </p>
          <div className={s.finalCtaButtons}>
            <Link className="btn btn-primary btn-lg" href="/contact">
              Request a briefing <Icon name="arrow-right" size={16} />
            </Link>
            <Link className="btn btn-ghost btn-lg" href="/platform">
              Explore the platform
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
