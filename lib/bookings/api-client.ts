"use client";

import type { BookingDetail } from "@/lib/bookings/types";

type BookingsListResponse = {
  ok: boolean;
  bookings?: BookingDetail[];
  error?: string;
};

export async function fetchBusinessBookings(
  idToken: string,
): Promise<BookingDetail[]> {
  const response = await fetch("/api/bookings", {
    headers: { authorization: `Bearer ${idToken}` },
    cache: "no-store",
  });
  const body = (await response.json()) as BookingsListResponse;
  if (!response.ok || !body.ok || !body.bookings) {
    throw new Error(body.error ?? "Could not load bookings.");
  }
  return body.bookings;
}
