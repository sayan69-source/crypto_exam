import type { Metadata } from "next";
import "@zuup/exam-ui/theme.css";
import "./globals.css";
import { Nav } from "./Nav";

export const metadata: Metadata = {
  title: "ZUUP-OS · Centre Admin",
  description: "Centre Admin Portal — counts for this centre only; blind courier.",
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
