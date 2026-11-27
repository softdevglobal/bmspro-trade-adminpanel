import "server-only";

import { Timestamp, type Firestore, type DocumentReference } from "firebase-admin/firestore";

import { EMAIL_BILL_ITEMS_COLLECTION } from "./actions/records";
import { COMPLAINT_CASES_COLLECTION } from "./complaints/cases";
import { EMAIL_DECISIONS_COLLECTION, EMAIL_TRIAGE_COLLECTION } from "./collections";
import { STAFF_QUESTIONS_COLLECTION } from "./complaints/staff-questions";
import { REPLY_SAMPLES_COLLECTION } from "./reply-learning";
import { REPLY_THREADS_COLLECTION } from "./replies";

/**
 * How long Sophie keeps what she learnt about email (docs/sophie-email-learning-and-auto-reply.md
 * §15, step 11), and what goes when a mailbox is disconnected.
 *
 * - Triage rows 180 days, decisions 24 months, memory examples 12 months (retired, so Sophie stops
 *   using them), her conversation records 180 days, closed or old complaint cases 180 days.
 * - Disconnecting a mailbox deletes everything Sophie holds that came from it: its triage rows, the
 *   examples, decisions, bill items and complaint cases made from them, and her reply records.
 * - Kept: approved rules and templates (so the owner can reconnect), STOP requests (so nobody who
 *   asked is emailed again) and the greeting and sign-off counts (no email text).
 *
 * Firestore's own expiry (`expireAt`) deletes most of this too; the daily sweep is the backstop, and
 * covers the collections that have no expiry field.
 */

const DAY_MS = 24 * 60 * 60_000;
export const RETENTION = {
  triageDays: 180,
  decisionDays: 730,
  exampleDays: 365,
  replyThreadDays: 180,
} as const;

export const EXAMPLES_COLLECTION = "ai_email_examples";
const BATCH = 300;
/** A run stops after this many rows per kind, so the cron fits its time; the next run carries on. */
const MAX_PER_KIND = 1_500;

export type RetentionCutoffs = { triage: number; decisions: number; examples: number; replyThreads: number; now: number };

export function retentionCutoffs(now: number): RetentionCutoffs {
  return {
    now,
    triage: now - RETENTION.triageDays * DAY_MS,
    decisions: now - RETENTION.decisionDays * DAY_MS,
    examples: now - RETENTION.exampleDays * DAY_MS,
    replyThreads: now - RETENTION.replyThreadDays * DAY_MS,
  };
}

async function deleteRefs(db: Firestore, refs: DocumentReference[]): Promise<void> {
  for (let start = 0; start < refs.length; start += BATCH) {
    const batch = db.batch();
    for (const ref of refs.slice(start, start + BATCH)) batch.delete(ref);
    await batch.commit();
  }
}

export type RetentionResult = {
  triage: number;
  decisions: number;
  examplesRetired: number;
  replyThreads: number;
  cases: number;
  staffQuestions: number;
  replySamples: number;
};

/** The daily sweep. Safe to run twice: it only deletes what is past its time. */
export async function runRetention(db: Firestore, now = Date.now()): Promise<RetentionResult> {
  const cut = retentionCutoffs(now);
  const result: RetentionResult = { triage: 0, decisions: 0, examplesRetired: 0, replyThreads: 0, cases: 0, staffQuestions: 0, replySamples: 0 };

  const sweep = async (collection: string, field: string, before: number, keep?: (data: Record<string, unknown>) => boolean) => {
    let removed = 0;
    while (removed < MAX_PER_KIND) {
      const snap = await db.collection(collection).where(field, "<", Timestamp.fromMillis(before)).limit(BATCH).get();
      const refs = snap.docs.filter((doc) => !keep || !keep(doc.data() ?? {})).map((doc) => doc.ref);
      if (refs.length === 0) break;
      await deleteRefs(db, refs);
      removed += refs.length;
      if (snap.docs.length < BATCH) break;
    }
    return removed;
  };

  result.triage = await sweep(EMAIL_TRIAGE_COLLECTION, "expireAt", cut.now);
  result.decisions = await sweep(EMAIL_DECISIONS_COLLECTION, "decidedAt", cut.decisions);
  result.replyThreads = await sweep(REPLY_THREADS_COLLECTION, "lastReplyAt", cut.replyThreads);
  result.cases = await sweep(COMPLAINT_CASES_COLLECTION, "expireAt", cut.now);
  // The owner's own reply wording kept to spot repeats: gone after a year without a new one.
  result.replySamples = await sweep(REPLY_SAMPLES_COLLECTION, "updatedAt", cut.examples);
  // The technician's answers: 90 days after their case closed (staff-questions.ts), or 180 days after it opened.
  result.staffQuestions = await sweep(STAFF_QUESTIONS_COLLECTION, "expireAt", cut.now);

  // Examples are retired, not deleted: Sophie stops using them and they drop out of her search.
  let retired = 0;
  while (retired < MAX_PER_KIND) {
    const snap = await db.collection(EXAMPLES_COLLECTION).where("createdAt", "<", Timestamp.fromMillis(cut.examples)).limit(BATCH).get();
    const active = snap.docs.filter((doc) => doc.data()?.status === "active");
    if (active.length === 0) break;
    const batch = db.batch();
    for (const doc of active) batch.set(doc.ref, { status: "retired", retiredAt: Timestamp.fromMillis(now), retiredReason: "age" }, { merge: true });
    await batch.commit();
    retired += active.length;
    if (snap.docs.length < BATCH) break;
  }
  result.examplesRetired = retired;
  return result;
}

export type PurgeResult = { triage: number; examples: number; decisions: number; billItems: number; cases: number; replyThreads: number };

/**
 * Everything Sophie holds that came from one mailbox, deleted when it is disconnected (§15). Called
 * from `disconnectEmailConnection`; a failure here is logged by the caller and never stops the
 * disconnect, and a second call finds nothing left.
 */
export async function purgeSophieData(db: Firestore, businessId: string, connectionId: string): Promise<PurgeResult> {
  const result: PurgeResult = { triage: 0, examples: 0, decisions: 0, billItems: 0, cases: 0, replyThreads: 0 };
  for (;;) {
    const snap = await db.collection(EMAIL_TRIAGE_COLLECTION).where("connectionId", "==", connectionId).limit(BATCH).get();
    const rows = snap.docs.filter((doc) => doc.data()?.businessId === businessId);
    if (snap.docs.length === 0) break;
    const refs: { ref: DocumentReference; kind: "triage" | "decision" | "example" | "bill" | "case" }[] = [];
    for (const doc of rows) {
      // The decision, the memory example and the bill item share the triage id; the case is found by it too.
      refs.push(
        { ref: doc.ref, kind: "triage" },
        { ref: db.collection(EMAIL_DECISIONS_COLLECTION).doc(doc.id), kind: "decision" },
        { ref: db.collection(EXAMPLES_COLLECTION).doc(doc.id), kind: "example" },
        { ref: db.collection(EMAIL_BILL_ITEMS_COLLECTION).doc(doc.id), kind: "bill" },
      );
      result.triage++;
    }
    const cases = await Promise.all(rows.map((doc) => db.collection(COMPLAINT_CASES_COLLECTION).where("triageId", "==", doc.id).limit(5).get()));
    for (const found of cases) for (const doc of found.docs) if (doc.data()?.businessId === businessId) { refs.push({ ref: doc.ref, kind: "case" }); result.cases++; }
    // Count what was actually there, then delete (deleting a missing document is a no-op).
    const there = await Promise.all(refs.map((item) => item.ref.get()));
    for (const [index, item] of there.entries()) {
      if (!item.exists) continue;
      const { kind } = refs[index];
      if (kind === "decision") result.decisions++;
      else if (kind === "example") result.examples++;
      else if (kind === "bill") result.billItems++;
    }
    await deleteRefs(db, refs.map((item) => item.ref));
    // Rows of another business sharing an id can't happen; if the filter ever removed none, stop.
    if (rows.length === 0) break;
  }
  const threads = await db.collection(REPLY_THREADS_COLLECTION).where("connectionId", "==", connectionId).limit(BATCH * 10).get();
  const mine = threads.docs.filter((doc) => doc.data()?.businessId === businessId);
  result.replyThreads = mine.length;
  await deleteRefs(db, mine.map((doc) => doc.ref));
  return result;
}
