import styles from "./audit.module.css";

export const metadata = {
  title: "CryptoExam — Public Audit Portal",
  description: "Verify any exam independently on Polygonscan. No login required.",
};

export default function AuditPortal() {
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <a href="/" className={styles.logo}>CryptoExam</a>
        <span className={styles.badge}>Public Audit — No Login Required</span>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <h1 className={styles.title}>Public Exam Verification</h1>
          <p className={styles.subtitle}>
            Anyone — journalist, RTI officer, candidate, parent, or court — can independently verify
            any exam&apos;s integrity. No API key. No login. No trust required.
          </p>
        </section>

        <section className={styles.verifyBox}>
          <h2 className={styles.verifyTitle}>Verify an Exam</h2>
          <div className={styles.inputGroup}>
            <label className={styles.inputLabel}>Exam ID (UUID)</label>
            <input
              type="text"
              className={styles.input}
              placeholder="e.g., a1b2c3d4-5678-90ab-cdef-1234567890ab"
              readOnly
              title="Enter exam ID to verify (requires JavaScript client)"
            />
            <p className={styles.inputHint}>
              Paste the Exam ID from your admit card or receipt to verify on-chain data.
            </p>
          </div>
        </section>

        <section className={styles.howItWorks}>
          <h2 className={styles.sectionTitle}>How Verification Works</h2>
          <div className={styles.stepGrid}>
            <div className={styles.stepCard}>
              <div className={styles.stepIcon}></div>
              <h3>Step 1: Question Hash</h3>
              <p>The SHA-256 hash of the encrypted paper was committed to Polygon <strong>before T₀</strong>.
                This proves the paper existed before anyone could see it.</p>
            </div>
            <div className={styles.stepCard}>
              <div className={styles.stepIcon}></div>
              <h3>Step 2: ZK Proof</h3>
              <p>A Groth16 ZK-SNARK proves the paper meets IRT difficulty constraints
                <strong> without revealing any questions</strong>. Download from IPFS and verify locally.</p>
            </div>
            <div className={styles.stepCard}>
              <div className={styles.stepIcon}></div>
              <h3>Step 3: Merkle Root</h3>
              <p>Every candidate&apos;s answer hash is a leaf in a SHA-256 Merkle tree. The root is
                committed to Polygon. <strong>Any modification changes the root.</strong></p>
            </div>
            <div className={styles.stepCard}>
              <div className={styles.stepIcon}></div>
              <h3>Step 4: Polygonscan</h3>
              <p>Copy the transaction hash to <a href="https://amoy.polygonscan.com" target="_blank" rel="noopener noreferrer">amoy.polygonscan.com</a> and
                verify all data matches. <strong>Zero trust required.</strong></p>
            </div>
          </div>
        </section>

        <section className={styles.commands}>
          <h2 className={styles.sectionTitle}>Verify Locally (CLI)</h2>
          <div className={styles.codeBlock}>
            <code>
              <span className={styles.comment}># 1. Download ZK proof from IPFS</span>{"\n"}
              ipfs cat QmXxx... &gt; proof.json{"\n"}
              {"\n"}
              <span className={styles.comment}># 2. Verify Groth16 proof</span>{"\n"}
              snarkjs groth16 verify verification_key.json public.json proof.json{"\n"}
              {"\n"}
              <span className={styles.comment}># 3. Check Merkle root on-chain</span>{"\n"}
              cast call 0xCONTRACT &quot;verifyExam(bytes32)&quot; $EXAM_ID --rpc-url https://rpc-amoy.polygon.technology
            </code>
          </div>
        </section>

        <section className={styles.transparency}>
          <h2 className={styles.sectionTitle}>Transparency Guarantees</h2>
          <div className={styles.guaranteeList}>
            <div className={styles.guarantee}>
              <span className={styles.checkmark}>✓</span>
              <div>
                <strong>Question hash committed before exam</strong>
                <p>On-chain timestamp proves pre-commitment</p>
              </div>
            </div>
            <div className={styles.guarantee}>
              <span className={styles.checkmark}>✓</span>
              <div>
                <strong>Difficulty verified by zero-knowledge proof</strong>
                <p>No questions revealed; only IRT parameters proven</p>
              </div>
            </div>
            <div className={styles.guarantee}>
              <span className={styles.checkmark}>✓</span>
              <div>
                <strong>Answers are immutable after submission</strong>
                <p>Merkle root on Polygon — any change is cryptographically detectable</p>
              </div>
            </div>
            <div className={styles.guarantee}>
              <span className={styles.checkmark}>✓</span>
              <div>
                <strong>Hardware delivery is GPS + TPM signed</strong>
                <p>ProofOfDelivery attestation verifiable on-chain</p>
              </div>
            </div>
            <div className={styles.guarantee}>
              <span className={styles.checkmark}>✓</span>
              <div>
                <strong>DPDP Act 2023 — No PII on-chain</strong>
                <p>Only cryptographic hashes. Never names, photos, or Aadhaar.</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <p>CryptoExam Core — The math is the affidavit.</p>
        <p className={styles.footerSub}>All on-chain data is permanently and publicly verifiable on Polygon PoS.</p>
      </footer>
    </div>
  );
}
