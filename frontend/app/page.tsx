import Link from "next/link";
import styles from "./page.module.css";

export default function LandingPage() {
  return (
    <main className={styles.main}>
      {/* Hero Section */}
      <section className={styles.hero}>
        <div className={styles.tricolour}>
          <div className={styles.saffronBar} />
          <div className={styles.whiteBar} />
          <div className={styles.greenBar} />
        </div>

        <div className={styles.heroContent}>
          <p className={styles.badge}>FAR AWAY 2026 · Examinations Track</p>
          <h1 className={styles.title}>CryptoExam Core</h1>
          <p className={styles.subtitle}>
            Zero-Trust Examination Infrastructure for India
          </p>
          <p className={styles.tagline}>
            The math cannot be bribed. The blockchain cannot forget. The hardware cannot lie.
          </p>

          <div className={styles.portals}>
            <Link href="/exam" className={styles.portalCard}>
              <span className={styles.portalIcon}>📝</span>
              <span className={styles.portalLabel}>Candidate Portal</span>
              <span className={styles.portalDesc}>Take your exam securely</span>
            </Link>
            <Link href="/setter" className={styles.portalCard}>
              <span className={styles.portalIcon}>🔬</span>
              <span className={styles.portalLabel}>Setter Workbench</span>
              <span className={styles.portalDesc}>Create &amp; manage papers</span>
            </Link>
            <Link href="/invigilator/login" className={styles.portalCard}>
              <span className={styles.portalIcon}>🪪</span>
              <span className={styles.portalLabel}>Invigilator Gateway</span>
              <span className={styles.portalDesc}>Biometric centre verification</span>
            </Link>
            <Link href="/admin" className={styles.portalCard}>
              <span className={styles.portalIcon}>🛡️</span>
              <span className={styles.portalLabel}>Admin Console</span>
              <span className={styles.portalDesc}>Mission control</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Five Guarantees */}
      <section className={styles.guarantees}>
        <h2 className={styles.sectionTitle}>Five Cryptographic Guarantees</h2>
        <div className={styles.guaranteeGrid}>
          {[
            { num: "01", title: "No human sees the paper before T₀", desc: "AES-GCM-256 + HKDF from drand beacon", icon: "🔐" },
            { num: "02", title: "Offline centers cannot cheat", desc: "RSA time-lock puzzle on TPM 2.0 hardware", icon: "⏱️" },
            { num: "03", title: "Answer records are immutable", desc: "SHA-256 Merkle root committed to Polygon PoS", icon: "🌳" },
            { num: "04", title: "Difficulty is machine-verifiable", desc: "ZK-SNARK (Groth16) proof on-chain", icon: "🧮" },
            { num: "05", title: "Delivery is provable", desc: "TPM 2.0 + GPS signed ProofOfDelivery", icon: "📡" },
          ].map((g) => (
            <div key={g.num} className={styles.guaranteeCard}>
              <span className={styles.guaranteeIcon}>{g.icon}</span>
              <span className={styles.guaranteeNum}>{g.num}</span>
              <h3 className={styles.guaranteeTitle}>{g.title}</h3>
              <p className={styles.guaranteeDesc}>{g.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Public Audit Link */}
      <section className={styles.auditSection}>
        <Link href="/exam/audit" className={styles.auditLink}>
          🔍 Public Audit Portal — Verify any exam on Polygonscan (No Login Required)
        </Link>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <p>CryptoExam Core · FAR AWAY 2026 · Built for India</p>
        <p className={styles.footerSub}>DPDP Act 2023 Compliant · Polygon PoS · CIRCOM Groth16</p>
      </footer>
    </main>
  );
}
