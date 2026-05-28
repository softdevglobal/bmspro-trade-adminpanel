"use client";

import type { CustomerBooking } from "@/app/api/customer/bookings/route";
import { useCustomerAuth } from "@/lib/customer-auth/customer-auth-context";
import {
  buildCustomerNotifications,
  countUnread,
  readLastSeenAt,
  writeLastSeenAt,
  type CustomerNotification,
} from "@/lib/customer/notifications";
import {
  accountPath,
  parseBooknowSlug,
  recallBookingSlug,
} from "@/lib/customer/booking-routes";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const STATUS_TONE: Record<CustomerNotification["status"], string> = {
  pending: "text-amber-700",
  owner_proposed: "text-violet-700",
  scheduled: "text-emerald-700",
  cancelled: "text-stone-600",
  completed: "text-primary",
};

const STATUS_ICON: Record<CustomerNotification["status"], string> = {
  pending: "schedule",
  owner_proposed: "edit_calendar",
  scheduled: "event_available",
  cancelled: "event_busy",
  completed: "check_circle",
};

function relativeTime(timestamp: number): string {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function CustomerNotificationBell() {
  const pathname = usePathname();
  const { status, getIdToken } = useCustomerAuth();
  const notificationsHref = useMemo(() => {
    const slug = parseBooknowSlug(pathname) ?? recallBookingSlug();
    return slug
      ? accountPath(slug, "notifications")
      : "/account?tab=notifications";
  }, [pathname]);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<CustomerNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastSeen, setLastSeen] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (status !== "authenticated") return;
    setLoading(true);
    try {
      const idToken = await getIdToken();
      if (!idToken) return;
      const response = await fetch("/api/customer/bookings", {
        headers: { authorization: `Bearer ${idToken}` },
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        bookings?: CustomerBooking[];
      };
      if (!response.ok || !payload.ok) return;
      setNotifications(buildCustomerNotifications(payload.bookings ?? []));
    } finally {
      setLoading(false);
    }
  }, [status, getIdToken]);

  useEffect(() => {
    setLastSeen(readLastSeenAt());
  }, []);

  useEffect(() => {
    if (status === "authenticated") {
      void load();
    } else {
      setNotifications([]);
    }
  }, [status, load]);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  if (status !== "authenticated") return null;

  const unread = countUnread(notifications, lastSeen);

  function handleOpen() {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        void load();
      } else {
        const top = notifications[0]?.timestamp ?? Date.now();
        writeLastSeenAt(top);
        setLastSeen(top);
      }
      return next;
    });
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={handleOpen}
        aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-stone-200 bg-white/95 shadow-sm backdrop-blur transition-all hover:scale-105 hover:bg-white"
      >
        <span className="material-symbols-outlined material-symbols-filled text-[18px] text-stone-700">
          notifications
        </span>
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 font-body text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-40 mt-2 w-[20rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_24px_60px_-24px_rgba(31,29,26,0.25)]">
          <div className="flex items-center justify-between border-b border-stone-100 px-3 py-2.5">
            <p className="font-body text-[13px] font-bold text-on-surface">
              Notifications
            </p>
            <Link
              href={notificationsHref}
              onClick={() => setOpen(false)}
              className="font-body text-[11px] font-semibold text-primary hover:underline"
            >
              View all
            </Link>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-6">
                <span className="material-symbols-outlined animate-spin text-[20px] text-primary">
                  progress_activity
                </span>
              </div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <span className="material-symbols-outlined text-[24px] text-on-surface-variant">
                  notifications_off
                </span>
                <p className="mt-1 font-body text-[12px] text-on-surface-variant">
                  Nothing here yet.
                </p>
              </div>
            ) : (
              <ul>
                {notifications.slice(0, 8).map((note) => {
                  const isUnread = note.timestamp > lastSeen;
                  return (
                    <li
                      key={note.id}
                      className={`flex gap-2 border-b border-stone-100 px-3 py-2.5 last:border-b-0 ${
                        isUnread ? "bg-primary/5" : ""
                      }`}
                    >
                      <span
                        className={`material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] ${
                          STATUS_TONE[note.status]
                        }`}
                      >
                        {STATUS_ICON[note.status]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 font-body text-[13px] font-semibold text-on-surface">
                          {note.title}
                        </p>
                        <p className="mt-0.5 line-clamp-2 font-body text-[11px] text-on-surface-variant">
                          {note.body}
                        </p>
                        <p className="mt-1 font-body text-[10px] uppercase tracking-wide text-on-surface-variant">
                          {relativeTime(note.timestamp)}
                        </p>
                      </div>
                      {isUnread ? (
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
