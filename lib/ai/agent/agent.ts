import "server-only";

import type { Firestore } from "firebase-admin/firestore";
import { randomBytes } from "node:crypto";

import { recordAgentAction } from "./audit";
import { AGENT_BATCH_SIZE, AGENT_MAX_ATTEMPTS, AGENT_RUN_BUDGET_MS, agentFlags, type AgentFlags } from "./config";
import { claimAgentEvent, findClaimableAgentEvents, settleAgentEvent } from "./events";
import { AgentHoldError, type AgentEventType, type AgentPrincipal, type ClaimedAgentEvent } from "./types";

/**
 * Sophie's runner (docs/sophie-autonomous-agent-plan.md §4.3). Each run claims a batch of events
 * with a lease, hands each one to the handler for its type, and settles it. A handler checks
 * the policy, acts or makes a card, and writes its own audit rows.
 *
 * Handlers must be safe to run twice for the same event: a run that dies after acting but
 * before settling leaves the event to be retried. Every side effect uses an idempotency key.
 */

export type AgentHandlerContext = {
  db: Firestore;
  event: ClaimedAgentEvent;
  principal: AgentPrincipal;
  flags: AgentFlags;
  now: number;
};

/** Returns a short code for what happened (e.g. "card_created"), stored on the event. */
export type AgentHandler = (context: AgentHandlerContext) => Promise<string>;
/**
 * Handlers by event type. The real ones are wired in handlers.ts (AGENT_HANDLERS). An event with
 * no handler is marked done with the result `no_handler`.
 */
export type AgentHandlers = Partial<Record<AgentEventType, AgentHandler>>;

export type AgentRunDeps = {
  db: Firestore;
  resolveOwnerUid: (businessId: string) => Promise<string | null>;
  handlers: AgentHandlers;
  flags?: AgentFlags;
  clock?: () => number;
};

export type AgentRunSummary = {
  claimed: number;
  done: number;
  noHandler: number;
  /** Handler failed; the event goes back to pending for the next run. */
  retrying: number;
  /** Out of attempts; the event is left as failed with an audit row. */
  failed: number;
  /** Waiting for later, e.g. a reply held until email hours. */
  held: number;
  /** The lease ran out mid-way and another run took the event over. */
  lostLease: number;
  /** Stopped taking events because the time budget ran out; the rest wait for the next run. */
  outOfTime: boolean;
};

const errorCode = (error: unknown) =>
  (error instanceof Error && error.name ? error.name : "Error").slice(0, 100);

export async function runAgent(
  deps: AgentRunDeps,
  options: { limit?: number; budgetMs?: number } = {},
): Promise<AgentRunSummary | { skipped: "disabled" }> {
  const flags = deps.flags ?? agentFlags();
  if (!flags.enabled) return { skipped: "disabled" };

  const clock = deps.clock ?? Date.now;
  const { handlers } = deps;
  const budgetMs = options.budgetMs ?? AGENT_RUN_BUDGET_MS;
  const started = clock();
  const leaseOwner = randomBytes(12).toString("hex");
  const summary: AgentRunSummary = {
    claimed: 0, done: 0, noHandler: 0, retrying: 0, failed: 0, held: 0, lostLease: 0, outOfTime: false,
  };

  const ids = await findClaimableAgentEvents(deps.db, started, options.limit ?? AGENT_BATCH_SIZE);
  for (const id of ids) {
    // Claim one at a time, so an event is never held by a run that has no time left for it.
    if (clock() - started >= budgetMs) {
      summary.outOfTime = true;
      break;
    }
    try {
      const claim = await claimAgentEvent(deps.db, id, clock(), leaseOwner);
      if (claim.status === "gave_up") {
        summary.failed++;
        await recordAgentAction(deps.db, {
          businessId: claim.businessId, eventId: claim.id, eventType: claim.type,
          actionKey: "run", action: "run", status: "failed", reason: "TOO_MANY_ATTEMPTS",
        }, clock());
        continue;
      }
      if (claim.status !== "claimed") continue;
      summary.claimed++;
      await processEvent(deps, handlers, flags, clock, claim.event, summary);
    } catch (error) {
      // One bad event must not stop the batch. Its lease runs out and a later run retries it.
      console.error("[agent] event failed", id.split(":")[0], errorCode(error));
    }
  }
  return summary;
}

async function processEvent(
  deps: AgentRunDeps,
  handlers: AgentHandlers,
  flags: AgentFlags,
  clock: () => number,
  event: ClaimedAgentEvent,
  summary: AgentRunSummary,
): Promise<void> {
  const settle = async (status: "done" | "failed" | "pending" | "held", result: string | null, error: string | null = null, holdUntil?: number) => {
    const settled = await settleAgentEvent(deps.db, event, { status, result, error, holdUntil }, clock());
    if (!settled) summary.lostLease++;
    return settled;
  };

  const handler = handlers[event.type];
  if (!handler) {
    if (await settle("done", "no_handler")) summary.noHandler++;
    return;
  }

  const ownerUid = await deps.resolveOwnerUid(event.businessId);
  if (!ownerUid) {
    await recordAgentAction(deps.db, {
      businessId: event.businessId, eventId: event.id, eventType: event.type,
      actionKey: "run", action: "run", status: "blocked", reason: "NO_OWNER",
    }, clock());
    if (await settle("done", "no_owner")) summary.done++;
    return;
  }

  const principal: AgentPrincipal = { kind: "agent", businessId: event.businessId, ownerUid, eventId: event.id };
  let result: string;
  try {
    result = await handler({ db: deps.db, event, principal, flags, now: clock() });
  } catch (error) {
    if (error instanceof AgentHoldError) {
      if (await settle("held", error.message.slice(0, 100), null, error.until)) summary.held++;
      return;
    }
    const code = errorCode(error);
    console.error("[agent] handler failed", event.type, code);
    if (event.attempts < AGENT_MAX_ATTEMPTS) {
      if (await settle("pending", null, code)) summary.retrying++;
      return;
    }
    await recordAgentAction(deps.db, {
      businessId: event.businessId, eventId: event.id, eventType: event.type,
      actionKey: "run", action: "run", status: "failed", reason: "HANDLER_ERROR",
    }, clock());
    if (await settle("failed", null, code)) summary.failed++;
    return;
  }
  if (await settle("done", result.slice(0, 100))) summary.done++;
}
