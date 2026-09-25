/**
 * Unit tests for CarePlus incident / complaint / risk capture envelopes.
 *
 * Run: npm run test:careplus-records
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  amendedEventTypeFor,
  buildCaptureEnvelope,
  buildCaptureEventId,
  buildComplaintRecord,
  buildIncidentRecord,
  buildRiskRecord,
  capturedEventTypeFor,
  nextCaptureRevision,
  validateCaptureBasics,
} from "../lib/integrations/careplus/capture-records";

describe("CarePlus capture event ids", () => {
  it("uses stable v1 ids for captured events", () => {
    assert.equal(
      buildCaptureEventId("rec-1", "incident.captured", 1),
      "bms-rec-1-incident.captured-v1",
    );
    assert.equal(
      buildCaptureEventId("rec-1", "complaint.captured", 1),
      "bms-rec-1-complaint.captured-v1",
    );
    assert.equal(
      buildCaptureEventId("rec-1", "risk.captured", 1),
      "bms-rec-1-risk.captured-v1",
    );
  });

  it("uses revisioned ids for amended events", () => {
    assert.equal(
      buildCaptureEventId("rec-1", "incident.amended", 2),
      "bms-rec-1-incident.amended-r2",
    );
    assert.equal(nextCaptureRevision(1), 2);
    assert.equal(nextCaptureRevision(null), 1);
  });
});

describe("incident.captured / incident.amended", () => {
  it("builds a participantless incident envelope", () => {
    const record = buildIncidentRecord({
      title: "Fall in hallway",
      date: "2026-09-20",
      incidentTime: "14:30",
      incidentType: "Fall",
      severity: "high",
      description: "Participant slipped near the bathroom door.",
      immediateAction: "First aid given",
      location: "Hallway",
      witnesses: "Witnessed by staff",
      injuryDetails: "None observed",
      notifiedParties: ["Family, guardian or nominee"],
      escalationMade: "Called supervisor",
    });
    assert.equal(record.customerId, undefined);
    assert.equal(record.severity, "high");
    assert.equal(record.incidentType, "Fall");
    assert.equal(record.incidentTime, "14:30");
    assert.deepEqual(record.notifiedParties, ["Family, guardian or nominee"]);

    const envelope = buildCaptureEnvelope({
      businessId: "biz-a",
      recordId: "inc-1",
      eventType: capturedEventTypeFor("incident"),
      revision: 1,
      occurredAt: "2026-09-20T10:00:00.000Z",
      record,
    });

    assert.equal(envelope.eventType, "incident.captured");
    assert.equal(envelope.eventId, "bms-inc-1-incident.captured-v1");
    assert.equal(envelope.source.recordId, "inc-1");
    assert.equal(envelope.source.revision, 1);
    assert.equal(envelope.source.customerId, undefined);
    assert.equal(envelope.record.title, "Fall in hallway");
  });

  it("builds an amended incident with the same source.recordId", () => {
    const record = buildIncidentRecord({
      title: "Fall in hallway",
      customerId: "cust-1",
      date: "2026-09-20",
      severity: "critical",
      description: "Updated severity after medical review.",
    });
    const envelope = buildCaptureEnvelope({
      businessId: "biz-a",
      recordId: "inc-1",
      eventType: amendedEventTypeFor("incident"),
      revision: 2,
      customerId: "cust-1",
      record,
    });
    assert.equal(envelope.eventType, "incident.amended");
    assert.equal(envelope.eventId, "bms-inc-1-incident.amended-r2");
    assert.equal(envelope.source.recordId, "inc-1");
    assert.equal(envelope.source.revision, 2);
    assert.equal(envelope.source.customerId, "cust-1");
  });
});

describe("complaint.captured / complaint.amended", () => {
  it("supports anonymous complaints with no customer", () => {
    const record = buildComplaintRecord({
      title: "Noise complaint",
      date: "2026-09-21",
      description: "Anonymous neighbour feedback about night noise.",
      anonymous: true,
      channel: "phone",
      category: "Communication",
      requestedOutcome: "Quieter evenings",
      actionTaken: "Logged call",
      ownerId: "staff-1",
      due: "2026-09-28",
      safetyConcern: false,
      supportOffered: "Offered a call-back",
    });
    assert.equal(record.anonymous, true);
    assert.equal(record.customerId, undefined);
    assert.equal(record.category, "Communication");
    assert.equal(record.complainantName, undefined);

    const envelope = buildCaptureEnvelope({
      businessId: "biz-a",
      recordId: "cmp-1",
      eventType: "complaint.captured",
      revision: 1,
      customerId: "should-be-dropped",
      staffId: "staff-1",
      record,
    });
    assert.equal(envelope.eventType, "complaint.captured");
    assert.equal(envelope.source.customerId, undefined);
    assert.equal(envelope.source.staffId, "staff-1");
    assert.equal(envelope.record.anonymous, true);
  });

  it("flags safety or harm for incident follow-up", () => {
    const record = buildComplaintRecord({
      title: "Unsafe ramp",
      customerId: "cust-2",
      date: "2026-09-21",
      description: "Complainant reported a near miss on the ramp.",
      anonymous: false,
      channel: "in_person",
      safetyConcern: true,
      riskLevel: "high",
      riskNotes: "Near miss on wet ramp",
      complainantName: "Sam",
      complainantRelationship: "Family member",
      complainantContact: "sam@example.com",
    });
    assert.equal(record.safetyConcern, true);
    assert.equal(record.safetyOrHarm, true);
    assert.equal(record.customerId, "cust-2");
    assert.equal(record.riskLevel, "high");

    const amend = buildCaptureEnvelope({
      businessId: "biz-a",
      recordId: "cmp-2",
      eventType: "complaint.amended",
      revision: 3,
      customerId: "cust-2",
      record,
    });
    assert.equal(amend.eventId, "bms-cmp-2-complaint.amended-r3");
  });
});

describe("risk.captured / risk.amended", () => {
  it("builds a risk with status and treatment fields", () => {
    const record = buildRiskRecord({
      title: "Wet floor risk",
      hazard: "Entrance mats hold water after rain.",
      likelihood: "medium",
      consequence: "high",
      existingControls: "Wet floor signs",
      treatment: "Replace mats and add drainage",
      siteOrAsset: "Front entrance",
      proposedOwner: "ops-lead",
      reviewDate: "2026-10-01",
      status: "open",
    });
    assert.equal(record.status, "open");
    assert.equal(record.hazard, "Entrance mats hold water after rain.");
    assert.equal(record.reviewOwnerId, "ops-lead");

    const envelope = buildCaptureEnvelope({
      businessId: "biz-a",
      recordId: "risk-1",
      eventType: "risk.captured",
      revision: 1,
      record,
    });
    assert.equal(envelope.eventType, "risk.captured");
    assert.equal(envelope.eventId, "bms-risk-1-risk.captured-v1");
    assert.equal(envelope.source.recordId, "risk-1");
  });

  it("amends risk without inventing customer ids", () => {
    const record = buildRiskRecord({
      title: "Wet floor risk",
      hazard: "Updated after inspection.",
      likelihood: "low",
      consequence: "medium",
      status: "assessed",
    });
    const envelope = buildCaptureEnvelope({
      businessId: "biz-a",
      recordId: "risk-1",
      eventType: "risk.amended",
      revision: 2,
      record,
    });
    assert.equal(envelope.eventType, "risk.amended");
    assert.equal(envelope.eventId, "bms-risk-1-risk.amended-r2");
    assert.equal(envelope.source.customerId, undefined);
  });
});

describe("validation", () => {
  it("requires date for incident and complaint", () => {
    assert.equal(
      validateCaptureBasics({
        title: "x",
        description: "short",
        kind: "incident",
      }),
      "Enter a title.",
    );
    assert.equal(
      validateCaptureBasics({
        title: "Valid title",
        description: "Long enough description here",
        kind: "complaint",
      }),
      "Enter the date.",
    );
    assert.equal(
      validateCaptureBasics({
        title: "Valid title",
        description: "Long enough hazard text here",
        kind: "risk",
      }),
      null,
    );
  });
});
