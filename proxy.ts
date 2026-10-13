import { contentSecurityPolicy, cspHeaderName } from "@/lib/security/csp";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { corsHeaders, isAllowedOrigin } from "@/lib/security/cors";

/**
 * Applies the CORS allowlist to the support-chat API — the one cross-origin
 * surface in the app. Route handlers no longer set CORS headers themselves, so
 * this is the single place the policy lives (see lib/security/cors.ts).
 *
 * Requests without an `Origin` header pass straight through: the Flutter app
 * and server-to-server callers are not subject to CORS and must keep working.
 */
export function proxy(request: NextRequest) {
  const origin = request.headers.get("origin");

  if (request.method === "OPTIONS") {
    // Non-allowlisted origins get a preflight with no grant, which the browser
    // rejects before it ever sends the real request.
    return new NextResponse(null, {
      status: 204,
      headers: { ...corsHeaders(origin), Vary: "Origin" },
    });
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy(nonce);
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set(cspHeaderName, policy);
  if (request.nextUrl.pathname.startsWith("/activate/")) response.headers.set("Referrer-Policy", "no-referrer");
  // Always vary on Origin so a permitted response is never cached and replayed
  // for a different origin.
  response.headers.set("Vary", "Origin");

  if (isAllowedOrigin(origin)) {
    for (const [key, value] of Object.entries(corsHeaders(origin))) {
      response.headers.set(key, value);
    }
  }

  return response;
}

export const config = {
  matcher: ["/api/chat/:path*", "/((?!api|_next|favicon.ico|sw.js|manifest|robots|.*\\.(?:png|jpg|jpeg|svg|webp|gif|ico)$).*)"],
};
