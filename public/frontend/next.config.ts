import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // ── Standalone output for minimal Docker images ──────────────────────────
  // Copies only the exact runtime files needed — no node_modules bloat.
  // Works with both Render (Dockerfile.render) and docker-compose.
  output: "standalone",

  // ── Root: this directory, not the monorepo ───────────────────────────────
  // The repo has a root package-lock.json (workspaces) AND a frontend one, so
  // Next.js infers the monorepo root and warns. Pointing at the monorepo root
  // silences the warning but ALSO nests the standalone bundle under
  // .next/standalone/public/frontend/, so the `node server.js` in
  // Dockerfile.render finds nothing and the container never serves. The
  // frontend traces no files outside this directory — and the Docker build
  // context IS this directory — so the correct root is here.
  turbopack: {
    root: path.resolve(__dirname),
  },
  outputFileTracingRoot: path.resolve(__dirname),

  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    cpus: 1,
    workerThreads: false,
  },

  // ── Security headers ─────────────────────────────────────────────────────
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
