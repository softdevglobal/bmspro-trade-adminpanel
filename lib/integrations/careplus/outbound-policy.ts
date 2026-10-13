/** Temporary outbound scope: explicit CarePlus records and participant onboardings only. */
const RECORD_EVENT_TYPES = new Set([
  "incident.captured",
  "incident.amended",
  "complaint.captured",
  "complaint.amended",
  "risk.captured",
  "risk.amended",
  "action.captured",
  "evidence.attached",
  "staff.credential.submitted",
]);

export const CAREPLUS_TRADE_SYNC_PAUSED = "trade_sync_paused";

export function isCareplusOutboundPayloadAllowed(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  if (typeof payload.eventType !== "string") return false;
  if (RECORD_EVENT_TYPES.has(payload.eventType)) return true;
  if (payload.eventType !== "directory.participant") return false;

  // Ordinary customer directory updates use this event type too. Only the
  // dedicated onboarding builder's identity is allowed through.
  const record = payload.record as Record<string, unknown> | undefined;
  const source = payload.source as Record<string, unknown> | undefined;
  const onboardingId = record?.onboardingId;
  return typeof onboardingId === "string" && Boolean(onboardingId.trim()) &&
    source?.recordId === onboardingId &&
    record?.customerId === `onboarding-${onboardingId}` &&
    payload.eventId === `bms-onboarding-${onboardingId}-r${source?.revision}`;
}

export function isCareplusOutboundBodyAllowed(rawBody: string, eventType?: string): boolean {
  try {
    const payload = JSON.parse(rawBody);
    return (!eventType || payload?.eventType === eventType) &&
      isCareplusOutboundPayloadAllowed(payload);
  } catch {
    return false;
  }
}
