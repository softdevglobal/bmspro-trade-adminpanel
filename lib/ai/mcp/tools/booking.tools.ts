import { availabilityArguments, inspectionArguments, voiceCustomerMatches,
  type VoiceActionResult, type ScheduleVoiceTask } from "./action-schemas";
import { parseInspectionRequestInput, type InspectionRequestInput, type InspectionRequestDetail } from "@/lib/inspection/types";
import { runVoiceOperation, voiceOperationStore } from "./operation";
import type { VoiceBusiness } from "../../config";

export interface VoiceBookingDependencies {
  business(): Promise<Record<string, unknown>>;
  activeService(id: string): Promise<boolean>;
  customer(id: string): Promise<Record<string, unknown> | undefined>;
  unavailable(from: string, to: string, timezone: string): Promise<unknown>;
  validateSlots(slots: InspectionRequestInput["preferredSlots"], timezone: string): Promise<{ ok: true } | { ok: false; error: string }>;
  create(input: InspectionRequestInput, customerId: string | null, autoConfirm: boolean): Promise<{ ok: true; request: InspectionRequestDetail } | { ok: false; error: string }>;
  created(request: InspectionRequestDetail): void;
  writesEnabled(): boolean;
  once(key: string, details: unknown, send: () => Promise<VoiceActionResult>): Promise<VoiceActionResult>;
}
export function bookingActions(binding: VoiceBusiness, deps: VoiceBookingDependencies) {
  return {
    availability: async (raw: unknown) => {
      const args = availabilityArguments.parse(raw);
      const span = (Date.parse(args.to) - Date.parse(args.from)) / 86_400_000;
      if (span < 0 || span >= 90) throw new Error("Choose a range of 1-90 days.");
      const business = await deps.business();
      const timezone = typeof business.timezone === "string" ? business.timezone : "Australia/Melbourne";
      return { brand: "trade", from: args.from, to: args.to, timezone, unavailable: await deps.unavailable(args.from, args.to, timezone),
        sessions: ["morning", "afternoon"], message: "Sessions are preferences. Only a CONFIRMED submission result confirms an appointment." };
    },
    create: async (raw: unknown): Promise<VoiceActionResult> => {
      if (!deps.writesEnabled()) return { status: "REJECTED", message: "Inspection submission is disabled." };
      const args = inspectionArguments.safeParse(raw);
      if (!args.success) return { status: "REJECTED", message: "Check the required details and obtain explicit confirmation after reading them back." };
      const { requestKey, serviceId, customerId, customer, address, preferredSlots, budgetAud, customerNotes } = args.data;
      const business = await deps.business();
      const timezone = typeof business.timezone === "string" ? business.timezone : "Australia/Melbourne";
      const details = { serviceId, customerId, customer, address, preferredSlots, budgetAud, customerNotes };
      return deps.once(requestKey, details, async () => {
        const parsed = parseInspectionRequestInput({ ...details, requestType: "existing_service" }, timezone);
        if (!parsed.ok) return { status: "REJECTED", message: parsed.error };
        if (parsed.value.preferredSlots.length !== preferredSlots.length) return { status: "REJECTED", message: "Choose valid future preferred sessions in the business timezone." };
        if (!await deps.activeService(serviceId)) return { status: "REJECTED", message: "Choose an active service for this business." };
        if (customerId && !voiceCustomerMatches(await deps.customer(customerId), binding.businessId, customer)) {
          return { status: "REJECTED", code: "CUSTOMER_VERIFICATION_REQUIRED", message: "The customer reference does not match this business and the supplied contacts. Staff must verify it." };
        }
        const slots = await deps.validateSlots(parsed.value.preferredSlots, timezone);
        if (!slots.ok) return { status: "REJECTED", message: slots.error };
        const autoConfirm = process.env.AI_AUTO_ASSIGN_STAFF_ENABLED === "true" && business.sophieBookingAuthority === true;
        const result = await deps.create(parsed.value, customerId, autoConfirm);
        if (!result.ok) return { status: "REJECTED", message: result.error };
        deps.created(result.request);
        const confirmed = result.request.status === "scheduled";
        return { status: confirmed ? "CONFIRMED" : "PENDING_REVIEW", requestId: result.request.id,
          ...(confirmed && result.request.scheduledSlot ? { appointment: { date: result.request.scheduledSlot.date,
            session: result.request.scheduledSlot.timeRange, startTime: result.request.scheduledStartTime ?? null,
            endTime: result.request.scheduledEndTime ?? null, timezone } } : {}),
          message: confirmed ? "The inspection is confirmed and staff have been assigned." : "The inspection request was received for business review. It is not a confirmed appointment." };
      });
    },
  };
}

export async function createVoiceBookingTools(binding: VoiceBusiness, business: VoiceBookingDependencies["business"], schedule: ScheduleVoiceTask) {
  const { adminDb, adminAuth } = await import("@/lib/firebase/admin");
  return bookingActions(binding, {
    business, writesEnabled: () => process.env.AI_VOICE_ACTIONS_ENABLED === "true",
    activeService: async id => {
      const data = (await adminDb.collection("services").doc(id).get()).data();
      return data?.businessId === binding.businessId && data?.isActive === true;
    },
    customer: async id => {
      const data = (await adminDb.collection("customers").doc(id).get()).data();
      if (!data || data.registeredBusinessId !== binding.businessId) return undefined;
      try { return (await adminAuth.getUser(id)).disabled ? undefined : data; } catch { return undefined; }
    },
    unavailable: async (from, to, timezone) => (await import("@/lib/booking/slot-availability")).computeUnavailableSlots(binding.businessId, from, to, timezone),
    validateSlots: async (slots, timezone) => (await import("@/lib/booking/slot-availability")).validatePreferredSlotsAvailable(binding.businessId, slots, timezone),
    create: async (input, customerId, autoConfirm) => (await import("@/lib/inspection/server")).createInspectionRequest(binding.businessId, input, {
      customerId, createdSource: "call_center", autoAssignStaff: autoConfirm, autoConfirmStaff: autoConfirm,
      assignmentSource: "sophie", scheduleNotifications: task => schedule("inspection-notifications", task),
    }),
    once: async (key, details, send) => runVoiceOperation(await voiceOperationStore(binding.businessId, binding.did, "create_inspection_request"), binding.businessId, "create_inspection_request", key, details, send),
    created: request => {
      schedule("inspection-audit", async () => {
        const { logAuditEvent } = await import("@/lib/audit/server");
        await logAuditEvent({ businessId: binding.businessId, category: "inspection", action: "inspection.created",
          actor: { uid: null, role: "call_center", name: "Sophie (voice)", email: null }, source: "system",
          summary: `Inspection ${request.requestCode || request.id} submitted by Sophie.`, targetId: request.id, targetLabel: request.serviceName || null });
      });
      schedule("sophie-owner-alert", async () => {
        const { sendSophieInspectionOwnerAlert } = await import("@/lib/notifications/sophie-owner-alert");
        await sendSophieInspectionOwnerAlert({ businessId: binding.businessId, requestCode: request.requestCode || request.id,
          customerName: request.customer.fullName, serviceName: request.serviceName || "Inspection request", status: request.status === "scheduled" ? "scheduled" : "pending",
          date: request.scheduledSlot?.date || request.aiAssignment?.proposedSlot?.date || null,
          timeRange: request.scheduledSlot?.timeRange || request.aiAssignment?.proposedSlot?.timeRange || null,
          startTime: request.scheduledStartTime || request.aiAssignment?.proposedSlot?.startTime || null,
          endTime: request.scheduledEndTime || request.aiAssignment?.proposedSlot?.endTime || null,
          staffName: request.assignedTo?.type === "staff" ? request.assignedTo.name : null });
      });
    },
  });
}
