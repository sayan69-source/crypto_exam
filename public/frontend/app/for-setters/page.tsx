import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/marketing/Navbar";
import Footer from "@/components/marketing/Footer";
import Icon from "@/components/marketing/LucideIcon";
import s from "./page.module.css";

export const metadata: Metadata = {
  title: "Setter Workbench — CryptoExam Core",
  description:
    "A dense authoring workbench for examination setters — compose papers, generate ZK difficulty proofs, run red-team review, and seal question banks under cryptographic lock.",
};

export default function SetterLanding() {
  return (
    <main>
      <Navbar />

      <section className={s.hero}>
        <div className="wrap">
          <span className="eyebrow">For setters</span>
          <h1 className={s.h1}>
            A workbench for sealing papers that <em>cannot leak.</em>
          </h1>
          <p className={s.lead}>
            CryptoExam Core gives examination setters a dense, focused environment for composing
            question papers, generating zero-knowledge difficulty proofs, and locking each paper
            under encryption that no one — not us, not the examining body — can open before T₀.
          </p>
          <div className={s.cta}>
            <Link className="btn btn-primary btn-lg" href="/setter/login">
              Open the workbench <Icon name="arrow-right" size={16} />
            </Link>
            <Link className="btn btn-ghost btn-lg" href="/platform#setter">
              See the setter flow
            </Link>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="heading-block">
            <span className="eyebrow">What you do here</span>
            <h2>Four tools, one sealed chain of evidence.</h2>
          </div>
          <div className={s.grid}>
            {[
              { icon: "flask-conical", title: "Compose & version", desc: "Author multi-language papers with structured metadata. Every revision is hashed and signed; nothing is silently overwritten." },
              { icon: "binary", title: "ZK difficulty proofs", desc: "Declare a target difficulty distribution; a Groth16 proof attests the paper meets it without revealing a single question." },
              { icon: "swords", title: "Red-team review", desc: "Run independent reviewers against the paper before sealing. Their findings are attached to the audit trail." },
              { icon: "file-lock-2", title: "Seal under encryption", desc: "AES-GCM-256 encrypts the paper at authoring time. The decryption key only exists at T₀, derived from a public beacon." },
            ].map((c) => (
              <article className={`card ${s.card}`} key={c.title}>
                <span className="icon-chip"><Icon name={c.icon} size={18} strokeWidth={1.7} /></span>
                <h3>{c.title}</h3>
                <p>{c.desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={s.bandDark}>
        <div className="wrap">
          <span className="eyebrow on-dark">Lifecycle</span>
          <h2 className={s.bandH2}>From a blank page to a sealed paper.</h2>
          <ol className={s.steps}>
            <li><span className={s.stepN}>01</span><div><h4>Draft</h4><p>Compose questions with translations and difficulty tags. Auto-save with hash chaining.</p></div></li>
            <li><span className={s.stepN}>02</span><div><h4>Prove</h4><p>Generate a ZK-SNARK that the paper meets its declared difficulty profile.</p></div></li>
            <li><span className={s.stepN}>03</span><div><h4>Review</h4><p>Red-team review captures every objection on the audit trail.</p></div></li>
            <li><span className={s.stepN}>04</span><div><h4>Seal</h4><p>Encrypt under AES-GCM-256. Commit the question hash on-chain. Hand off to the broadcast schedule.</p></div></li>
          </ol>
        </div>
      </section>

      <section className={`section-sm ${s.finalCta}`}>
        <div className="wrap">
          <h2>Bring your next paper into the open.</h2>
          <p>Sign in to the workbench with your setter credentials, or talk to us about onboarding your board.</p>
          <div className={s.cta}>
            <Link className="btn btn-primary btn-lg" href="/setter/login">
              Sign in to the workbench <Icon name="arrow-right" size={16} />
            </Link>
            <Link className="btn btn-ghost btn-lg" href="/contact">
              Request setter access
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
