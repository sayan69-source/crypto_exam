import type { Metadata } from "next";
import Navbar from "@/components/marketing/Navbar";
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
      <Navbar />

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
      <section className={`${s.role} ${s.calm}`} id="candidate">
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
      <section className={`${s.role} ${s.dark}`} id="setter">
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
              composed, calibrated, red-teamed and sealed — without the paper ever existing in
              plaintext outside the lock.
            </p>
            <p className={s.roleGridPSpace}>
              The Setter Workbench generates the ZK proof of difficulty, runs red-team
              adversarial review, and seals the final paper under a key only the network can
              release at T₀.
            </p>
            <ul className={s.featureList}>
              <Feature icon="binary" title="ZK-SNARK difficulty proof" desc="Groth16 proof attests the paper's difficulty distribution without revealing the questions." variant="dark" />
              <Feature icon="swords" title="Red-team review pipeline" desc="Adversarial reviewers stress-test items for ambiguity, leakage and bias before sealing." variant="dark" />
              <Feature icon="git-branch" title="Item Response Theory calibration" desc="IRT-based item analysis with parallel paper-mode generation for equivalent variants." variant="dark" />
              <Feature icon="key-round" title="Sealed at lock" desc="Final paper is encrypted under a key released only by the public beacon at T₀." variant="dark" />
            </ul>
          </div>
        </div>
      </section>

      {/* ===== INVIGILATOR ===== */}
      <section className={`${s.role} ${s.cream}`} id="invigilator">
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
      <section className={`${s.role} ${s.deep}`} id="admin">
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
              The Admin Console is where the key ceremony is convened, where the emergency
              channel is opened, and where the audit trail of every action lives.
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

      {/* ===== ARCHITECTURE ===== */}
      <section className={s.archSection} id="architecture">
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
