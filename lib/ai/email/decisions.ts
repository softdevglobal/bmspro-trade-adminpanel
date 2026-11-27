import "server-only";

import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { resolvePlatformTimeZone } from "@/lib/platform/timezone";

import { actionsKey, defaultActions, parseActions } from "./action-list";
import { suggestionHints } from "./cards";
import { needsDetails, parseCardDetails, type ParsedDetails } from "./details";
import type { EmailMemory } from "./memory";
import { addSender, senderKey } from "./senders";
import { EMAIL_DECISIONS_COLLECTION, EMAIL_RULES_COLLECTION, EMAIL_TRIAGE_COLLECTION } from "./collections";
import type { EmailAction, EmailDecision, EmailKind, EmailTriageResult } from "./types";

/**
 * The owner's answers (docs/sophie-email-learning-and-auto-reply.md §5.7). One decision per email,
 * saved with the type and the actions from the fixed list, then added to Sophie's memory. Counting
 * "the same decision N times" is a plain query here, never RAG.
 *
 * Step 5 only records the actions. In shadow mode they're never run; otherwise step 6 runs them,
 * each through the policy check at the moment of acting.
 */

export { EMAIL_DECISIONS_COLLECTION };

/** What the owner tapped on a card. */
export type CardChoice =
  /** "Do this", with the suggestions they left ticked (all of them when `actions` is left out). */
  | { choice: "confirm"; actions?: unknown }
  /** "This isn't a …": the right type, and optionally its actions. */
  | { choice: "change_kind"; kind: unknown; actions?: unknown }
  /** "Do something else": actions from the fixed list. */
  | { choice: "other_actions"; actions: unknown }
  | { choice: "ignore" }
  /** "Yes, private": the sender joins the private list (§11.3). */
  | { choice: "mark_private" };

export type DecideResult =
  | { ok: true; decision: EmailDecision; sameInARow: number }
  | { ok: false; status: number; error: string; code?: string };

const fail = (status: number, error: string): DecideResult => ({ ok: false, status, error });

export async function decideCard(
  db: Firestore,
  input: {
    businessId: string;
    triageId: string;
    actorUid: string;
    via: EmailDecision["via"];
    choice: CardChoice;
    /** The types the owner may pick (built-in today; their own from step 7). */
    kinds: ReadonlySet<string>;
    /** What the owner's own types suggest (kinds.ts kindChoices). */
    defaults?: ReadonlyMap<string, EmailAction[]>;
    memory?: EmailMemory;
    /** The customer details confirmed on the card, for saving a customer or adding a request. */
    details?: unknown;
    /** The business time zone, for checking the preferred dates. */
    timeZone?: string | null;
  },
  now = Date.now(),
): Promise<DecideResult> {
  if (!/^[0-9a-f]{40}$/.test(input.triageId)) return fail(404, "Email not found.");
  const triageRef = db.collection(EMAIL_TRIAGE_COLLECTION).doc(input.triageId);
  const decisionRef = db.collection(EMAIL_DECISIONS_COLLECTION).doc(input.triageId);

  const outcome = await db.runTransaction(async (tx): Promise<
    { ok: false; status: number; error: string; code?: string } | { ok: true; decision: EmailDecision; row: Record<string, unknown> }
  > => {
    const snap = await tx.get(triageRef);
    const row = snap.data();
    if (!snap.exists || !row || row.businessId !== input.businessId) return { ok: false, status: 404, error: "Email not found." };
    if (row.status !== "new" || row.decisionId) return { ok: false, status: 409, error: "This email was already handled." };
    if (row.precheck === "private") return { ok: false, status: 409, error: "This email is private." };

    // A card built from a rule's actions can only run with that exact rule version (T08). When the
    // rule changed since, the card is rebuilt from the current version and the owner looks again.
    let ruleActions = Array.isArray(row.ruleActions) ? (row.ruleActions as EmailAction[]) : null;
    if (typeof row.ruleId === "string" && row.ruleId) {
      const ruleRef = db.collection(EMAIL_RULES_COLLECTION).doc(row.ruleId);
      const rule = (await tx.get(ruleRef)).data();
      const current = rule && rule.businessId === input.businessId && rule.level !== "off" ? rule : null;
      if ((current?.version ?? null) !== (row.ruleVersion ?? null)) {
        tx.set(triageRef, {
          ruleId: current ? row.ruleId : null,
          ruleVersion: current?.version ?? null,
          ruleActions: current?.actions ?? null,
        }, { merge: true });
        return { ok: false, status: 409, error: "The rule for emails like this changed since this card was made. I've updated it: please check it again.", code: "rule_changed" };
      }
      ruleActions = (current?.actions as EmailAction[] | undefined) ?? ruleActions;
    }

    const result = (row.result ?? null) as EmailTriageResult | null;
    const guessedKind = result?.kind ?? null;
    const kindActions = Array.isArray(row.kindActions) && row.kindActions.length > 0 ? (row.kindActions as EmailAction[]) : null;
    const suggested = ruleActions ?? kindActions ?? defaultActions(guessedKind, suggestionHints(row));
    const defaultsFor = (kind: EmailKind) => input.defaults?.get(kind) ?? defaultActions(kind);
    let confirmedKind: EmailKind;
    let actions: EmailAction[] | null;
    const choice = input.choice;
    switch (choice.choice) {
      case "confirm":
        if (!guessedKind) return { ok: false, status: 400, error: "Choose what kind of email this is." };
        if (guessedKind === "private") return { ok: false, status: 400, error: "Say whether this sender is private." };
        confirmedKind = guessedKind;
        actions = choice.actions === undefined ? suggested : parseActions(choice.actions);
        break;
      case "change_kind":
        if (typeof choice.kind !== "string" || !input.kinds.has(choice.kind)) return { ok: false, status: 400, error: "Choose a type from the list." };
        if (choice.kind === "private") return { ok: false, status: 400, error: "Use “Yes, private” to keep a sender private." };
        confirmedKind = choice.kind as EmailKind;
        actions = choice.actions === undefined ? defaultsFor(confirmedKind) : parseActions(choice.actions);
        break;
      case "other_actions":
        confirmedKind = guessedKind && guessedKind !== "private" ? guessedKind : "unknown";
        actions = parseActions(choice.actions);
        if (actions?.length === 0) actions = null;
        break;
      case "ignore":
        confirmedKind = guessedKind && guessedKind !== "private" ? guessedKind : "unknown";
        actions = [{ kind: "ignore" }];
        break;
      case "mark_private":
        confirmedKind = "private";
        actions = [];
        break;
      default:
        return { ok: false, status: 400, error: "Choose what to do with this email." };
    }
    if (!actions) return { ok: false, status: 400, error: "Choose actions from the list." };

    const sender = row.sender as { address?: unknown } | null;
    const address = typeof sender?.address === "string" ? sender.address : null;
    const willRun = row.shadow !== true && confirmedKind !== "private";
    const kinds = actions.map((action) => action.kind);
    // Customers and requests are made only from details the owner confirmed (step 6b).
    let confirmed: Extract<ParsedDetails, { ok: true }> | null = null;
    if (willRun && needsDetails(kinds)) {
      if (!address) return { ok: false, status: 400, error: "This email has no sender address to save." };
      const parsed = parseCardDetails(input.details, { kinds, email: address, timeZone: resolvePlatformTimeZone(input.timeZone) });
      if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
      confirmed = parsed;
    }
    const key = actionsKey(actions);
    const decision: EmailDecision = {
      businessId: input.businessId,
      triageId: input.triageId,
      messageId: String(row.messageId ?? ""),
      confirmedKind,
      guessedKind,
      actions,
      actionsKey: key,
      replyEdited: false,
      matchedSuggestion: confirmedKind === guessedKind && key === actionsKey(suggested),
      senderKey: address ? senderKey(input.businessId, address) : null,
      decidedBy: input.actorUid,
      via: input.via,
      actionsStatus: willRun ? "pending" : "not_run",
      ...(confirmed ? { details: confirmed.details, requestInput: confirmed.requestInput } : {}),
      decidedAt: now,
    };
    tx.set(decisionRef, { ...decision, decidedAt: Timestamp.fromMillis(now) });
    tx.set(triageRef, {
      status: choice.choice === "ignore" ? "ignored" : "owner_done",
      decisionId: input.triageId,
      decidedAt: Timestamp.fromMillis(now),
    }, { merge: true });
    return { ok: true, decision, row };
  });
  if (!outcome.ok) return outcome;
  const { decision, row } = outcome;

  if (decision.confirmedKind === "private") {
    // Future email from this sender is never read (§11.3). The address is on the row only for cards.
    const address = (row.sender as { address?: string } | null)?.address;
    if (address) await addSender(db, input.businessId, { list: "private", value: address, source: "card" }, input.actorUid, now);
  } else if (input.memory) {
    // Memory helps Sophie guess next time (§7.2). Best effort: the decision is already saved.
    const result = row.result as EmailTriageResult | null;
    const stored = row.memoryVector as { toArray?: () => number[] } | null;
    const vector = typeof stored?.toArray === "function" ? stored.toArray() : null;
    if (result?.summary && vector && typeof row.memoryModel === "string") {
      await input.memory.save({
        businessId: input.businessId,
        decisionId: input.triageId,
        kind: decision.confirmedKind,
        senderKey: decision.senderKey ?? "",
        summary: result.summary,
        actionsKey: decision.actionsKey,
        vector,
        embeddingModel: row.memoryModel,
      }, now).catch((error) => console.error("[ai/email] memory save failed", (error as Error)?.name));
    }
  }

  const sameInARow = await sameDecisionsInARow(db, input.businessId, {
    confirmedKind: decision.confirmedKind,
    actionsKey: decision.actionsKey,
  }).catch(() => 0);
  return { ok: true, decision, sameInARow };
}

export type DecisionRunItem = { id: string; senderKey: string | null; decidedAt: number; guessedKind: string | null };

/**
 * The owner's latest decisions for this type that were the same, newest first, stopping at the first
 * different one (§5.7): same actions, no edited reply, not undone, and, for a one-sender rule, the
 * same sender. Decisions a rule made don't count: only the owner's own answers teach a rule.
 */
export async function sameDecisionsRun(
  db: Firestore,
  businessId: string,
  like: Pick<EmailDecision, "confirmedKind" | "actionsKey"> & { senderKey?: string | null },
  max = 10,
): Promise<DecisionRunItem[]> {
  const snap = await db.collection(EMAIL_DECISIONS_COLLECTION)
    .where("businessId", "==", businessId)
    .where("confirmedKind", "==", like.confirmedKind)
    .orderBy("decidedAt", "desc")
    .limit(max * 2)
    .get();
  const run: DecisionRunItem[] = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.businessId !== businessId || data.via === "rule") continue;
    const same = data.actionsKey === like.actionsKey && data.replyEdited !== true && data.undone !== true
      && (!like.senderKey || data.senderKey === like.senderKey);
    if (!same) break;
    run.push({
      id: doc.id,
      senderKey: typeof data.senderKey === "string" ? data.senderKey : null,
      decidedAt: data.decidedAt instanceof Timestamp ? data.decidedAt.toMillis() : Number(data.decidedAt) || 0,
      guessedKind: typeof data.guessedKind === "string" ? data.guessedKind : null,
    });
    if (run.length >= max) break;
  }
  return run;
}

/** How many in a row (see sameDecisionsRun). */
export async function sameDecisionsInARow(
  db: Firestore,
  businessId: string,
  like: Pick<EmailDecision, "confirmedKind" | "actionsKey"> & { senderKey?: string | null },
  max = 10,
): Promise<number> {
  return (await sameDecisionsRun(db, businessId, like, max)).length;
}
