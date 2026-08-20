import type { Metadata } from "next";
import Link from "next/link";
import Footer from "@/components/marketing/Footer";
import Icon from "@/components/marketing/LucideIcon";
import s from "./page.module.css";

export const metadata: Metadata = {
  title: "Platform — CryptoExam Core",
  description: "The platform — four interfaces, one cryptographic backbone.",
};



/* ─── Feature list helper ─── */
function Feature({ icon, title, desc, variant }: { icon: string; title: string; desc: string; variant?: string }) {
  const iconClass = variant === "dark"
    ? s.darkChip
    : variant === "cream"
    ? s.creamChip
    : variant === "deep"
    ? s.deepChip
    : "";

  return (
    <li className={s.featureItem}>
      <Icon name={icon} size={18} strokeWidth={1.7} className={s.featureIcon} />
      <div>
        <div className={s.featureT}>{title}</div>
        <div className={s.featureD}>{desc}</div>
      </div>
    </li>
  );
}

export default function PlatformPage() {
  return (
    <main>
      {/* ===== PAGE HERO ===== */}
      <section className={s.pageHero}>
        <div className="wrap">
          <span className="eyebrow">Platform</span>
          <h1>Four interfaces. One verifiable system of record.</h1>
          <p className={s.pageHeroLead}>
            Each role in the examination chain works in a surface designed for their task —
            candidates, setters, invigilators and administrators — sharing the same cryptographic
            backbone underneath.
          </p>
        </div>
      </section>

      {/* ===== CANDIDATE ===== */}
      <section className={`${s.role} ${s.calm} reveal reveal-rise`} id="candidate">
        <div className={`wrap ${s.roleGrid}`}>
          <div>
            <span className={s.roleLabel}>01 · Candidate Portal</span>
            <h2>Calm institutionalism.</h2>
            <span className={s.roleTag}>
              <span className={`icon-chip ${s.roleTagChipSmall}`}>
                <Icon name="graduation-cap" size={14} strokeWidth={1.7} />
              </span>
              For the candidate at their desk
            </span>
          </div>
          <div>
            <p>
              A focused exam environment in the candidate&apos;s chosen language. Everything that
              is not essential to answering the next question is removed from the screen.
            </p>
            <p className={s.roleGridPSpace}>
              Biometric check-in confirms identity at the centre. Responses are autosaved and
              continuously hashed. On submission, the candidate receives a printable receipt
              containing the cryptographic root of their paper — proof, in their hand, that what
              they wrote cannot be altered.
            </p>
            <ul className={s.featureList}>
              <Feature icon="languages" title="11 Indian languages" desc="Native script rendering — Devanagari, Bengali, Tamil, Telugu, Kannada, Malayalam, Gujarati and more." />
              <Feature icon="fingerprint" title="On-device biometric verification" desc="Raw biometric data never leaves the candidate's hardware — DPDP Act 2023 compliant by design." />
              <Feature icon="save" title="Continuous answer sync" desc="Local-first storage with Merkle hash sync — works through brief network interruptions." />
              <Feature icon="receipt" title="Printable cryptographic receipt" desc="A4 receipt with the candidate's submission root, on-chain transaction, and verification link." />
            </ul>
          </div>
        </div>
      </section>

      {/* ===== SETTER ===== */}
      <section className={`${s.role} ${s.dark} reveal reveal-left`} id="setter">
        <div className={`wrap ${s.roleGrid}`}>
          <div>
            <span className={s.roleLabel}>02 · Setter Workbench</span>
            <h2>Authoring under lock.</h2>
            <span className={s.roleTag}>
              <span className={`icon-chip ${s.roleTagChipSmall} ${s.darkChip}`}>
                <Icon name="flask-conical" size={14} strokeWidth={1.7} />
              </span>
              For the paper setter and reviewer
            </span>
          </div>
          <div>
            <p>
              A dense, dark, data-forward workbench for examination authors. Questions are
              authored as parametric templates, verified, red-teamed and sealed — without the
              paper ever existing in plaintext outside the lock.
            </p>
            <p className={s.roleGridPSpace}>
              The Setter Workbench derives every answer key from a formula rather than an
              assertion, generates the ZK proof of difficulty, runs red-team adversarial
              review, and seals the final paper under a key only the network can release at T₀.
            </p>
            <ul className={s.featureList}>
              <Feature icon="binary" title="ZK-SNARK difficulty proof" desc="Groth16 proof attests the paper's difficulty distribution without revealing the questions." variant="dark" />
              <Feature icon="swords" title="Red-team review pipeline" desc="Adversarial reviewers stress-test items for ambiguity, leakage and bias before sealing." variant="dark" />
              <Feature icon="git-branch" title="Provisional IRT estimates" desc="3PL parameters derived from item features. Calibration proper needs response data from a sitting, and is not claimed until then." variant="dark" />
              <Feature icon="function-square" title="Computed answer keys" desc="Setters author parametric templates; the key is the result of evaluating a formula against the substituted parameters, so a wrong key cannot be asserted." variant="dark" />
              <Feature icon="dices" title="N forms, drawn at T₀" desc="Candidate papers are committed together under one root days ahead; a public beacon picks which one runs, and anyone can recompute the draw." variant="dark" />
              <Feature icon="printer" title="Print delivery for paper centres (§30)" desc="A centre with no terminal per candidate unlocks the SAME sealed bundle at T₀ — from a drand beacon cached before the air-gap, or from on-site Shamir shards when no window existed. Built and cross-language verified against the Python implementation; PDF render and printer spool are not yet built." variant="dark" />
              <Feature icon="key-round" title="Sealed at lock" desc="Final paper is encrypted under a key released only by the public beacon at T₀." variant="dark" />
            </ul>
          </div>
        </div>
      </section>

      {/* ===== INVIGILATOR ===== */}
      <section className={`${s.role} ${s.cream} reveal reveal-scale`} id="invigilator">
        <div className={`wrap ${s.roleGrid}`}>
          <div>
            <span className={s.roleLabel}>03 · Invigilator Gateway</span>
            <h2>Verification at the centre.</h2>
            <span className={s.roleTag}>
              <span className={`icon-chip ${s.roleTagChipSmall} ${s.creamChip}`}>
                <Icon name="badge-check" size={14} strokeWidth={1.7} />
              </span>
              For the invigilator at the examination centre
            </span>
          </div>
          <div>
            <p>
              A lightweight tablet interface for invigilators on the floor. Designed for a single
              morning of clear, decisive actions: verify, seat, monitor, report.
            </p>
            <p className={s.roleGridPSpace}>
              Every action the invigilator takes is signed and time-stamped. Incident reports
              route directly to the administrator&apos;s mission control without paperwork in between.
            </p>
            <ul className={s.featureList}>
              <Feature icon="scan-face" title="Biometric candidate verification" desc="Match candidates to their registered identity at the centre door, fully on-device." variant="cream" />
              <Feature icon="clipboard-list" title="Live roster & seat plan" desc="See present, absent and late candidates in real time — with seat-level filtering." variant="cream" />
              <Feature icon="siren" title="One-tap incident report" desc="Raise a signed alert that reaches mission control in seconds — with photo and audio attachment." variant="cream" />
              <Feature icon="file-signature" title="Signed centre report" desc="A single signed end-of-day report replaces hand-written attendance and incident logs." variant="cream" />
            </ul>
          </div>
        </div>
      </section>

      {/* ===== ADMIN ===== */}
      <section className={`${s.role} ${s.deep} reveal reveal-right`} id="admin">
        <div className={`wrap ${s.roleGrid}`}>
          <div>
            <span className={s.roleLabel}>04 · Admin Console</span>
            <h2>Mission control.</h2>
            <span className={s.roleTag}>
              <span className={`icon-chip ${s.roleTagChipSmall} ${s.deepChip}`}>
                <Icon name="radar" size={14} strokeWidth={1.7} />
              </span>
              For the examining body
            </span>
          </div>
          <div>
            <p>
              A real-time command surface for the people responsible for the entire exam —
              centres, candidates, nodes, blockchain anchors and emergencies. Every sensitive
              action requires dual control.
            </p>
            <p className={s.roleGridPSpace}>
              The Admin Console is where emergency controls, centre status and the signed audit
              trail of every action live.
            </p>
            <ul className={s.featureList}>
              <Feature icon="users-round" title="Dual-control authorisation" desc="No single administrator can act on a sensitive operation. Every critical step needs two approvals." variant="deep" />
              <Feature icon="map" title="Live centre map" desc="A geographic view of every examination centre with signal health, attendance and alerts." variant="deep" />
              <Feature icon="link" title="Blockchain node status" desc="Real-time monitoring of Polygon PoS anchors, commitments, and confirmations." variant="deep" />
              <Feature icon="megaphone" title="Emergency broadcast" desc="Reach every centre, candidate and invigilator in a single signed transmission." variant="deep" />
            </ul>
          </div>
        </div>
      </section>

      {/* ===== THE INTEGRITY PROBLEM =====
           Relocated from the home page: the front door now routes people to
           their portal, and the long-form argument lives here. */}
      <section className="section reveal reveal-rise">
        <div className="wrap">
          <div className={s.problemGrid}>
            <div className={s.leadCol}>
              <span className="eyebrow">The integrity problem</span>
              <h2 className={s.problemH2}>
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

      {/* ===== THE FOUR GUARANTEES ===== */}
      <section className={`section-sm ${s.guarSection} reveal reveal-scale`} id="guarantees">
        <div className="wrap">
          <div className="heading-block">
            <span className="eyebrow">The four guarantees</span>
            <h2>Four properties, each backed by cryptography.</h2>
            <p>Every examination run on CryptoExam Core satisfies the same four guarantees — and produces the proofs to demonstrate it.</p>
          </div>
          <div className={s.guarGrid}>
            {[
              { icon: "lock", num: "GUARANTEE 01", title: "No human sees the paper before T₀", desc: "The paper is encrypted at creation and can only be decrypted at the broadcast moment, using a key derived from a public randomness beacon.", tech: "AES-GCM-256 + HKDF from drand beacon" },
              { icon: "git-merge", num: "GUARANTEE 02", title: "Answer records are immutable", desc: "Each candidate’s answers are hashed into a Merkle tree whose root is committed on-chain, making any later alteration provably detectable.", tech: "SHA-256 Merkle root committed to Polygon PoS" },
              { icon: "binary", num: "GUARANTEE 03", title: "Difficulty is machine-verifiable", desc: "A zero-knowledge proof attests that the paper meets its declared difficulty distribution — without revealing the questions themselves.", tech: "ZK-SNARK (Groth16) proof on-chain" },
              { icon: "satellite-dish", num: "GUARANTEE 04", title: "Delivery is provable", desc: "Hardware-backed attestation signs the time, place and device of delivery, producing a proof that the right paper reached the right centre.", tech: "TPM 2.0 + GPS signed ProofOfDelivery" },
            ].map((g) => (
              <article className={`card card-hover ${s.guarCard}`} key={g.num}>
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

      {/* ===== ARCHITECTURE ===== */}
      <section className={`${s.archSection} reveal reveal-rise`} id="architecture">
        <div className="wrap">
          <div className="heading-block">
            <span className="eyebrow">Architecture</span>
            <h2>A layered, verifiable stack.</h2>
            <p>Each layer produces evidence the next layer can check. There is no single point of trust.</p>
          </div>
          <div className={s.archGrid}>
            {[
              { icon: "lock", title: "Sealing layer", desc: "Papers are encrypted with AES-GCM-256 keys derived from the drand public randomness beacon. Custody is split via Shamir's Secret Sharing.", mono: "AES-GCM-256 · HKDF · drand · SSS" },
              { icon: "binary", title: "Proof layer", desc: "Difficulty is asserted with a Groth16 ZK-SNARK. Verifiers can confirm fairness without learning any question.", mono: "CIRCOM · Groth16 · zk-SNARK" },
              { icon: "cpu", title: "Attestation layer", desc: "Centre devices use TPM 2.0 with GPS to sign a ProofOfDelivery — binding paper, place, time and hardware.", mono: "TPM 2.0 · PCR quotes · GPS" },
              { icon: "git-merge", title: "Commitment layer", desc: "Answer roots and proofs are anchored on Polygon PoS — public, permanent, and tamper-evident.", mono: "SHA-256 Merkle · Polygon PoS" },
              { icon: "shield-check", title: "Lockdown layer", desc: "An Electron-based client locks the candidate environment, blocks side-channels and signs telemetry.", mono: "Electron · WebAuthn · sandbox" },
              { icon: "eye", title: "Audit layer", desc: "Anyone — candidate, examiner, journalist — can independently verify any submission on Polygonscan, without an account.", mono: "Open audit · no login required" },
            ].map((tile) => (
              <div className={s.archTile} key={tile.title}>
                <span className="icon-chip accent" style={{ marginBottom: "var(--space-md)" }}>
                  <Icon name={tile.icon} size={18} strokeWidth={1.7} />
                </span>
                <h4>{tile.title}</h4>
                <p>{tile.desc}</p>
                <span className={s.archMono}>{tile.mono}</span>
              </div>
            ))}
          </div>
        </div>
      </section>



      <Footer />
    </main>
  );
}
