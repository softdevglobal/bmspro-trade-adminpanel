/**
 * Central CORS policy.
 *
 * The only cross-origin surface in this app is the support-chat API under
 * `/api/chat/*`, which authenticates with `Authorization: Bearer <idToken>` —
 * never with cookies. That matters for two reasons:
 *
 *  1. Requests without an `Origin` header (the Flutter mobile app, server jobs,
 *     curl) are not browser CORS requests at all, so they are left untouched.
 *  2. Because no cookie is involved we never send
 *     `Access-Control-Allow-Credentials`, so the wildcard-plus-credentials
 *     combination that CORS forbids cannot be reintroduced by accident.
 *
 * Everything else — pages, static files, and all other API routes — is
 * same-origin only and emits no CORS headers.
 */

/** Origins that may read `/api/chat/*` responses from a browser. */
const PRODUCTION_ORIGINS = [
  "https://trade.bmspros.com.au",
  "https://www.bmspros.com.au",
];

/** Local origins, added only outside production. */
const DEVELOPMENT_ORIGINS = ["http://localhost:3000", "http://localhost:3001"];

/**
 * Extra origins for staging or a call-center web client, as a comma-separated
 * env value, e.g. `CORS_ALLOWED_ORIGINS=https://staging.bmspros.com.au`.
 * Set this per environment — never add a staging origin to the defaults above.
 */
function configuredOrigins(): string[] {
  return (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function allowedOrigins(): string[] {
  const origins = [...PRODUCTION_ORIGINS, ...configuredOrigins()];
  if (process.env.NODE_ENV !== "production") {
    origins.push(...DEVELOPMENT_ORIGINS);
  }
  return origins;
}

/** Exact-match only: no wildcards, no suffix matching, no `null` origin. */
export function isAllowedOrigin(origin: string | null): origin is string {
  if (!origin || origin === "null") return false;
  return allowedOrigins().includes(origin);
}

/** Methods the chat routes actually export, plus the preflight itself. */
export const CHAT_ALLOWED_METHODS = "GET, POST, PATCH, OPTIONS";

/**
 * Request headers the chat routes actually read: `Authorization` for the bearer
 * token, `Content-Type` because JSON bodies are not a simple request type.
 * `X-Tenant-Id` used to be advertised here but no chat route or helper reads it
 * — add it back only if a cross-origin client is found to send it.
 */
export const CHAT_ALLOWED_HEADERS = "Authorization, Content-Type";

/** Cache preflight results for 10 minutes to cut round trips. */
const PREFLIGHT_MAX_AGE = "600";

/**
 * Headers granting an allowed origin access. Returns an empty object for any
 * other origin, so the browser blocks the response.
 */
export function corsHeaders(origin: string | null): Record<string, string> {
  if (!isAllowedOrigin(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": CHAT_ALLOWED_METHODS,
    "Access-Control-Allow-Headers": CHAT_ALLOWED_HEADERS,
    "Access-Control-Max-Age": PREFLIGHT_MAX_AGE,
  };
}
