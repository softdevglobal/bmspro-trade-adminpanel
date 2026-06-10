import type { CustomerAccountTab } from "@/components/customer-account-nav";

export const LAST_BOOKING_SLUG_KEY = "bmspt:last-booking-slug";

/** URL segment for each account tab (`bookings` → `history` in the path). */
export const ACCOUNT_TAB_SEGMENT: Record<
  CustomerAccountTab,
  string | null
> = {
  profile: null,
  requests: "requests",
  jobs: "history",
  notifications: "notifications",
  activity: "activity",
};

const SEGMENT_TO_TAB: Record<string, CustomerAccountTab> = {
  requests: "requests",
  history: "jobs",
  notifications: "notifications",
  activity: "activity",
  profile: "profile",
};

export function segmentToAccountTab(
  segment: string | undefined,
): CustomerAccountTab | null {
  if (!segment) return "profile";
  return SEGMENT_TO_TAB[segment] ?? null;
}

export function booknowPath(slug: string): string {
  return `/booknow/${slug}`;
}

export function accountPath(
  slug: string,
  tab: CustomerAccountTab = "profile",
): string {
  const segment = ACCOUNT_TAB_SEGMENT[tab];
  const base = `/booknow/${slug}/account`;
  return segment ? `${base}/${segment}` : base;
}

/** Active or history tab with optional `request` query to open one booking. */
export function accountBookingFocusPath(
  slug: string,
  requestId: string | null | undefined,
  scope: "active" | "history",
): string {
  const tab = scope === "history" ? "jobs" : "requests";
  const base = accountPath(slug, tab);
  if (!requestId?.trim()) return base;
  return `${base}?request=${encodeURIComponent(requestId.trim())}`;
}

/** @deprecated Use accountBookingFocusPath(slug, requestId, "active"). */
export function accountRequestsPath(
  slug: string,
  requestId?: string | null,
): string {
  return accountBookingFocusPath(slug, requestId, "active");
}

/** Reads the business slug from a /booknow/[slug] URL. */
export function parseBooknowSlug(pathname: string): string | null {
  const match = pathname.match(/^\/booknow\/([^/]+)/);
  return match?.[1] ?? null;
}

export function parseAccountTabFromPathname(
  pathname: string,
): CustomerAccountTab | null {
  const match = pathname.match(/^\/booknow\/[^/]+\/account(?:\/([^/?]+))?\/?$/);
  const segment = match?.[1];
  if (!segment) return "profile";
  return SEGMENT_TO_TAB[segment] ?? null;
}

export function isBooknowAccountPath(pathname: string): boolean {
  return /^\/booknow\/[^/]+\/account/.test(pathname);
}

/** Maps legacy `?tab=` values to account tabs. */
export function parseLegacyAccountTabQuery(
  value: string | null,
): CustomerAccountTab | null {
  if (value === "requests" || value === "notifications") return value;
  if (value === "jobs" || value === "history") return "jobs";
  if (value === "profile") return "profile";
  return null;
}

export function rememberBookingSlug(slug: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(LAST_BOOKING_SLUG_KEY, slug);
}

export function recallBookingSlug(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(LAST_BOOKING_SLUG_KEY);
}
