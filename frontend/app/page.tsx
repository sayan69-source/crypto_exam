/**
 * CryptoExam Core — Root Landing Page
 * 
 * Redirects to the appropriate interface based on role,
 * or shows a brief system identity page.
 */

import Link from "next/link";

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-navy-950)",
        color: "white",
        fontFamily: "var(--font-sans)",
        padding: "var(--space-xl)",
      }}
    >
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "48px",
          fontWeight: 400,
          marginBottom: "var(--space-md)",
          letterSpacing: "-0.02em",
        }}
      >
        CryptoExam Core
      </h1>

      <p
        style={{
          fontSize: "18px",
          color: "var(--color-navy-300)",
          marginBottom: "var(--space-3xl)",
          textAlign: "center",
          maxWidth: "600px",
          lineHeight: 1.6,
        }}
      >
        Zero-Trust Examination Infrastructure for India.
        <br />
        <span style={{ color: "var(--color-india-gold)", fontStyle: "italic" }}>
          The math cannot be bribed.
        </span>
      </p>

      {/* India Tricolour stripe */}
      <div
        style={{
          display: "flex",
          width: "200px",
          height: "4px",
          borderRadius: "var(--radius-full)",
          overflow: "hidden",
          marginBottom: "var(--space-3xl)",
        }}
      >
        <div style={{ flex: 1, background: "var(--color-india-saffron)" }} />
        <div style={{ flex: 1, background: "var(--color-india-white)" }} />
        <div style={{ flex: 1, background: "var(--color-india-green)" }} />
      </div>

      <nav
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "var(--space-lg)",
          maxWidth: "720px",
          width: "100%",
        }}
      >
        {[
          {
            href: "/exam/dashboard",
            title: "Candidate Portal",
            desc: "Take exams with cryptographic protection",
            bg: "var(--bg-exam)",
            color: "var(--color-navy-800)",
          },
          {
            href: "/setter/dashboard",
            title: "Setter Workbench",
            desc: "Create AI-powered exam papers",
            bg: "var(--bg-setter)",
            color: "var(--color-navy-100)",
          },
          {
            href: "/admin/dashboard",
            title: "Admin Console",
            desc: "Mission control for exam day",
            bg: "var(--bg-admin)",
            color: "var(--color-navy-100)",
          },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            style={{
              display: "flex",
              flexDirection: "column",
              padding: "var(--space-xl)",
              background: item.bg,
              color: item.color,
              borderRadius: "var(--radius-xl)",
              textDecoration: "none",
              transition: "transform 150ms ease, box-shadow 150ms ease",
              border: "1px solid var(--color-navy-800)",
            }}
          >
            <span style={{ fontWeight: 600, fontSize: "16px", marginBottom: "var(--space-sm)" }}>
              {item.title}
            </span>
            <span style={{ fontSize: "13px", opacity: 0.7 }}>
              {item.desc}
            </span>
          </Link>
        ))}
      </nav>

      <footer
        style={{
          marginTop: "var(--space-4xl)",
          color: "var(--color-navy-600)",
          fontSize: "13px",
          textAlign: "center",
        }}
      >
        FAR AWAY 2026 · Examinations Track · DPDP Act 2023 Compliant
      </footer>
    </main>
  );
}
