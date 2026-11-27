import "server-only";

import { Timestamp, type Firestore } from "firebase-admin/firestore";

import {
  AGENT_EVENTS_COLLECTION,
  AGENT_EVENT_TTL_MS,
  AGENT_LEASE_MS,
  AGENT_MAX_ATTEMPTS,
} from "./config";
import { AGENT_EVENT_TYPES, AGENT_MAX_HOLD_MS, type AgentEventType, type ClaimedAgentEvent } from "./types";

/** gRPC status Firestore returns when create() finds the document already there. */
const ALREADY_EXISTS = 6;

const toMillis = (value: unknown): number | null =>
  value instanceof Timestamp ? value.toMillis() : null;

const isEventType = (value: unknown): value is AgentEventType =>
  typeof value === "string" && (AGENT_EVENT_TYPES as readonly string[]).includes(value);

/** A Firestore doc id segment: non-empty, no slash, short. */
const validRef = (value: string) => value.length > 0 && value.length <= 500 && !value.includes("/");

/**
 * The doc id is the dedupe key (plan §4.1): the same thing happening twice is one event.
 * Entity ids are Firestore doc ids from global collections, so they never collide across businesses.
 */
export function agentEventId(type: AgentEventType, entityId: string): string {
  return `${type}:${entityId}`;
}

/** Records that something happened. Writing the same event again is a no-op. */
export async function writeAgentEvent(
  db: Firestore,
  input: { businessId: string; type: AgentEventType; entityId: string },
  now = Date.now(),
): Promise<{ id: string; written: boolean }> {
  const businessId = input.businessId.trim();
  const entityId = input.entityId.trim();
  if (!isEventType(input.type)) throw new Error("Unknown agent event type.");
  if (!validRef(businessId) || !validRef(entityId)) throw new Error("Invalid agent event reference.");

  const id = agentEventId(input.type, entityId);
  try {
    await db.collection(AGENT_EVENTS_COLLECTION).doc(id).create({
      businessId,
      type: input.type,
      entityId,
      status: "pending",
      attempts: 0,
      leaseOwner: null,
      leaseUntil: null,
      result: null,
      lastError: null,
      createdAt: Timestamp.fromMillis(now),
      updatedAt: Timestamp.fromMillis(now),
      expireAt: Timestamp.fromMillis(now + AGENT_EVENT_TTL_MS),
    });
    return { id, written: true };
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === ALREADY_EXISTS) return { id, written: false };
    throw error;
  }
}

/**
 * Event ids a run may try to claim: leases that ran out first (they are the oldest work),
 * then pending events, oldest first. Claiming still happens one by one in a transaction.
 */
export async function findClaimableAgentEvents(db: Firestore, now: number, limit: number): Promise<string[]> {
  const events = db.collection(AGENT_EVENTS_COLLECTION);
  const [expired, due, pending] = await Promise.all([
    events.where("status", "==", "processing").where("leaseUntil", "<", Timestamp.fromMillis(now)).limit(limit).get(),
    events.where("status", "==", "held").where("notBefore", "<", Timestamp.fromMillis(now)).limit(limit).get(),
    events.where("status", "==", "pending").orderBy("createdAt", "asc").limit(limit).get(),
  ]);
  return [...new Set([...expired.docs, ...due.docs, ...pending.docs].map((doc) => doc.id))].slice(0, limit);
}

export type AgentClaim =
  | { status: "claimed"; event: ClaimedAgentEvent }
  /** Its lease ran out too many times (a crash or a hang each time). It is now `failed`. */
  | { status: "gave_up"; id: string; businessId: string; type: string }
  /** Already done, or another run holds a live lease on it. */
  | { status: "unavailable" };

/**
 * Takes a lease on one event. Safe to call from two runs at once: the transaction lets only
 * one of them move it to `processing`, and the other sees a live lease and gets `unavailable`.
 */
export async function claimAgentEvent(
  db: Firestore,
  eventId: string,
  now: number,
  leaseOwner: string,
): Promise<AgentClaim> {
  const ref = db.collection(AGENT_EVENTS_COLLECTION).doc(eventId);
  return db.runTransaction(async (tx): Promise<AgentClaim> => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!snap.exists || !data) return { status: "unavailable" };

    const leaseExpired = data.status === "processing" && (toMillis(data.leaseUntil) ?? 0) <= now;
    const holdOver = data.status === "held" && (toMillis(data.notBefore) ?? 0) <= now;
    if (data.status !== "pending" && !leaseExpired && !holdOver) return { status: "unavailable" };

    const attempts = Number(data.attempts) || 0;
    const giveUp = (lastError: string): AgentClaim => {
      tx.update(ref, {
        status: "failed",
        leaseOwner: null,
        leaseUntil: null,
        lastError,
        updatedAt: Timestamp.fromMillis(now),
      });
      return { status: "gave_up", id: snap.id, businessId: String(data.businessId ?? ""), type: String(data.type ?? "") };
    };
    if (!isEventType(data.type)) return giveUp("unknown_type");
    if (attempts >= AGENT_MAX_ATTEMPTS) return giveUp("too_many_attempts");

    tx.update(ref, {
      status: "processing",
      attempts: attempts + 1,
      leaseOwner,
      leaseUntil: Timestamp.fromMillis(now + AGENT_LEASE_MS),
      updatedAt: Timestamp.fromMillis(now),
    });
    return {
      status: "claimed",
      event: {
        id: snap.id,
        businessId: String(data.businessId),
        type: data.type,
        entityId: String(data.entityId),
        attempts: attempts + 1,
        leaseOwner,
        createdAt: toMillis(data.createdAt) ?? now,
      },
    };
  });
}

/**
 * Finishes a claimed event: `done`, `failed`, or back to `pending` for the next run to retry.
 * Returns false when this run no longer holds the lease (it ran out and another run took over),
 * in which case nothing is written.
 */
export async function settleAgentEvent(
  db: Firestore,
  event: ClaimedAgentEvent,
  /** held: wait until `holdUntil`; the attempt this run used is given back. */
  outcome: { status: "done" | "failed" | "pending" | "held"; result?: string | null; error?: string | null; holdUntil?: number },
  now = Date.now(),
): Promise<boolean> {
  const ref = db.collection(AGENT_EVENTS_COLLECTION).doc(event.id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!snap.exists || data?.status !== "processing" || data.leaseOwner !== event.leaseOwner) return false;
    tx.update(ref, {
      status: outcome.status,
      result: outcome.result ?? null,
      lastError: outcome.error ?? null,
      leaseOwner: null,
      leaseUntil: null,
      updatedAt: Timestamp.fromMillis(now),
      ...(outcome.status === "held"
        ? {
          notBefore: Timestamp.fromMillis(Math.min(Math.max(outcome.holdUntil ?? now, now), now + AGENT_MAX_HOLD_MS)),
          attempts: Math.max(0, (Number(data.attempts) || 1) - 1),
        }
        : {}),
      ...(outcome.status === "pending" || outcome.status === "held" ? {} : { finishedAt: Timestamp.fromMillis(now) }),
    });
    return true;
  });
}
