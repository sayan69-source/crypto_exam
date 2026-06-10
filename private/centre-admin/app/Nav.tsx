"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearToken } from "../lib/edge";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/approvals", label: "Approvals" },
  { href: "/ledger", label: "Blind Courier" },
];

export function Nav() {
  const path = usePathname();
  const router = useRouter();
  if (path === "/login") return null;
  return (
    <nav
      style={{
        display: "flex", alignItems: "center", gap: 8, padding: "12px 24px",
        borderBottom: "1px solid var(--zuup-line)", background: "var(--zuup-panel)",
      }}
    >
      <strong style={{ letterSpacing: "0.08em", marginRight: 16 }}>ZUUP · CENTRE ADMIN</strong>
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          style={{
            padding: "6px 12px", borderRadius: 8, textDecoration: "none", fontSize: 14,
            color: path === l.href ? "#fff" : "#8b97a7",
            background: path === l.href ? "var(--zuup-accent)" : "transparent",
          }}
        >
          {l.label}
        </Link>
      ))}
      <button
        onClick={() => { clearToken(); router.push("/login"); }}
        style={{ marginLeft: "auto", padding: "6px 12px", borderRadius: 8, border: "1px solid var(--zuup-line)", background: "transparent", color: "#8b97a7", cursor: "pointer" }}
      >
        Lock
      </button>
    </nav>
  );
}
