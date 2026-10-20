"use client";

import { EmailHtmlFrame } from "@/components/email-html-frame";
import { AttachmentGallery, useInlineImages } from "@/components/mail-attachments";
import { MailComposer, type ComposerDraft } from "@/components/mail-composer";
import { MailCustomerPanel, MatchChip } from "@/components/mail-customer-panel";
import { useAuth } from "@/lib/auth/auth-context";
import { emailApi, EmailApiError, providerInfo, useEmailSending } from "@/lib/email-integration/client";
import type {
  MailboxAction,
  MailboxMessageSummary,
  MailboxSyncStatus,
  MailboxThreadMessage,
  MailboxView,
} from "@/lib/email-integration/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const BUTTON_PRIMARY =
  "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60";
const BUTTON_OUTLINE =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-outline-variant px-3 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-60";
const ICON_BUTTON =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-50";

const VIEWS: { value: MailboxView; label: string; icon: string }[] = [
  { value: "inbox", label: "Inbox", icon: "inbox" },
  { value: "starred", label: "Starred", icon: "star" },
  { value: "sent", label: "Sent", icon: "send" },
  { value: "archive", label: "Archive", icon: "archive" },
  { value: "trash", label: "Trash", icon: "delete" },
];

function formatListDate(timestamp: number | null): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

function formatFullDate(timestamp: number | null): string {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function initials(name: string | null, address: string): string {
  const source = (name || address).trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Left accent colour for linked rows: quote, invoice, or customer. */
function accentFor(message: MailboxMessageSummary): string {
  if (message.match.document?.type === "quote") return "border-l-violet-500";
  if (message.match.document?.type === "invoice") return "border-l-emerald-500";
  if (message.match.method !== "none") return "border-l-primary";
  return "border-l-transparent";
}

/** The connected mailbox (Gmail, Outlook or Yahoo), labelled with each conversation's link to the platform. */
export function MailboxPanel() {
  const { user } = useAuth();
  const { loading, connection, reload } = useEmailSending();
  const [enabling, setEnabling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ComposerDraft | null>(null);
  const [sentCount, setSentCount] = useState(0);

  const startUpgrade = useCallback(async () => {
    if (!user || !connection) return;
    setEnabling(true);
    setError(null);
    try {
      const { url } = await emailApi<{ url: string }>(
        user,
        `/api/email/connections/${encodeURIComponent(connection.id)}/enable-inbox`,
        { method: "POST", body: JSON.stringify({ return_to: "emails" }) },
      );
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the request.");
      setEnabling(false);
    }
  }, [user, connection]);

  if (loading) return null;

  if (!connection) {
    return (
      <p className="rounded-2xl border border-dashed border-outline-variant/60 px-5 py-8 text-center font-body text-[13px] text-on-surface-variant">
        Connect Gmail, Outlook or Yahoo Mail above to use your mailbox here.
      </p>
    );
  }

  const canRead = connection.capabilities.includes("read");
  const canModify = connection.capabilities.includes("modify");
  const composer = draft ? (
    <MailComposer
      draft={draft}
      fromAddress={connection.address}
      canForwardAttachments={canRead}
      onClose={() => setDraft(null)}
      onSent={() => {
        setDraft(null);
        setSentCount((value) => value + 1);
      }}
    />
  ) : null;

  if (!canRead) {
    return (
      <div className="space-y-3">
        <div className="space-y-3 rounded-2xl border border-outline-variant/60 bg-surface-container-lowest px-5 py-5">
          <div>
            <p className="font-body text-[14px] font-semibold text-on-surface">Use your whole mailbox here</p>
            <p className="mt-1 font-body text-[12px] leading-relaxed text-on-surface-variant">
              This asks {providerInfo(connection.provider)?.company ?? "your email provider"} for permission to read and organise {connection.address}.
              All your mail is imported (spam and drafts excepted), and email with
              your customers is linked to their quotes, invoices and jobs. Only
              business owners can see it, message contents are read from your mailbox when
              opened and not stored, and disconnecting removes everything imported.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void startUpgrade()} disabled={enabling} className={BUTTON_PRIMARY}>
              {enabling ? "Opening sign-in…" : "Enable mailbox"}
            </button>
            <button type="button" onClick={() => setDraft({ intent: "new" })} className={BUTTON_OUTLINE}>
              <span className="material-symbols-outlined text-[18px]">edit</span>
              New email
            </button>
          </div>
          {error ? (
            <p role="alert" className="font-body text-[12px] text-rose-700">
              {error}
            </p>
          ) : null}
        </div>
        {composer}
      </div>
    );
  }

  return (
    <>
      {!canModify ? (
        <div className="mb-3 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-body text-[12px] text-amber-900">
            To mark read, star, archive or delete from here, allow BMS Pro Trade to organise your mail.
          </p>
          <button type="button" onClick={() => void startUpgrade()} disabled={enabling} className={BUTTON_OUTLINE}>
            {enabling ? "Opening sign-in…" : "Allow"}
          </button>
        </div>
      ) : null}
      <Mailbox
        connectionId={connection.id}
        canModify={canModify}
        sentCount={sentCount}
        onCompose={setDraft}
        onNeedsReconnect={() => void reload()}
      />
      {composer}
    </>
  );
}

function Mailbox({
  connectionId,
  canModify,
  sentCount,
  onCompose,
  onNeedsReconnect,
}: {
  connectionId: string;
  canModify: boolean;
  sentCount: number;
  onCompose: (draft: ComposerDraft) => void;
  onNeedsReconnect: () => void;
}) {
  const { user } = useAuth();
  const [view, setView] = useState<MailboxView>("inbox");
  const [linkedOnly, setLinkedOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [items, setItems] = useState<MailboxMessageSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<MailboxSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MailboxMessageSummary | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const listPath = useCallback(
    (cursor: string | null) => {
      const params = new URLSearchParams();
      if (activeSearch) params.set("q", activeSearch);
      else {
        params.set("view", view);
        if (linkedOnly) params.set("linked", "1");
      }
      if (cursor) params.set("cursor", cursor);
      return `/api/email/mailbox?${params}`;
    },
    [view, linkedOnly, activeSearch],
  );

  const load = useCallback(async () => {
    if (!user) return null;
    try {
      const page = await emailApi<{
        items: MailboxMessageSummary[];
        nextCursor: string | null;
        status: MailboxSyncStatus;
      }>(user, listPath(null));
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setStatus(page.status);
      setError(null);
      return page.status;
    } catch (err) {
      if (err instanceof EmailApiError && err.code === "needs_reconnect") onNeedsReconnect();
      setError(err instanceof Error ? err.message : "Could not load messages.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [user, listPath, onNeedsReconnect]);

  /**
   * One sync step. Importing past mail runs in steps of ~40 seconds; while this
   * page is open the next step starts as soon as one finishes. `manual` is a
   * "Sync now" click; automatic steps are not limited to one per 15 seconds.
   */
  const syncNow = useCallback(
    async (manual = true) => {
      if (!user) return;
      setSyncing(true);
      if (manual) setError(null);
      try {
        const result = await emailApi<{ status: MailboxSyncStatus }>(
          user,
          `/api/email/connections/${encodeURIComponent(connectionId)}/sync`,
          { method: "POST", body: JSON.stringify({ continue: !manual }) },
        );
        setStatus(result.status);
        await load();
      } catch (err) {
        // Busy, too soon and "slow down" from the provider are normal while
        // importing; the status bar explains them, so no red error.
        const quiet =
          err instanceof EmailApiError &&
          (err.code === "busy" || err.code === "too_soon" || err.code === "rate_limited");
        if (quiet) await load();
        else setError(err instanceof Error ? err.message : "Could not sync the mailbox.");
      } finally {
        setSyncing(false);
      }
    },
    [user, connectionId, load],
  );

  useEffect(() => {
    queueMicrotask(async () => {
      setLoading(true);
      setItems([]);
      await load();
    });
  }, [load]);

  // Keep importing while past mail is incomplete and the page is open; wait
  // out a provider "slow down" pause first. Otherwise refresh once a minute.
  const importing = status ? !status.historyComplete : false;
  useEffect(() => {
    if (!status || syncing) return;
    const pause = status.pausedUntil ? Math.max(0, status.pausedUntil - Date.now()) + 1000 : 0;
    const delay = importing ? Math.max(pause, 2000) : 60_000;
    const timer = window.setTimeout(() => {
      if (mounted.current) void (importing ? syncNow(false) : load());
    }, delay);
    return () => window.clearTimeout(timer);
  }, [status, importing, syncing, syncNow, load]);

  // After sending, the copy lands in Sent within a few seconds.
  useEffect(() => {
    if (sentCount === 0) return;
    const timers = [4000, 12_000].map((delay) => window.setTimeout(() => void load(), delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [sentCount, load]);

  async function loadMore() {
    if (!user || !nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await emailApi<{ items: MailboxMessageSummary[]; nextCursor: string | null }>(
        user,
        listPath(nextCursor),
      );
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load more messages.");
    } finally {
      setLoadingMore(false);
    }
  }

  const runAction = useCallback(
    async (threadId: string, action: MailboxAction) => {
      if (!user) return false;
      try {
        await emailApi(user, `/api/email/mailbox/threads/${encodeURIComponent(threadId)}/actions`, {
          method: "POST",
          body: JSON.stringify({ action }),
        });
        await load();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "That action didn't work. Try again.");
        return false;
      }
    },
    [user, load],
  );

  // One row per conversation; the newest message represents it.
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.threadId)) return false;
      seen.add(item.threadId);
      return true;
    });
  }, [items]);

  const listPane = (
    <div className="flex min-h-0 flex-col">
      {error ? (
        <p role="alert" className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 font-body text-[12px] text-rose-700">
          {error}
        </p>
      ) : null}
      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="h-[72px] animate-pulse rounded-lg bg-surface-container-low" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-outline-variant/60 px-5 py-12 text-center">
          <span className="material-symbols-outlined text-[36px] text-on-surface-variant">
            {importing ? "cloud_download" : activeSearch ? "search_off" : "inbox"}
          </span>
          <p className="mt-2 font-body text-[13px] text-on-surface-variant">
            {importing
              ? "Importing your mailbox… messages appear here as they arrive."
              : activeSearch
                ? `No email matches “${activeSearch}”.`
                : linkedOnly
                  ? "No customer or BMS Pro email here."
                  : `Nothing in ${VIEWS.find((item) => item.value === view)?.label ?? "this folder"}.`}
          </p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-outline-variant/60 bg-white">
          {rows.map((item, index) => (
            <li
              key={item.id}
              className={`border-l-4 ${accentFor(item)} ${index > 0 ? "border-t border-t-outline-variant/40" : ""} ${
                item.unread ? "bg-white" : "bg-surface-container-lowest"
              }`}
            >
              <div className="flex items-start gap-2.5 px-3 py-3">
                <button
                  type="button"
                  aria-label={item.starred ? "Unstar" : "Star"}
                  disabled={!canModify}
                  onClick={() => void runAction(item.threadId, item.starred ? "unstar" : "star")}
                  className="mt-2 shrink-0 text-on-surface-variant hover:text-amber-500 disabled:cursor-default disabled:hover:text-on-surface-variant"
                >
                  <span
                    className={`material-symbols-outlined text-[19px] ${item.starred ? "text-amber-500" : ""}`}
                    style={item.starred ? { fontVariationSettings: "'FILL' 1" } : undefined}
                  >
                    star
                  </span>
                </button>
                <span
                  className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-body text-[12px] font-bold ${
                    item.match.method !== "none" ? "bg-primary text-white" : "bg-surface-container text-on-surface-variant"
                  }`}
                  aria-hidden
                >
                  {item.folder === "sent" ? "↗" : initials(item.fromName, item.fromAddress)}
                </span>
                <button type="button" onClick={() => setSelected(item)} className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className={`min-w-0 truncate font-body text-[13px] text-on-surface ${item.unread ? "font-bold" : "font-medium"}`}>
                      {item.folder === "sent" ? `To: ${item.to || "—"}` : item.fromName || item.fromAddress}
                    </span>
                    <span className={`shrink-0 font-body text-[11px] ${item.unread ? "font-bold text-primary" : "text-on-surface-variant"}`}>
                      {formatListDate(item.date)}
                    </span>
                  </span>
                  <span className={`flex items-center gap-1.5 font-body text-[13px] text-on-surface ${item.unread ? "font-semibold" : ""}`}>
                    <span className="truncate">{item.subject || "(no subject)"}</span>
                    {item.hasAttachments ? (
                      <span className="material-symbols-outlined shrink-0 text-[15px] text-on-surface-variant">attach_file</span>
                    ) : null}
                  </span>
                  <span className="flex min-w-0 items-center gap-2">
                    <MatchChip match={item.match} compact />
                    <span className="truncate font-body text-[12px] text-on-surface-variant">{item.snippet}</span>
                  </span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {nextCursor && !loading ? (
        <div className="mt-3 flex justify-center">
          <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className={BUTTON_OUTLINE}>
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
      <aside className="min-w-0 space-y-3">
        <button type="button" onClick={() => onCompose({ intent: "new" })} className={`${BUTTON_PRIMARY} w-full`}>
          <span className="material-symbols-outlined text-[18px]">edit</span>
          New email
        </button>
        <nav aria-label="Mail folders" className="grid grid-cols-5 gap-1 lg:flex lg:flex-col">
          {VIEWS.map((option) => {
            const active = !activeSearch && view === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setView(option.value);
                  setActiveSearch("");
                  setSearch("");
                  setSelected(null);
                }}
                className={`inline-flex min-w-0 flex-col items-center gap-0.5 rounded-xl px-1 py-2 font-body text-[11px] font-semibold transition-colors lg:flex-row lg:gap-2 lg:rounded-l-none lg:rounded-r-full lg:px-3 lg:text-[13px] ${
                  active ? "bg-primary/10 text-primary" : "text-on-surface-variant hover:bg-surface-container"
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">{option.icon}</span>
                {option.label}
              </button>
            );
          })}
        </nav>
        <div className="hidden space-y-1.5 rounded-xl border border-outline-variant/50 px-3 py-2.5 lg:block">
          <p className="font-body text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Labels</p>
          {[
            { tone: "bg-violet-500", label: "Quote conversation" },
            { tone: "bg-emerald-500", label: "Invoice conversation" },
            { tone: "bg-primary", label: "Customer" },
          ].map((legend) => (
            <p key={legend.label} className="flex items-center gap-2 font-body text-[11px] text-on-surface-variant">
              <span className={`h-2.5 w-2.5 rounded-full ${legend.tone}`} />
              {legend.label}
            </p>
          ))}
        </div>
      </aside>

      <section className="min-w-0 space-y-3">
        {importing ? (
          <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5">
            <span className={`material-symbols-outlined text-[20px] text-primary ${status?.pausedUntil ? "" : "animate-spin"}`}>
              {status?.pausedUntil ? "hourglass_top" : "progress_activity"}
            </span>
            <p className="font-body text-[12px] text-on-surface">
              <span className="font-semibold">Importing your mailbox</span> ·{" "}
              {(status?.imported ?? 0).toLocaleString("en-AU")} emails so far.{" "}
              {status?.pausedUntil
                ? `Your email provider asked us to slow down, so importing continues at ${new Date(status.pausedUntil).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}. Everything already imported is ready to use.`
                : "Customer and BMS Pro conversations come first; the rest of your history follows."}
            </p>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <form
            className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-outline-variant bg-white px-3"
            onSubmit={(event) => {
              event.preventDefault();
              setSelected(null);
              setActiveSearch(search.trim());
            }}
          >
            <span className="material-symbols-outlined text-[18px] text-on-surface-variant">search</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search all mail"
              aria-label="Search all mail"
              className="h-10 min-w-0 flex-1 bg-transparent font-body text-[13px] text-on-surface outline-none"
            />
            {activeSearch ? (
              <button
                type="button"
                aria-label="Clear search"
                className="text-on-surface-variant hover:text-on-surface"
                onClick={() => {
                  setSearch("");
                  setActiveSearch("");
                }}
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            ) : null}
          </form>
          <div className="flex items-center justify-between gap-2 sm:justify-end">
            <button
              type="button"
              role="switch"
              aria-checked={linkedOnly}
              disabled={Boolean(activeSearch)}
              onClick={() => {
                setLinkedOnly((value) => !value);
                setSelected(null);
              }}
              className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 font-body text-[12px] font-semibold transition-colors disabled:opacity-50 ${
                linkedOnly ? "border-primary bg-primary text-white" : "border-outline-variant text-on-surface hover:bg-surface-container"
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">hub</span>
              Customers only
            </button>
            <button type="button" onClick={() => void syncNow(true)} disabled={syncing} className={ICON_BUTTON} aria-label="Sync now" title={status?.lastSuccessAt ? `Synced ${formatListDate(status.lastSuccessAt)}` : "Sync now"}>
              <span className={`material-symbols-outlined text-[20px] ${syncing ? "animate-spin" : ""}`}>sync</span>
            </button>
          </div>
        </div>

        {selected ? (
          <ThreadView
            key={selected.threadId}
            summary={selected}
            canModify={canModify}
            onBack={() => setSelected(null)}
            onCompose={onCompose}
            onAction={async (action) => {
              const ok = await runAction(selected.threadId, action);
              if (ok && (action === "archive" || action === "trash" || action === "untrash" || action === "move_to_inbox")) {
                setSelected(null);
              }
              return ok;
            }}
          />
        ) : (
          listPane
        )}
      </section>
    </div>
  );
}

function ThreadView({
  summary,
  canModify,
  onBack,
  onCompose,
  onAction,
}: {
  summary: MailboxMessageSummary;
  canModify: boolean;
  onBack: () => void;
  onCompose: (draft: ComposerDraft) => void;
  onAction: (action: MailboxAction) => Promise<boolean>;
}) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<MailboxThreadMessage[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const markedRead = useRef(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    queueMicrotask(async () => {
      try {
        const payload = await emailApi<{ messages: MailboxThreadMessage[] }>(
          user,
          `/api/email/mailbox/threads/${encodeURIComponent(summary.threadId)}`,
        );
        if (!active) return;
        setMessages(payload.messages);
        // Newest message open; older ones collapsed, except unread ones.
        const open = new Set<string>(payload.messages.filter((message) => message.unread).map((message) => message.id));
        const last = payload.messages[payload.messages.length - 1];
        if (last) open.add(last.id);
        setExpanded(open);
        // Opening a conversation marks it read in the mailbox too, like Gmail and Outlook do.
        if (canModify && !markedRead.current && payload.messages.some((message) => message.unread)) {
          markedRead.current = true;
          void onAction("mark_read");
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Could not load this conversation.");
      }
    });
    return () => {
      active = false;
    };
    // onAction is stable per selection; re-running would re-mark read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, summary.threadId, canModify]);

  const latest = messages?.[messages.length - 1] ?? null;
  const folder = latest?.folder ?? summary.folder;
  const starred = messages?.some((message) => message.starred) ?? summary.starred;
  // The most specific link in the thread (a quote/invoice beats a customer).
  const match =
    messages?.find((message) => message.match.document?.type)?.match ??
    messages?.find((message) => message.match.method !== "none")?.match ??
    summary.match;

  async function act(action: MailboxAction) {
    setBusy(true);
    const ok = await onAction(action);
    if (ok && messages && (action === "star" || action === "unstar" || action === "mark_unread")) {
      setMessages(
        messages.map((message) => ({
          ...message,
          starred: action === "star" ? true : action === "unstar" ? false : message.starred,
          unread: action === "mark_unread" ? true : message.unread,
        })),
      );
      if (action === "mark_unread") onBack();
    }
    setBusy(false);
  }

  function compose(intent: "reply" | "reply_all" | "forward", message: MailboxThreadMessage) {
    onCompose(
      intent === "forward"
        ? { intent: "forward", source: message }
        : { intent: "reply", replyAll: intent === "reply_all", source: message },
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <article className="min-w-0 overflow-hidden rounded-2xl border border-outline-variant/60 bg-white">
        <header className="flex flex-wrap items-center gap-1 border-b border-outline-variant/50 px-2 py-2">
          <button type="button" onClick={onBack} className={ICON_BUTTON} aria-label="Back to list" title="Back">
            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
          </button>
          <div className="mx-1 h-6 w-px bg-outline-variant/60" />
          {folder === "trash" ? (
            <button type="button" disabled={!canModify || busy} onClick={() => void act("untrash")} className={ICON_BUTTON} title="Restore from Trash" aria-label="Restore from Trash">
              <span className="material-symbols-outlined text-[20px]">restore_from_trash</span>
            </button>
          ) : (
            <>
              {folder === "archive" ? (
                <button type="button" disabled={!canModify || busy} onClick={() => void act("move_to_inbox")} className={ICON_BUTTON} title="Move to Inbox" aria-label="Move to Inbox">
                  <span className="material-symbols-outlined text-[20px]">move_to_inbox</span>
                </button>
              ) : (
                <button type="button" disabled={!canModify || busy} onClick={() => void act("archive")} className={ICON_BUTTON} title="Archive" aria-label="Archive">
                  <span className="material-symbols-outlined text-[20px]">archive</span>
                </button>
              )}
              <button type="button" disabled={!canModify || busy} onClick={() => void act("trash")} className={ICON_BUTTON} title="Delete" aria-label="Delete">
                <span className="material-symbols-outlined text-[20px]">delete</span>
              </button>
            </>
          )}
          <button type="button" disabled={!canModify || busy} onClick={() => void act("mark_unread")} className={ICON_BUTTON} title="Mark as unread" aria-label="Mark as unread">
            <span className="material-symbols-outlined text-[20px]">mark_email_unread</span>
          </button>
          <button type="button" disabled={!canModify || busy} onClick={() => void act(starred ? "unstar" : "star")} className={ICON_BUTTON} title={starred ? "Unstar" : "Star"} aria-label={starred ? "Unstar" : "Star"}>
            <span
              className={`material-symbols-outlined text-[20px] ${starred ? "text-amber-500" : ""}`}
              style={starred ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              star
            </span>
          </button>
          {latest ? (
            <div className="ml-auto flex items-center gap-1">
              <button type="button" onClick={() => compose("reply", latest)} className={ICON_BUTTON} title="Reply" aria-label="Reply">
                <span className="material-symbols-outlined text-[20px]">reply</span>
              </button>
              <button type="button" onClick={() => compose("forward", latest)} className={ICON_BUTTON} title="Forward" aria-label="Forward">
                <span className="material-symbols-outlined text-[20px]">forward</span>
              </button>
            </div>
          ) : null}
        </header>

        <div className="px-4 pb-5 pt-4 sm:px-6">
          <div className="flex flex-wrap items-start gap-2">
            <h2 className="min-w-0 flex-1 break-words font-display text-[20px] font-semibold leading-tight text-on-surface">
              {summary.subject || "(no subject)"}
            </h2>
            <MatchChip match={match} />
          </div>

          {!messages && !error ? (
            <div className="mt-4 space-y-3" aria-busy="true">
              {[0, 1].map((row) => (
                <div key={row} className="h-28 animate-pulse rounded-lg bg-surface-container-low" />
              ))}
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 font-body text-[12px] text-rose-700">
              {error}
            </p>
          ) : null}

          <div className="mt-3 divide-y divide-outline-variant/40">
            {messages?.map((message) => (
              <MessageCard
                key={message.id}
                message={message}
                expanded={expanded.has(message.id)}
                onToggle={() =>
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(message.id)) next.delete(message.id);
                    else next.add(message.id);
                    return next;
                  })
                }
                onCompose={(intent) => compose(intent, message)}
              />
            ))}
          </div>

          {latest ? (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-outline-variant/40 pt-4">
              <button type="button" onClick={() => compose("reply", latest)} className={BUTTON_OUTLINE}>
                <span className="material-symbols-outlined text-[18px]">reply</span>
                Reply
              </button>
              <button type="button" onClick={() => compose("reply_all", latest)} className={BUTTON_OUTLINE}>
                <span className="material-symbols-outlined text-[18px]">reply_all</span>
                Reply all
              </button>
              <button type="button" onClick={() => compose("forward", latest)} className={BUTTON_OUTLINE}>
                <span className="material-symbols-outlined text-[18px]">forward</span>
                Forward
              </button>
            </div>
          ) : null}
        </div>
      </article>

      <MailCustomerPanel
        key={match.customerEmails[0] ?? match.method}
        match={match}
        onEmailCustomer={(email) => onCompose({ intent: "new", to: [email] })}
      />
    </div>
  );
}

function MessageCard({
  message,
  expanded,
  onToggle,
  onCompose,
}: {
  message: MailboxThreadMessage;
  expanded: boolean;
  onToggle: () => void;
  onCompose: (intent: "reply" | "reply_all" | "forward") => void;
}) {
  const [plain, setPlain] = useState(!message.bodyHtml);
  const [showImages, setShowImages] = useState(false);
  // Images embedded in the email (cid:) are shown in place.
  const html = useInlineImages(message.id, expanded ? message.bodyHtml : null, message.attachments);
  const hasRemoteImages = useMemo(
    () => Boolean(message.bodyHtml && /(<img[^>]+src\s*=\s*["']?https?:|url\(\s*["']?https?:)/i.test(message.bodyHtml)),
    [message.bodyHtml],
  );

  return (
    <section className="py-3">
      <div className="flex items-start gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-body text-[12px] font-bold ${
            message.match.method !== "none" ? "bg-primary text-white" : "bg-primary/10 text-primary"
          }`}
        >
          {initials(message.fromName, message.fromAddress)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <button type="button" onClick={onToggle} className="min-w-0 text-left">
              <p className="truncate font-body text-[13px] font-semibold text-on-surface">
                {message.fromName || message.fromAddress}{" "}
                {message.fromName ? (
                  <span className="font-normal text-on-surface-variant">&lt;{message.fromAddress}&gt;</span>
                ) : null}
              </p>
              {expanded ? (
                <p className="break-all font-body text-[11px] text-on-surface-variant">
                  To {message.to || "—"}
                  {message.cc ? ` · Cc ${message.cc}` : ""}
                </p>
              ) : (
                <p className="truncate font-body text-[12px] text-on-surface-variant">{message.snippet}</p>
              )}
            </button>
            <div className="flex shrink-0 items-center gap-0.5">
              <span className="mr-1 hidden font-body text-[11px] text-on-surface-variant sm:inline">
                {formatFullDate(message.date)}
              </span>
              {expanded ? (
                <>
                  <button type="button" onClick={() => onCompose("reply")} className={ICON_BUTTON} title="Reply" aria-label="Reply">
                    <span className="material-symbols-outlined text-[18px]">reply</span>
                  </button>
                  <button type="button" onClick={() => onCompose("reply_all")} className={ICON_BUTTON} title="Reply all" aria-label="Reply all">
                    <span className="material-symbols-outlined text-[18px]">reply_all</span>
                  </button>
                  <button type="button" onClick={() => onCompose("forward")} className={ICON_BUTTON} title="Forward" aria-label="Forward">
                    <span className="material-symbols-outlined text-[18px]">forward</span>
                  </button>
                </>
              ) : null}
            </div>
          </div>

          {expanded ? (
            <div className="mt-3 space-y-3">
              {message.bodyError ? (
                <p className="font-body text-[12px] text-on-surface-variant">{message.bodyError}</p>
              ) : (
                <>
                  {message.bodyHtml ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {!plain && hasRemoteImages && !showImages ? (
                        <p className="flex flex-1 flex-wrap items-center gap-2 rounded-lg bg-surface-container-low px-3 py-1.5 font-body text-[11px] text-on-surface-variant">
                          <span className="material-symbols-outlined text-[15px]">hide_image</span>
                          Images from the web are hidden to protect your privacy.
                          <button type="button" onClick={() => setShowImages(true)} className="font-semibold text-primary hover:underline">
                            Show images
                          </button>
                        </p>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setPlain((value) => !value)}
                        className="ml-auto font-body text-[11px] font-semibold text-primary hover:underline"
                      >
                        {plain ? "Show formatted" : "Show plain text"}
                      </button>
                    </div>
                  ) : null}
                  {plain || !html ? (
                    <pre className="whitespace-pre-wrap break-words font-body text-[14px] leading-relaxed text-on-surface">
                      {message.bodyText || "(empty message)"}
                    </pre>
                  ) : (
                    <EmailHtmlFrame html={html} showImages={showImages} />
                  )}
                </>
              )}
              <AttachmentGallery messageId={message.id} attachments={message.attachments} />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
