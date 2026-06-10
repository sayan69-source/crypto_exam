import type { NextConfig } from "next";

// In production the Centre Admin portal is served BY the Edge (kiosk Firefox
// loads https://edge.local/), so /api/* is same-origin. In dev we proxy /api/*
// to the local Edge so the portal code stays identical (no CORS, no client URL).
const EDGE_URL = process.env.EDGE_URL ?? "http://127.0.0.1:4000";

const nextConfig: NextConfig = {
  transpilePackages: ["@zuup/exam-ui"],
  reactStrictMode: true,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${EDGE_URL}/api/:path*` }];
  },
};

export default nextConfig;
