"use client";

/**
 * Site header — Problem 6: Expanded navigation.
 *
 * Before: only two links (Home · Login) were visible. Every other route —
 * candidate enrolment, staff registration, admin/setter portals — was only
 * reachable by typing the URL or using Cmd+K.
 *
 * After: three visible link groups:
 *   • Register (Candidate Enrolment · Staff Registration)
 *   • Portals  (Login · Admin · Setter · Invigilator)
 *   • About    (Platform · Administration · For Setters · About)
 * Plus the existing search / Add exam CTA.
 *
 * Mobile: a hamburger toggle reveals the same groups in a full-width drawer.
 * The command palette is retained as a power-user shortcut, no longer the
 * only path to any route.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Icon from "./LucideIcon";
import { useAuth } from "@/lib/auth/AuthContext";

// ── Navigation groups (Problem 6) ──
const NAV_GROUPS = [
  {
    label: "Register",
    id: "register",
    items: [
      { href: "/candidate-enrolment", label: "Candidate Enrolment", desc: "Enrol with face + details" },
      { href: "/staff-registration", label: "Centre Staff Registration", desc: "Register as invigilator or centre admin" },
    ],
  },
  {
    label: "Portals",
    id: "portals",
    items: [
      { href: "/login", label: "Candidate Login", desc: "Sign in to your candidate portal" },
      { href: "/admin/login", label: "Admin Console", desc: "System administrator login" },
      { href: "/setter/login", label: "Setter Login", desc: "Question setter workbench" },
      { href: "/invigilator/login", label: "Invigilator Login", desc: "Centre invigilator portal" },
    ],
  },
  {
    label: "About",
    id: "about",
    items: [
      { href: "/platform", label: "Platform Overview", desc: "Six-layer cryptographic architecture" },
      { href: "/administration", label: "Administration", desc: "Admin role and capabilities" },
      { href: "/for-setters", label: "For Setters", desc: "Exam setter role and features" },
      { href: "/about", label: "About CryptoExam", desc: "Team, mission and principles" },
    ],
  },
];

export default function SiteHeader() {
  const pathname = usePathname();
  const { session } = useAuth();
  const role = session?.role ?? null;

  const [isMac, setIsMac] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenGroup(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Close everything on route change
  useEffect(() => {
    setOpenGroup(null);
    setMobileOpen(false);
  }, [pathname]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  return (
    <header className="hdr">
      <div className="hdr-inner" style={{ position: "relative" }}>
        {/* Brand */}
        <Link className="hdr-brand" href="/" aria-label="CryptoExam Core home">
          <span className="hdr-mark">
            <Icon name="shield-check" size={16} strokeWidth={1.9} />
          </span>
          <span className="hdr-name">CryptoExam<b>Core</b></span>
        </Link>

        {/* Desktop nav */}
        <nav className="hdr-nav" aria-label="Primary" ref={dropdownRef}>
          {/* Home link */}
          <Link
            href="/"
            className={`hdr-link${isActive("/") ? " is-active" : ""}`}
            aria-current={isActive("/") ? "page" : undefined}
          >
            Home
          </Link>

          {/* Dropdown groups (Problem 6) */}
          {!role && NAV_GROUPS.map((group) => (
            <div key={group.id} style={{ position: "relative" }}>
              <button
                type="button"
                className="hdr-link"
                aria-expanded={openGroup === group.id}
                aria-haspopup="true"
                onClick={() => setOpenGroup(openGroup === group.id ? null : group.id)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  display: "inline-flex", alignItems: "center", gap: 4,
                }}
              >
                {group.label}
                <Icon name={openGroup === group.id ? "chevron-up" : "chevron-down"} size={13} strokeWidth={2} />
              </button>

              {openGroup === group.id && (
                <div style={{
                  position: "absolute", top: "calc(100% + 8px)", left: 0,
                  background: "#fffefb", border: "1px solid #e8e2d8",
                  borderRadius: 12, boxShadow: "0 8px 32px rgba(32,21,21,0.12)",
                  padding: "8px 0", minWidth: 230, zIndex: 200,
                }}>
                  {group.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      style={{
                        display: "block", padding: "10px 16px",
                        textDecoration: "none",
                        background: isActive(item.href) ? "rgba(255,79,0,0.06)" : "transparent",
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#201515" }}>{item.label}</div>
                      <div style={{ fontSize: 11, color: "#939084", marginTop: 1 }}>{item.desc}</div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Signed-in session indicator */}
          {role && (
            <span className="hdr-session">
              <span className="hdr-dot" aria-hidden="true" />
              Signed in · {role}
            </span>
          )}
        </nav>

        {/* Right side: search, CTA, hamburger */}
        <div className="hdr-right" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            className="hdr-search"
            onClick={() => window.dispatchEvent(new Event("cmdk:open"))}
            aria-label="Search features"
            title="Search all features"
          >
            <Icon name="search" size={16} strokeWidth={2} />
            <span className="hdr-searchLabel">Search</span>
            <kbd className="hdr-kbd">{isMac ? "⌘K" : "Ctrl K"}</kbd>
          </button>

          <Link className="hdr-cta" href="/contact">
            <Icon name="plus" size={16} strokeWidth={2.4} />
            Add exam
          </Link>

          {/* Mobile hamburger (Problem 6 - mobile support) */}
          <button
            type="button"
            className="hdr-hamburger"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            onClick={() => setMobileOpen(!mobileOpen)}
            style={{
              display: "none",  // shown via CSS at mobile breakpoint
              background: "none", border: "none", cursor: "pointer",
              padding: "6px", borderRadius: 6,
            }}
          >
            <Icon name={mobileOpen ? "x" : "menu"} size={20} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Mobile drawer (Problem 6) */}
      {mobileOpen && (
        <nav
          className="hdr-mobile-drawer"
          aria-label="Mobile navigation"
          style={{
            position: "fixed", inset: "60px 0 0 0", background: "#fffefb",
            borderTop: "1px solid #e8e2d8", overflowY: "auto", zIndex: 150, padding: "16px 0 32px",
          }}
        >
          <div style={{ padding: "0 20px" }}>
            <Link href="/" style={{ display: "block", padding: "12px 0", fontSize: 15, fontWeight: 600, color: "#201515", borderBottom: "1px solid #e8e2d8", textDecoration: "none" }}>
              Home
            </Link>

            {NAV_GROUPS.map((group) => (
              <div key={group.id}>
                <div style={{ padding: "12px 0 4px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#939084" }}>{group.label}</div>
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    style={{ display: "block", padding: "10px 12px", fontSize: 13, fontWeight: 500, color: "#201515", borderRadius: 8, textDecoration: "none", background: isActive(item.href) ? "rgba(255,79,0,0.06)" : "transparent" }}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
