import { findCustomerArguments, registerCustomerArguments, voiceCustomerMatches,
  type VoiceActionResult, type VoiceCustomerInput, type ScheduleVoiceTask } from "./action-schemas";
import { runVoiceOperation, voiceOperationStore } from "./operation";
import type { VoiceBusiness } from "../../config";

type CustomerRecord = { id: string; data: Record<string, unknown> };
export interface VoiceCustomerDependencies {
  business(): Promise<Record<string, unknown>>;
  find(email: string): Promise<CustomerRecord[]>;
  ensure(customer: VoiceCustomerInput, business: Record<string, unknown>): Promise<{ uid: string; created: boolean }>;
  enabled(id: string): Promise<boolean>;
  writesEnabled(): boolean;
  once(key: string, details: unknown, send: () => Promise<VoiceActionResult>): Promise<VoiceActionResult>;
  created(id: string, customer: VoiceCustomerInput, business: Record<string, unknown>): void;
}
const rejectContact = (): VoiceActionResult => ({ status: "REJECTED", code: "CUSTOMER_VERIFICATION_REQUIRED",
  message: "These contact details cannot be used for customer registration. Staff must verify the account. No existing profile was changed." });

export function customerActions(binding: VoiceBusiness, deps: VoiceCustomerDependencies) {
  return {
    find: async (raw: unknown): Promise<VoiceActionResult> => {
      const parsed = findCustomerArguments.safeParse(raw);
      if (!parsed.success) return { status: "REJECTED", message: "Ask for a valid email and phone number." };
      await deps.business();
      const records = await deps.find(parsed.data.email);
      const record = records.length === 1 ? records[0] : null;
      if (!record || !voiceCustomerMatches(record.data, binding.businessId, parsed.data) || !await deps.enabled(record.id))
        return { status: "NOT_FOUND", message: "No usable customer match for the supplied details. This does not verify caller identity." };
      return { status: "MATCHED", customerId: record.id, message: "A business-scoped customer matches the supplied contact details. Do not disclose stored profile information or history." };
    },
    register: async (raw: unknown): Promise<VoiceActionResult> => {
      if (!deps.writesEnabled()) return { status: "REJECTED", message: "Customer registration is disabled." };
      const parsed = registerCustomerArguments.safeParse(raw);
      if (!parsed.success) return { status: "REJECTED", message: "Read back the name, email and phone, and obtain explicit permission to create a customer account." };
      const business = await deps.business();
      return deps.once(parsed.data.requestKey, parsed.data.customer, async () => {
        const records = await deps.find(parsed.data.customer.email);
        if (records.length) {
          const record = records.length === 1 ? records[0] : null;
          if (!record || !voiceCustomerMatches(record.data, binding.businessId, parsed.data.customer) || !await deps.enabled(record.id)) return rejectContact();
          return { status: "EXISTS", customerId: record.id, message: "A customer account matches the provided details. Its existing profile was not changed." };
        }
        const account = await deps.ensure(parsed.data.customer, business);
        if (account.created) deps.created(account.uid, parsed.data.customer, business);
        return { status: account.created ? "CREATED" : "EXISTS", customerId: account.uid, welcomeEmailPending: account.created,
          message: account.created ? "The customer account was created. Setup email delivery is pending; do not claim it was delivered." : "A matching customer account already exists. No existing profile was changed." };
      });
    },
  };
}

export async function createVoiceCustomerTools(binding: VoiceBusiness, business: VoiceCustomerDependencies["business"], schedule: ScheduleVoiceTask) {
  const { adminDb, adminAuth } = await import("@/lib/firebase/admin");
  return customerActions(binding, {
    business,
    writesEnabled: () => process.env.AI_VOICE_ACTIONS_ENABLED === "true",
    find: async email => {
      const snapshot = await adminDb.collection("customers").where("registeredBusinessId", "==", binding.businessId).where("email", "==", email).limit(2).get();
      return snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }));
    },
    enabled: async id => { try { return !(await adminAuth.getUser(id)).disabled; } catch { return false; } },
    ensure: async (customer, data) => {
      const { ensureCustomerAccount } = await import("@/lib/customer/server");
      return ensureCustomerAccount({ ...customer, businessId: binding.businessId,
        businessName: typeof data.businessName === "string" ? data.businessName : null,
        bookingSlug: typeof data.bookingSlug === "string" ? data.bookingSlug : null,
        preserveExistingProfile: true, sendWelcomeEmail: false, context: "inspection" });
    },
    once: async (key, details, send) => runVoiceOperation(await voiceOperationStore(binding.businessId, binding.did, "register_customer"), binding.businessId, "register_customer", key, details, send),
    created: (id, customer, data) => {
      schedule("customer-welcome", async () => {
        const [{ sendCustomerWelcomeEmail }, { issueActivationLink }, { FieldValue }] = await Promise.all([
          import("@/lib/email/templates"), import("@/lib/auth/activation"), import("firebase-admin/firestore"),
        ]);
        const sent = await sendCustomerWelcomeEmail({ ...customer, businessId: binding.businessId,
          businessName: typeof data.businessName === "string" ? data.businessName : null,
          bookingSlug: typeof data.bookingSlug === "string" ? data.bookingSlug : null,
          logoUrl: typeof data.logoUrl === "string" ? data.logoUrl : null,
          context: "inspection", activationUrl: await issueActivationLink(id, "customer") });
        if (sent) await adminDb.collection("customers").doc(id).update({ welcomeEmailSent: true, updatedAt: FieldValue.serverTimestamp() });
      });
      schedule("customer-audit", async () => {
        const { logAuditEvent } = await import("@/lib/audit/server");
        await logAuditEvent({ businessId: binding.businessId, category: "customer", action: "customer.created",
          actor: { uid: null, role: "call_center", name: "Sophie (voice)", email: null }, source: "system",
          summary: "Customer account created by Sophie with caller consent.", targetId: id, targetLabel: customer.fullName });
      });
    },
  });
}
