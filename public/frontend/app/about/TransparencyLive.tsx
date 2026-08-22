"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/marketing/LucideIcon";
import {
  aboutApi,
  ABOUT_API_URL,
  API_DOCS_URL,
  type AboutDocument,
  type TransparencyReport,
} from "@/lib/api/about";
import s from "./transparency.module.css";

/**
 * Public-transparency section of the About page.
 *
 * Renders the platform's self-description directly from the public, no-login
 * backend (GET /api/v1/about*). If the backend isn't reachable it falls back to
 * a bundled snapshot, so the section always renders — and it tells you which
 * one you're seeing.
 */
export default function TransparencyLive() {
  const [about, setAbout] = useState<AboutDocument | null>(null);
  const [report, setReport] = useState<TransparencyReport | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let active = true;
    aboutApi.load().then(({ about, transparency, live }) => {
      if (!active) return;
      setAbout(about);
      setReport(transparency);
      setLive(live);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!about || !report) {
    return (
      <section className={s.transparency} id="transparency">
        <div className="wrap">
          <p className={s.loading}>Loading public transparency record…</p>
        </div>
      </section>
    );
  }

  return (
    <section className={s.transparency} id="transparency">
      <div className="wrap">
        <div className={s.head}>
          <span className="eyebrow">Public transparency</span>
          <span
            className={`${s.source} ${live ? s.sourceLive : s.sourceSnapshot}`}
            title={
              live
                ? "Loaded live from the public transparency API"
                : "Public API unreachable — showing the published snapshot"
            }
          >
            <span className="dot" style={{ background: live ? "#3a9b6e" : "#b0791f" }} />
            {live ? "Live from public API" : "Published snapshot"}
          </span>
        </div>

        <h2 className={s.title}>Everything about this platform, served in the open.</h2>
        <p className={s.lead}>
          This section is published by a backend that needs no login, no API key, and no trust in
          us. The exact JSON below powers this page — read it, archive it, or machine-check it
          yourself. <strong>{about.tagline}</strong>
        </p>

        <div className={s.endpoints}>
          <a className={s.endpoint} href={ABOUT_API_URL} target="_blank" rel="noopener noreferrer">
            <Icon name="braces" size={15} /> <code>GET /api/v1/about</code>
            <Icon name="external-link" size={13} />
          </a>
          <a className={s.endpoint} href={`${ABOUT_API_URL}/transparency`} target="_blank" rel="noopener noreferrer">
            <Icon name="scale" size={15} /> <code>GET /api/v1/about/transparency</code>
            <Icon name="external-link" size={13} />
          </a>
          <a className={s.endpoint} href={API_DOCS_URL} target="_blank" rel="noopener noreferrer">
            <Icon name="book-open" size={15} /> <code>Interactive API docs</code>
            <Icon name="external-link" size={13} />
          </a>
        </div>

        {/* The four guarantees, with the mechanism behind each */}
        <h3 className={s.subhead}>The four guarantees — and the mechanism behind each</h3>
        <div className={s.guarGrid}>
          {about.guarantees.map((g) => (
            <article className={s.guar} key={g.code}>
              <span className={s.guarIcon}>
                <Icon name={g.icon} size={18} strokeWidth={1.7} />
              </span>
              <span className={s.guarCode}>{g.code}</span>
              <h4>{g.title}</h4>
              <p>{g.description}</p>
              <span className={s.guarMech}>{g.mechanism}</span>
            </article>
          ))}
        </div>

        {/* What is public vs private */}
        <h3 className={s.subhead}>What is public, what is private</h3>
        <p className={s.principle}>{report.principle}</p>
        <div className={s.splitGrid}>
          <div className={s.splitCol}>
            <div className={`${s.splitLabel} ${s.splitPublic}`}>
              <Icon name="eye" size={15} /> Public &amp; verifiable
            </div>
            {report.public_data.map((c) => (
              <div className={s.claim} key={c.claim}>
                <Icon name="check" size={16} className={s.claimOk} />
                <div>
                  <p className={s.claimText}>{c.claim}</p>
                  <p className={s.claimHow}>{c.how_to_verify}</p>
                </div>
              </div>
            ))}
          </div>
          <div className={s.splitCol}>
            <div className={`${s.splitLabel} ${s.splitPrivate}`}>
              <Icon name="lock" size={15} /> Private by cryptography
            </div>
            {report.private_data.map((c) => (
              <div className={s.claim} key={c.claim}>
                <Icon name="shield" size={16} className={s.claimLock} />
                <div>
                  <p className={s.claimText}>{c.claim}</p>
                  <p className={s.claimHow}>{c.how_to_verify}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Technology stack */}
        <h3 className={s.subhead}>The technology, layer by layer</h3>
        <div className={s.techGrid}>
          {about.tech_stack.map((t) => (
            <div className={s.tech} key={t.layer}>
              <span className={s.techLayer}>{t.layer}</span>
              <span className={s.techName}>{t.name}</span>
              <p className={s.techDetail}>{t.detail}</p>
            </div>
          ))}
        </div>

        <p className={s.footnote}>{report.note}</p>
      </div>
    </section>
  );
}
