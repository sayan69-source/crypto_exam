import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/marketing/Navbar";
import Footer from "@/components/marketing/Footer";
import Icon from "@/components/marketing/LucideIcon";
import s from "../legal.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy — CryptoExam Core",
  description:
    "How CryptoExam Core handles personal data under the Digital Personal Data Protection Act, 2023 — on-device biometrics, public proofs without personal exposure, and your rights to access, correct and erase.",
};

const LAST_UPDATED = "2026-06-09";

export default function PrivacyPage() {
  return (
    <main>
      <Navbar />

      <section className={s.hero}>
        <div className="wrap">
          <span className="eyebrow">Privacy</span>
          <h1 className={s.h1}>
            Proofs are public. <em>Personal data is not.</em>
          </h1>
          <p className={s.lead}>
            CryptoExam Core is built so that an examination&apos;s integrity is publicly verifiable
            without ever exposing the people who sat it. This policy explains, in plain language,
            what we collect, what we don&apos;t, what stays on your device, and what your rights are
            under the Digital Personal Data Protection Act, 2023.
          </p>
          <p className={s.meta}>Last updated: {LAST_UPDATED}</p>
        </div>
      </section>

      <section className={s.bodySection}>
        <div className="wrap-narrow">
          <div className={s.callout}>
            <span className="icon-chip"><Icon name="shield" size={18} strokeWidth={1.7} /></span>
            <div>
              <h3>The principle in one line</h3>
              <p>If a piece of data could identify or harm a candidate, it never leaves their
                device in raw form. If it&apos;s needed to prove integrity, only its hash goes on-chain.</p>
            </div>
          </div>

          <Article number="01" title="Who we are">
            <p>
              CryptoExam Core (&ldquo;CryptoExam&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is a
              zero-trust examination infrastructure operator. When an examining body uses our
              platform to conduct an examination, we act as a Data Processor under the Digital
              Personal Data Protection Act, 2023 (&ldquo;DPDP Act&rdquo;); the examining body is the
              Data Fiduciary.
            </p>
          </Article>

          <Article number="02" title="What we collect">
            <p>To operate an examination we process the following categories of personal data:</p>
            <ul>
              <li><strong>Identity:</strong> roll number, name and date of birth (provided by the examining body).</li>
              <li><strong>Authentication signals:</strong> a one-time password sent to your registered mobile number, and a consent record stating you accepted this policy.</li>
              <li><strong>Biometric verification result:</strong> a pass/fail signal from on-device face matching. See §3.</li>
              <li><strong>Examination metadata:</strong> centre, language, timestamps, anti-cheat events (tab switches, network drops, etc.).</li>
              <li><strong>Submission hashes:</strong> cryptographic hashes of your answers and the Merkle inclusion proof of your receipt.</li>
            </ul>
          </Article>

          <Article number="03" title="What we never collect">
            <ul>
              <li><strong>Raw biometric data.</strong> Face matching is performed on your device. Only a mathematical embedding is compared, and only a pass/fail result is shared. Your photograph, video frames or face template are not transmitted or stored by us.</li>
              <li><strong>Question content tied to your identity.</strong> On-chain commitments record hashes of submissions, not the answers themselves, and never a candidate&apos;s name or roll number.</li>
              <li><strong>Behavioural profiling beyond the session.</strong> Anti-cheat signals are scoped to the examination window and discarded after the audit retention period.</li>
            </ul>
          </Article>

          <Article number="04" title="Why we collect it">
            <p>We process personal data only for purposes that are necessary to deliver and prove
              the integrity of an examination:</p>
            <ul>
              <li>Verify that the right candidate is sitting the right paper at the right centre.</li>
              <li>Produce a cryptographic receipt that you and any auditor can verify independently.</li>
              <li>Detect tampering and anti-cheat anomalies, and produce evidence for review.</li>
              <li>Comply with statutory record-keeping obligations of the examining body.</li>
            </ul>
          </Article>

          <Article number="05" title="On-device biometrics, in plain language">
            <p>
              Biometric data carries a lifetime of risk and almost no benefit if it leaves your
              device. So it doesn&apos;t. Your camera capture, face embedding and matching score
              stay on your hardware. The platform receives only a one-bit answer: &ldquo;the
              candidate at this terminal is the candidate enrolled for this seat — yes or no.&rdquo;
              The raw template is discarded immediately after the check.
            </p>
          </Article>

          <Article number="06" title="What is public, by design">
            <p>
              The whole point of CryptoExam Core is that an examination&apos;s integrity is
              <em> publicly checkable</em> — by you, by a journalist, by a court — without anyone
              needing to log in. To make that possible, certain non-personal data is published on
              a public blockchain (Polygon PoS):
            </p>
            <ul>
              <li>The encrypted question hash, before the examination starts.</li>
              <li>A zero-knowledge difficulty proof for each paper.</li>
              <li>The Merkle root of all candidate answers, after the examination ends.</li>
              <li>Hardware-attested delivery proofs (time, place, device).</li>
            </ul>
            <p>None of this data identifies a candidate. See our <Link href="/about#transparency" className={s.link}>public transparency report</Link> for the exhaustive list and verification instructions.</p>
          </Article>

          <Article number="07" title="How long we keep your data">
            <p>
              Personal data is retained only for the period required by the examining body and
              applicable law, typically until the results are published and the statutory
              objection window closes. Cryptographic hashes that contain no personal information
              remain on-chain indefinitely — that is what makes the examination publicly auditable.
            </p>
          </Article>

          <Article number="08" title="Your rights">
            <p>Under the DPDP Act you have the right to:</p>
            <ul>
              <li>Access the personal data we hold about you and how it has been used.</li>
              <li>Have inaccurate data corrected, or incomplete data completed.</li>
              <li>Have your data erased once the lawful retention period ends.</li>
              <li>Withdraw consent for processing that relies on consent, at any time.</li>
              <li>Nominate another individual to exercise these rights on your behalf.</li>
              <li>Lodge a grievance with us, and escalate to the Data Protection Board of India.</li>
            </ul>
            <p>
              To exercise any of these rights, write to{" "}
              <a className={s.link} href="mailto:dpo@cryptoexam.core">dpo@cryptoexam.core</a> with
              the subject &ldquo;DPDP rights request&rdquo;. We respond within statutory timelines.
            </p>
          </Article>

          <Article number="09" title="Security">
            <p>
              We apply cryptographic, hardware and operational controls appropriate to the high
              stakes of a national examination: AES-GCM-256 encryption of papers, Shamir&apos;s
              Secret Sharing of the master key, TPM 2.0 hardware attestation at centres, dual-control
              authorisation on every sensitive operation, and on-chain anchoring of integrity
              commitments. The cryptographic stack is documented in full on our{" "}
              <Link className={s.link} href="/about#transparency">transparency page</Link>.
            </p>
          </Article>

          <Article number="10" title="Changes to this policy">
            <p>
              Material changes will be notified through the examining body and on this page. The
              &ldquo;last updated&rdquo; date at the top of this page always reflects the current
              version. Previous versions are kept in our public repository.
            </p>
          </Article>

          <Article number="11" title="Contact">
            <p>
              For privacy-specific requests:{" "}
              <a className={s.link} href="mailto:dpo@cryptoexam.core">dpo@cryptoexam.core</a>.
              For everything else, see <Link className={s.link} href="/contact">/contact</Link>.
            </p>
          </Article>
        </div>
      </section>

      <Footer />
    </main>
  );
}

function Article({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <article className={s.article}>
      <header className={s.articleHead}>
        <span className={s.articleNum}>§ {number}</span>
        <h2 className={s.articleTitle}>{title}</h2>
      </header>
      <div className={s.articleBody}>{children}</div>
    </article>
  );
}
