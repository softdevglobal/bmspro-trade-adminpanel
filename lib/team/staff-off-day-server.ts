import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { PLATFORM_TIME_ZONE } from "@/lib/platform/timezone";
import {
  isStaffOffOnDate,
  offDayIdsFromAvailability,
} from "@/lib/team/staff-availability";

async function resolveBusinessTimeZone(businessId: string): Promise<string> {
  try {
    const snap = await adminDb.collection("businesses").doc(businessId).get();
    const tz = snap.data()?.timezone;
    return typeof tz === "string" && tz.trim() ? tz.trim() : PLATFORM_TIME_ZONE;
  } catch {
    return PLATFORM_TIME_ZONE;
  }
}

export async function staffIsOffOnDate(
  staffUid: string,
  ymd: string,
  businessId?: string | null,
): Promise<boolean> {
  if (!staffUid || !ymd) return false;
  const snap = await adminDb.collection("users").doc(staffUid).get();
  if (!snap.exists) return false;

  const timeZone = businessId
    ? await resolveBusinessTimeZone(businessId)
    : PLATFORM_TIME_ZONE;
  const offDays = offDayIdsFromAvailability(snap.data()?.availability);
  return isStaffOffOnDate(offDays, ymd, timeZone);
}
