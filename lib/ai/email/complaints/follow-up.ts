import "server-only";

import type { Firestore } from "firebase-admin/firestore";

import type { ActionDeps } from "../actions/context";
import { sendTemplateReply } from "../actions/reply";
import { EMAIL_TRIAGE_COLLECTION } from "../collections";
import { EMAIL_MESSAGES_COLLECTION } from "@/lib/email-integration/config";
import { COMPLAINT_CASES_COLLECTION, mapCase, moveCase, noteCase } from "./cases";

/**
 * After the return visit (docs/sophie-email-learning-and-auto-reply.md §10.7, §10.9 steps 8 and 10).
 * When the visit linked to a complaint is completed, the case moves to "follow up" and the owner
 * hears about it. Asking the customer whether it's fixed is the owner's tap: Sophie sends the
 * follow-up email, then the customer's answer is an ordinary email, and the owner marks the case
 * fixed or reopens it.
 */

/** A linked return visit was just completed: its case moves to follow-up, and the owner is told once. */
export async function noteReturnVisitCompleted(
  db: Firestore,
  input: { businessId: string; jobId: string },
  pushOwner: (businessId: string, push: { title: string; body: string; data: Record<string, string> }) => Promise<void>,
  now = Date.now(),
): Promise<boolean> {
  const snap = await db.collection(COMPLAINT_CASES_COLLECTION).where("remedy.revisitJobId", "==", input.jobId).limit(3).get();
  const found = snap.docs.map((doc) => mapCase(doc.id, doc.data() ?? {})).find((item) => item.businessId === input.businessId);
  if (!found) return false;
  const moved = await moveCase(db, { businessId: input.businessId, caseId: found.id, to: "follow_up", event: "The return visit was completed.", by: "sophie" }, now);
  if (!moved.ok) return false;
  await pushOwner(input.businessId, {
    title: "Return visit done",
    body: `${found.customerName ?? "The customer"}'s return visit is finished. Ask them if it's fixed: Emails → Sophie.`,
    data: { type: "complaint_follow_up", link: "/dashboard/emails?tab=sophie", caseId: found.id },
  }).catch((error) => console.error("[complaints] follow-up push failed", (error as Error)?.name));
  return true;
}

export type FollowUpResult = { ok: true } | { ok: false; status: number; error: string };

/** The owner taps "Ask if it's fixed": the follow-up email goes once, through the reply gate. */
export async function sendFollowUp(
  deps: ActionDeps,
  input: { businessId: string; caseId: string; actorUid: string },
  now = Date.now(),
): Promise<FollowUpResult> {
  if (!/^[0-9a-f]{40}$/.test(input.caseId)) return { ok: false, status: 404, error: "Case not found." };
  const data = (await deps.db.collection(COMPLAINT_CASES_COLLECTION).doc(input.caseId).get()).data();
  if (!data || data.businessId !== input.businessId) return { ok: false, status: 404, error: "Case not found." };
  const found = mapCase(input.caseId, data);
  if (found.status !== "follow_up") return { ok: false, status: 409, error: "The return visit isn't finished yet." };

  const triage = (await deps.db.collection(EMAIL_TRIAGE_COLLECTION).doc(found.triageId).get()).data();
  const message = triage ? (await deps.db.collection(EMAIL_MESSAGES_COLLECTION).doc(String(triage.messageId ?? "")).get()).data() : null;
  if (!triage || triage.businessId !== input.businessId || !message || message.businessId !== input.businessId) {
    return { ok: false, status: 409, error: "The customer's email isn't in the mailbox any more. Ask them yourself." };
  }
  const sent = await sendTemplateReply({
    deps, businessId: input.businessId, triageId: found.triageId, triage, message, authority: "owner", actorUid: input.actorUid, decision: {}, now,
  }, "complaint_follow_up");
  if (sent.status !== "done") return { ok: false, status: 409, error: sent.summary };
  await noteCase(deps.db, { businessId: input.businessId, caseId: input.caseId, event: "Asked the customer if it's fixed.", by: input.actorUid }, now);
  return { ok: true };
}
