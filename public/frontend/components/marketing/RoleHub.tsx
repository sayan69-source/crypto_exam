"use client";

/**
 * The role hub — one component, four routes.
 *
 * This is the page that did not exist before, and its absence is why the
 * platform's own owner did not know how many features it had. A role now has
 * a single place that shows EVERYTHING it can do, grouped by when you'd use
 * it rather than alphabetically.
 *
 * Public by design: you can read what a role does before you have credentials
 * for it. Features that need sign-in say so up front rather than bouncing you
 * to a login screen when you click.
 */

import Link from "next/link";
import Footer from "./Footer";
import Icon from "./LucideIcon";
import { byId, stagesOf } from "@/lib/navigation";
import s from "./RoleHub.module.css";

export type HubProps = {
  groupId: string;
  /** Plain statement of who may actually use this, shown before any link. */
  access: string;
  /** One-line orientation under the title. */
  intro: string;
  /** The single deep-reading destination for this role. */
  deeper: { label: string; href: string; desc: string };
};

export default function RoleHub({ groupId, access, intro, deeper }: HubProps) {
  const group = byId(groupId);
  if (!group) return null;

  const stages = stagesOf(groupId);
  const total = group.items.length;

  return (
    <main className={s.main}>
      <header className={s.hero}>
        <div className="wrap">
          <span className="eyebrow">{total} features</span>
          <h1 className={s.h1}>{group.label}</h1>
          <p className={s.intro}>{intro}</p>

          <p className={s.access}>
            <Icon name="info" size={15} strokeWidth={2} />
            {access}
          </p>

          {/* One action. Signing in is handled by the Login button in the tab
              bar, which is present on every page — a second sign-in button per
              hub was four more entry points to the same page. */}
          <div className={s.heroActions}>
            <Link className="btn btn-ghost btn-lg" href={deeper.href}>
              {deeper.label} <Icon name="arrow-right" size={16} />
            </Link>
          </div>
        </div>
      </header>

      <section className={`section ${s.body}`}>
        <div className="wrap">
          <div className={s.stageIntro}>
            <h2 className={s.h2}>Everything you can do, in the order you&rsquo;d do it</h2>
            <p>
              Grouped by stage rather than alphabetically — you may not know what a feature
              is called, but you always know where you are in the process.
            </p>
          </div>

          <ol className={s.stages}>
            {stages.map(({ stage, items }, si) => (
              <li className={`${s.stage} reveal reveal-rise`} key={stage}>
                <div className={s.stageHead}>
                  <span className={s.stageNum}>{String(si + 1).padStart(2, "0")}</span>
                  <h3 className={s.stageName}>{stage}</h3>
                  <span className={s.stageCount}>
                    {items.length} {items.length === 1 ? "feature" : "features"}
                  </span>
                </div>

                <ul className={s.features}>
                  {items.map((it) => (
                    <li key={it.href + it.title}>
                      <Link href={it.href} className={s.feature} data-spotlight>
                        <span className={s.featIcon}>
                          <Icon name={it.icon} size={17} strokeWidth={1.8} />
                        </span>
                        <span className={s.featBody}>
                          <span className={s.featTitle}>
                            {it.title}
                            {it.auth && <span className={s.featLock}>needs sign-in</span>}
                          </span>
                          <span className={s.featDesc}>{it.desc}</span>
                        </span>
                        <span className={s.featGo} aria-hidden="true">
                          <Icon name="arrow-right" size={15} strokeWidth={2} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>

          <aside className={`${s.deeper} reveal reveal-scale`}>
            <div>
              <span className="eyebrow">Understand this role</span>
              <h3 className={s.deeperH}>{deeper.label}</h3>
              <p>{deeper.desc}</p>
            </div>
            <Link className="btn btn-primary" href={deeper.href}>
              Read it <Icon name="arrow-right" size={16} />
            </Link>
          </aside>
        </div>
      </section>

      <Footer />
    </main>
  );
}
