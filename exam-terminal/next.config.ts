import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 'standalone' produces a self-contained server we can ship inside the
  // centre OS image without requiring node_modules at runtime.
  output: "standalone",

  // We deliberately do not expose the public website's API routes here.
  // The terminal speaks only to the CryptoExam backend, configured via
  // NEXT_PUBLIC_API_URL (default http://localhost:8000/api/v1).
  reactStrictMode: true,
};

export default nextConfig;
