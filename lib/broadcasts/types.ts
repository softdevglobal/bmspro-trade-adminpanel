/**
 * Custom messages ("broadcasts") authored by a super admin and delivered to
 * business users as read-only notifications. Used for platform-wide announcements
 * such as system updates or maintenance windows.
 *
 * Stored once per message (no per-recipient fan-out). Each consumer (admin panel
 * or mobile app) reads the broadcasts that match its platform and the caller's
 * role, and tracks read/dismiss state per user.
 */

/** A single broadcast document. */
export const BROADCAST_COLLECTION = "admin_broadcasts";

/** Per-user read/dismiss state for broadcasts, keyed by Firebase Auth UID. */
export const BROADCAST_USER_STATE_COLLECTION = "broadcast_user_state";

/** Which client surfaces should display the message. */
export type BroadcastPlatforms = {
  /** Business owners on the web admin panel. */
  admin: boolean;
  /** Owners (and optionally staff) on the mobile app. */
  mobile: boolean;
};

/**
 * Who should receive the message:
 * - `owners` — business owners (and admins) only
 * - `all` — business owners and their staff
 */
export type BroadcastAudience = "owners" | "all";

/** Stored broadcast (timestamps are epoch millis on the client). */
export type BroadcastRecord = {
  id: string;
  title: string;
  body: string;
  platforms: BroadcastPlatforms;
  audience: BroadcastAudience;
  /** When false the message is hidden from recipients (recalled). */
  active: boolean;
  createdAt: number;
  createdByUid: string | null;
  createdByEmail: string | null;
  /** Number of mobile devices a push was attempted to at send time. */
  mobilePushCount: number | null;
};

/** Broadcast as delivered to a consumer, including this user's read state. */
export type BroadcastForUser = {
  id: string;
  title: string;
  body: string;
  audience: BroadcastAudience;
  createdAt: number;
  read: boolean;
};

export const BROADCAST_AUDIENCE_LABELS: Record<BroadcastAudience, string> = {
  owners: "Business owners only",
  all: "All staff & owners",
};

/** Consumer platform a request is made on behalf of. */
export type BroadcastPlatform = "admin" | "mobile";

/** Prefix used so broadcast notifications never collide with other IDs. */
export const BROADCAST_NOTIFICATION_PREFIX = "broadcast__";

export function isValidAudience(value: unknown): value is BroadcastAudience {
  return value === "owners" || value === "all";
}

export function isValidPlatform(value: unknown): value is BroadcastPlatform {
  return value === "admin" || value === "mobile";
}
