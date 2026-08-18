import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from '@/lib/auth/AuthContext';
import CommandPalette from '@/components/marketing/CommandPalette';
import ScrollFX from '@/components/marketing/ScrollFX';
import SiteHeader from '@/components/marketing/SiteHeader';

export const metadata: Metadata = {
  title: "CryptoExam Core — Zero-Trust Examination Infrastructure",
  description:
    "Cryptographically enforced, zero-trust national examination platform for India. " +
    "AES-GCM-256 encryption, ZK-SNARK difficulty proofs, Merkle answer commitments on Polygon, " +
    "and RSA time-lock hardware nodes. DPDP Act 2023 compliant.",
  keywords: [
    "CryptoExam", "zero-trust", "examination", "India", "NEET", "JEE",
    "ZK-SNARK", "blockchain", "Polygon", "DPDP Act 2023",
  ],
  authors: [{ name: "CryptoExam Team" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <AuthProvider>
          {/* Primary navigation, held on every route — marketing, auth and
              the signed-in portals alike. Portals previously rendered no site
              nav at all, which made signing in a one-way door. */}
          <SiteHeader />
          {children}
          {/* Global ⌘K navigator — available on every route, including the
              authenticated portals, not just the marketing pages. */}
          <CommandPalette />
          {/* Scroll progress, nav condense, back-to-top, and the site-wide
              reveal observer. Mounted here so every route animates, not just
              the landing page. */}
          <ScrollFX />
        </AuthProvider>
      </body>
    </html>
  );
}
