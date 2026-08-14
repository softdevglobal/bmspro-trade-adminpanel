import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const isDev = process.env.NODE_ENV === "development";

/**
 * CSP rollout switch. Leave unset (or anything but "enforce") to ship the policy
 * as `Content-Security-Policy-Report-Only`, which reports violations to
 * `/api/security/csp-report` without blocking anything. Set `CSP_MODE=enforce`
 * in the host env once the report log is clean.
 */
const cspEnforced = process.env.CSP_MODE === "enforce";

/**
 * Third-party origins the browser legitimately talks to:
 * - fonts.googleapis.com / fonts.gstatic.com — Finlandica + Material Symbols in app/layout.tsx
 * - *.googleapis.com — Firebase Auth (identitytoolkit, securetoken), Firestore, Storage
 * - *.stripe.com — hosted checkout / billing portal redirects
 * - api.dicebear.com — generated staff + customer avatars
 * - unpkg.com — pdf.js worker in components/pdf-canvas-viewer.tsx
 *
 * `'unsafe-inline'` and `'unsafe-eval'` are deliberate starting points, not the
 * end state: tighten script-src to nonces or hashes (see
 * node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md) once
 * the report-only phase confirms the rest of the policy holds.
 */
const cspDirectives = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  [
    "connect-src 'self' blob: data:",
    "https://*.googleapis.com",
    "https://*.firebaseio.com",
    "https://*.firebase.com",
    "https://*.stripe.com",
    "https://api.dicebear.com",
    "https://unpkg.com",
    "wss://*.firebaseio.com",
    // Turbopack HMR socket + dev asset fetches.
    isDev ? "ws://localhost:* http://localhost:*" : "",
  ]
    .filter(Boolean)
    .join(" "),
  "worker-src 'self' blob: https://unpkg.com",
  "frame-src 'self' https://*.stripe.com",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  // Dev runs over plain http://localhost, so only upgrade in deployed builds.
  isDev ? "" : "upgrade-insecure-requests",
  "report-uri /api/security/csp-report",
]
  .filter(Boolean)
  .join("; ");

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
  {
    key: cspEnforced
      ? "Content-Security-Policy"
      : "Content-Security-Policy-Report-Only",
    value: cspDirectives,
  },
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
