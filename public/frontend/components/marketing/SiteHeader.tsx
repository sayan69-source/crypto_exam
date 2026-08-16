"use client";

/**
 * Site header — on every page, including the signed-in portals.
 *
 * Layout, left to right:
 *   brand → Home · Login ······················· search · Add exam
 *
 * The brand and the Home link both return to the front page; the primary
 * action sits hard right where a primary action belongs. Signing in swaps the
 * Login link for the session indicator, so the header always says who you are
 * and always offers a way out of a portal.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon from "./LucideIcon";
import { useAuth } from "@/lib/auth/AuthContext";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/login", label: "Login" },
];

export default function SiteHeader() {
  const pathname = usePathname();
  const { session } = useAuth();
  const role = session?.role ?? null;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  return (
    <header className="hdr">
      {/* Full-bleed, not the centred `wrap` container — the primary action is
          meant to sit hard against the right edge of the viewport. */}
      <div className="hdr-inner">
        <Link className="hdr-brand" href="/" aria-label="CryptoExam Core home">
          <span className="hdr-mark">
            <Icon name="shield-check" size={16} strokeWidth={1.9} />
          </span>
          <span className="hdr-name">CryptoExam<b>Core</b></span>
        </Link>

        <nav className="hdr-nav" aria-label="Primary">
          {LINKS.map((l) => {
            // Once signed in, "Login" is no longer the useful thing to show.
            if (l.href === "/login" && role) return null;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`hdr-link${isActive(l.href) ? " is-active" : ""}`}
                aria-current={isActive(l.href) ? "page" : undefined}
              >
                {l.label}
              </Link>
            );
          })}
          {role && (
            <span className="hdr-session">
              <span className="hdr-dot" aria-hidden="true" />
              Signed in · {role}
            </span>
          )}
        </nav>

        <div className="hdr-right">
          <button
            type="button"
            className="hdr-search"
            onClick={() => window.dispatchEvent(new Event("cmdk:open"))}
            aria-label="Search features (Ctrl or Command + K)"
            title="Search features  ⌘K"
          >
            <Icon name="search" size={17} strokeWidth={2} />
          </button>

          {/* Adding an examination is not self-serve — an examining body talks
              to us first, so this goes to contact rather than the setter
              workbench. */}
          <Link className="hdr-cta" href="/contact">
            <Icon name="plus" size={16} strokeWidth={2.4} />
            Add exam
          </Link>
        </div>
      </div>
    </header>
  );
}
