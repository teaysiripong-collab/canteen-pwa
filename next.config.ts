import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits a self-contained server bundle — keeps the Cloud Run image small.
  output: "standalone",
  serverExternalPackages: ["@prisma/client", "exceljs", "googleapis"],
  experimental: {
    // Master-data imports and receiving photos travel through Server Actions.
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;
