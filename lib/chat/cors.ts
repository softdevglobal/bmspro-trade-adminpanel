import { NextResponse } from "next/server";

/**
 * Response helpers for the support-chat API.
 *
 * These used to attach `Access-Control-Allow-Origin: *` to every chat response.
 * CORS is now decided in one place — proxy.ts, backed by the allowlist in
 * lib/security/cors.ts — so these helpers only shape the body and status.
 * Keeping them means route handlers stay unchanged and cannot drift back to
 * per-route CORS.
 */
export function chatJson(
  body: unknown,
  init?: { status?: number },
): NextResponse {
  return NextResponse.json(body, { status: init?.status ?? 200 });
}

/**
 * Preflight fallback. In practice proxy.ts answers `OPTIONS` before a request
 * reaches the route, so this only runs if the proxy matcher stops covering
 * `/api/chat/*` — in which case returning no CORS grant is the safe default.
 */
export function chatOptions(): NextResponse {
  return new NextResponse(null, { status: 204 });
}
