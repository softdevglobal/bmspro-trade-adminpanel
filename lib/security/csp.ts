import { commandCentreBackendUrl } from "@/lib/commandCentreBackendUrl";

const isDev = process.env.NODE_ENV === "development";
const commandCentreOrigin = new URL(commandCentreBackendUrl(process.env.NEXT_PUBLIC_COMMAND_CENTRE_BACKEND_URL, isDev)).origin;

const cspEnforced = process.env.CSP_MODE !== "report-only";

const firebaseAuthDomain =
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim() || "";
const firebaseAuthFrameSources = [
  firebaseAuthDomain ? `https://${firebaseAuthDomain}` : "",
  // Firebase also serves the auth helper from the *.web.app alias of a project.
  firebaseAuthDomain.endsWith(".firebaseapp.com")
    ? `https://${firebaseAuthDomain.replace(/\.firebaseapp\.com$/, ".web.app")}`
    : "",
]
  .filter(Boolean)
  .join(" ");

const yeastarConnectSources = (() => {
  const configured = process.env.YEASTAR_PBX_URL?.trim();
  if (!configured) return [];
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" || url.username || url.password) return [];
    const secureWebSocket = new URL(url);
    secureWebSocket.protocol = "wss:";
    return [url.origin, secureWebSocket.origin];
  } catch {
    return [];
  }
})();

export function contentSecurityPolicy(nonce: string) { return [
  "default-src 'self'",
  `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
  // The Next dev indicator injects un-nonced <style> tags; a nonce would make
  // browsers ignore 'unsafe-inline', so dev drops the nonce. Production is unchanged.
  `style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`} https://fonts.googleapis.com`,
  "style-src-attr 'unsafe-inline'",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  [
    "connect-src 'self' blob: data:",
    // Owner review reads/approvals use this authenticated Command Centre API.
    commandCentreOrigin,
    "https://*.googleapis.com",
    "https://*.firebaseio.com",
    "https://*.firebase.com",
    "https://*.stripe.com",
    "https://api.dicebear.com",
    ...yeastarConnectSources,
    "wss://*.firebaseio.com",
    // Turbopack HMR socket + dev asset fetches.
    isDev ? "ws://localhost:* http://localhost:*" : "",
  ]
    .filter(Boolean)
    .join(" "),
  "worker-src 'self' blob:",
  ["frame-src 'self' https://*.stripe.com", firebaseAuthFrameSources]
    .filter(Boolean)
    .join(" "),
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  // Browsers ignore this directive in report-only CSP (it would change
  // requests). Only emit it when the policy is enforced. HSTS already
  // upgrades HTTP on production.
  !isDev && cspEnforced ? "upgrade-insecure-requests" : "",
  "report-uri /api/security/csp-report",
]
  .filter(Boolean)
  .join("; ");
}
export const cspHeaderName = cspEnforced ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";

