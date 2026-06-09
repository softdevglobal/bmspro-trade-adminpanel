"use client";

export type StaffSummary = {
  id: string;
  fullName: string;
  email: string;
  staffType: string;
  canget_qutaion: boolean;
};

const CACHE_PREFIX = "bms.staff.summary.";
const CACHE_TTL_MS = 15 * 60 * 1000;

export const STAFF_CHANGED_EVENT = "bms:staff-changed";

type CachedStaff = {
  businessId: string;
  staff: StaffSummary[];
  cachedAt: number;
};

function cacheKey(businessId: string): string {
  return `${CACHE_PREFIX}${businessId}`;
}

export function readStaffSummaryCache(
  businessId: string,
): StaffSummary[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(cacheKey(businessId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedStaff;
    if (parsed.businessId !== businessId) return null;
    if (Date.now() - parsed.cachedAt > CACHE_TTL_MS) return null;
    return parsed.staff;
  } catch {
    return null;
  }
}

export function writeStaffSummaryCache(
  businessId: string,
  staff: StaffSummary[],
): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      cacheKey(businessId),
      JSON.stringify({ businessId, staff, cachedAt: Date.now() } satisfies CachedStaff),
    );
  } catch {
    /* storage unavailable */
  }
}

export function clearStaffSummaryCache(businessId?: string): void {
  if (typeof window === "undefined") return;
  try {
    if (businessId) {
      sessionStorage.removeItem(cacheKey(businessId));
      return;
    }
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(CACHE_PREFIX)) keys.push(key);
    }
    for (const key of keys) sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function notifyStaffChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(STAFF_CHANGED_EVENT));
}
