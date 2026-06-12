"use client";

import type { BookingDetail } from "@/lib/bookings/types";

type JobsListResponse = {
  ok: boolean;
  jobs?: BookingDetail[];
  error?: string;
};

export async function fetchBusinessBookings(
  idToken: string,
): Promise<BookingDetail[]> {
  const response = await fetch("/api/jobs", {
    headers: { authorization: `Bearer ${idToken}` },
    cache: "no-store",
  });
  const body = (await response.json()) as JobsListResponse;
  if (!response.ok || !body.ok || !body.jobs) {
    throw new Error(body.error ?? "Could not load jobs.");
  }
  return body.jobs;
}
