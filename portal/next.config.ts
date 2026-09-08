import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "standalone",
  // Keep development artifacts inside the checkout. The production build
  // still writes to its configured absolute artifact directory.
  distDir: process.env.NODE_ENV === "development" ? ".next" : "/var/compliance-build/.next",
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "img.clerk.com",
      },
    ],
  },
};

export default nextConfig;
