"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon from "./LucideIcon";

export default function Navbar() {
  const pathname = usePathname();

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
              <li>
                <Link href="/platform" aria-current={pathname === "/platform" ? "page" : undefined}>
                  Platform
                </Link>
              </li>
              <li>
                <Link href="/#guarantees">Guarantees</Link>
              </li>
              <li>
                <Link href="/#roles">For teams</Link>
              </li>
              <li>
                <Link href="/about" aria-current={pathname === "/about" ? "page" : undefined}>
                  About
                </Link>
              </li>
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

          <button className="nav-toggle" aria-label="Menu">
            <Icon name="menu" size={24} />
          </button>
        </div>
      </header>
    </>
  );
}
