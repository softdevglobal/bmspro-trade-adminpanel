"use client";

import { EmailConnectionSettings } from "@/components/email-connection-settings";
import { EmailSendRow } from "@/components/email-send-row";
import { MailboxPanel } from "@/components/mailbox-panel";
import { useAuth } from "@/lib/auth/auth-context";
import {
  emailApi,
  PENDING_EMAIL_STATUSES,
  useEmailSending,
} from "@/lib/email-integration/client";
import type { EmailSendHistoryItem } from "@/lib/email-integration/types";
import { useCallback, useEffect, useState } from "react";

type EmailFilter = "all" | "attention" | "in_progress" | "accepted";
type EmailTab = "mailbox" | "log";

const TABS: { value: EmailTab; label: string; icon: string }[] = [
  { value: "mailbox", label: "Mailbox", icon: "mail" },
  { value: "log", label: "Send log", icon: "receipt_long" },
];

const FILTERS: { value: EmailFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "attention", label: "Needs attention" },
  { value: "in_progress", label: "Sending" },
  { value: "accepted", label: "Accepted" },
];

const EMPTY_MESSAGES: Record<EmailFilter, string> = {
  all: "No emails sent yet. Open a sent quote or invoice and choose Send by email.",
  attention: "Nothing needs attention.",
  in_progress: "No emails are waiting to send.",
  accepted: "No emails have been accepted yet.",
};

/** Every quote, invoice and test email sent from the business's mailbox. */
export function EmailsBoard() {
  const { user } = useAuth();
  const { loading: settingsLoading, enabled } = useEmailSending();
  const [tab, setTab] = useState<EmailTab>("mailbox");
  const [filter, setFilter] = useState<EmailFilter>("all");
  const [items, setItems] = useState<EmailSendHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      if (!user) return null;
      const params = new URLSearchParams({ filter });
      if (cursor) params.set("cursor", cursor);
      return emailApi<{ items: EmailSendHistoryItem[]; nextCursor: string | null }>(
        user,
        `/api/email/outbox?${params}`,
      );
    },
    [user, filter],
  );

  const reload = useCallback(async () => {
    try {
      const page = await fetchPage(null);
      if (!page) return;
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load emails.");
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    if (!enabled) return;
    queueMicrotask(() => {
      setLoading(true);
      void reload();
    });
  }, [enabled, reload]);

  // Refresh while anything on screen is still sending.
  const hasPending = items.some((item) => PENDING_EMAIL_STATUSES.includes(item.status));
  useEffect(() => {
    if (!hasPending) return;
    const timer = window.setInterval(() => void reload(), 5000);
    return () => window.clearInterval(timer);
  }, [hasPending, reload]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(nextCursor);
      if (!page) return;
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load more emails.");
    } finally {
      setLoadingMore(false);
    }
  }

  if (settingsLoading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <span className="material-symbols-outlined animate-spin text-[28px] text-primary">
          progress_activity
        </span>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="rounded-2xl border border-outline-variant/60 bg-surface-container-lowest px-5 py-8 text-center">
        <p className="font-body text-[14px] font-semibold text-on-surface">
          Email sending isn&apos;t enabled for your business yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <EmailConnectionSettings returnTo="emails" />

      <div role="tablist" aria-label="Email views" className="flex gap-1 border-b border-outline-variant/60">
        {TABS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={tab === option.value}
            onClick={() => setTab(option.value)}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 font-body text-[13px] font-semibold transition-colors ${
              tab === option.value
                ? "border-primary text-primary"
                : "border-transparent text-on-surface-variant hover:text-on-surface"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">{option.icon}</span>
            {option.label}
          </button>
        ))}
      </div>

      {tab === "mailbox" ? <MailboxPanel /> : null}

      {tab === "log" ? (
        <>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              if (option.value === filter) return;
              setFilter(option.value);
              setItems([]);
              setNextCursor(null);
            }}
            className={`rounded-full border px-3.5 py-1.5 font-body text-[13px] font-semibold transition-colors ${
              filter === option.value
                ? "border-primary bg-primary text-on-primary"
                : "border-outline-variant/60 bg-white text-on-surface hover:bg-surface-container-low"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 font-body text-[12px] text-rose-700"
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-24 animate-pulse rounded-lg bg-surface-container-low" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-outline-variant/60 px-5 py-8 text-center font-body text-[13px] text-on-surface-variant">
          {EMPTY_MESSAGES[filter]}
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id}>
              <EmailSendRow item={item} showDocument onChanged={reload} />
            </li>
          ))}
        </ul>
      )}

      {nextCursor && !loading ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-outline-variant px-4 font-body text-[13px] font-semibold text-on-surface hover:bg-surface-container-low disabled:opacity-60"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
        </>
      ) : null}
    </div>
  );
}
