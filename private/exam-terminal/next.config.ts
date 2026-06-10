import type { NextConfig } from "next";

// In production the terminal surface is served inside ZUUP-OS and /api/* is
// the Centre Edge over the WireGuard tunnel (§6.4) — same-origin, LAN-only.
// In dev we proxy /api/* to a local Edge so the page code stays identical.
const EDGE_URL = process.env.EDGE_URL ?? "http://127.0.0.1:4000";

const nextConfig: NextConfig = {
  // 'standalone' produces a self-contained server we can ship inside the
  // centre OS image without requiring node_modules at runtime.
  output: "standalone",

  reactStrictMode: true,

  async rewrites() {
    return [{ source: "/api/:path*", destination: `${EDGE_URL}/api/:path*` }];
  },
};

export default nextConfig;
