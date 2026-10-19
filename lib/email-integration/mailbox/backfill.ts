import { MAILBOX_SEARCH_ADDRESSES_PER_QUERY } from "@/lib/email-integration/config";
import type { BusinessMailContext } from "@/lib/email-integration/mailbox/directory";

/** One unit of past-mail import work; resumable via the page token. */
export type BackfillTask =
  | { type: "search"; query: string; pageToken: string | null }
  | { type: "thread"; threadId: string };

/** Everything except spam and drafts (Trash included), newest first. */
export const WHOLE_MAILBOX_QUERY = "-in:spam -in:drafts";

export type BackfillState = {
  queue: BackfillTask[];
  /** Whether the sweep of the whole mailbox has been queued (once). */
  wholeMailboxQueued?: boolean;
  /** Customer addresses / platform threads already queued, so each is imported once. */
  searched: string[];
  threads: string[];
  imported: number;
  done: boolean;
};

export const EMPTY_BACKFILL: BackfillState = {
  queue: [],
  searched: [],
  threads: [],
  imported: 0,
  done: false,
};

export function readBackfill(raw: unknown): BackfillState | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Partial<BackfillState>;
  return {
    queue: Array.isArray(data.queue) ? data.queue : [],
    searched: Array.isArray(data.searched) ? data.searched : [],
    threads: Array.isArray(data.threads) ? data.threads : [],
    imported: typeof data.imported === "number" ? data.imported : 0,
    done: data.done === true,
    wholeMailboxQueued: data.wholeMailboxQueued === true,
  };
}

/** Gmail search for every message to, from or copied to these addresses, all time. */
export function customerSearchQuery(addresses: string[]): string {
  const terms = addresses.flatMap((address) => [
    `from:${address}`,
    `to:${address}`,
    `cc:${address}`,
    `bcc:${address}`,
  ]);
  return `{${terms.join(" ")}}`;
}

/** Adds work for customers and platform threads not imported yet. */
export function queueNewWork(
  state: BackfillState,
  mail: Pick<BusinessMailContext, "customers" | "platformThreads">,
  ownAddress: string,
): BackfillState {
  const own = ownAddress.toLowerCase();
  const searched = new Set(state.searched);
  const fresh = [...mail.customers.keys()].filter(
    (address) => address !== own && !searched.has(address) && /^[^\s{}()"]+$/.test(address),
  );
  const threads = new Set(state.threads);
  const newThreads = [...mail.platformThreads.keys()].filter((id) => !threads.has(id));
  // Customer and platform conversations first, so linked mail appears quickly.
  const targeted: BackfillTask[] = [];
  for (const threadId of newThreads) targeted.push({ type: "thread", threadId });
  for (let i = 0; i < fresh.length; i += MAILBOX_SEARCH_ADDRESSES_PER_QUERY) {
    const chunk = fresh.slice(i, i + MAILBOX_SEARCH_ADDRESSES_PER_QUERY);
    targeted.push({ type: "search", query: customerSearchQuery(chunk), pageToken: null });
  }
  // Then the rest of the mailbox, once.
  const queue = [...targeted, ...state.queue];
  if (!state.wholeMailboxQueued) {
    queue.push({ type: "search", query: WHOLE_MAILBOX_QUERY, pageToken: null });
  }
  return {
    queue,
    searched: [...state.searched, ...fresh],
    threads: [...state.threads, ...newThreads],
    wholeMailboxQueued: true,
    imported: state.imported,
    done: queue.length === 0,
  };
}

