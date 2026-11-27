import "server-only";

import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { createHash } from "node:crypto";

import { AGENT_ACTIONS_COLLECTION, AGENT_ACTION_TTL_MS } from "./config";
import type { AgentActionStatus } from "./types";

const SUBJECT_MAX = 120;
const BODY_MAX = 200;

const oneLine = (value: string, max: number) => {
  const text = value
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

/** The subject plus the first 200 characters of the body, on one safe line (plan §4.7). */
export function auditPreview(input: { subject?: string | null; body?: string | null }): string {
  return [
    input.subject ? oneLine(input.subject, SUBJECT_MAX) : "",
    input.body ? oneLine(input.body, BODY_MAX) : "",
  ].filter(Boolean).join(" — ");
}

/** Same event and action key, same row: a retried run overwrites its own row instead of adding one. */
export function agentActionId(eventId: string, actionKey: string): string {
  return createHash("sha256").update(`${eventId}\n${actionKey}`).digest("hex").slice(0, 40);
}

export type AgentActionInput = {
  businessId: string;
  eventId: string;
  eventType: string;
  /** Unique within the event, e.g. "move_folder" or "reply". */
  actionKey: string;
  /** What Sophie did or wanted to do, e.g. "move_folder". */
  action: string;
  status: AgentActionStatus;
  /** A policy reason code such as `PAUSED`, or null when it went through. */
  reason?: string | null;
  /** In a dry run, what would have happened (`allow`, `suggest`, `blocked` …). */
  wouldBe?: string | null;
  ruleId?: string | null;
  customerId?: string | null;
  preview?: string;
};

/** Writes one row to `ai_agent_actions`. Rows expire after 180 days. */
export async function recordAgentAction(db: Firestore, input: AgentActionInput, now = Date.now()): Promise<string> {
  const id = agentActionId(input.eventId, input.actionKey);
  await db.collection(AGENT_ACTIONS_COLLECTION).doc(id).set({
    businessId: input.businessId,
    eventId: input.eventId,
    eventType: input.eventType,
    actionKey: input.actionKey,
    action: input.action,
    status: input.status,
    reason: input.reason ?? null,
    wouldBe: input.wouldBe ?? null,
    ruleId: input.ruleId ?? null,
    customerId: input.customerId ?? null,
    preview: input.preview ?? "",
    createdAt: Timestamp.fromMillis(now),
    expireAt: Timestamp.fromMillis(now + AGENT_ACTION_TTL_MS),
  });
  return id;
}
