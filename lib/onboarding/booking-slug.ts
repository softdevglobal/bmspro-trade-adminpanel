/**
 * Convert a business name into a URL-safe slug for the public booking engine.
 *   "Pawan Plumbing"     -> "pawan-plumbing"
 *   "Joe's Sparky Co."   -> "joes-sparky-co"
 *   "ABC HVAC & Cooling" -> "abc-hvac-cooling"
 */
export function slugifyBusinessName(name: string): string {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Reserved slugs that must never be assigned to a business. */
const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "booknow",
  "booking",
  "dashboard",
  "login",
  "logout",
  "onboard",
  "settings",
  "signup",
  "signin",
  "support",
  "tenant",
  "tenants",
  "user",
  "users",
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

/**
 * Build the full public booking URL. If `baseUrl` is provided we use it,
 * otherwise we fall back to `NEXT_PUBLIC_BOOKING_BASE_URL`, then to the
 * raw `/booknow/<slug>` path.
 */
export function buildBookingUrl(slug: string, baseUrl?: string | null): string {
  const trimmedBase =
    (baseUrl ?? process.env.NEXT_PUBLIC_BOOKING_BASE_URL ?? "").replace(
      /\/+$/,
      ""
    );
  if (!slug) return trimmedBase || "";
  if (!trimmedBase) return `/booknow/${slug}`;
  return `${trimmedBase}/booknow/${slug}`;
}
