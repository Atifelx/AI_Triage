import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Keep the dev-mode badge away from the sidebar's status block.
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
