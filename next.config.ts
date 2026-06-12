import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
  async redirects() {
    return [
      {
        source: "/dashboard/inspection-visits",
        destination: "/dashboard/requests",
        permanent: true,
      },
      {
        source: "/dashboard/inspection-visits/:path*",
        destination: "/dashboard/requests/:path*",
        permanent: true,
      },
      {
        source: "/dashboard/bookings",
        destination: "/dashboard/jobs",
        permanent: true,
      },
      {
        source: "/dashboard/bookings/:path*",
        destination: "/dashboard/jobs/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
