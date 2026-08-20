import RoleHub from "@/components/marketing/RoleHub";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Administration — CryptoExam Core",
  description: "Run the estate: exams, centres, hardware, keys and emergencies.",
};

/**
 * Problem 4: /administration is the public-facing hub for system administrators.
 * Fix: added a clear Sign in CTA pointing to /admin/login so admins can discover
 * the portal from nav. The RoleHub lists all admin features; the deeper link
 * takes readers to the architecture page.
 *
 * Note: /for-administrators and /administration serve the same audience. This
 * route is kept as the canonical URL; /for-administrators redirects here (or
 * can be consolidated later). Both are now linked from SiteHeader (Problem 6).
 */
export default function AdministrationHub() {
  return (
    <>
      {/* Problem 4: prominent admin login CTA at top of page */}
      <div style={{ background: "var(--color-navy-950, #0d1117)", borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "12px 0" }}>
        <div className="wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", margin: 0 }}>
            Already authorised? Access the administration console.
          </p>
          <Link
            href="/admin/login"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 8, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)", color: "#fff", fontSize: 13, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}
          >
            Sign in to Admin Console →
          </Link>
        </div>
      </div>

      <RoleHub
        groupId="admin"
        intro="Commission centres and terminals, run examinations across the estate, audit every on-chain commitment, and halt an exam under dual control if you have to."
        access="Restricted to authorised administrators. Sensitive actions require a second authoriser, and every one of them is recorded on-chain with its stated reason."
        deeper={{
          label: "The architecture you are operating",
          href: "/platform",
          desc: "Six layers, each producing evidence the next can check — and none of which requires trusting the operator.",
        }}
      />
    </>
  );
}
