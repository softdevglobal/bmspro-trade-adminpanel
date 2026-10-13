import assert from "node:assert/strict";
import { test } from "node:test";
import { isCareplusOutboundBodyAllowed, isCareplusOutboundPayloadAllowed } from "../lib/integrations/careplus/outbound-policy";
import { buildOnboardingCareplusPayload } from "../lib/participant-onboarding/careplus-payload";

test("explicit CarePlus records continue to sync", () => {
  for (const eventType of ["incident.captured", "incident.amended", "complaint.captured", "complaint.amended", "risk.captured", "risk.amended", "action.captured", "evidence.attached", "staff.credential.submitted"]) {
    assert.equal(isCareplusOutboundPayloadAllowed({ eventType }), true, eventType);
  }
});

test("Trade actions and ordinary directory updates are paused", () => {
  for (const eventType of ["job.completed", "activity.scheduled", "activity.completed", "activity.amended", "activity.cancelled", "activity.missed", "invoice.sent", "quotation.sent", "directory.participant", "directory.staff", "new.unknown.event"]) {
    assert.equal(isCareplusOutboundPayloadAllowed({ eventType }), false, eventType);
  }
});

const onboarding = buildOnboardingCareplusPayload("business-a", {
  id: "participant-a", revision: 2, participantName: "Participant",
  participantReference: "", status: "draft", sections: [],
  createdAt: "2026-10-13T00:00:00.000Z", updatedAt: "2026-10-13T00:00:00.000Z",
});

test("participant onboarding payloads remain allowed", () => {
  assert.equal(isCareplusOutboundPayloadAllowed(onboarding), true);
  assert.equal(isCareplusOutboundBodyAllowed(JSON.stringify(onboarding), "directory.participant"), true);
});

test("ordinary participant updates cannot pass as an onboarding", () => {
  assert.equal(isCareplusOutboundPayloadAllowed({ ...onboarding, eventId: "bms-customer-directory.participant-v1" }), false);
  assert.equal(isCareplusOutboundPayloadAllowed({ ...onboarding, record: { ...onboarding.record, onboardingId: "other" } }), false);
  assert.equal(isCareplusOutboundPayloadAllowed({ ...onboarding, source: { recordId: "other", revision: 2 } }), false);
});

test("queued bodies fail closed for malformed JSON or mismatched event types", () => {
  assert.equal(isCareplusOutboundBodyAllowed("not json"), false);
  assert.equal(isCareplusOutboundBodyAllowed("null"), false);
  assert.equal(isCareplusOutboundBodyAllowed(JSON.stringify(onboarding), "job.completed"), false);
  assert.equal(isCareplusOutboundBodyAllowed(JSON.stringify({ eventType: "activity.completed" })), false);
});
