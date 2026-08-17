"use client";

/**
 * /explore — the complete feature directory.
 *
 * The platform's capability surface is large enough that neither the navbar
 * nor the homepage can honestly represent it. This page is the canonical
 * answer to "what can this thing actually do?", with filter-as-you-type so a
 * known feature is one or two keystrokes away.
 *
 * It renders straight from lib/navigation, so it stays complete by
 * construction rather than by anyone remembering to update it.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import Footer from "@/components/marketing/Footer";
import Icon from "@/components/marketing/LucideIcon";
import { GROUPS, ALL_ITEMS, scoreItem } from "@/lib/navigation";
import s from "./explore.module.css";

export default function ExplorePage() {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<string>("all");

  const visible = useMemo(() => {
    return GROUPS.map((g) => {
      if (group !== "all" && group !== g.id) return { ...g, items: [] };
      const items = g.items.filter((i) => scoreItem({ ...i, group: g.label }, q) > 0);
      return { ...g, items };
    }).filter((g) => g.items.length > 0);
  }, [q, group]);

  const shown = visible.reduce((n, g) => n + g.items.length, 0);

  return (
    <>
      <main className={s.main}>
        <section className={s.hero}>
          <div className="wrap">
            <span className="eyebrow">Feature directory</span>
            <h1 className={s.h1}>Everything CryptoExam Core does.</h1>
            <p className={s.lede}>
              Four portals, a public verification layer and the infrastructure underneath.
              Every capability the platform exposes is listed here — search it, or press{" "}
              <kbd className={s.kbd}>⌘</kbd><kbd className={s.kbd}>K</kbd> from anywhere.
            </p>

            <div className={s.controls}>
              <div className={s.searchWrap}>
                <Icon name="search" size={18} strokeWidth={1.9} />
                <input
                  className={s.search}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Filter features…"
                  aria-label="Filter features"
                  autoComplete="off"
                />
                {q && (
                  <button className={s.clear} onClick={() => setQ("")} aria-label="Clear filter" type="button">
                    <Icon name="x" size={15} strokeWidth={2} />
                  </button>
                )}
              </div>
              <p className={s.count} role="status" aria-live="polite">
                {shown} of {ALL_ITEMS.length} features
              </p>
            </div>

            <div className={s.chips} role="group" aria-label="Filter by area">
              <button
                type="button"
                className={`${s.chip}${group === "all" ? ` ${s.chipOn}` : ""}`}
                onClick={() => setGroup("all")}
                aria-pressed={group === "all"}
              >
                All areas
              </button>
              {GROUPS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={`${s.chip}${group === g.id ? ` ${s.chipOn}` : ""}`}
                  onClick={() => setGroup(g.id)}
                  aria-pressed={group === g.id}
                >
                  <Icon name={g.icon} size={14} strokeWidth={1.9} />
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className={s.body}>
          <div className="wrap">
            {visible.length === 0 ? (
              <div className={s.empty}>
                <Icon name="search-x" size={28} strokeWidth={1.6} />
                <p>No feature matches “{q}”.</p>
                <button type="button" className="btn btn-ghost" onClick={() => { setQ(""); setGroup("all"); }}>
                  Reset filters
                </button>
              </div>
            ) : (
              visible.map((g) => (
                <div key={g.id} className={s.group}>
                  <div className={s.groupHead}>
                    <span className={s.groupIcon}><Icon name={g.icon} size={18} strokeWidth={1.8} /></span>
                    <div>
                      <h2 className={s.groupTitle}>{g.label}</h2>
                      <p className={s.groupBlurb}>{g.blurb}</p>
                    </div>
                  </div>

                  <ul className={s.grid}>
                    {g.items.map((it) => (
                      <li key={it.href + it.title}>
                        <Link href={it.href} className={s.card} data-spotlight>
                          <span className={s.cardIcon}><Icon name={it.icon} size={17} strokeWidth={1.8} /></span>
                          <span className={s.cardBody}>
                            <span className={s.cardTitle}>
                              {it.title}
                              {it.auth && (
                                <span className={s.lock} title="Requires sign in">
                                  <Icon name="lock" size={11} strokeWidth={2.2} />
                                </span>
                              )}
                            </span>
                            <span className={s.cardDesc}>{it.desc}</span>
                          </span>
                          <span className={s.cardGo} aria-hidden="true">
                            <Icon name="arrow-right" size={15} strokeWidth={2} />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
