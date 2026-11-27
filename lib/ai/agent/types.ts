/**
 * Shared types for Sophie's background engine (docs/sophie-autonomous-agent-plan.md §4).
 * Each feature adds its own event types here when it starts writing them.
 */

export const AGENT_EVENT_TYPES = [
  /** New mail in a connected Inbox (docs/sophie-email-learning-and-auto-reply.md §14.1). */
  "email.received",
  /** A person at the business sent an email, not Sophie (plan §4.1; feeds the style guide). */
  "email.sent_by_owner",
  /** The owner answered an email card; its actions are run (email plan step 6). Entity: the triage id. */
  "email.decided",
  /** A safety email: send the owner-approved safety reply at once (email plan §10.5). Entity: the triage id. */
  "email.safety",
] as const;

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export type AgentEventStatus = "pending" | "processing" | "done" | "failed";

/** An event the runner has claimed; only the claimer may settle it. */
export type ClaimedAgentEvent = {
  id: string;
  businessId: string;
  type: AgentEventType;
  entityId: string;
  attempts: number;
  leaseOwner: string;
  createdAt: number;
};

/** The fixed identity Sophie acts as. She never borrows a browser session (plan §4.4). */
export type AgentPrincipal = {
  kind: "agent";
  businessId: string;
  ownerUid: string;
  eventId: string;
};

export type AutomationLevel = "off" | "suggest" | "auto";

/** One audit row per decision (plan §4.7). `skipped` marks a duplicate that was already handled. */
export type AgentActionStatus = "done" | "suggested" | "blocked" | "held" | "failed" | "dry_run" | "skipped";

/** The longest an event may wait: a reply held overnight for the email hours. */
export const AGENT_MAX_HOLD_MS = 24 * 60 * 60_000;

/**
 * Thrown by a handler that must wait, e.g. a reply outside the business's email hours (plan §4.6
 * check 9). The event is held until `until` without using up an attempt, then runs again.
 */
export class AgentHoldError extends Error {
  readonly until: number;
  constructor(until: number, reason = "HELD") {
    super(reason);
    this.name = "AgentHold";
    this.until = until;
  }
}
