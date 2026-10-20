import { MAILBOX_SEARCH_ADDRESSES_PER_QUERY } from "@/lib/email-integration/config";
import type { BusinessMailContext } from "@/lib/email-integration/mailbox/directory";
import type { MailboxSearch } from "@/lib/email-integration/mailbox/provider";

/** One unit of past-mail import work; resumable via the page token. */
export type BackfillTask =
  | { type: "search"; search: MailboxSearch; pageToken: string | null }
  | { type: "thread"; threadId: string };

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

/** Gmail queries saved before searches became provider-neutral. */
const LEGACY_WHOLE_MAILBOX_QUERY = "-in:spam -in:drafts";

function readTask(raw: unknown): BackfillTask | null {
  if (!raw || typeof raw !== "object") return null;
  const task = raw as Record<string, unknown>;
  if (task.type === "thread" && typeof task.threadId === "string") {
    return { type: "thread", threadId: task.threadId };
  }
  if (task.type !== "search") return null;
  const pageToken = typeof task.pageToken === "string" ? task.pageToken : null;
  if (task.search && typeof task.search === "object") {
    return { type: "search", search: task.search as MailboxSearch, pageToken };
  }
  // Saved before searches were provider-neutral: a raw Gmail query.
  if (typeof task.query === "string") {
    if (task.query === LEGACY_WHOLE_MAILBOX_QUERY) {
      return { type: "search", search: { kind: "all" }, pageToken };
    }
    const addresses = [...new Set([...task.query.matchAll(/from:(\S+)/g)].map((match) => match[1]))];
    if (addresses.length > 0) {
      return { type: "search", search: { kind: "customers", addresses }, pageToken };
    }
  }
  return null;
}

export function readBackfill(raw: unknown): BackfillState | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Partial<Omit<BackfillState, "queue">> & { queue?: unknown };
  return {
    queue: Array.isArray(data.queue)
      ? data.queue.map(readTask).filter((task): task is BackfillTask => task !== null)
      : [],
    searched: Array.isArray(data.searched) ? data.searched : [],
    threads: Array.isArray(data.threads) ? data.threads : [],
    imported: typeof data.imported === "number" ? data.imported : 0,
    done: data.done === true,
    wholeMailboxQueued: data.wholeMailboxQueued === true,
  };
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
    (address) => address !== own && !searched.has(address) && /^[^\s{}()"']+$/.test(address),
  );
  const threads = new Set(state.threads);
  const newThreads = [...mail.platformThreads.keys()].filter((id) => !threads.has(id));
  // Customer and platform conversations first, so linked mail appears quickly.
  const targeted: BackfillTask[] = [];
  for (const threadId of newThreads) targeted.push({ type: "thread", threadId });
  for (let i = 0; i < fresh.length; i += MAILBOX_SEARCH_ADDRESSES_PER_QUERY) {
    const addresses = fresh.slice(i, i + MAILBOX_SEARCH_ADDRESSES_PER_QUERY);
    targeted.push({ type: "search", search: { kind: "customers", addresses }, pageToken: null });
  }
  // Then the rest of the mailbox, once.
  const queue = [...targeted, ...state.queue];
  if (!state.wholeMailboxQueued) {
    queue.push({ type: "search", search: { kind: "all" }, pageToken: null });
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
