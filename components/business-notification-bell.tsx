"use client";

import { useAuth } from "@/lib/auth/auth-context";
import {
  NOTIFICATION_STATUS_ICON,
  NOTIFICATION_STATUS_TONE,
  type NotificationRecord,
} from "@/lib/notifications/types";
import { useCallback, useEffect, useRef, useState } from "react";

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

export function BusinessNotificationBell() {
  const { user, status } = useAuth();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const authed = status === "authenticated" && !!user;

  const token = useCallback(async () => {
    if (!user) return null;
    return user.getIdToken();
  }, [user]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const idToken = await user.getIdToken();
      const response = await fetch("/api/notifications", {
        headers: { authorization: `Bearer ${idToken}` },
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        notifications?: NotificationRecord[];
      };
      if (response.ok && payload.ok) {
        setNotifications(payload.notifications ?? []);
      }
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authed) {
      setNotifications([]);
      return;
    }
    void load();
    const interval = setInterval(() => void load(), 60_000);
    return () => clearInterval(interval);
  }, [authed, load]);

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

  if (!authed) {
    return (
      <button
        type="button"
        className="flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-low"
        aria-label="Notifications"
      >
        <span className="material-symbols-outlined">notifications</span>
      </button>
    );
  }

  const unread = notifications.filter((note) => !note.read).length;

  async function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      await load();
      if (unread > 0) {
        const idToken = await token();
        if (idToken) {
          void fetch("/api/notifications", {
            method: "PATCH",
            headers: { authorization: `Bearer ${idToken}` },
          });
        }
        setNotifications((current) =>
          current.map((note) => ({ ...note, read: true })),
        );
      }
    }
  }

  async function clearOne(id: string) {
    setBusyId(id);
    try {
      const idToken = await token();
      if (!idToken) return;
      const response = await fetch(`/api/notifications/${id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${idToken}` },
      });
      if (response.ok) {
        setNotifications((current) => current.filter((note) => note.id !== id));
      }
    } finally {
      setBusyId(null);
    }
  }

  async function clearAll() {
    setClearingAll(true);
    try {
      const idToken = await token();
      if (!idToken) return;
      const response = await fetch("/api/notifications", {
        method: "DELETE",
        headers: { authorization: `Bearer ${idToken}` },
      });
      if (response.ok) setNotifications([]);
    } finally {
      setClearingAll(false);
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => void handleToggle()}
        aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`}
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-low"
      >
        <span className="material-symbols-outlined">notifications</span>
        {unread > 0 ? (
          <span className="absolute right-1 top-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 font-body text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-[22rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border border-outline-variant bg-surface shadow-[0_24px_60px_-24px_rgba(25,27,35,0.45)]">
          <div className="flex items-center justify-between border-b border-outline-variant/60 px-4 py-3">
            <div>
              <p className="font-body text-[14px] font-bold text-on-surface">
                Notifications
              </p>
              <p className="font-body text-[11px] text-on-surface-variant">
                {unread > 0 ? `${unread} unread` : "You're all caught up"}
              </p>
            </div>
            {notifications.length > 0 ? (
              <button
                type="button"
                onClick={() => void clearAll()}
                disabled={clearingAll}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-body text-[11px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-rose-600 disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-[15px]">
                  {clearingAll ? "progress_activity" : "clear_all"}
                </span>
                Clear all
              </button>
            ) : null}
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="flex justify-center py-8">
                <span className="material-symbols-outlined animate-spin text-[20px] text-primary">
                  progress_activity
                </span>
              </div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <span className="material-symbols-outlined text-[28px] text-on-surface-variant">
                  notifications_off
                </span>
                <p className="mt-2 font-body text-[13px] font-semibold text-on-surface">
                  No notifications
                </p>
                <p className="mt-1 font-body text-[12px] text-on-surface-variant">
                  New inspection requests will appear here.
                </p>
              </div>
            ) : (
              <ul>
                {notifications.map((note) => (
                  <li
                    key={note.id}
                    className={`group flex gap-3 border-b border-outline-variant/40 px-4 py-3 last:border-b-0 ${
                      note.read ? "" : "bg-primary/[0.04]"
                    }`}
                  >
                    <span
                      className={`material-symbols-outlined material-symbols-filled mt-0.5 text-[20px] ${NOTIFICATION_STATUS_TONE[note.status]}`}
                    >
                      {NOTIFICATION_STATUS_ICON[note.status]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-body text-[13px] font-bold text-on-surface">
                        {note.title}
                      </p>
                      <p className="mt-0.5 font-body text-[12px] leading-snug text-on-surface-variant">
                        {note.body}
                      </p>
                      <p className="mt-1 font-body text-[10px] uppercase tracking-wide text-on-surface-variant">
                        {relativeTime(note.createdAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void clearOne(note.id)}
                      disabled={busyId === note.id}
                      aria-label="Clear notification"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-rose-600 disabled:opacity-60"
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        {busyId === note.id ? "progress_activity" : "close"}
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
