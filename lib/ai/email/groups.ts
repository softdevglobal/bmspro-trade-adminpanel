import "server-only";

import type { Firestore } from "firebase-admin/firestore";

import { defaultActions, parseActions } from "./action-list";
import { decideCard } from "./decisions";
import { needsDetails } from "./details";
import type { EmailMemory } from "./memory";
import type { EmailAction, EmailDecision, EmailKind } from "./types";

/**
 * "How should I handle these?" (docs/sophie-email-learning-and-auto-reply.md §6.3, §5.7): one answer
 * for a group of emails Sophie couldn't sort, saved as one decision for each email.
 */

export const MAX_GROUP = 50;

export type GroupResult =
  /** pending: the emails whose actions wait for the runner (not in shadow mode). */
  | { ok: true; decided: number; skipped: number; pending: string[]; last: EmailDecision | null }
  | { ok: false; status: number; error: string };

export async function decideGroup(
  db: Firestore,
  input: {
    businessId: string;
    triageIds: unknown;
    actorUid: string;
    kind: unknown;
    /** Left out: the type's own suggestion. */
    actions?: unknown;
    kinds: ReadonlySet<string>;
    defaults?: ReadonlyMap<string, EmailAction[]>;
    memory?: EmailMemory;
  },
  now = Date.now(),
): Promise<GroupResult> {
  const ids = Array.isArray(input.triageIds) ? [...new Set(input.triageIds)] : [];
  if (ids.length === 0 || ids.length > MAX_GROUP || !ids.every((id) => typeof id === "string" && /^[0-9a-f]{40}$/.test(id))) {
    return { ok: false, status: 400, error: `Choose between 1 and ${MAX_GROUP} emails.` };
  }
  if (typeof input.kind !== "string" || !input.kinds.has(input.kind) || input.kind === "private" || input.kind === "system") {
    return { ok: false, status: 400, error: "Choose a type from the list." };
  }
  const kind = input.kind as EmailKind;
  const actions = input.actions === undefined ? (input.defaults?.get(kind) ?? defaultActions(kind)) : parseActions(input.actions);
  if (!actions || actions.length === 0) return { ok: false, status: 400, error: "Choose actions from the list." };
  // Saving a customer or adding a request needs one email's details, checked on its own card.
  if (needsDetails(actions.map((action) => action.kind))) {
    return { ok: false, status: 400, error: "Saving customers and adding requests are done one email at a time, from its card." };
  }

  let decided = 0;
  let skipped = 0;
  let last: EmailDecision | null = null;
  const pending: string[] = [];
  for (const [index, triageId] of (ids as string[]).entries()) {
    const result = await decideCard(db, {
      businessId: input.businessId,
      triageId,
      actorUid: input.actorUid,
      via: "summary",
      choice: { choice: "change_kind", kind, actions },
      kinds: input.kinds,
      defaults: input.defaults,
      memory: input.memory,
    }, now + index);
    // Already answered, another business's, or private: left as it is.
    if (result.ok) {
      decided++;
      last = result.decision;
      if (result.decision.actionsStatus === "pending") pending.push(triageId);
    } else {
      skipped++;
    }
  }
  return { ok: true, decided, skipped, pending, last };
}
