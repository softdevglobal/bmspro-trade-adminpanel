import "server-only";

import {
  EMAIL_SYNC_STATE_COLLECTION,
  MAILBOX_SYNC_BUDGET_MS,
  MAILBOX_SYNC_LEASE_MS,
  MAILBOX_SYNC_MAX_MESSAGES,
  MAILBOX_SYNC_MIN_INTERVAL_MS,
} from "@/lib/email-integration/config";
import {
  markConnectionNeedsReconnect,
  type EmailConnectionRecord,
} from "@/lib/email-integration/connections";
import { freshCredentials } from "@/lib/email-integration/credentials";
import {
  loadBusinessMailContext,
  type BusinessMailContext,
} from "@/lib/email-integration/mailbox/directory";
import {
  EMPTY_BACKFILL,
  queueNewWork,
  readBackfill,
  type BackfillState,
} from "@/lib/email-integration/mailbox/backfill";
import {
  MailboxReadError,
  type MailboxAdapter,
  type MailboxMetadata,
} from "@/lib/email-integration/mailbox/provider";
import { getMailboxAdapter } from "@/lib/email-integration/providers";
import { classifyMessage } from "@/lib/email-integration/mailbox/match";
import {
  deleteStoredMessages,
  loadKnownMessages,
  markMessagesDeleted,
  updateMessageLabels,
  updateMessageMatch,
  upsertMessage,
} from "@/lib/email-integration/mailbox/store";
import type { ProviderCredentials } from "@/lib/email-integration/providers/types";
import { adminDb } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

/**
 * Bump when what gets stored changes. A mailbox synced under an older version
 * is cleared and imported again.
 *   v2: only platform-related mail.  v4: the whole mailbox, all history,
 *   labelled with its customer / platform link.
 */
const SYNC_SCHEMA_VERSION = 4;
/** Parallel reads; kept well under providers' per-user rate limits. */
const FETCH_CONCURRENCY = 5;
/** How long to wait after the provider says "slow down" before importing again. */
const RATE_LIMIT_PAUSE_MS = 60 * 1000;

export type SyncOutcome =
  | { ok: true; stored: number; mode: "initial" | "incremental" | "resync"; historyComplete: boolean }
  | { ok: false; code: "busy" | "too_soon" | "not_enabled" | string };

function toMillis(value: unknown): number | null {
  return value instanceof Timestamp ? value.toMillis() : null;
}

type IngestContext = {
  adapter: MailboxAdapter;
  credentials: ProviderCredentials;
  connection: EmailConnectionRecord;
  mail: BusinessMailContext;
  linkedThreads: Set<string>;
  knownMessages: Set<string>;
  /** Threads already expanded in this run. */
  expanded: Set<string>;
};

function classify(context: IngestContext, message: MailboxMetadata) {
  return classifyMessage({
    threadId: message.threadId,
    from: message.from,
    to: message.to,
    cc: message.cc,
    ownAddress: context.connection.address,
    customers: context.mail.customers,
    platformThreads: context.mail.platformThreads,
    linkedThreads: context.linkedThreads,
  });
}

/**
 * Stores every message in `ids` (spam and drafts excepted), labelled with its
 * link to the platform. Already-stored messages are skipped, unless `refresh`
 * (history changes: labels) or `relink` (a customer search: re-label) asks.
 * Returns the threads that became linked to a customer or the platform.
 */
async function ingest(
  context: IngestContext,
  ids: string[],
  options: { refresh?: boolean; relink?: boolean; prefetched?: MailboxMetadata[] } = {},
): Promise<{ stored: number; newlyLinked: string[] }> {
  let stored = 0;
  const newlyLinked: string[] = [];
  // Providers that list full details with the ids (Outlook) skip a fetch per message.
  const prefetched = new Map((options.prefetched ?? []).map((message) => [message.id, message]));
  const todo = ids.filter(
    (id) => options.refresh || options.relink || !context.knownMessages.has(id),
  );
  for (let i = 0; i < todo.length; i += FETCH_CONCURRENCY) {
    const batch = await Promise.all(
      todo
        .slice(i, i + FETCH_CONCURRENCY)
        .map((id) => prefetched.get(id) ?? context.adapter.getMetadata(context.credentials, id)),
    );
    // Classify in order (it updates the linked-thread set), then write the
    // whole batch in parallel.
    const writes: Promise<void>[] = [];
    for (const message of batch) {
      if (!message) continue;
      const match = classify(context, message);
      const linked = match.method !== "none";
      if (linked && !context.linkedThreads.has(message.threadId)) {
        context.linkedThreads.add(message.threadId);
        newlyLinked.push(message.threadId);
      }
      if (context.knownMessages.has(message.id)) {
        if (options.refresh) writes.push(updateMessageLabels(context.connection.id, message));
        if (options.relink && linked) {
          writes.push(updateMessageMatch(context.connection.id, message.id, match));
        }
        continue;
      }
      context.knownMessages.add(message.id);
      writes.push(
        upsertMessage({
          businessId: context.connection.businessId,
          connectionId: context.connection.id,
          message,
          match,
        }).then((result) => {
          if (result === "stored") stored += 1;
          else context.knownMessages.delete(message.id);
        }),
      );
    }
    await Promise.all(writes);
  }
  return { stored, newlyLinked };
}

/** Pulls in the rest of each conversation (colleagues' replies, own follow-ups). */
async function expandThreads(context: IngestContext, threadIds: string[]): Promise<number> {
  let stored = 0;
  for (const threadId of threadIds) {
    if (context.expanded.has(threadId)) continue;
    context.expanded.add(threadId);
    const ids = await context.adapter.threadMessageIds(context.credentials, threadId);
    stored += (await ingest(context, ids, { relink: true })).stored;
  }
  return stored;
}

/**
 * Works through the past-mail queue until the time budget runs out, saving
 * after every page so a timeout or crash only repeats the last page.
 */
async function runBackfill(
  context: IngestContext,
  state: BackfillState,
  deadline: number,
  save: (state: BackfillState) => Promise<void>,
): Promise<{ state: BackfillState; stored: number }> {
  let stored = 0;
  const queue = [...state.queue];
  let imported = state.imported;
  while (queue.length > 0 && Date.now() < deadline) {
    const task = queue[0];
    if (task.type === "search") {
      const page = await context.adapter.searchPage(context.credentials, task.search, task.pageToken);
      // Customer searches also re-label mail the whole-mailbox sweep stored earlier.
      const result = await ingest(context, page.ids, {
        relink: task.search.kind !== "all",
        prefetched: page.prefetched,
      });
      const expandedCount = await expandThreads(context, result.newlyLinked);
      stored += result.stored + expandedCount;
      imported += result.stored + expandedCount;
      if (page.nextPageToken) queue[0] = { ...task, pageToken: page.nextPageToken };
      else queue.shift();
    } else {
      const ids = await context.adapter.threadMessageIds(context.credentials, task.threadId);
      const result = await ingest(context, ids, { relink: true });
      stored += result.stored;
      imported += result.stored;
      queue.shift();
    }
    await save({ ...state, queue, imported, done: queue.length === 0 });
  }
  return { state: { ...state, queue, imported, done: queue.length === 0 }, stored };
}

/**
 * Syncs one mailbox. Incremental provider changes keep it current; a resumable
 * queue imports all past mail with customers and platform conversations.
 * One lease per mailbox prevents overlapping runs.
 */
export async function syncMailbox(
  connection: EmailConnectionRecord,
  options: { manual?: boolean; budgetMs?: number } = {},
): Promise<SyncOutcome> {
  const adapter = getMailboxAdapter(connection.provider);
  if (!adapter || connection.status !== "active" || !connection.capabilities.includes("read")) {
    return { ok: false, code: "not_enabled" };
  }
  const deadline = Date.now() + Math.min(options.budgetMs ?? MAILBOX_SYNC_BUDGET_MS, MAILBOX_SYNC_BUDGET_MS);
  const stateRef = adminDb.collection(EMAIL_SYNC_STATE_COLLECTION).doc(connection.id);

  const claimed = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(stateRef);
    const data = snap.data() ?? {};
    if ((toMillis(data.leaseUntil) ?? 0) > Date.now()) return { ok: false as const, code: "busy" };
    if ((toMillis(data.pausedUntil) ?? 0) > Date.now()) {
      return { ok: false as const, code: "rate_limited" };
    }
    if (
      options.manual &&
      Date.now() - (toMillis(data.lastStartedAt) ?? 0) < MAILBOX_SYNC_MIN_INTERVAL_MS
    ) {
      return { ok: false as const, code: "too_soon" };
    }
    tx.set(
      stateRef,
      {
        connectionId: connection.id,
        businessId: connection.businessId,
        leaseUntil: Timestamp.fromMillis(Date.now() + MAILBOX_SYNC_LEASE_MS),
        lastStartedAt: Timestamp.now(),
      },
      { merge: true },
    );
    const current = data.schemaVersion === SYNC_SCHEMA_VERSION;
    return {
      ok: true as const,
      historyId: current && typeof data.historyId === "string" ? data.historyId : null,
      backfill: current ? readBackfill(data.backfill) : null,
      outdated: snap.exists && !current,
    };
  });
  if (!claimed.ok) return claimed;

  const finish = (patch: Record<string, unknown>) =>
    stateRef.set(
      { ...patch, leaseUntil: null, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

  try {
    const credentials = await freshCredentials(connection);
    if (!credentials.ok) {
      if (credentials.authFailure) await markConnectionNeedsReconnect(connection, credentials.code);
      await finish({ lastErrorCode: credentials.code });
      return { ok: false, code: credentials.code };
    }

    // Mail stored under an older rule set is cleared first.
    if (claimed.outdated) await deleteStoredMessages(connection.id);

    const [mail, known] = await Promise.all([
      loadBusinessMailContext(connection.businessId),
      loadKnownMessages(connection.id),
    ]);
    const context: IngestContext = {
      adapter,
      credentials: credentials.credentials,
      connection,
      mail,
      linkedThreads: known.linkedThreads,
      knownMessages: known.messages,
      expanded: new Set(),
    };

    let mode: "initial" | "incremental" | "resync" = claimed.historyId ? "incremental" : "initial";
    let stored = 0;
    let historyId = claimed.historyId;
    let backfill = claimed.backfill ?? EMPTY_BACKFILL;

    if (historyId) {
      try {
        const changes = await adapter.changes(credentials.credentials, historyId, MAILBOX_SYNC_MAX_MESSAGES);
        const result = await ingest(context, changes.changedIds, {
          refresh: true,
          prefetched: changes.prefetched,
        });
        stored += result.stored + (await expandThreads(context, result.newlyLinked));
        await markMessagesDeleted(connection.id, changes.deletedIds);
        historyId = changes.cursor;
      } catch (error) {
        // An expired cursor means changes were missed: import everything again
        // (already-stored mail is kept and skipped).
        if (!(error instanceof MailboxReadError && error.code === "cursor_expired")) throw error;
        mode = "resync";
        historyId = null;
        backfill = { ...EMPTY_BACKFILL, imported: backfill.imported };
      }
    }
    if (!historyId) {
      // Checkpoint before importing, so mail arriving meanwhile is replayed later.
      historyId = await adapter.startCursor(credentials.credentials);
    }

    backfill = queueNewWork(backfill, mail, connection.address);
    const save = async (state: BackfillState) => {
      await stateRef.set(
        { historyId, schemaVersion: SYNC_SCHEMA_VERSION, backfill: state },
        { merge: true },
      );
    };
    await save(backfill);
    const result = await runBackfill(context, backfill, deadline, save);
    stored += result.stored;

    await finish({
      historyId,
      schemaVersion: SYNC_SCHEMA_VERSION,
      backfill: result.state,
      lastSuccessAt: FieldValue.serverTimestamp(),
      lastErrorCode: null,
      pausedUntil: null,
    });
    return { ok: true, stored, mode, historyComplete: result.state.done };
  } catch (error) {
    const code = error instanceof MailboxReadError ? error.code : "sync_failed";
    if (code === "rate_limited") {
      // Progress is already saved page by page; just pause and resume later.
      await finish({ pausedUntil: Timestamp.fromMillis(Date.now() + RATE_LIMIT_PAUSE_MS) });
      return { ok: false, code };
    }
    if (code === "unauthorised") await markConnectionNeedsReconnect(connection, code);
    console.error("[email/sync] failed", connection.id, code);
    await finish({ lastErrorCode: code });
    return { ok: false, code };
  }
}

/** Re-reads specific messages after an action so the lists update at once. */
export async function refreshMessageLabels(
  connection: EmailConnectionRecord,
  credentials: ProviderCredentials,
  providerMessageIds: string[],
): Promise<void> {
  const adapter = getMailboxAdapter(connection.provider);
  if (!adapter) return;
  for (const id of providerMessageIds) {
    const message = await adapter.getMetadata(credentials, id);
    if (message) await updateMessageLabels(connection.id, message);
  }
}

/**
 * Imports specific messages straight away (e.g. search hits from mail the
 * background import hasn't reached yet).
 */
export async function importMessages(
  connection: EmailConnectionRecord,
  credentials: ProviderCredentials,
  providerMessageIds: string[],
  prefetched?: MailboxMetadata[],
): Promise<void> {
  const adapter = getMailboxAdapter(connection.provider);
  if (!adapter) return;
  const [mail, known] = await Promise.all([
    loadBusinessMailContext(connection.businessId),
    loadKnownMessages(connection.id),
  ]);
  const missing = providerMessageIds.filter((id) => !known.messages.has(id));
  if (missing.length === 0) return;
  await ingest(
    {
      adapter,
      credentials,
      connection,
      mail,
      linkedThreads: known.linkedThreads,
      knownMessages: known.messages,
      expanded: new Set(),
    },
    missing,
    { prefetched },
  );
}
