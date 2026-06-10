"use client";

import { useCustomerAuth } from "@/lib/customer-auth/customer-auth-context";
import { useCustomerNotifications } from "@/lib/notifications/use-customer-notifications";
import {
  NOTIFICATION_STATUS_ICON,
  NOTIFICATION_STATUS_TONE,
} from "@/lib/notifications/types";
import {
  accountBookingFocusPath,
  accountPath,
  parseBooknowSlug,
  recallBookingSlug,
} from "@/lib/customer/booking-routes";
import type { NotificationRecord } from "@/lib/notifications/types";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

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
  const router = useRouter();
  const { status } = useCustomerAuth();
  const {
    notifications,
    loading,
    unread,
    markAllRead,
    clearOne,
    clearAll,
  } = useCustomerNotifications();

  const fallbackSlug = useMemo(
    () => parseBooknowSlug(pathname) ?? recallBookingSlug(),
    [pathname],
  );
  const notificationsHref = fallbackSlug
    ? accountPath(fallbackSlug, "notifications")
    : "/account?tab=notifications";

  function openNotification(note: NotificationRecord) {
    setOpen(false);
    const target = note.bookingSlug ?? fallbackSlug;
    if (!target) return;
    const scope =
      note.status === "completed" || note.status === "cancelled"
        ? "history"
        : "active";
    router.push(
      note.requestId
        ? accountBookingFocusPath(target, note.requestId, scope)
        : accountPath(target, scope === "history" ? "jobs" : "requests"),
    );
  }

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

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

  function handleToggle() {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        void markAllRead();
      }
      return next;
    });
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={handleToggle}
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
            <div className="flex items-center gap-1.5">
              {notifications.length > 0 ? (
                <button
                  type="button"
                  onClick={() => void clearAll()}
                  className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 font-body text-[11px] font-semibold text-on-surface-variant transition-colors hover:bg-stone-100 hover:text-rose-600"
                >
                  <span className="material-symbols-outlined text-[14px]">
                    clear_all
                  </span>
                  Clear all
                </button>
              ) : null}
              <Link
                href={notificationsHref}
                onClick={() => setOpen(false)}
                className="font-body text-[11px] font-semibold text-primary hover:underline"
              >
                View all
              </Link>
            </div>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {loading && notifications.length === 0 ? (
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
                {notifications.slice(0, 10).map((note) => (
                  <li
                    key={note.id}
                    className={`group flex items-stretch gap-1 border-b border-stone-100 last:border-b-0 ${
                      note.read ? "" : "bg-primary/5"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => openNotification(note)}
                      className="flex min-w-0 flex-1 gap-2 px-3 py-2.5 text-left transition-colors hover:bg-stone-50"
                    >
                      <span
                        className={`material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] ${NOTIFICATION_STATUS_TONE[note.status]}`}
                      >
                        {NOTIFICATION_STATUS_ICON[note.status]}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 block font-body text-[13px] font-semibold text-on-surface">
                          {note.title}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block font-body text-[11px] text-on-surface-variant">
                          {note.body}
                        </span>
                        <span className="mt-1 block font-body text-[10px] uppercase tracking-wide text-on-surface-variant">
                          {relativeTime(note.createdAt)}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void clearOne(note.id)}
                      aria-label="Clear notification"
                      className="my-2 mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center self-start rounded-full text-on-surface-variant transition-colors hover:bg-stone-100 hover:text-rose-600"
                    >
                      <span className="material-symbols-outlined text-[15px]">
                        close
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
