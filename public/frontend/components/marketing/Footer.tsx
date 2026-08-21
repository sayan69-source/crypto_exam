import Link from "next/link";
import Icon from "./LucideIcon";
import { GROUPS } from "@/lib/navigation";

/**
 * Footer sitemap.
 *
 * Generated from lib/navigation rather than hand-maintained, so it links the
 * real feature set instead of drifting into a handful of repeated anchors.
 */

const COLUMNS = ["candidate", "setter", "invigilator", "admin"];

/** Role hubs. The header no longer carries role tabs, so these headings are
 *  one of the main ways in. */
const HUBS: Record<string, string> = {
  candidate: "/candidates",
  setter: "/setters",
  invigilator: "/invigilators",
  admin: "/administration",
};

export default function Footer() {
  const columns = COLUMNS.map((id) => GROUPS.find((g) => g.id === id)!).filter(Boolean);

  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="footer-main">
          <div>
            <Link className="brand" href="/">
              <span className="brand-mark">
                <Icon name="shield-check" size={18} strokeWidth={1.8} />
              </span>
              <span className="brand-name">
                CryptoExam<b>Core</b>
              </span>
            </Link>
            <p className="footer-blurb">
              Zero-trust examination infrastructure for India. Integrity proven
              on-chain, for anyone to inspect.
            </p>
            {/* The sitewide "Request access" CTA used to live in the marketing
                nav bar. With that bar removed, the footer carries it — without
                this, /contact is unreachable from the hubs and /platform. */}
            <div className="footer-actions">
              <Link className="footer-cta" href="/contact">
                Request access <Icon name="arrow-right" size={15} strokeWidth={2} />
              </Link>
              <Link className="footer-explore" href="/explore">
                <Icon name="compass" size={15} strokeWidth={1.9} />
                Explore all features
              </Link>
            </div>
          </div>

          <div className="footer-col">
            <h5>Platform & Trust</h5>
            <ul>
              <li><Link href="/platform">Platform Overview</Link></li>
              <li><Link href="/platform#architecture">Security & Architecture</Link></li>
              <li><Link href="/exam/audit">Public Audit</Link></li>
              <li><Link href="/privacy">Privacy & DPDP</Link></li>
              <li><Link href="/contact">Contact Us</Link></li>
            </ul>
          </div>

          <div className="footer-col">
            <h5>Sign in</h5>
            <ul>
              <li><Link href="/candidate-enrolment">Candidate</Link></li>
              <li><Link href="/center-access">Centre Staff</Link></li>
              <li><Link href="/admin/login">Administrator</Link></li>
            </ul>
          </div>
        </div>

        <div className="footer-bottom">
          <p>© 2026 CryptoExam Core · FAR AWAY 2026 · Built for India</p>
          <div className="footer-legal">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/about">About</Link>
            <span className="mono" style={{ color: "var(--text-on-dark-muted)" }}>
              Polygon PoS · CIRCOM Groth16
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
