import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["postgres"],
  experimental: {
    // Lets a page answer "you may not see this" with 403/401 instead of a 500 error page.
    authInterrupts: true,
  },
};

export default nextConfig;
