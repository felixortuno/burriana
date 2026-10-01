import type { NextConfig } from "next";

// Supabase is the only database, so the build needs no per-platform module swaps.
const nextConfig: NextConfig = {
  experimental: {
    // Vercel restores .next/cache between deployments, and a restored Turbopack
    // cache once shipped the previous stylesheet with new markup. Build cold.
    turbopackFileSystemCacheForBuild: false,
  },
};

export default nextConfig;
