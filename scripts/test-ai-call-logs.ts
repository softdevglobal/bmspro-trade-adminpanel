import assert from "node:assert/strict";
import test from "node:test";
import { callLogInput, callOutcome, callLogRetentionDays, toCallLogSummary, type CallLogInput } from "../lib/ai/data/call-logs";

const valid: CallLogInput = {
  callId: "0a41e31d-0620-47d1-9ef9-c9c60cef73a8",
  startedAt: "2026-11-06T06:40:00.000Z",
  answeredAt: "2026-11-06T06:40:03.000Z",
  endedAt: "2026-11-06T06:42:10.000Z",
  durationMs: 130_000,
  setupMs: 2400,
  endReason: "caller disconnected",
  callerNumber: null,
  tools: [{ name: "search_business_knowledge", status: "FOUND", durationMs: 712 }],
  outcomes: [],
  transcript: [
    { speaker: "sophie", atMs: 0, text: "Hi, thanks for calling Nira Electrical." },
    { speaker: "caller", atMs: 2500, text: "Do you charge to come out?" },
  ],
};

test("a bridge call log validates, and business or unknown fields are rejected", () => {
  assert.equal(callLogInput.safeParse(valid).success, true);
  assert.equal(callLogInput.safeParse({ ...valid, businessId: "other-business" }).success, false);
  assert.equal(callLogInput.safeParse({ ...valid, callId: "../../etc" }).success, false);
  assert.equal(callLogInput.safeParse({ ...valid, transcript: [{ speaker: "admin", atMs: 0, text: "x" }] }).success, false);
  assert.equal(callLogInput.safeParse({ ...valid, tools: [{ name: "bad name!", status: "OK", durationMs: 1 }] }).success, false);
  assert.equal(callLogInput.safeParse({ ...valid, callerNumber: "+61 412" }).success, false);
  assert.equal(callLogInput.safeParse({ ...valid, transcript: Array(501).fill(valid.transcript[0]) }).success, false);
});

test("the headline outcome reflects booking tool results", () => {
  assert.equal(callOutcome([]), "no_booking");
  assert.equal(callOutcome([{ tool: "register_customer", status: "CREATED", reference: "c1" }]), "no_booking");
  assert.equal(callOutcome([{ tool: "create_inspection_request", status: "PENDING_REVIEW", reference: "r1" }]), "request_sent");
  assert.equal(callOutcome([{ tool: "create_job_booking", status: "CONFIRMED", reference: "BK1" }]), "booked");
  assert.equal(callOutcome([{ tool: "create_inspection_request", status: "UNKNOWN", reference: null }]), "needs_staff");
  assert.equal(callOutcome([{ tool: "create_inspection_request", status: "REJECTED", reference: null }]), "no_booking");
});

test("summaries never include transcript text and retention is bounded", () => {
  const summary = toCallLogSummary("id", { transcript: valid.transcript, firstCallerLine: "Do you charge to come out?", outcome: "hacked" });
  assert.ok(!("transcript" in summary));
  assert.equal(summary.outcome, "no_booking");
  assert.equal(callLogRetentionDays({}), 90);
  assert.equal(callLogRetentionDays({ AI_CALL_LOG_RETENTION_DAYS: "30" }), 30);
  assert.equal(callLogRetentionDays({ AI_CALL_LOG_RETENTION_DAYS: "0" }), 90);
  assert.equal(callLogRetentionDays({ AI_CALL_LOG_RETENTION_DAYS: "99999" }), 90);
});

test("saving a call log requires the bridge secret", async () => {
  const { POST } = await import("../app/api/ai/calls/route");
  const previous = { enabled: process.env.AI_VOICE_DIRECT_ENABLED, secret: process.env.AI_VOICE_BRIDGE_SECRET };
  process.env.AI_VOICE_DIRECT_ENABLED = "true";
  process.env.AI_VOICE_BRIDGE_SECRET = "test-call-log-secret-0000000000000000000";
  try {
    const post = (headers: Record<string, string>) => POST(new Request("http://localhost/api/ai/calls", {
      method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(valid),
    }));
    assert.equal((await post({})).status, 401);
    assert.equal((await post({ Authorization: "Bearer wrong", "X-BMSPro-DID": "0359111403" })).status, 401);
    assert.equal((await post({ Authorization: `Bearer ${process.env.AI_VOICE_BRIDGE_SECRET}`, "X-BMSPro-DID": "abc" })).status, 403);
  } finally {
    if (previous.enabled === undefined) delete process.env.AI_VOICE_DIRECT_ENABLED; else process.env.AI_VOICE_DIRECT_ENABLED = previous.enabled;
    if (previous.secret === undefined) delete process.env.AI_VOICE_BRIDGE_SECRET; else process.env.AI_VOICE_BRIDGE_SECRET = previous.secret;
  }
});
