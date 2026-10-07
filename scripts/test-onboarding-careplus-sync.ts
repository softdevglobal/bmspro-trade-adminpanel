import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOnboardingCareplusPayload } from "../lib/participant-onboarding/careplus-payload";

const record = {
  id: "saved-record", revision: 1, createdAt: "2026-10-07T10:00:00.000Z", updatedAt: "2026-10-07T10:00:00.000Z",
  participantName: "Participant example", participantReference: "private-reference", status: "draft" as const,
  sections: [{ id: "health", title: "Private health", description: "", fields: [{ id: "answer", label: "Sensitive", type: "text" as const, value: "Private answer" }] }],
};
test("Transfer contains only name and stable onboarding identity", () => {
  const payload = buildOnboardingCareplusPayload("tenant-a", record);
  assert.deepEqual(payload.record, { customerId: "onboarding-saved-record", name: "Participant example", onboardingId: "saved-record" });
  assert.equal(payload.businessId, "tenant-a");
  assert.equal(payload.eventType, "directory.participant");
  assert.equal(JSON.stringify(payload).includes("Private answer"), false);
  assert.equal(JSON.stringify(payload).includes("private-reference"), false);
});
test("Repeated saves retain participant identity and use revision-specific events", () => {
  const first = buildOnboardingCareplusPayload("tenant-a", record);
  const second = buildOnboardingCareplusPayload("tenant-a", { ...record, revision: 2, participantName: "Changed name" });
  assert.equal(first.record.customerId, second.record.customerId);
  assert.notEqual(first.eventId, second.eventId);
  assert.equal(second.source.revision, 2);
  assert.equal(first.source.recordId, record.id);
});
