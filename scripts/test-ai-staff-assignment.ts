import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { planTradeStaffAssignment, staffCanPerformService } from "../lib/team/ai-assignment-planner";
import { verifyAiAssignmentSignature } from "../lib/team/ai-assignment-auth";

function fixture() {
  return {
    service: { id: "service", isActive: true, requiredSkill: "plumbing" },
    staff: [{ id: "plumber", role: "staff", status: "active", staffType: "plumbing", fullName: "Plumber", availability: ["Weekdays", "Saturdays", "Sundays"] }],
    slots: [{ date: "2099-01-05", timeRange: "morning" }], leave: [] as Record<string, any>[], work: [] as Record<string, any>[], closures: [] as string[],
    timezone: "Australia/Melbourne", workingHours: { startTime: "08:00", endTime: "17:00" }, now: new Date("2026-10-26T00:00:00Z"), durationMinutes: 60, travelBufferMinutes: 30,
  };
}
test("qualified staff get an inspection proposal within the customer's session", () => {
  const result = planTradeStaffAssignment(fixture());
  assert.equal(result.assignedTo?.uid, "plumber");
  assert.deepEqual(result.aiAssignment.proposedSlot, { date: "2099-01-05", timeRange: "morning", startTime: "08:00", endTime: "09:00" });
});
test("unknown skills, inactive staff, missing schedules and closures require review", () => {
  const changes = [
    (input: ReturnType<typeof fixture>) => { input.staff[0].staffType = "electrician"; },
    (input: ReturnType<typeof fixture>) => { input.staff[0].status = "suspended"; },
    (input: ReturnType<typeof fixture>) => { input.staff[0].availability = []; },
    (input: ReturnType<typeof fixture>) => { input.closures = ["2099-01-05"]; },
  ];
  for (const change of changes) { const input = fixture(); change(input); assert.equal(planTradeStaffAssignment(input).aiAssignment.status, "needs_review"); }
});
test("pending and approved full-day leave exclude staff; partial leave permits later work", () => {
  for (const status of ["pending", "approved"]) {
    const input = fixture(); input.leave = [{ requesterUid: "plumber", status, fromDate: "2099-01-05", toDate: "2099-01-05", isFullDay: true }];
    assert.equal(planTradeStaffAssignment(input).assignedTo, null);
    input.leave[0] = { ...input.leave[0], isFullDay: false, startTime: "08:00", endTime: "10:00" };
    assert.equal(planTradeStaffAssignment(input).aiAssignment.proposedSlot?.startTime, "10:00");
  }
});
test("jobs and pending Sophie proposals block overlap including travel buffer", () => {
  const input = fixture(); input.work = [{ status: "scheduled", assignedTo: { uid: "plumber" }, scheduledSlot: { date: "2099-01-05", timeRange: "morning" }, scheduledStartTime: "08:00", scheduledEndTime: "09:00" }];
  assert.equal(planTradeStaffAssignment(input).aiAssignment.proposedSlot?.startTime, "09:30");
  input.work.push({ status: "pending", assignedTo: { uid: "plumber" }, aiAssignment: { proposedSlot: { date: "2099-01-05", timeRange: "morning", startTime: "09:30", endTime: "11:00" } } });
  assert.equal(planTradeStaffAssignment(input).assignedTo, null);
});
test("least busy eligible staff wins, and no match falls through to another preferred session", () => {
  const input = fixture(); input.staff.push({ ...input.staff[0], id: "free" });
  input.work = [{ status: "scheduled", assignedTo: { uid: "plumber" }, scheduledSlot: { date: "2099-01-05", timeRange: "afternoon" }, scheduledStartTime: "13:00", scheduledEndTime: "15:00" }];
  assert.equal(planTradeStaffAssignment(input).assignedTo?.uid, "free");
  input.closures = ["2099-01-05"]; input.slots.push({ date: "2099-01-06", timeRange: "afternoon" });
  assert.equal(planTradeStaffAssignment(input).aiAssignment.proposedSlot?.date, "2099-01-06");
});
test("signature binds customer details and timestamp; invalid or old credentials are rejected", () => {
  const secret = "test-secret".padEnd(32, "x"), now = Date.now(), timestamp = String(now), body = { slug: "business", serviceId: "service" };
  const signature = createHmac("sha256", secret).update(`${timestamp}.${JSON.stringify(body)}`).digest("hex");
  assert.equal(verifyAiAssignmentSignature(body, timestamp, signature, secret, now), true);
  assert.equal(verifyAiAssignmentSignature({ ...body, slug: "another" }, timestamp, signature, secret, now), false);
  assert.equal(verifyAiAssignmentSignature(body, timestamp, signature, secret, now + 61_000), false);
  assert.equal(verifyAiAssignmentSignature(body, timestamp, signature, undefined, now), false);
});

test("explicit staff service configuration overrides free-text role matching", () => {
  const input = fixture();
  assert.equal(staffCanPerformService({ ...input.staff[0], serviceIds: [] }, input.service), false);
  assert.equal(staffCanPerformService({ ...input.staff[0], staffType: "Supervisor", serviceIds: ["service"] }, input.service), true);
  assert.equal(staffCanPerformService({ ...input.staff[0], serviceIds: ["other"] }, input.service), false);
});
test("customer portal requests can use the same proposal planner with clear attribution", () => {
  const input = fixture();
  const result = planTradeStaffAssignment({ ...input, assignedBy: "customer_portal" });
  assert.equal(result.aiAssignment.status, "assigned");
  assert.equal(result.aiAssignment.assignedBy, "customer_portal");
});
