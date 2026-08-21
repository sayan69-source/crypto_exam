import type { Metadata } from "next";
import Footer from "@/components/marketing/Footer";
import Icon from "@/components/marketing/LucideIcon";
import s from "./page.module.css";

export const metadata: Metadata = {
  title: "FAQ — CryptoExam Core",
  description: "Frequently asked questions about CryptoExam Core.",
};

const FAQS = [
  {
    q: "Do I have to trust CryptoExam Core?",
    a: "No. That is the point. Every guarantee is backed by a proof anchored to a public blockchain. You can verify any examination yourself on a block explorer, without an account and without trusting us, the examining body, or the centre.",
  },
  {
    q: "How can a paper stay sealed until the exam begins?",
    a: "The paper is encrypted at authoring time. Its decryption key is derived from a public randomness beacon and is only available at the scheduled start time, T₀. Custody of the master key is split across independent parties using Shamir’s Secret Sharing, so no individual can open it early.",
  },
  {
    q: 'What does "machine-verifiable difficulty" mean?',
    a: "Setters declare a target difficulty distribution for each paper. A zero-knowledge proof demonstrates the paper meets that distribution without revealing the questions — so fairness across paper variants can be checked publicly, before anyone sits the exam.",
  },
  {
    q: "Is the platform compliant with Indian data law?",
    a: "Yes. CryptoExam Core is built to comply with the Digital Personal Data Protection Act, 2023. Biometric data is processed on-device and never leaves the candidate’s hardware in raw form.",
  },
  {
    q: "Which languages are supported?",
    a: "The candidate interface supports 11 Indian languages with native script rendering, including Devanagari, Bengali, Tamil, Telugu, Kannada, Malayalam, Gujarati and Odia.",
  },
];

export default function FaqPage() {
  return (
    <main>
      <section className={`section ${s.faqSection} reveal reveal-rise`} id="faq">
        <div className="wrap-narrow">
          <div className="heading-block center">
            <span className="eyebrow">Questions</span>
            <h2>What people ask first.</h2>
          </div>
          <div className={s.faqList}>
            {FAQS.map((f, i) => (
              <details className={s.faqItem} key={f.q} open={i === 0}>
                <summary className={s.faqQ}>
                  <span>{f.q}</span>
                  <Icon name="plus" size={20} />
                </summary>
                <div className={s.faqA}><p>{f.a}</p></div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
