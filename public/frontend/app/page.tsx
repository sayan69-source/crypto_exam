"use client";

/**
 * Home — the front door.
 *
 * This page's job is ROUTING, not pitching. The platform has ~48 features
 * across four role portals plus a public verification layer; the previous
 * home page was eleven sections of narrative that linked to exactly two
 * destinations, so nothing downstream was reachable from it.
 *
 * Order is deliberate:
 *   1. what this is, in one screen
 *   2. WHO ARE YOU  — four doors, each with its real next actions
 *   3. verify       — the one path that needs no account at all
 *   4. lifecycle    — how those four roles connect end to end
 *   5. proof points, then a single closing CTA
 *
 * The long-form argument (leak problem, guarantees, architecture, FAQ) lives
 * on /platform, which is built for it.
 */

import Link from "next/link";
import Footer from "@/components/marketing/Footer";
import Icon from "@/components/marketing/LucideIcon";
import WorkflowDiagram from "@/components/marketing/WorkflowDiagram";
import CountUp from "@/components/marketing/CountUp";
import { GROUPS } from "@/lib/navigation";
import s from "./page.module.css";

/* Each door names the role, states plainly whether it is reachable from this
   browser, and offers one primary action plus the real deep links behind it.
   Quick links come from lib/navigation so they cannot drift from the nav. */
const DOORS = [
  {
    id: "candidate",
    icon: "graduation-cap",
    label: "I am a candidate",
    tagline: "Enrol, check your terminal, sit the exam and raise exam-day issues.",
    access: "Centre terminal",
    hub: "/candidates",
    picks: ["/candidate-enrolment", "/exam/dashboard", "/exam/system-check", "/exam/complaint"],
  },
  {
    id: "setter",
    icon: "pen-tool",
    label: "I set papers",
    tagline: "Author, calibrate and seal a paper nobody can read before T₀.",
    access: "Sign-in required",
    hub: "/setters",
    picks: ["/setter/dashboard", "/setter/create", "/setter/paper-modes", "/setter/proofs"],
  },
  {
    id: "invigilator",
    icon: "user-check",
    label: "I run an exam hall",
    tagline: "Verify identity, seat candidates, log incidents at the centre.",
    access: "Centre staff",
    hub: "/invigilators",
    picks: ["/invigilator/dashboard", "/invigilator/verify", "/invigilator/roster", "/invigilator/report"],
  },
  {
    id: "admin",
    icon: "shield",
    label: "I administer the estate",
    tagline: "Exams, centres, hardware, keys, emergencies — under dual control.",
    access: "Restricted",
    hub: "/administration",
    picks: ["/admin/dashboard", "/admin/exams", "/admin/nodes", "/admin/emergency"],
  },
];

/** Resolve a href to its canonical entry in the site map. */
const ALL = GROUPS.flatMap((g) => g.items);
const lookup = (href: string) => ALL.find((i) => i.href === href);

export default function HomePage() {
  return (
    <main className={s.main}>
      {/* ═══ 1 · WHAT THIS IS ═══ */}
      <section className={s.hero}>
        <div className={`${s.heroPhoto} parallax-slow`} aria-hidden="true" />
        <div className={`wrap ${s.heroInner}`}>
          <div>
            <span className="eyebrow on-dark">Zero-trust examination infrastructure</span>
            <h1 className={s.heroH1}>
              High-stakes exams that prove <em>their own integrity.</em>
            </h1>
            <p className={s.heroLead}>
              Papers are sealed before anyone can read them, answers are committed with
              tamper-evident records, and each role gets a focused portal for the work they
              actually need to do.
            </p>
            <div className={s.heroCta}>
              <Link className="btn btn-accent btn-lg" href="#roles">
                Find your portal <Icon name="arrow-down" size={16} />
              </Link>
              <Link className="btn btn-quiet-dark btn-lg" href="/platform">
                Explore platform
              </Link>
            </div>
            <p className={s.heroTagline}>
              The math cannot be bribed. The blockchain cannot forget. The hardware cannot lie.
            </p>
          </div>

          <aside className={s.proofPanel} aria-label="Live integrity proofs">
            <div className={s.proofHead}>
              <span className={s.proofLabel}>Integrity ledger</span>
              <span className={`pill ${s.proofPill}`}>
                <span className="dot" style={{ background: "#8fbf93" }} /> Verified
              </span>
            </div>
            {[
              { icon: "lock", title: "Paper sealed before T₀", hash: "AES-GCM-256 · HKDF" },
              { icon: "git-merge", title: "Answers committed", hash: "SHA-256 Merkle root" },
              { icon: "binary", title: "Difficulty proven", hash: "ZK-SNARK · Groth16" },
              { icon: "satellite-dish", title: "Delivery attested", hash: "TPM 2.0 · GPS signed" },
            ].map((r) => (
              <div className={s.proofRow} key={r.icon}>
                <span className={s.proofIco}>
                  <Icon name={r.icon} size={17} strokeWidth={1.7} />
                </span>
                <span className={s.proofInfo}>
                  <span className={s.proofT}>{r.title}</span>
                  <span className={s.proofH}>{r.hash}</span>
                </span>
                <span className={s.proofChk}><Icon name="check" size={17} /></span>
              </div>
            ))}
          </aside>
        </div>
      </section>

      {/* ═══ 2 · WHO ARE YOU ═══ */}
      <section className={`section ${s.doorsSection}`} id="roles">
        <div className="wrap">
          <div className="heading-block reveal">
            <span className="eyebrow">Start here</span>
            <h2>Four portals. Pick the one that is yours.</h2>
            <p>
              Every role has its own interface and its own proofs. Choose a door to go straight to
              what you need — or press <kbd className={s.kbd}>⌘</kbd><kbd className={s.kbd}>K</kbd>{" "}
              anywhere to search all {ALL.length} features.
            </p>
          </div>

          <div className={s.doorsGrid}>
            {DOORS.map((d) => (
              <article className={s.door} key={d.id} data-spotlight>
                <div className={s.doorTop}>
                  <span className={s.doorIcon}>
                    <Icon name={d.icon} size={20} strokeWidth={1.8} />
                  </span>
                  <span className={s.doorAccess}>{d.access}</span>
                </div>

                <h3 className={s.doorLabel}>{d.label}</h3>
                <p className={s.doorTagline}>{d.tagline}</p>

                <ul className={s.doorLinks}>
                  {d.picks.map((href) => {
                    const item = lookup(href);
                    if (!item) return null;
                    return (
                      <li key={href}>
                        <Link href={href}>
                          <Icon name={item.icon} size={14} strokeWidth={1.9} />
                          <span>{item.title}</span>
                          {item.auth && <Icon name="lock" size={11} strokeWidth={2} />}
                        </Link>
                      </li>
                    );
                  })}
                </ul>

                {/* The role hubs are only reachable from here now that the
                    header carries no role tabs — this is their front door. */}
                <Link className={s.doorAll} href={d.hub}>
                  All {GROUPS.find((g) => g.id === d.id)?.items.length ?? 0} features
                  <Icon name="arrow-right" size={15} strokeWidth={2} />
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 4 · HOW THE ROLES CONNECT ═══ */}
      <section className={`section ${s.howItWorks}`}>
        <div className="wrap">
          <div className="heading-block reveal">
            <span className="eyebrow">Lifecycle</span>
            <h2>One sealed path, from authoring to completion.</h2>
            <p>
              Each stage hands the next a proof it can check. Nobody in the chain — including the
              examining body — can skip a step or forge one.
            </p>
          </div>
          <div className="reveal">
            <WorkflowDiagram />
          </div>
        </div>
      </section>

      {/* ═══ 6 · PROOF POINTS ═══ */}
      <section className={`section-sm ${s.stats}`}>
        <div className="wrap">
          <div className={`${s.statsGrid} reveal`}>
            <div>
              <div className={s.statN}><CountUp to={4} /></div>
              <div className={s.statL}>Cryptographic guarantees on every exam</div>
            </div>
            <div>
              <div className={s.statN}><CountUp to={11} /></div>
              <div className={s.statL}>Indian languages supported end to end</div>
            </div>
            <div>
              <div className={s.statN}><CountUp to={0} /><small> trust</small></div>
              <div className={s.statL}>Required in any single party or device</div>
            </div>
            <div>
              <div className={s.statN}><CountUp to={100} /><small>%</small></div>
              <div className={s.statL}>Of submissions covered by tamper-evident records</div>
            </div>
          </div>
          <p className={s.statsMore}>
            <Link className="btn-link" href="/platform">
              Read how it works, layer by layer <Icon name="arrow-right" size={15} />
            </Link>
          </p>
        </div>
      </section>

      {/* ═══ 6 · CLOSE ═══ */}
      <section className={`section ${s.finalCta}`}>
        <div className="wrap">
          <div className={`${s.finalInner} reveal`}>
            <h2>Bring provable examinations to your candidates.</h2>
            <p>
              Built for India&rsquo;s 40 million annual candidates — NEET, JEE, CUET, UPSC, SSC,
              GATE and the state commissions.
            </p>
            <div className={s.finalActions}>
              <Link className="btn btn-accent btn-lg" href="/contact">
                Request a briefing <Icon name="arrow-right" size={16} />
              </Link>
              <Link className="btn btn-ghost btn-lg" href="/explore">
                Explore all {ALL.length} features
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
