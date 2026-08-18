'use client';

/**
 * /pipeline — the full-page home of the sealed-question demo.
 *
 * The demo itself now lives in components/marketing/PipelineDemo so the home
 * page can show exactly the same thing without a second implementation. This
 * page supplies the framing; the component supplies the cryptography.
 */

import Footer from '@/components/marketing/Footer';
import PipelineDemo from '@/components/marketing/PipelineDemo';
import s from '@/components/marketing/PipelineDemo.module.css';

export default function PipelineDemoPage() {
  return (
    <main>
      <section className={s.hero}>
        <div className="wrap">
          <span className="eyebrow">How delivery works</span>
          <h1 className={s.h1}>
            A question stays sealed from setter to seat — and opens <em>one at a time.</em>
          </h1>
          <p className={s.lead}>
            Every question is encrypted under its own key and committed to a public blockchain. The terminal holds
            nothing but ciphertext until T₀, then decrypts a question <strong>only at the moment the candidate opens it</strong> —
            the same on-demand reveal TCS iON uses, but with every step independently verifiable. This page runs the
            real cryptography in your browser.
          </p>
        </div>
      </section>

      <section className={`${s.railSectionOuter} reveal reveal-rise`}>
        <div className="wrap">
          <PipelineDemo />
        </div>
      </section>

      <Footer />
    </main>
  );
}
