import "server-only";

import type { Firestore } from "firebase-admin/firestore";

import { COMPLAINT_CASES_COLLECTION, mapCase, moveCase } from "./cases";
import { scanStaffQuestions, type ScanDeps, type ScanResult } from "./staff-questions";

/**
 * The deadlines for complaints (docs/sophie-email-learning-and-auto-reply.md §10.7, §10.9 step 9):
 * run every few minutes with the agent. It sends the technician's question and its one reminder,
 * ends a question that has had no answer by its deadline, and, when the reply-by time passes with
 * the case still waiting on the owner, escalates it with one more push to the owner.
 *
 * Every move goes through the state rules in cases.ts, so running it twice never repeats a push.
 */

export type DeadlineDeps = ScanDeps & {
  /** Pushes the business owner. */
  pushOwner(businessId: string, push: { title: string; body: string; data: Record<string, string> }): Promise<void>;
};

export type DeadlineResult = ScanResult & { escalated: number };

export async function scanComplaintDeadlines(db: Firestore, deps: DeadlineDeps, now: number): Promise<DeadlineResult> {
  const staff = await scanStaffQuestions(db, deps, now);
  let escalated = 0;
  const waiting = await db.collection(COMPLAINT_CASES_COLLECTION).where("status", "==", "waiting_owner").limit(200).get();
  for (const doc of waiting.docs) {
    const item = mapCase(doc.id, doc.data() ?? {});
    if (item.replyBy === 0 || item.replyBy > now) continue;
    const moved = await moveCase(db, { businessId: item.businessId, caseId: item.id, to: "escalated", event: "The reply-by time passed with no answer from you.", by: "sophie" }, now);
    if (!moved.ok) continue;
    escalated++;
    await deps.pushOwner(item.businessId, {
      title: "A complaint is overdue",
      body: `${item.customerName ?? "A customer"}'s complaint passed its reply-by time. Open Emails → Sophie.`,
      data: { type: "complaint_overdue", link: "/dashboard/emails?tab=sophie", caseId: item.id },
    }).catch((error) => console.error("[complaints] overdue push failed", (error as Error)?.name));
  }
  return { ...staff, escalated };
}
