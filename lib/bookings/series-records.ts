import "server-only";

import type { Transaction } from "firebase-admin/firestore";
import { JOBS_COLLECTION } from "@/lib/bookings/types";
import { adminDb } from "@/lib/firebase/admin";

export async function readSeriesRequestLinks(
  transaction: Transaction,
  businessId: string,
  bookingId: string | null | undefined,
  requestId: string,
) {
  if (!bookingId) return null;
  const jobs = adminDb.collection(JOBS_COLLECTION);
  const booking = (await transaction.get(jobs.doc(bookingId))).data();
  if (booking?.businessId !== businessId || booking.inspectionRequestId !== requestId) return null;
  const links = new Map([[requestId, new Set([bookingId])]]);
  if (!booking.seriesId) return booking.recurrence ? links : null;

  const visits = await transaction.get(
    jobs.where("businessId", "==", businessId).where("seriesId", "==", booking.seriesId),
  );
  for (const visit of visits.docs) {
    const id: unknown = visit.get("inspectionRequestId");
    if (typeof id !== "string" || !id) continue;
    const linkedBookings = links.get(id) ?? new Set<string>();
    linkedBookings.add(visit.id);
    links.set(id, linkedBookings);
  }
  return links;
}
