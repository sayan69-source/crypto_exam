"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon from "./LucideIcon";

/**
 * Primary navigation.
 *
 * Two things were wrong and both hurt navigation directly:
 *
 *  - Half the links were same-page anchors ("Guarantees", "For teams"), so the
 *    nav mostly scrolled you around the homepage instead of taking you
 *    anywhere. The links below are destinations, ordered by who is asking.
 *  - The mobile menu button had no handler at all. Below 900px the CSS hides
 *    `.nav-links` and shows `.nav-toggle`, so on a phone the site had NO
 *    navigation whatsoever — the button was decorative.
 */
const LINKS = [
  { href: "/platform", label: "Platform" },
  { href: "/pipeline", label: "How delivery works" },
  { href: "/center-access", label: "Centre access" },
  { href: "/about", label: "About" },
];

export default function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close on navigation — otherwise the panel stays over the page you asked for.
  useEffect(() => setOpen(false), [pathname]);

  // Escape closes, and the page behind must not scroll while it is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      {/* Tricolour */}
      <div className="tricolour">
        <span /><span /><span />
      </div>

      {/* Nav */}
      <header className="site-nav">
        <div className="wrap nav-inner">
          <Link className="brand" href="/" aria-label="CryptoExam Core home">
            <span className="brand-mark">
              <Icon name="shield-check" size={18} strokeWidth={1.8} />
            </span>
            <span className="brand-name">
              CryptoExam<b>Core</b>
            </span>
          </Link>

          <nav>
            <ul className="nav-links">
              {LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} aria-current={pathname === l.href ? "page" : undefined}>
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="nav-actions">
            <Link className="btn-link" href="/#faq">Public audit</Link>
            <Link
              className="btn btn-primary"
              href="/contact"
              aria-current={pathname === "/contact" ? "page" : undefined}
            >
              Request access
            </Link>
          </div>

          <button
            className="nav-toggle"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
          >
            <Icon name={open ? "x" : "menu"} size={24} />
          </button>
        </div>

        {/* Mobile panel. Rendered only when open so nothing is focusable
            behind the scenes on desktop. */}
        {open && (
          <div className="mobile-nav" id="mobile-nav">
            <ul>
              {LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} aria-current={pathname === l.href ? "page" : undefined}>
                    {l.label}
                    <Icon name="arrow-right" size={16} />
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/candidate-enrolment">
                  Candidate enrolment <Icon name="arrow-right" size={16} />
                </Link>
              </li>
              <li>
                <Link href="/for-setters">
                  Question setters <Icon name="arrow-right" size={16} />
                </Link>
              </li>
              <li>
                <Link href="/#faq">
                  Public audit <Icon name="arrow-right" size={16} />
                </Link>
              </li>
            </ul>
            <Link className="btn btn-primary btn-lg mobile-nav-cta" href="/contact">
              Request access
            </Link>
          </div>
        )}
      </header>
    </>
  );
}
