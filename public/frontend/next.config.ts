import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // ── Standalone output for minimal Docker images ──────────────────────────
  // Copies only the exact runtime files needed — no node_modules bloat.
  // Works with both Render (Dockerfile.render) and docker-compose.
  output: "standalone",

  // ── Monorepo root: silence the lockfile-detection warning ────────────────
  // This repo has a root package-lock.json (workspaces) AND a frontend one.
  // Without this, Next.js picks the wrong root and warns on every build.
  turbopack: {
    root: path.resolve(__dirname, "../.."),
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
