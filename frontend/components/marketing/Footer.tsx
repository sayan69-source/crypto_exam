import Link from "next/link";
import Icon from "./LucideIcon";

export default function Footer() {
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
          </div>

          <div className="footer-col">
            <h5>Platform</h5>
            <ul>
              <li><Link href="/platform">Overview</Link></li>
              <li><Link href="/#guarantees">Guarantees</Link></li>
              <li><Link href="/platform#architecture">Architecture</Link></li>
              <li><Link href="/#roles">For teams</Link></li>
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
              <li><Link href="/#faq">Public audit</Link></li>
              <li><Link href="/#faq">DPDP Act 2023</Link></li>
              <li><Link href="/platform#architecture">Security model</Link></li>
              <li><Link href="/#faq">FAQ</Link></li>
            </ul>
          </div>
        </div>

        <div className="footer-bottom">
          <p>© 2026 CryptoExam Core · FAR AWAY 2026 · Built for India</p>
          <div className="footer-legal">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <span className="mono" style={{ color: "var(--color-navy-500)" }}>
              Polygon PoS · CIRCOM Groth16
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
