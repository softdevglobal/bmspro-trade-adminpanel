import "server-only";

import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { actionLabel } from "./action-list";
import { canUndo } from "./actions";
import { EMAIL_BILL_ITEMS_COLLECTION } from "./actions/records";
import { EMAIL_DECISIONS_COLLECTION, EMAIL_TRIAGE_COLLECTION } from "./collections";
import { emailKindLabel } from "./labels";
import type { ActionResult, EmailAction, EmailActionKind } from "./types";

/**
 * What Sophie did with the owner's answers, and the bills she added (Emails → Sophie). Each action
 * shows what happened and, when it can be, an Undo button.
 */

export type RecentDecision = {
  triageId: string;
  kindLabel: string;
  sender: string;
  subject: string;
  decidedAt: number | null;
  actionsStatus: string;
  /** Sophie decided this one herself, under one of the owner's rules (step 7). */
  byRule: boolean;
  actions: { kind: EmailActionKind; label: string; status: string; summary: string; canUndo: boolean }[];
};

const toMillis = (value: unknown) => (value instanceof Timestamp ? value.toMillis() : typeof value === "number" ? value : null);

/** The latest decisions that ran (or tried to run) actions. Shadow-mode answers aren't listed. */
export async function listRecentDecisions(db: Firestore, businessId: string, limit = 20): Promise<RecentDecision[]> {
  const snap = await db.collection(EMAIL_DECISIONS_COLLECTION)
    .where("businessId", "==", businessId)
    .orderBy("decidedAt", "desc")
    .limit(limit * 2)
    .get();
  const decisions = snap.docs
    .map((doc) => ({ id: doc.id, data: doc.data() }))
    .filter((item) => item.data.businessId === businessId && item.data.actionsStatus !== "not_run")
    .slice(0, limit);
  const triage = await Promise.all(decisions.map((item) => db.collection(EMAIL_TRIAGE_COLLECTION).doc(item.id).get()));
  return decisions.map((item, index) => {
    const row = triage[index].data() ?? {};
    const sender = (row.sender ?? {}) as { name?: string | null; address?: string };
    const results = (item.data.results ?? {}) as Partial<Record<EmailActionKind, ActionResult>>;
    return {
      triageId: item.id,
      kindLabel: emailKindLabel(item.data.confirmedKind),
      sender: sender.name || sender.address || "Unknown sender",
      subject: typeof row.subject === "string" ? row.subject : "",
      decidedAt: toMillis(item.data.decidedAt),
      actionsStatus: String(item.data.actionsStatus ?? "pending"),
      byRule: item.data.via === "rule",
      actions: ((item.data.actions ?? []) as EmailAction[]).map((action) => {
        const result = results[action.kind];
        return {
          kind: action.kind,
          label: actionLabel(action),
          status: result?.status ?? "waiting",
          summary: result?.summary ?? "Waiting to run.",
          canUndo: result?.status === "done" && canUndo(action.kind),
        };
      }),
    };
  });
}

export type BillItem = {
  id: string;
  supplierName: string;
  /** Exactly as written in the email. Never checked, never paid by Sophie (T19). */
  amountAsWritten: string;
  dueDate: string;
  reference: string | null;
};

/** Bills Sophie added that the owner hasn't dismissed, soonest first. */
export async function listBills(db: Firestore, businessId: string): Promise<BillItem[]> {
  const snap = await db.collection(EMAIL_BILL_ITEMS_COLLECTION)
    .where("businessId", "==", businessId)
    .where("status", "==", "to_review")
    .orderBy("dueDate", "asc")
    .limit(50)
    .get();
  return snap.docs
    .filter((doc) => doc.data().businessId === businessId)
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        supplierName: String(data.supplierName ?? ""),
        amountAsWritten: String(data.amountAsWritten ?? ""),
        dueDate: String(data.dueDate ?? ""),
        reference: typeof data.reference === "string" ? data.reference : null,
      };
    });
}
