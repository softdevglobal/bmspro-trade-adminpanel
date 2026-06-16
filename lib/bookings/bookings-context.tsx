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

type BookingsSnapshot = {
  businessId: string;
  bookings: BookingDetail[];
};

type BookingsError = {
  businessId: string;
  message: string;
};

const BookingsContext = createContext<BookingsValue | null>(null);

/** Streams dashboard booking updates through one shared Firestore listener. */
export function BookingsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { role, businessId, user } = useAuth();
  const pageVisible = usePageVisible();
  const [snapshot, setSnapshot] = useState<BookingsSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState<BookingsError | null>(null);

  const enabled =
    role === "business_owner" &&
    Boolean(businessId) &&
    Boolean(user) &&
    needsBookingsFeed(pathname) &&
    pageVisible;

  useEffect(() => {
    if (!enabled || !businessId) {
      return;
    }

    const unsubscribe = subscribeBusinessBookings(
      businessId,
      (next) => {
        setSnapshot({ businessId, bookings: next });
        setSnapshotError(null);
      },
      () => {
        setSnapshotError({
          businessId,
          message: "Could not load bookings.",
        });
      },
    );

    return unsubscribe;
  }, [enabled, businessId]);

  const activeSnapshot =
    enabled && snapshot?.businessId === businessId ? snapshot : null;
  const activeError =
    enabled && snapshotError?.businessId === businessId
      ? snapshotError.message
      : null;

  const value = useMemo(
    () => ({
      bookings: activeSnapshot?.bookings ?? [],
      loading: enabled && !activeSnapshot && !activeError,
      error: activeError,
    }),
    [activeSnapshot, activeError, enabled],
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
