import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // No part of the app is meant to be embedded, so deny framing outright.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  // robots.txt only asks crawlers not to fetch; a disallowed URL can still be
  // indexed from an inbound link. This is the part that actually keeps the
  // portal out of search results. See app/robots.ts.
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

/**
 * Vercel serves prerendered HTML and /public files from its CDN with a default
 * `Access-Control-Allow-Origin: *`, which is why the live site returns wildcard
 * CORS on pages even though no route sets it. There is no "unset" primitive for
 * platform headers, so we override the value with the canonical origin: pages
 * are only ever read same-origin, making this grant a no-op in practice while
 * removing the wildcard. API routes are excluded — their CORS is decided in
 * proxy.ts.
 */
const canonicalOrigin =
  process.env.CANONICAL_ORIGIN ?? "https://trade.bmspros.com.au";

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/((?!api/).*)",
        // A fixed value, so no `Vary: Origin` — that would fragment the CDN
        // cache for every requesting origin and buy nothing.
        headers: [{ key: "Access-Control-Allow-Origin", value: canonicalOrigin }],
      },
      {
        /**
         * API responses carry tenant data behind a bearer token and must never
         * land in a shared cache. Next sends no `Cache-Control` at all on these
         * today, which leaves them open to heuristic caching by intermediaries.
         *
         * The exclusions are routes that deliberately manage their own caching,
         * and a header set here would override them: the PDF endpoints use
         * `private, max-age=60` so re-opening a document does not re-render it,
         * and the SSE streams need `no-transform` to stop proxies buffering the
         * stream. Add to this list if another route starts setting its own.
         */
        source:
          "/api/((?!invoices/pdf|quotations/pdf|customer/documents/pdf|notifications/stream|customer/notifications/stream).*)",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
      {
        // The worker script must never be served stale, or a deploy cannot
        // replace it. `Service-Worker-Allowed` lets it control the whole origin.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      // Next serves the app/manifest.ts route at /manifest.webmanifest; installers
      // and audits conventionally probe /manifest.json, so answer both.
      { source: "/manifest.json", destination: "/manifest.webmanifest" },
    ];
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
