"use client";

import { fetchBusinessBookings } from "@/lib/bookings/api-client";
import type { BookingDetail } from "@/lib/bookings/types";
import { useAuth } from "@/lib/auth/auth-context";
import { usePollingFetch } from "@/lib/data/use-polling-fetch";
import { usePageVisible } from "@/lib/notifications/use-page-visible";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

const BOOKING_ROUTES = [
  "/dashboard/jobs",
  "/dashboard/calendar",
] as const;

function needsBookingsFeed(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname === "/dashboard" || pathname === "/dashboard/") return true;
  return BOOKING_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

type BookingsValue = {
  bookings: BookingDetail[];
  loading: boolean;
  error: string | null;
};

const BookingsContext = createContext<BookingsValue | null>(null);

/** Polls bookings via API (no Firestore snapshot listener). */
export function BookingsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { role, businessId, user } = useAuth();
  const pageVisible = usePageVisible();

  const enabled =
    role === "business_owner" &&
    Boolean(businessId) &&
    Boolean(user) &&
    needsBookingsFeed(pathname) &&
    pageVisible;

  const { data, loading, error } = usePollingFetch({
    enabled,
    intervalMs: 90_000,
    fetcher: async () => {
      if (!user) return [];
      const token = await user.getIdToken();
      return fetchBusinessBookings(token);
    },
  });

  const value = useMemo(
    () => ({
      bookings: data ?? [],
      loading: enabled ? loading : false,
      error,
    }),
    [data, loading, error, enabled],
  );

  return (
    <BookingsContext.Provider value={value}>{children}</BookingsContext.Provider>
  );
}

export function useBookings(): BookingsValue {
  const context = useContext(BookingsContext);
  if (!context) {
    throw new Error("useBookings must be used within BookingsProvider");
  }
  return context;
}
