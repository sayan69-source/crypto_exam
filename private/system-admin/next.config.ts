import type { NextConfig } from "next";

// The System Admin portal runs at HQ (tier-0) and reaches each centre's Edge
// over the HQ WireGuard link (§6.4). In dev we proxy /api/* to the local Edge
// so the portal code stays identical (no CORS, no client URL). The HQ-only
// vault route (/hq/ingest) is served by THIS app, never proxied — the private
// key never leaves this process (stand-in for the HSM).
const EDGE_URL = process.env.EDGE_URL ?? "http://127.0.0.1:4000";

// The on-device biometric daemon (zuup-biometric.service) binds loopback only
// and is never on the LAN (§8). Proxying it through this origin keeps the kiosk
// CSP to a single host and keeps the page code origin-agnostic.
const BIOMETRIC_URL = process.env.BIOMETRIC_URL ?? "http://127.0.0.1:7700";

const nextConfig: NextConfig = {
  transpilePackages: ["@zuup/exam-ui"],
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${EDGE_URL}/api/:path*` },
      { source: "/biometric/:path*", destination: `${BIOMETRIC_URL}/:path*` },
    ];
  },
};

export default nextConfig;
