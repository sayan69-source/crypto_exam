import type { NextConfig } from "next";

// The System Admin portal runs at HQ (tier-0) and reaches each centre's Edge
// over the HQ WireGuard link (§6.4). In dev we proxy /api/* to the local Edge
// so the portal code stays identical (no CORS, no client URL). The HQ-only
// vault route (/hq/ingest) is served by THIS app, never proxied — the private
// key never leaves this process (stand-in for the HSM).
const EDGE_URL = process.env.EDGE_URL ?? "http://127.0.0.1:4000";

const nextConfig: NextConfig = {
  transpilePackages: ["@zuup/exam-ui"],
  reactStrictMode: true,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${EDGE_URL}/api/:path*` }];
  },
};

export default nextConfig;
