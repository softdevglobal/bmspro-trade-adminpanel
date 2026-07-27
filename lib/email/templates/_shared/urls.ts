import "server-only";

import { firstUsable, resolveAppBaseUrl } from "@/lib/config/base-url";

/**
 * Origin for links inside emails. Prefers the booking engine host, then the app
 * origin; `NEXT_PUBLIC_BOOKING_BASE_URL` is inlined at build time, so on a
 * deployment it can hold a stale localhost value and is only trusted when it
 * points somewhere reachable. Returns `""` when nothing resolves, which callers
 * already treat as "omit the link".
 */
export function appBaseUrl(): string {
  return (
    firstUsable([
      process.env.BOOKING_BASE_URL,
      process.env.NEXT_PUBLIC_BOOKING_BASE_URL,
    ]) ??
    resolveAppBaseUrl() ??
    ""
  );
}

export function loginUrl(): string | null {
  const base = appBaseUrl();
  return base ? `${base}/login` : null;
}

/** Public URL for the platform logo used in owner welcome emails. */
export function platformBrandLogoUrl(): string | null {
  const base = appBaseUrl();
  return base ? `${base}/bms_pro_blue.jpeg` : null;
}
