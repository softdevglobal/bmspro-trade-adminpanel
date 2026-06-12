"use client";

import { db } from "@/lib/firebase/client";
import {
  mapBookingDoc,
  sortBookingsNewestFirst,
} from "@/lib/bookings/map-booking-doc";
import { JOBS_COLLECTION } from "@/lib/bookings/types";
import type { BookingDetail } from "@/lib/bookings/types";
import {
  collection,
  limit,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";

export const BOOKING_LIST_LIMIT = 80;

export function subscribeBusinessBookings(
  businessId: string,
  onData: (bookings: BookingDetail[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const q = query(
    collection(db, JOBS_COLLECTION),
    where("businessId", "==", businessId),
    limit(BOOKING_LIST_LIMIT),
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const bookings = snapshot.docs.map((doc) =>
        mapBookingDoc(doc.id, doc.data() as Record<string, unknown>),
      );
      onData(sortBookingsNewestFirst(bookings));
    },
    (error) => onError?.(error),
  );
}
