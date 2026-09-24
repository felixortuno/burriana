import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Next.js runs on Vercel's Node runtime; Sites supplies Cloudflare bindings.
  turbopack: {
    resolveAlias: {
      "@/lib/server/warehouse-runtime": "./lib/server/warehouse-vercel.ts",
      "@/lib/server/deployment-access": "./lib/server/vercel-access.ts",
    },
  },
  webpack(config) {
    config.resolve.alias["@/lib/server/warehouse-runtime"] = path.resolve(
      process.cwd(),
      "lib/server/warehouse-vercel.ts",
    );
    config.resolve.alias["@/lib/server/deployment-access"] = path.resolve(
      process.cwd(),
      "lib/server/vercel-access.ts",
    );
    return config;
  },
};

export default nextConfig;
