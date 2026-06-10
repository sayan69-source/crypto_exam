import type { Metadata } from "next";
import "@zuup/exam-ui/theme.css";
import "./globals.css";
import { Nav } from "./Nav";

export const metadata: Metadata = {
  title: "ZUUP-OS · System Admin",
  description:
    "System Admin Portal (tier-0) — nationwide oversight, Centre Admin approvals, HQ answer vault.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
