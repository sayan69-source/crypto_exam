"use client";

import Link from "next/link";
import { useEffect, useRef, useCallback } from "react";
import Navbar from "@/components/marketing/Navbar";
import Footer from "@/components/marketing/Footer";
import Icon from "@/components/marketing/LucideIcon";
import s from "./page.module.css";

/* ─── FAQ data ─── */
const faqs = [
  {
    q: "Do I have to trust CryptoExam Core?",
    a: "No. That is the point. Every guarantee is backed by a proof anchored to a public blockchain. You can verify any examination yourself on a block explorer, without an account and without trusting us, the examining body, or the centre.",
  },
  {
    q: "How can a paper stay sealed until the exam begins?",
    a: "The paper is encrypted at authoring time. Its decryption key is derived from a public randomness beacon and is only available at the scheduled start time, T₀. Custody of the master key is split across independent parties using Shamir\u2019s Secret Sharing, so no individual can open it early.",
  },
  {
    q: 'What does "machine-verifiable difficulty" mean?',
    a: "Setters declare a target difficulty distribution for each paper. A zero-knowledge proof demonstrates the paper meets that distribution without revealing the questions — so fairness across paper variants can be checked publicly, before anyone sits the exam.",
  },
  {
    q: "Is the platform compliant with Indian data law?",
    a: "Yes. CryptoExam Core is built to comply with the Digital Personal Data Protection Act, 2023. Biometric data is processed on-device and never leaves the candidate\u2019s hardware in raw form.",
  },
  {
    q: "Which languages are supported?",
    a: "The candidate interface supports 11 Indian languages with native script rendering, including Devanagari, Bengali, Tamil, Telugu, Kannada, Malayalam, Gujarati and Odia.",
  },
];

/* ─── FAQ Item (client interactive) ─── */
function FaqItem({ q, a, defaultOpen }: { q: string; a: string; defaultOpen?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const open = el.style.maxHeight !== "0px" && el.style.maxHeight !== "";
    el.style.maxHeight = open ? "0px" : `${el.scrollHeight}px`;
    el.parentElement?.querySelector("button")?.classList.toggle(s.faqQOpen!, !open);
  }, []);

  useEffect(() => {
    if (defaultOpen && ref.current) {
      ref.current.style.maxHeight = `${ref.current.scrollHeight}px`;
      ref.current.parentElement?.querySelector("button")?.classList.add(s.faqQOpen!);
    }
  }, [defaultOpen]);

  return (
    <div className={s.faqItem}>
      <button className={s.faqQ} onClick={toggle} type="button">
        {q}
        <Icon name="plus" size={20} />
      </button>
      <div className={s.faqA} ref={ref} style={{ maxHeight: defaultOpen ? undefined : "0px" }}>
        <p>{a}</p>
      </div>
    </div>
  );
}

/* ─── Scroll reveal hook ─── */
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll(".reveal");
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

export default function LandingPage() {
  useReveal();

  return (
    <main className={s.main}>
      <Navbar />

      {/* ===== HERO ===== */}
      <section className={s.hero}>
        <div className={`wrap ${s.heroInner}`}>
          <div>
            <span className="eyebrow on-dark">FAR AWAY 2026 · Examinations Track</span>
            <h1 className={s.heroH1}>
              Zero-trust examination infrastructure,{" "}
              <em>built&nbsp;for&nbsp;India.</em>
            </h1>
            <p className={s.heroLead}>
              CryptoExam Core delivers high-stakes examinations that are verifiable end to end —
              from the moment a paper is sealed to the instant a candidate submits. Integrity is
              not promised. It is proven, on-chain, for anyone to inspect.
            </p>
            <div className={s.heroCta}>
              <Link className="btn btn-accent btn-lg" href="/contact">
                Request a briefing <Icon name="arrow-right" size={16} />
              </Link>
              <Link className="btn btn-quiet-dark btn-lg" href="/platform">
                Explore the platform
              </Link>
            </div>
            <p className={s.heroTagline}>
              The math cannot be bribed. The blockchain cannot forget. The hardware cannot lie.
            </p>
          </div>

          {/* Proof Panel */}
          <aside className={s.proofPanel} aria-label="Live integrity proofs">
            <div className={s.proofHead}>
              <span className={s.proofLabel}>Integrity ledger</span>
              <span className={`pill ${s.proofPill}`}>
                <span className="dot" style={{ background: "#6fe0a6" }} /> Verified
              </span>
            </div>

            {[
              { icon: "lock", title: "Paper sealed before T₀", hash: "AES-GCM-256 · HKDF" },
              { icon: "git-merge", title: "Answers committed", hash: "SHA-256 Merkle root" },
              { icon: "binary", title: "Difficulty proven", hash: "ZK-SNARK · Groth16" },
              { icon: "satellite-dish", title: "Delivery attested", hash: "TPM 2.0 · GPS signed" },
            ].map((r) => (
              <div className={s.proofRow} key={r.icon}>
                <span className={s.proofIco}>
                  <Icon name={r.icon} size={17} strokeWidth={1.7} />
                </span>
                <span className={s.proofInfo}>
                  <span className={s.proofT}>{r.title}</span>
                  <span className={s.proofH}>{r.hash}</span>
                </span>
                <span className={s.proofChk}>
                  <Icon name="check" size={17} />
                </span>
              </div>
            ))}
          </aside>
        </div>
      </section>

      {/* ===== TRUST STRIP ===== */}
      <div className={s.trust}>
        <div className={`wrap ${s.trustInner}`}>
          <span className={s.trustLabel}>Built on</span>
          {[
            { icon: "shield", label: "DPDP Act 2023 compliant" },
            { icon: "boxes", label: "Polygon PoS" },
            { icon: "binary", label: "CIRCOM · Groth16" },
            { icon: "cpu", label: "TPM 2.0 attestation" },
            { icon: "languages", label: "11 Indian languages" },
          ].map((t) => (
            <span className={s.trustItem} key={t.label}>
              <Icon name={t.icon} size={17} strokeWidth={1.7} /> {t.label}
            </span>
          ))}
        </div>
      </div>

      {/* ===== PROBLEM ===== */}
      <section className="section">
        <div className="wrap">
          <div className={`${s.problemGrid} reveal`}>
            <div className={s.leadCol}>
              <span className="eyebrow">The integrity problem</span>
              <h2 style={{ fontSize: "var(--fs-h2)", marginTop: "var(--space-md)" }}>
                Trust in examinations has always depended on people behaving well.
              </h2>
              <p className={s.leadColSpace}>
                Every year, millions of candidates sit examinations whose outcomes shape their
                careers. Yet the systems that protect those exams still rest on locked rooms,
                sealed envelopes and the good conduct of everyone in the chain. When that chain
                breaks — a leaked paper, an altered answer sheet, a contested result — there is
                rarely a way to prove what actually happened.
              </p>
              <p className={s.leadColSpace}>
                CryptoExam Core replaces institutional trust with mathematical proof. Each stage
                of the examination lifecycle produces evidence that anyone can verify
                independently, without needing to trust the examining body, the centre, or us.
              </p>
            </div>
            <div className={s.problemList}>
              {[
                { n: "A", t: "Papers leak before the exam", d: "Question papers pass through many hands during printing, transport and storage — each one a point of failure." },
                { n: "B", t: "Answer records can be altered", d: "Once an exam ends, scripts and digital records sit in custody where tampering is possible and hard to detect." },
                { n: "C", t: "Fairness is impossible to audit", d: "Candidates have no way to confirm the difficulty, scoring, or delivery of the paper they actually received." },
                { n: "D", t: "Disputes have no ground truth", d: "When results are challenged, there is no immutable record to settle the question objectively." },
              ].map((p) => (
                <div className={s.problemRow} key={p.n}>
                  <span className={s.problemNum}>{p.n}</span>
                  <div>
                    <h4>{p.t}</h4>
                    <p>{p.d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===== GUARANTEES ===== */}
      <section className={`section-sm ${s.guarSection}`} id="guarantees">
        <div className="wrap">
          <div className="heading-block reveal">
            <span className="eyebrow">The four guarantees</span>
            <h2>Four properties, each backed by cryptography.</h2>
            <p>Every examination run on CryptoExam Core satisfies the same four guarantees — and produces the proofs to demonstrate it.</p>
          </div>
          <div className={s.guarGrid}>
            {[
              { icon: "lock", num: "GUARANTEE 01", title: "No human sees the paper before T₀", desc: "The paper is encrypted at creation and can only be decrypted at the broadcast moment, using a key derived from a public randomness beacon.", tech: "AES-GCM-256 + HKDF from drand beacon" },
              { icon: "git-merge", num: "GUARANTEE 02", title: "Answer records are immutable", desc: "Each candidate\u2019s answers are hashed into a Merkle tree whose root is committed on-chain, making any later alteration provably detectable.", tech: "SHA-256 Merkle root committed to Polygon PoS" },
              { icon: "binary", num: "GUARANTEE 03", title: "Difficulty is machine-verifiable", desc: "A zero-knowledge proof attests that the paper meets its declared difficulty distribution — without revealing the questions themselves.", tech: "ZK-SNARK (Groth16) proof on-chain" },
              { icon: "satellite-dish", num: "GUARANTEE 04", title: "Delivery is provable", desc: "Hardware-backed attestation signs the time, place and device of delivery, producing a proof that the right paper reached the right centre.", tech: "TPM 2.0 + GPS signed ProofOfDelivery" },
            ].map((g) => (
              <article className={`card card-hover ${s.guarCard} reveal`} key={g.num}>
                <div className={s.guarTop}>
                  <span className="icon-chip accent"><Icon name={g.icon} size={18} strokeWidth={1.7} /></span>
                  <span className={s.guarNum}>{g.num}</span>
                </div>
                <h3>{g.title}</h3>
                <p>{g.desc}</p>
                <span className={s.guarTech}>{g.tech}</span>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ===== HOW IT WORKS ===== */}
      <section className={`section ${s.howItWorks}`}>
        <div className="wrap">
          <div className="heading-block reveal">
            <span className="eyebrow">Lifecycle</span>
            <h2>One sealed path, from authoring to audit.</h2>
            <p>Every examination follows the same verifiable sequence. Each step hands the next a proof it can check.</p>
          </div>
          <div className={`${s.timeline} reveal`}>
            {[
              { icon: "key-round", time: "PRE-EXAM", title: "Key ceremony", desc: "Custodians split the master key with Shamir\u2019s Secret Sharing. No single party can open the paper.", key: true },
              { icon: "file-lock-2", time: "AUTHORING", title: "Paper sealed", desc: "Setters compose and encrypt the paper. A ZK proof certifies its difficulty profile." },
              { icon: "satellite-dish", time: "T₀", title: "Broadcast", desc: "At the exact start time, the decryption key is released from the beacon. Not a second sooner." },
              { icon: "pen-line", time: "LIVE", title: "Session", desc: "Candidates answer under lockdown. Responses are continuously hashed and synced." },
              { icon: "search-check", time: "POST-EXAM", title: "Commit & audit", desc: "The Merkle root is committed on-chain. Anyone can verify any submission, forever." },
            ].map((step) => (
              <div className={`${s.tlStep} ${step.key ? s.tlStepKey : ""}`} key={step.time}>
                <span className={s.tlNode}>
                  <Icon name={step.icon} size={22} strokeWidth={1.6} />
                </span>
                <span className={s.tlTime}>{step.time}</span>
                <h4>{step.title}</h4>
                <p>{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== ARCHITECTURE ===== */}
      <section className={`section ${s.arch}`}>
        <div className="wrap">
          <div className={s.archGrid}>
            <div className="reveal">
              <span className="eyebrow on-dark">Architecture</span>
              <h2>Trust, reduced to verifiable evidence.</h2>
              <p className={s.archLead}>
                Where conventional systems ask you to trust the institution, CryptoExam Core asks
                you to trust nothing — and verify everything.
              </p>
              <div className={s.archFeats}>
                {[
                  { icon: "users-round", title: "Threshold custody", desc: "The master key never exists in one place. A quorum of independent custodians is required to act." },
                  { icon: "link", title: "On-chain commitments", desc: "Merkle roots and proofs are anchored to Polygon PoS — public, permanent, and tamper-evident." },
                  { icon: "eye", title: "Open audit, no login", desc: "Candidates, examiners and the public can independently verify any exam on a block explorer." },
                ].map((f) => (
                  <div className={s.archFeat} key={f.title}>
                    <span className="icon-chip on-dark"><Icon name={f.icon} size={18} strokeWidth={1.7} /></span>
                    <div>
                      <h4>{f.title}</h4>
                      <p>{f.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Code Card */}
            <div className={`${s.codeCard} reveal`} aria-hidden="true">
              <div className={s.codeHead}>
                <span className={s.codeDots}>
                  <span className={s.codeDot} />
                  <span className={s.codeDot} />
                  <span className={s.codeDot} />
                </span>
                <span className={s.codeFname}>proof_of_delivery.json</span>
              </div>
              <pre className={s.codeBody}>
                <span className={s.codeC}>{"// Signed at the examination centre, at T₀"}</span>
                {"\n{\n  "}
                <span className={s.codeK}>{'"examId"'}</span>:      <span className={s.codeS}>{'"FA26-CIVILS-PRELIM-01"'}</span>,
                {"\n  "}<span className={s.codeK}>{'"centre"'}</span>:      <span className={s.codeS}>{'"DL-CTR-0142"'}</span>,
                {"\n  "}<span className={s.codeK}>{'"merkleRoot"'}</span>:  <span className={s.codeS}>{'"0x9f3a…c71d"'}</span>,
                {"\n  "}<span className={s.codeK}>{'"zkProof"'}</span>:     <span className={s.codeS}>{'"groth16:verified"'}</span>,
                {"\n  "}<span className={s.codeK}>{'"deliveredAt"'}</span>: <span className={s.codeN}>1781827200</span>,
                {"\n  "}<span className={s.codeK}>{'"geo"'}</span>:         [ <span className={s.codeN}>28.6139</span>, <span className={s.codeN}>77.2090</span> ],
                {"\n  "}<span className={s.codeK}>{'"tpmQuote"'}</span>:    <span className={s.codeS}>{'"PCR[7]=sha256:4b…e9"'}</span>,
                {"\n  "}<span className={s.codeK}>{'"chain"'}</span>:       <span className={s.codeS}>{'"polygon-pos"'}</span>,
                {"\n  "}<span className={s.codeK}>{'"status"'}</span>:      <span className={s.codeS}>{'"CONFIRMED"'}</span>
                {"\n}"}
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* ===== ROLES ===== */}
      <section className="section" id="roles">
        <div className="wrap">
          <div className="heading-block reveal">
            <span className="eyebrow">Four interfaces, one system of record</span>
            <h2>A tailored surface for every role in the exam chain.</h2>
            <p>Each participant works in an interface designed for their task — sharing the same cryptographic backbone.</p>
          </div>
          <div className={s.rolesGrid}>
            {[
              { icon: "graduation-cap", title: "Candidate", tag: "Calm institutionalism", desc: "A focused, distraction-free exam environment with biometric check-in, real-time autosave, and a printable cryptographic receipt for every submission.", href: "/exam", linkText: "View candidate flow" },
              { icon: "flask-conical", title: "Setter", tag: "Workbench", desc: "A dense authoring workbench for composing papers, generating ZK difficulty proofs, running red-team review, and sealing question banks under lock.", href: "/for-setters", linkText: "View setter workbench" },
              { icon: "badge-check", title: "Invigilator", tag: "Gateway", desc: "Biometric verification of candidates at the centre, live roster management, and a one-tap channel to raise alerts and incident reports.", href: "/invigilator/login", linkText: "View invigilator gateway" },
              { icon: "radar", title: "Administrator", tag: "Mission control", desc: "A real-time command console for centres, candidates, nodes and emergencies — with dual-control authorisation for every sensitive action.", href: "/for-administrators", linkText: "View admin console" },
            ].map((role) => (
              <article className={`card card-hover ${s.roleCard} reveal`} key={role.title}>
                <div className={s.roleHead}>
                  <span className="icon-chip"><Icon name={role.icon} size={18} strokeWidth={1.7} /></span>
                  <div>
                    <h3>{role.title}</h3>
                    <span className={s.roleTag}>{role.tag}</span>
                  </div>
                </div>
                <p>{role.desc}</p>
                <Link className={`btn-link ${s.roleLink}`} href={role.href}>
                  {role.linkText} <Icon name="arrow-right" size={15} />
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ===== STATS ===== */}
      <section className={`section-sm ${s.stats}`}>
        <div className="wrap">
          <div className={`${s.statsGrid} reveal`}>
            <div>
              <div className={s.statN}>4</div>
              <div className={s.statL}>Cryptographic guarantees on every exam</div>
            </div>
            <div>
              <div className={s.statN}>11</div>
              <div className={s.statL}>Indian languages supported end to end</div>
            </div>
            <div>
              <div className={s.statN}>0<small> trust</small></div>
              <div className={s.statL}>Required in any single party or device</div>
            </div>
            <div>
              <div className={s.statN}>100<small>%</small></div>
              <div className={s.statL}>Of submissions publicly verifiable</div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== FAQ ===== */}
      <section className="section" id="faq">
        <div className="wrap-narrow">
          <div className="heading-block center reveal">
            <span className="eyebrow" style={{ justifyContent: "center" }}>Common questions</span>
            <h2>What you can verify, and how.</h2>
          </div>
          <div className={`${s.faqList} reveal`}>
            {faqs.map((f, i) => (
              <FaqItem key={i} q={f.q} a={f.a} defaultOpen={i === 0} />
            ))}
          </div>
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section className="section-sm">
        <div className="wrap">
          <div className={`${s.ctaBand} reveal`}>
            <span className="eyebrow on-dark">Get started</span>
            <h2 style={{ marginTop: "var(--space-md)" }}>
              Bring provable integrity to your next examination.
            </h2>
            <p>
              Request a briefing and we&apos;ll walk your team through the platform, the
              cryptography, and a live audit of a sample exam.
            </p>
            <div className={s.heroCta}>
              <Link className="btn btn-on-dark btn-lg" href="/contact">
                Request access <Icon name="arrow-right" size={16} />
              </Link>
              <Link className="btn btn-quiet-dark btn-lg" href="/platform">
                Read the platform overview
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
