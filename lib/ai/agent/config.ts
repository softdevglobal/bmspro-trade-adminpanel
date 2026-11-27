/**
 * Switches and limits for Sophie's background engine (docs/sophie-autonomous-agent-plan.md §4, §12).
 * Kept apart from the runner so event writers can check the switch without importing it.
 */

export const AGENT_EVENTS_COLLECTION = "ai_agent_events";
export const AGENT_ACTIONS_COLLECTION = "ai_agent_actions";

/** One run claims at most this many events. */
export const AGENT_BATCH_SIZE = 25;
/** An event whose lease runs out is picked up again by the next run. */
export const AGENT_LEASE_MS = 2 * 60_000;
/** After this many tries an event is marked failed and left for a person to look at. */
export const AGENT_MAX_ATTEMPTS = 3;
/** Vercel stops a function at 60 seconds; stop taking new events well before that. */
export const AGENT_RUN_BUDGET_MS = 50_000;

const DAY_MS = 24 * 60 * 60_000;
/** Firestore TTL deletes rows once `expireAt` passes (plan §11). */
export const AGENT_EVENT_TTL_MS = 30 * DAY_MS;
export const AGENT_ACTION_TTL_MS = 180 * DAY_MS;

export type AgentFlags = {
  /** `AI_AGENT_ENABLED`: the platform switch. Off stops the runner for every business. */
  enabled: boolean;
  /** `AI_AGENT_DRY_RUN`: log what would happen and do nothing. On unless set to exactly "false". */
  dryRun: boolean;
};

export function agentFlags(env: Readonly<Record<string, string | undefined>> = process.env): AgentFlags {
  return {
    enabled: env.AI_AGENT_ENABLED?.trim() === "true",
    dryRun: env.AI_AGENT_DRY_RUN?.trim() !== "false",
  };
}
