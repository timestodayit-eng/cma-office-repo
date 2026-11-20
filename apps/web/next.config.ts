import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: ["@cma/core"],
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  // The old data file uploaded in Settings is about 0.5 MB.
  experimental: { serverActions: { bodySizeLimit: "8mb" } },
};

export default nextConfig;
