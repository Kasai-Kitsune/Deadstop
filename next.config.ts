import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // the sandbox preview reaches the dev server through its own host
  allowedDevOrigins: ["https://*.space-z.ai"],
};

export default nextConfig;
