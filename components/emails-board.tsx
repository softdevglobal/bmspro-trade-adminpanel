"use client";

import { EmailConnectionSettings } from "@/components/email-connection-settings";
import { EmailSendRow } from "@/components/email-send-row";
import { EmailSophieQueue, useSophieEmailAvailable } from "@/components/email-sophie-queue";
import { MailboxPanel } from "@/components/mailbox-panel";
import { emailsBoardVoice, type EmailsBoardState } from "@/lib/ai/owner-call/owner-email";
import { useAuth } from "@/lib/auth/auth-context";
import { usePageVisible } from "@/lib/notifications/use-page-visible";
import {
  emailApi,
  PENDING_EMAIL_STATUSES,
  useEmailSending,
} from "@/lib/email-integration/client";
import type { EmailSendHistoryItem } from "@/lib/email-integration/types";
import { useCallback, useEffect, useRef, useState } from "react";

type EmailFilter = "all" | "attention" | "in_progress" | "accepted";
type EmailTab = "mailbox" | "log" | "sophie";

const TABS: { value: EmailTab; label: string; icon: string }[] = [
  { value: "mailbox", label: "Mailbox", icon: "mail" },
  { value: "log", label: "Send log", icon: "receipt_long" },
];
/** Shown when Sophie's email sorting is switched on for the platform. */
const SOPHIE_TAB = { value: "sophie" as const, label: "Sophie", icon: "smart_toy" };

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
  const visible = usePageVisible();
  const { loading: settingsLoading, enabled } = useEmailSending();
  const [tab, setTab] = useState<EmailTab>("mailbox");
  const [filter, setFilter] = useState<EmailFilter>("all");
  const [items, setItems] = useState<EmailSendHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // For Talk to Sophie: which filter last finished loading, and a count of finished loads.
  const [loadedFilter, setLoadedFilter] = useState<EmailFilter | null>(null);
  const [loadSeq, setLoadSeq] = useState(0);
  const sophieAvailable = useSophieEmailAvailable();
  const tabs = sophieAvailable ? [...TABS, SOPHIE_TAB] : TABS;

  useEffect(() => {
    // Sophie's pushes link to /dashboard/emails?tab=sophie.
    if (new URLSearchParams(window.location.search).get("tab") === "sophie") {
      queueMicrotask(() => setTab("sophie"));
    }
  }, []);

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
      setLoadedFilter(filter);
      setLoadSeq((value) => value + 1);
    }
  }, [fetchPage, filter]);

  useEffect(() => {
    if (!enabled || !visible) return;
    queueMicrotask(() => {
      setLoading(true);
      void reload();
    });
  }, [enabled, visible, reload]);

  // Refresh while anything on screen is still sending.
  const hasPending = items.some((item) => PENDING_EMAIL_STATUSES.includes(item.status));
  useEffect(() => {
    if (!enabled || !visible || !hasPending) return;
    const timer = window.setInterval(() => void reload(), 5000);
    return () => window.clearInterval(timer);
  }, [enabled, visible, hasPending, reload]);

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
      setLoadSeq((value) => value + 1);
    }
  }

  // Talk to Sophie switches tabs and reads the Send log through emailsBoardVoice (lib/ai/owner-call/owner-email.ts).
  const live = useRef<EmailsBoardState | null>(null);
  const latest = useRef({ reload, loadMore });
  useEffect(() => {
    live.current = {
      ready: !settingsLoading, enabled, tab,
      log: { filter, loadedFilter, loading, loadingMore, loadSeq, items, hasMore: Boolean(nextCursor), error },
    };
    latest.current = { reload, loadMore };
  });
  useEffect(() => emailsBoardVoice.register({
    state: () => live.current!,
    setTab: (next) => setTab(next),
    showLog(next) {
      if (next === live.current?.log.filter) return false;
      setFilter(next);
      setItems([]);
      setNextCursor(null);
      return true;
    },
    moreLog() {
      if (!live.current?.log.hasMore) return false;
      void latest.current.loadMore();
      return true;
    },
    reloadLog: () => void latest.current.reload(),
  }), []);

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
        {tabs.map((option) => (
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

      {tab === "sophie" ? <EmailSophieQueue onEmailCustomer={() => setTab("mailbox")} /> : null}

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
