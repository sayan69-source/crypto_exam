import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/marketing/Navbar";
import Footer from "@/components/marketing/Footer";
import Icon from "@/components/marketing/LucideIcon";
import s from "../legal.module.css";

export const metadata: Metadata = {
  title: "Terms of Use — CryptoExam Core",
  description:
    "The terms on which CryptoExam Core delivers zero-trust examination infrastructure to examining bodies and the candidates who sit them.",
};

const LAST_UPDATED = "2026-06-09";

export default function TermsPage() {
  return (
    <main>
      <Navbar />

      <section className={s.hero}>
        <div className="wrap">
          <span className="eyebrow">Terms</span>
          <h1 className={s.h1}>
            The rules of an examination <em>that proves itself.</em>
          </h1>
          <p className={s.lead}>
            These terms describe how CryptoExam Core operates, what we promise to candidates and
            examining bodies, what we ask of you in return, and what every cryptographic guarantee
            on this site actually means in law.
          </p>
          <p className={s.meta}>Last updated: {LAST_UPDATED}</p>
        </div>
      </section>

      <section className={s.bodySection}>
        <div className="wrap-narrow">
          <div className={s.callout}>
            <span className="icon-chip"><Icon name="scale" size={18} strokeWidth={1.7} /></span>
            <div>
              <h3>What these terms are, and aren&apos;t</h3>
              <p>These are the operating terms of the platform. They do not replace the rules of any
                specific examination, which the examining body publishes separately. Where they
                differ, the examining body&apos;s rules govern the conduct of that examination.</p>
            </div>
          </div>

          <Article number="01" title="Definitions">
            <ul>
              <li><strong>Platform</strong> — CryptoExam Core, including the website, candidate, setter, invigilator and administrator interfaces.</li>
              <li><strong>Examining Body</strong> — the authority that conducts an examination using the Platform.</li>
              <li><strong>Candidate</strong> — a person enrolled by an Examining Body to sit an examination on the Platform.</li>
              <li><strong>Examination</strong> — a sealed paper, its delivery window, and all submissions made within it.</li>
              <li><strong>Proof</strong> — a cryptographic artefact (hash, Merkle commitment, ZK-SNARK, hardware attestation) anchored on a public blockchain.</li>
            </ul>
          </Article>

          <Article number="02" title="Eligibility & access">
            <p>
              Access to candidate, setter, invigilator and administrator interfaces is granted by
              the relevant Examining Body. The public marketing site and the public audit portal
              are open to everyone. By using the Platform you confirm that you have been granted
              the appropriate access and that you will use it only for the purpose for which it was
              granted.
            </p>
          </Article>

          <Article number="03" title="Acceptable use">
            <p>You agree not to:</p>
            <ul>
              <li>Attempt to bypass authentication, biometric verification or anti-cheat controls.</li>
              <li>Attempt to read, decrypt or copy a sealed paper before T₀.</li>
              <li>Tamper with a hardware node, ProofOfDelivery or any on-chain artefact.</li>
              <li>Use the Platform to harass, defame or expose any candidate, setter, invigilator or administrator.</li>
              <li>Interfere with the operation of an Examination in any way that is not authorised by the Examining Body.</li>
            </ul>
            <p>Violations are logged and may be reported to the Examining Body and law enforcement.</p>
          </Article>

          <Article number="04" title="What the cryptographic guarantees mean">
            <p>
              The Platform produces four headline guarantees: no human sees the paper before T₀;
              answer records are immutable; difficulty is machine-verifiable; delivery is provable.
              Each is backed by a published proof anchored to a public blockchain. These are
              <em> mathematical</em> guarantees, not promises — anyone can verify them on Polygonscan
              without trusting us.
            </p>
            <p>
              They do <em>not</em> guarantee that an Examining Body has correctly enrolled you,
              that a question is well-written, or that a centre&apos;s operator has followed every
              procedural rule. Those are responsibilities of the Examining Body and the centre.
            </p>
          </Article>

          <Article number="05" title="Your data">
            <p>
              Personal data is handled under our{" "}
              <Link className={s.link} href="/privacy">Privacy Policy</Link>, which forms part of
              these terms. In short: biometrics never leave your device, on-chain data carries no
              personal identifiers, and you retain your rights under the Digital Personal Data
              Protection Act, 2023.
            </p>
          </Article>

          <Article number="06" title="Receipts & verification">
            <p>
              After every submission you receive a cryptographic receipt containing the Merkle path
              from your answers to the on-chain root. You can verify this receipt yourself, at any
              time, without an account, at the public audit portal. A successful verification is a
              mathematical statement that your submission was included in the official record.
            </p>
            <p>
              A receipt does not, by itself, change the outcome declared by the Examining Body —
              that is governed by the body&apos;s own rules. But it gives you the evidence to ask
              the right question, in the right forum.
            </p>
          </Article>

          <Article number="07" title="Service availability">
            <p>
              We engineer the Platform for high availability during examinations and provide
              network-offline resilience at hardware nodes. We do not, however, warrant continuous
              uninterrupted access outside an Examination window. Maintenance and outages will be
              communicated through the Examining Body and on the public status channel.
            </p>
          </Article>

          <Article number="08" title="Intellectual property">
            <p>
              The Platform — including its source code where licensed open, its design system, its
              cryptographic protocols and this site — remains the intellectual property of
              CryptoExam Core and its contributors. Question papers belong to the Examining Body
              that authored them. Candidate answers belong to the Candidate; we hold only their
              cryptographic hash and the licence necessary to operate the Examination.
            </p>
          </Article>

          <Article number="09" title="Liability">
            <p>
              The Platform produces proofs; it does not adjudicate examinations. We are not liable
              for the decisions of an Examining Body, the conduct of a centre operator, or for
              indirect or consequential losses arising from those decisions. Our maximum liability
              to any party in respect of the Platform is limited to the fees paid for the
              Examination in which the dispute arose. Nothing in these terms excludes liability for
              fraud, gross negligence, or any liability that cannot be excluded by law.
            </p>
          </Article>

          <Article number="10" title="Governing law">
            <p>
              These terms are governed by the laws of India. Disputes will be subject to the
              exclusive jurisdiction of the courts of New Delhi, save where statute reserves
              jurisdiction to another forum (for example, under the DPDP Act).
            </p>
          </Article>

          <Article number="11" title="Changes">
            <p>
              Material changes will be notified through the Examining Body and on this page. The
              &ldquo;last updated&rdquo; date at the top always reflects the current version.
              Continued use of the Platform after a change constitutes acceptance of the revised
              terms.
            </p>
          </Article>

          <Article number="12" title="Contact">
            <p>
              For questions about these terms, write to{" "}
              <a className={s.link} href="mailto:legal@cryptoexam.core">legal@cryptoexam.core</a>.
              For privacy-specific requests, see our{" "}
              <Link className={s.link} href="/privacy">Privacy Policy</Link>. For everything else,
              see <Link className={s.link} href="/contact">/contact</Link>.
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
