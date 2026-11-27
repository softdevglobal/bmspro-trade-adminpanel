import "server-only";

import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { recordAgentAction } from "@/lib/ai/agent/audit";
import { agentFlags } from "@/lib/ai/agent/config";
import { EMAIL_MESSAGES_COLLECTION } from "@/lib/email-integration/config";

import type { ActionDeps } from "./actions/context";
import { sendTemplateReply } from "./actions/reply";
import { EMAIL_TRIAGE_COLLECTION } from "./collections";
import { getEmailSettings } from "./settings";
import { REPLY_TEMPLATES } from "./templates";
import type { EmailTriageResult } from "./types";

/**
 * Safety emails (docs/sophie-email-learning-and-auto-reply.md §10.5): sparks, gas, water near
 * electrics, someone hurt. The owner hears at once (a U1 card). Sophie replies straight away with
 * the safety template, even to an unverified sender, because waiting could be dangerous; but only
 * once the owner has approved that exact template in Settings. Otherwise she sends nothing.
 *
 * Nothing else is automatic: no diagnosis, no staff question, and never "it's safe".
 */

export const SAFETY_TEMPLATE_VERSION = REPLY_TEMPLATES.safety_holding.version;

/** Another push this often, until the owner answers the card (§10.5: keep pushing until someone acknowledges). */
export const SAFETY_REPUSH_MS = 15 * 60_000;
/** At most this many in all (the first included), so a card nobody can reach doesn't push for ever. */
export const SAFETY_MAX_PUSHES = 8;

export function isSafetyEmail(result: EmailTriageResult | null): boolean {
  return !!result && (result.flags.includes("safety") || result.complaintType === "safety");
}

type SafetyStatus = "sent" | "not_sent" | "not_approved" | "paused" | "dry_run";

/** The `email.safety` handler. Returns a short code; the outcome is kept on the triage row for the card. */
export async function runSafetyReply(deps: ActionDeps, triageId: string, ownerUid: string, now = Date.now()): Promise<string> {
  const db = deps.db;
  const ref = db.collection(EMAIL_TRIAGE_COLLECTION).doc(triageId);
  const triage = (await ref.get()).data();
  if (!triage) return "triage_missing";
  if (triage.safetyReply?.status === "sent") return "already_sent";
  const businessId = String(triage.businessId ?? "");
  const message = (await db.collection(EMAIL_MESSAGES_COLLECTION).doc(String(triage.messageId ?? "")).get()).data() ?? null;

  const settle = async (status: SafetyStatus, summary: string) => {
    await ref.set({ safetyReply: { status, summary, at: Timestamp.fromMillis(now) } }, { merge: true });
    await recordAgentAction(db, {
      businessId,
      eventId: `email.safety:${triageId}`,
      eventType: "email.safety",
      actionKey: "safety_reply",
      action: "safety_reply",
      status: status === "sent" ? "done" : status === "dry_run" ? "dry_run" : status === "paused" ? "blocked" : "held",
      reason: status,
    }, now);
    return `safety:${status}`;
  };

  const settings = await getEmailSettings(db, businessId);
  if (settings.paused) return settle("paused", "Not sent: Sophie's email actions are paused.");
  if (settings.safetyReplyVersion !== SAFETY_TEMPLATE_VERSION) {
    return settle("not_approved", "I didn't send the safety reply: approve it once under Settings → Sophie, and I'll send it straight away next time.");
  }
  const flags = agentFlags(deps.env ?? process.env);
  if (!flags.enabled || flags.dryRun) return settle("dry_run", "Practice run: the safety reply wasn't sent.");

  const outcome = await sendTemplateReply({
    deps,
    businessId,
    triageId,
    triage,
    message: message && message.businessId === businessId && message.folder ? message : null,
    // The owner approved this exact template for exactly this case, so it isn't held for email hours.
    authority: "owner",
    actorUid: ownerUid,
    decision: {},
    now,
  }, "safety_holding");
  return settle(outcome.status === "done" ? "sent" : "not_sent", outcome.status === "done" ? "I sent the safety reply straight away." : outcome.summary);
}

/**
 * Keeps pushing the owner about a safety email until they answer its card (§10.5). Run every few
 * minutes with the agent. The first push is the card's own; each later one waits 15 minutes, up to
 * 8 in all. Answering the card (any answer) is the acknowledgement and stops it.
 */
export async function scanSafetyAcknowledgements(
  db: Firestore,
  pushOwner: (businessId: string, push: { title: string; body: string; data: Record<string, string> }) => Promise<void>,
  now: number,
): Promise<number> {
  const waiting = await db.collection(EMAIL_TRIAGE_COLLECTION).where("safety", "==", true).where("status", "==", "new").limit(100).get();
  let pushed = 0;
  for (const doc of waiting.docs) {
    const row = doc.data() ?? {};
    const count = Number(row.safetyPushCount) || (row.pushedAt ? 1 : 0);
    const last = row.safetyPushedAt instanceof Timestamp ? row.safetyPushedAt.toMillis() : row.pushedAt instanceof Timestamp ? row.pushedAt.toMillis() : null;
    if (count >= SAFETY_MAX_PUSHES || (last !== null && now - last < SAFETY_REPUSH_MS)) continue;
    await pushOwner(String(row.businessId), {
      title: "A safety email still needs you",
      body: "Someone reported something unsafe. Open Emails → Sophie and answer it.",
      data: { type: "email_safety", link: "/dashboard/emails?tab=sophie", triageId: doc.id },
    }).catch((error) => console.error("[safety] repeat push failed", (error as Error)?.name));
    await doc.ref.set({ safetyPushCount: count + 1, safetyPushedAt: Timestamp.fromMillis(now) }, { merge: true });
    pushed++;
  }
  return pushed;
}
