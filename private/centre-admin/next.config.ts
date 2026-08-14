import type { NextConfig } from "next";

// In production the Centre Admin portal is served BY the Edge (kiosk Firefox
// loads https://edge.local/), so /api/* is same-origin. In dev we proxy /api/*
// to the local Edge so the portal code stays identical (no CORS, no client URL).
const EDGE_URL = process.env.EDGE_URL ?? "http://127.0.0.1:4000";

// The on-device biometric daemon (zuup-biometric.service) binds loopback only
// and is never on the LAN (§8). Proxying it through this origin keeps the kiosk
// CSP to a single host and keeps the page code origin-agnostic.
const BIOMETRIC_URL = process.env.BIOMETRIC_URL ?? "http://127.0.0.1:7700";

// The all-in-one image serves this portal under /admin (the kiosk loads
// edge.local/admin/) and ships a self-contained standalone server. All three
// are env-gated so plain `npm run dev` keeps serving at the root, unchanged.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined; // e.g. "/admin"

const nextConfig: NextConfig = {
  ...(process.env.NEXT_OUTPUT ? { output: process.env.NEXT_OUTPUT as "standalone" } : {}),
  ...(basePath ? { basePath } : {}),
  // In the workspace the standalone tracer must root at the monorepo, not the
  // app dir, or @zuup/exam-ui and node_modules land outside the bundle.
  ...(process.env.TRACING_ROOT ? { outputFileTracingRoot: process.env.TRACING_ROOT } : {}),
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
