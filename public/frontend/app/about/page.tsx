import type { Metadata } from "next";
import Link from "next/link";
import Footer from "@/components/marketing/Footer";
import Icon from "@/components/marketing/LucideIcon";
import s from "./page.module.css";

export const metadata: Metadata = {
  title: "About — CryptoExam Core",
  description:
    "Built for India. Built so no one has to take our word for it.",
};

export default function AboutPage() {
  return (
    <main>
      {/* ===== EDITORIAL HERO ===== */}
      <section className={s.aboutHero}>
        <div className="wrap" style={{ position: "relative" }}>
          <span className="eyebrow">About CryptoExam Core</span>
          <h1>
            We are building examination infrastructure that{" "}
            <em>no one needs to take on faith.</em>
          </h1>
        </div>
      </section>

      {/* ===== MISSION ===== */}
      <section className={`${s.mission} reveal reveal-rise`} id="mission">
        <div className={`wrap ${s.missionWrap}`}>
          <span className="eyebrow on-dark">Our mission</span>
          <p className={s.missionPull}>
            &ldquo;The math cannot be bribed. The blockchain cannot forget. The hardware cannot
            lie.&rdquo;
          </p>
        </div>
      </section>

      {/* ===== VALUES ===== */}
      <section className={`${s.values} reveal reveal-left`}>
        <div className="wrap">
          <div className="heading-block">
            <span className="eyebrow">Our values</span>
            <h2>Commitments to every candidate.</h2>
          </div>
          <div className={s.valuesGrid}>
            {[
              { num: "01", title: "Verifiability before convenience." },
              { num: "02", title: "Proofs without exposure." },
              { num: "03", title: "Built for India, not retrofitted." },
            ].map((v) => (
              <article className={s.value} key={v.num}>
                <span className={s.valueNum}>{v.num}</span>
                <h3>{v.title}</h3>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ===== STORY ===== */}
      <section className={`${s.story} reveal reveal-scale`}>
        <div className={`wrap ${s.storyGrid}`}>
          <div>
            <span className="eyebrow">Our story</span>
            <h2 style={{ fontSize: "var(--fs-h2)", marginTop: "var(--space-md)", letterSpacing: "var(--tracking-tight)" }}>
              From a paper leak to a public proof.
            </h2>
          </div>
          <div>
            {[
              { when: "2023", title: "The question" },
              { when: "2024", title: "The first sealed paper" },
              { when: "2025", title: "On-chain commitments" },
              { when: "2026", title: "FAR AWAY Examinations Track" },
            ].map((m) => (
              <div className={s.ms} key={m.when}>
                <span className={s.msWhen}>{m.when}</span>
                <div>
                  <h4>{m.title}</h4>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== PRINCIPLES ===== */}
      <section className={`${s.principles} reveal reveal-right`}>
        <div className="wrap">
          <div className="heading-block">
            <span className="eyebrow">Our principles</span>
            <h2>How we work.</h2>
          </div>
          <div className={s.principlesGrid}>
            {[
              { icon: "scale", title: "We hold no master key." },
              { icon: "eye", title: "Every action is logged." },
              { icon: "file-check", title: "We meet you where you are." },
              { icon: "handshake", title: "Public accountability." },
            ].map((p) => (
              <div className={s.principle} key={p.title}>
                <span className={`icon-chip ${s.principleChip}`}>
                  <Icon name={p.icon} size={18} strokeWidth={1.7} />
                </span>
                <div>
                  <h4>{p.title}</h4>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== FINAL CTA ===== */}
      <section className={`${s.finalCta} reveal reveal-rise`}>
        <div className="wrap">
          <span className="eyebrow" style={{ justifyContent: "center" }}>Talk to us</span>
          <h2 style={{ marginTop: "var(--space-md)" }}>
            If integrity matters, <em>let us prove it.</em>
          </h2>
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
