import type { OnboardingRecord } from "./types";
import type { CareplusRecordPayload } from "../integrations/careplus/types";

/** Stable identity prevents repeat saves from creating duplicate participants. */
export function buildOnboardingCareplusPayload(businessId: string, record: OnboardingRecord): CareplusRecordPayload {
  return {
    eventId: `bms-onboarding-${record.id}-r${record.revision}`,
    eventType: "directory.participant",
    businessId,
    occurredAt: record.updatedAt,
    source: { recordId: record.id, revision: record.revision },
    record: {
      customerId: `onboarding-${record.id}`,
      name: record.participantName.slice(0, 160),
      onboardingId: record.id,
    },
  };
}
