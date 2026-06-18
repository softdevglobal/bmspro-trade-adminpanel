"use client";

import type { CustomerBooking } from "@/app/api/customer/jobs/route";
import { useCustomerAuth } from "@/lib/customer-auth/customer-auth-context";
import {
  accountBookingFocusPath,
  accountPath,
  recallBookingSlug,
} from "@/lib/customer/booking-routes";
import { customerPendingActionBookings } from "@/lib/notifications/customer-pending-actions";
import { useCustomerNotifications } from "@/lib/notifications/use-customer-notifications";
import {
  notificationCardIcon,
  type NotificationRecord,
} from "@/lib/notifications/types";
import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type BannerAlert = {
  id: string;
  requestId: string;
  bookingSlug: string | null;
  title: string;
  body: string;
  icon: string;
  priority: number;
  scope: "active" | "history";
};

function notificationScope(
  note: Pick<NotificationRecord, "status" | "type">,
): "active" | "history" {
  if (
    note.status === "completed" ||
    note.status === "cancelled" ||
    note.type === "job_completed" ||
    note.type === "invoice_sent"
  ) {
    return "history";
  }
  return "active";
}

function bannerPriorityFromNotification(note: NotificationRecord): number {
  if (note.type === "quotation_sent" || note.status === "awaiting_decision") {
    return 0;
  }
  if (note.status === "owner_proposed" || note.type === "request_proposed") {
    return 1;
  }
  if (
    note.type === "visit_on_the_way" ||
    note.type === "booking_on_the_way"
  ) {
    return 2;
  }
  return 3;
}

function alertFromNotification(note: NotificationRecord): BannerAlert {
  return {
    id: `note:${note.id}`,
    requestId: note.requestId,
    bookingSlug: note.bookingSlug,
    title: note.title,
    body: note.body,
    icon: notificationCardIcon(note),
    priority: bannerPriorityFromNotification(note),
    scope: notificationScope(note),
  };
}

function pendingAlertsFromBookings(
  bookings: CustomerBooking[],
  bookingSlug: string,
): BannerAlert[] {
  return customerPendingActionBookings(bookings, bookingSlug).map((booking) => {
    const business = booking.businessName?.trim() || "The business";
    const service =
      booking.serviceName ?? booking.customRequest?.title ?? "your request";

    if (booking.status === "owner_proposed") {
      return {
        id: `pending:proposed:${booking.id}`,
        requestId: booking.id,
        bookingSlug: booking.bookingSlug,
        title: `${business} proposed new times`,
        body: `Pick a new visit time for ${service}.`,
        icon: "edit_calendar",
        priority: 1,
        scope: "active" as const,
      };
    }

    const quotation = booking.quotation;
    const priceLine =
      quotation && typeof quotation.finalPriceAud === "number"
        ? ` Total: $${quotation.finalPriceAud.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}.`
        : "";

    return {
      id: `pending:quotation:${booking.id}`,
      requestId: booking.id,
      bookingSlug: booking.bookingSlug,
      title: `${business} sent your quotation`,
      body: `Accept or reject the quote for ${service}.${priceLine}`,
      icon: "request_quote",
      priority: 0,
      scope: "active" as const,
    };
  });
}

function mergeBannerAlerts(
  notifications: NotificationRecord[],
  bookings: CustomerBooking[],
  bookingSlug: string,
): BannerAlert[] {
  const unreadNotes = notifications
    .filter((note) => !note.read)
    .map(alertFromNotification);

  const coveredRequestIds = new Set(unreadNotes.map((alert) => alert.requestId));
  const pending = pendingAlertsFromBookings(bookings, bookingSlug).filter(
    (alert) => !coveredRequestIds.has(alert.requestId),
  );

  return [...unreadNotes, ...pending].sort((a, b) => {
    const priorityDelta = a.priority - b.priority;
    if (priorityDelta !== 0) return priorityDelta;
    return 0;
  });
}

type Props = {
  bookingSlug: string;
};

/** BMS Black strip — unread updates and pending actions below the customer nav. */
export function CustomerNotificationBanner({ bookingSlug }: Props) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const { status, getIdToken } = useCustomerAuth();
  const { notifications, loading: notificationsLoading } =
    useCustomerNotifications();
  const [bookings, setBookings] = useState<CustomerBooking[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);

  const loadBookings = useCallback(async () => {
    if (status !== "authenticated") return;
    setBookingsLoading(true);
    try {
      const token = await getIdToken();
      if (!token) return;
      const response = await fetch(
        `/api/customer/jobs?bookingSlug=${encodeURIComponent(bookingSlug)}`,
        {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );
      const payload = (await response.json()) as {
        ok?: boolean;
        jobs?: CustomerBooking[];
      };
      if (response.ok && payload.ok) {
        setBookings(payload.jobs ?? []);
      }
    } catch {
      /* fallback is best-effort */
    } finally {
      setBookingsLoading(false);
    }
  }, [bookingSlug, getIdToken, status]);

  useEffect(() => {
    void loadBookings();
  }, [loadBookings]);

  const alerts = useMemo(
    () => mergeBannerAlerts(notifications, bookings, bookingSlug),
    [notifications, bookings, bookingSlug],
  );

  const primary = alerts[0] ?? null;
  const extraCount = alerts.length > 1 ? alerts.length - 1 : 0;
  const loading =
    status === "authenticated" &&
    notificationsLoading &&
    notifications.length === 0 &&
    bookingsLoading &&
    bookings.length === 0;

  if (status !== "authenticated" || loading || !primary) {
    return null;
  }

  function openAlert(alert: BannerAlert) {
    const target = alert.bookingSlug ?? bookingSlug ?? recallBookingSlug();
    if (!target) return;
    router.push(
      alert.requestId
        ? accountBookingFocusPath(target, alert.requestId, alert.scope)
        : accountPath(target, alert.scope === "history" ? "jobs" : "requests"),
    );
  }

  const notificationsHref = accountPath(bookingSlug, "notifications");

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="mt-2 w-full sm:mt-3"
    >
      <div className="relative overflow-hidden rounded-2xl bg-on-background shadow-[0_12px_36px_-14px_rgba(0,74,198,0.45)] ring-1 ring-primary/25 sm:rounded-[20px]">
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/30 via-primary/5 to-transparent"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-primary"
          aria-hidden
        />

        <button
          type="button"
          onClick={() => openAlert(primary)}
          className="relative flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.05] sm:gap-4 sm:px-5 sm:py-3.5"
        >
          <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/20 text-inverse-primary ring-1 ring-primary/30 sm:h-10 sm:w-10">
            <span className="material-symbols-outlined material-symbols-filled text-[20px]">
              {primary.icon}
            </span>
          </span>
          <span className="relative min-w-0 flex-1">
            <span className="block font-body text-[13px] font-bold leading-snug text-inverse-on-surface sm:text-[14px]">
              {primary.title}
            </span>
            <span className="mt-0.5 line-clamp-2 block font-body text-[11px] leading-relaxed text-inverse-on-surface/75 sm:text-[12px]">
              {primary.body}
            </span>
            {extraCount > 0 ? (
              <span className="mt-1 block font-body text-[10px] font-semibold uppercase tracking-wide text-inverse-on-surface/55">
                + {extraCount} more{" "}
                {extraCount === 1 ? "update" : "updates"}
              </span>
            ) : null}
          </span>
          <span className="material-symbols-outlined relative shrink-0 text-[20px] text-inverse-primary">
            chevron_right
          </span>
        </button>
        <div className="relative flex items-center justify-between border-t border-primary/20 px-4 py-2 sm:px-5">
          <p className="font-body text-[10px] font-semibold uppercase tracking-wider text-inverse-on-surface/50">
            BMS Pro Trade
          </p>
          <Link
            href={notificationsHref}
            className="font-body text-[11px] font-semibold text-inverse-primary transition-colors hover:text-inverse-on-surface"
          >
            View all
          </Link>
        </div>
      </div>
    </motion.div>
  );
}
