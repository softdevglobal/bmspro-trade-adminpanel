import assert from "node:assert/strict";
import test from "node:test";

import { runAgent, type AgentHandler, type AgentRunDeps } from "../lib/ai/agent/agent";
import { agentActionId, auditPreview, recordAgentAction } from "../lib/ai/agent/audit";
import { AGENT_LEASE_MS, AGENT_MAX_ATTEMPTS } from "../lib/ai/agent/config";
import { claimAgentEvent, settleAgentEvent, writeAgentEvent } from "../lib/ai/agent/events";
import { checkPolicy } from "../lib/ai/agent/policy";
import { AgentHoldError } from "../lib/ai/agent/types";
import { fakeFirestore, millis, type Row } from "./fake-firestore";

function fakeDb() {
  const { db, table } = fakeFirestore();
  return { db, events: table("ai_agent_events"), actions: table("ai_agent_actions") };
}

const START = Date.UTC(2026, 10, 25, 23, 0);
const ON = { enabled: true, dryRun: false };

function setup(handlers: AgentRunDeps["handlers"] = {}, ownerUid: string | null = "owner-a") {
  const fake = fakeDb();
  let now = START;
  const deps: AgentRunDeps = { db: fake.db, handlers, flags: ON, clock: () => now, resolveOwnerUid: async () => ownerUid };
  return {
    ...fake,
    deps,
    advance: (ms: number) => { now += ms; },
    write: (entityId: string, type: "email.received" | "email.sent_by_owner" = "email.received") =>
      writeAgentEvent(fake.db, { businessId: "business-a", type, entityId }, now++),
    event: (id: string) => fake.events.get(id) as Row,
  };
}

test("an event is written once however many times it happens", async () => {
  const { write, events, event } = setup();
  assert.deepEqual(await write("message-1"), { id: "email.received:message-1", written: true });
  assert.deepEqual(await write("message-1"), { id: "email.received:message-1", written: false });
  assert.equal(events.size, 1);
  assert.equal(event("email.received:message-1").status, "pending");
  assert.equal(event("email.received:message-1").businessId, "business-a");
  const expiry = millis(event("email.received:message-1").expireAt) as number;
  assert.equal(expiry - START, 30 * 24 * 60 * 60_000);
});

test("bad event references are refused before anything is written", async () => {
  const { db, events } = setup();
  await assert.rejects(writeAgentEvent(db, { businessId: "business-a", type: "email.received", entityId: "a/b" }));
  await assert.rejects(writeAgentEvent(db, { businessId: " ", type: "email.received", entityId: "m1" }));
  await assert.rejects(writeAgentEvent(db, { businessId: "business-a", type: "quote.sent" as "email.received", entityId: "q1" }));
  assert.equal(events.size, 0);
});

test("two runs at the same time handle each event exactly once", async () => {
  const seen: string[] = [];
  const handler: AgentHandler = async ({ event, principal }) => {
    assert.equal(principal.ownerUid, "owner-a");
    assert.equal(principal.businessId, event.businessId);
    seen.push(event.entityId);
    await new Promise((resolve) => setImmediate(resolve));
    return "handled";
  };
  const { deps, write, event } = setup({ "email.received": handler });
  for (const id of ["m1", "m2", "m3", "m4"]) await write(id);

  const [first, second] = await Promise.all([runAgent(deps), runAgent(deps)]);
  assert.deepEqual(seen.sort(), ["m1", "m2", "m3", "m4"]);
  assert.equal((first as { done: number }).done + (second as { done: number }).done, 4);
  assert.equal(event("email.received:m1").status, "done");
  assert.equal(event("email.received:m1").result, "handled");
  assert.equal(event("email.received:m1").leaseOwner, null);

  assert.deepEqual(await runAgent(deps), { claimed: 0, done: 0, noHandler: 0, retrying: 0, failed: 0, held: 0, lostLease: 0, outOfTime: false });
});

test("with the platform switch off nothing is claimed", async () => {
  const { deps, write, event } = setup({ "email.received": async () => assert.fail("must not run") });
  await write("m1");
  assert.deepEqual(await runAgent({ ...deps, flags: { enabled: false, dryRun: false } }), { skipped: "disabled" });
  assert.equal(event("email.received:m1").status, "pending");
});

test("an event type with no handler yet is marked done", async () => {
  const { deps, write, event, actions } = setup();
  await write("outbox-1", "email.sent_by_owner");
  const summary = await runAgent(deps);
  assert.equal((summary as { noHandler: number }).noHandler, 1);
  assert.equal(event("email.sent_by_owner:outbox-1").status, "done");
  assert.equal(event("email.sent_by_owner:outbox-1").result, "no_handler");
  assert.equal(actions.size, 0);
});

test("a failing handler is retried, then left as failed with an audit row", async () => {
  let calls = 0;
  const failing: AgentHandler = async () => { calls++; throw new RangeError("boom"); };
  const { deps, write, event, actions } = setup({ "email.received": failing });
  await write("m1");

  for (let attempt = 1; attempt < AGENT_MAX_ATTEMPTS; attempt++) {
    assert.equal((await runAgent(deps) as { retrying: number }).retrying, 1);
    assert.equal(event("email.received:m1").status, "pending");
    assert.equal(event("email.received:m1").lastError, "RangeError");
  }
  assert.equal((await runAgent(deps) as { failed: number }).failed, 1);
  assert.equal(calls, AGENT_MAX_ATTEMPTS);
  assert.equal(event("email.received:m1").status, "failed");
  const row = actions.get(agentActionId("email.received:m1", "run"));
  assert.equal(row?.status, "failed");
  assert.equal(row?.reason, "HANDLER_ERROR");
  assert.equal((await runAgent(deps) as { claimed: number }).claimed, 0);
});

test("a run that dies mid-way: the lease runs out and the next run takes over", async () => {
  const seen: number[] = [];
  const { deps, db, write, advance, event } = setup({ "email.received": async ({ event }) => { seen.push(event.attempts); return "handled"; } });
  await write("m1");

  const crashed = await claimAgentEvent(db, "email.received:m1", START, "crashed-run");
  if (crashed.status !== "claimed") return assert.fail("the first claim should succeed");
  assert.equal((await runAgent(deps) as { claimed: number }).claimed, 0, "a live lease is respected");

  advance(AGENT_LEASE_MS + 1);
  assert.equal((await runAgent(deps) as { done: number }).done, 1);
  assert.deepEqual(seen, [2]);
  // The crashed run wakes up late: its lease is gone, so it can't settle the event.
  assert.equal(await settleAgentEvent(db, crashed.event, { status: "failed" }), false);
  assert.equal(event("email.received:m1").status, "done");
});

test("an event whose lease keeps running out is given up after the attempt limit", async () => {
  const { deps, db, write, advance, event, actions } = setup({ "email.received": async () => assert.fail("must not run") });
  await write("m1");
  for (let attempt = 0; attempt < AGENT_MAX_ATTEMPTS; attempt++) {
    assert.equal((await claimAgentEvent(db, "email.received:m1", START + attempt * (AGENT_LEASE_MS + 1), `hung-${attempt}`)).status, "claimed");
  }
  advance(AGENT_MAX_ATTEMPTS * (AGENT_LEASE_MS + 1));
  assert.equal((await runAgent(deps) as { failed: number }).failed, 1);
  assert.equal(event("email.received:m1").status, "failed");
  assert.equal(event("email.received:m1").lastError, "too_many_attempts");
  assert.equal(actions.get(agentActionId("email.received:m1", "run"))?.reason, "TOO_MANY_ATTEMPTS");
});

test("a run stops taking events when its time budget is used up, leaving them unclaimed", async () => {
  const { deps, write, advance, event } = setup({ "email.received": async () => { advance(20_000); return "slow"; } });
  for (const id of ["m1", "m2", "m3", "m4"]) await write(id);
  const summary = await runAgent(deps, { budgetMs: 50_000 }) as { done: number; outOfTime: boolean };
  assert.equal(summary.done, 3);
  assert.equal(summary.outOfTime, true);
  assert.equal(event("email.received:m4").status, "pending");
  assert.equal(event("email.received:m4").attempts, 0);
});

test("a business with no owner is skipped and logged", async () => {
  const { deps, write, event, actions } = setup({ "email.received": async () => assert.fail("must not run") }, null);
  await write("m1");
  await runAgent(deps);
  assert.equal(event("email.received:m1").result, "no_owner");
  assert.equal(actions.get(agentActionId("email.received:m1", "run"))?.reason, "NO_OWNER");
});

test("dry run: the handler logs what it would do and does nothing", async () => {
  const acted: string[] = [];
  const handler: AgentHandler = async ({ db, event, flags, now }) => {
    const decision = checkPolicy({
      now, flags, businessPaused: false, authority: { kind: "rule", level: "auto" }, autoAllowed: true,
      neverAuto: false, dedupeKeyUsed: false, stillNeeded: true, contact: null, text: null,
    });
    if (!decision.dryRun && decision.outcome === "allow") acted.push(event.entityId);
    await recordAgentAction(db, {
      businessId: event.businessId, eventId: event.id, eventType: event.type, actionKey: "move_folder",
      action: "move_folder", status: decision.dryRun ? "dry_run" : "done", reason: decision.reason,
      wouldBe: decision.outcome, preview: auditPreview({ subject: "50% off this week" }),
    }, now);
    return decision.dryRun ? "dry_run" : "done";
  };
  const { deps, write, actions } = setup({ "email.received": handler });
  await write("m1");
  await runAgent({ ...deps, flags: { enabled: true, dryRun: true } });
  assert.deepEqual(acted, []);
  const row = actions.get(agentActionId("email.received:m1", "move_folder"));
  assert.equal(row?.status, "dry_run");
  assert.equal(row?.wouldBe, "allow");
  assert.equal(row?.preview, "50% off this week");
});

test("a retried run overwrites its audit row instead of adding a second one", async () => {
  const { db, actions } = setup();
  const row = { businessId: "b", eventId: "email.received:m1", eventType: "email.received", actionKey: "reply", action: "reply" };
  await recordAgentAction(db, { ...row, status: "held", reason: "OUTSIDE_HOURS" });
  await recordAgentAction(db, { ...row, status: "done" });
  assert.equal(actions.size, 1);
  assert.equal([...actions.values()][0].status, "done");
});

test("a handler that must wait holds its event until then, without using up an attempt", async () => {
  let calls = 0;
  const handler: AgentHandler = async () => {
    calls++;
    if (calls === 1) throw new AgentHoldError(START + 8 * 60 * 60_000, "OUTSIDE_HOURS");
    return "sent";
  };
  const { deps, write, event, advance } = setup({ "email.received": handler });
  await write("m-held");
  const first = await runAgent(deps);
  assert.equal("held" in first && first.held, 1);
  const held = event("email.received:m-held");
  assert.deepEqual([held.status, held.attempts, millis(held.notBefore), held.result], ["held", 0, START + 8 * 60 * 60_000, "OUTSIDE_HOURS"]);
  assert.equal("claimed" in (await runAgent(deps)) && calls, 1, "not before its time");
  advance(8 * 60 * 60_000);
  await runAgent(deps);
  assert.deepEqual([event("email.received:m-held").status, event("email.received:m-held").result, calls], ["done", "sent", 2]);
});
