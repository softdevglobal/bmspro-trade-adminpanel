"use client";

import { subscribeBusinessBookings } from "@/lib/bookings/firestore-client";
import type { BookingDetail } from "@/lib/bookings/types";
import { useAuth } from "@/lib/auth/auth-context";
import { usePageVisible } from "@/lib/notifications/use-page-visible";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const BOOKING_ROUTES = [
  "/dashboard/bookings",
  "/dashboard/calendar",
] as const;

function needsBookingsFeed(pathname: string | null): boolean {
  if (!pathname) return false;
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

export function BookingsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { role, businessId } = useAuth();
  const pageVisible = usePageVisible();
  const [bookings, setBookings] = useState<BookingDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabled =
    role === "business_owner" &&
    Boolean(businessId) &&
    needsBookingsFeed(pathname);

  useEffect(() => {
    if (!enabled || !businessId) {
      setBookings([]);
      setLoading(false);
      setError(null);
      return;
    }
    if (!pageVisible) return;

    setLoading(true);
    setError(null);
    const unsubscribe = subscribeBusinessBookings(
      businessId,
      (next) => {
        setBookings(next);
        setLoading(false);
        setError(null);
      },
      () => {
        setError("Could not load bookings.");
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [enabled, businessId, pageVisible]);

  const value = useMemo(
    () => ({ bookings, loading: enabled ? loading : false, error }),
    [bookings, loading, error, enabled],
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
