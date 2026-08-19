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
            <h5>Platform</h5>
            <ul>
              <li><Link href="/platform">Overview</Link></li>
              <li><Link href="/#guarantees">Guarantees</Link></li>
              <li><Link href="/platform#architecture">Architecture</Link></li>
              <li><Link href="/#roles">For teams</Link></li>
              <li><Link href="/for-setters">For setters</Link></li>
              {/* Explainer, not a portal — it belongs beside the other
                  explainers rather than next to the tier-0 login. */}
              <li><Link href="/for-administrators">For administrators</Link></li>
            </ul>
          </div>

          <div className="footer-col">
            <h5>Company</h5>
            <ul>
              <li><Link href="/about">About</Link></li>
              <li><Link href="/about#mission">Mission</Link></li>
              <li><Link href="/contact">Contact</Link></li>
              <li><Link href="/contact">Request access</Link></li>
            </ul>
          </div>

          <div className="footer-col">
            <h5>Trust</h5>
            <ul>
              {/* Three of these used to point at the same /#faq anchor, so
                  "DPDP Act 2023" and "Public audit" promised dedicated pages
                  and delivered the homepage FAQ. Each now goes where its label
                  says: the audit surface, the privacy notice that actually
                  sets out the DPDP position, and the architecture section. */}
              <li><Link href="/exam/audit">Public audit</Link></li>
              <li><Link href="/privacy">DPDP Act 2023</Link></li>
              <li><Link href="/platform#architecture">Security model</Link></li>
              <li><Link href="/#faq">FAQ</Link></li>
            </ul>
          </div>

          {/* Sign-in destinations only — no explainer pages.
              This column used to mix them, which produced two entries reading
              "For administrators" and "System Administration" side by side:
              one a marketing page about the tier-1 console, the other the
              tier-0 login. Indistinguishable from the outside, and neither was
              centre staff. The explainer now sits under Platform, where the
              other explainers are, and every link here goes to a real portal.
              The two registration links also pointed at the SAME url; they now
              deep-link the role so they are genuinely different. */}
          <div className="footer-col">
            <h5>Sign in</h5>
            <ul>
              <li><Link href="/candidate-enrolment">Candidate enrolment</Link></li>
              <li><Link href="/staff-registration?role=CENTER_ADMIN">Register as Centre Admin</Link></li>
              <li><Link href="/staff-registration?role=CENTER_INVIGILATOR">Register as Invigilator</Link></li>
              <li><Link href="/center-access">Centre access &amp; login</Link></li>
              <li><Link href="/admin/login">Administrator console</Link></li>
              {/* Tier-0. Listed like any other portal so it is findable —
                  enrolment is IP-restricted and login needs a fingerprint, so
                  the link being public costs nothing. */}
              <li><Link href="/sysadmin/login">System Administration · tier&nbsp;0</Link></li>
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
