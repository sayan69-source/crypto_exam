import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CryptoExam Terminal",
  description:
    "Examination-centre terminal — Candidate and Invigilator portals only. Not a public website.",
  robots: { index: false, follow: false },
};

export default function TerminalRootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div id="kiosk-root">{children}</div>
      </body>
    </html>
  );
}
