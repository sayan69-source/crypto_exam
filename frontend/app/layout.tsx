import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
