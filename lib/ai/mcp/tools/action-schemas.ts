import { z } from "zod";

export const voiceDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Use a valid calendar date.");
export const voiceId = z.string().trim().min(1).max(128).refine(value => !value.includes("/") && value !== "." && value !== "..");
export const voiceContact = z.object({
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  phone: z.string().trim().max(40).transform(value => value.replace(/\D/g, "")).refine(value => /^\d{6,15}$/.test(value), "Use a valid phone number."),
}).strict();
export const voiceCustomer = voiceContact.extend({ fullName: z.string().trim().min(2).max(200) }).strict();
export const findCustomerArguments = voiceContact;
export const registerCustomerArguments = z.object({
  requestKey: z.string().trim().min(16).max(128), customerConfirmed: z.literal(true), customer: voiceCustomer,
}).strict();
export const availabilityArguments = z.object({ from: voiceDate, to: voiceDate }).strict();
export const inspectionArguments = z.object({
  requestKey: z.string().trim().min(16).max(128), customerConfirmed: z.literal(true),
  requestType: z.enum(["existing_service", "custom_quote"]).default("existing_service"),
  serviceId: voiceId.nullable().default(null),
  customRequest: z.object({ title: z.string().trim().min(3).max(120), description: z.string().trim().max(1500).default("") }).strict().nullable().default(null),
  customerId: voiceId.nullable().default(null), customer: voiceCustomer,
  address: z.object({ street: z.string().trim().max(300), suburb: z.string().trim().min(1).max(200), state: z.string().trim().min(1).max(100), postcode: z.string().regex(/^\d{4}$/) }).strict(),
  preferredSlots: z.array(z.object({ date: voiceDate, timeRange: z.enum(["morning", "afternoon"]) }).strict()).min(1).max(3),
  budgetAud: z.number().finite().positive().max(99_999_999).nullable().default(null),
  customerNotes: z.string().trim().max(2000).default(""),
}).strict();
export type VoiceCustomerInput = z.infer<typeof voiceCustomer>;
export type VoiceInspectionInput = z.infer<typeof inspectionArguments>;
export type VoiceActionResult = {
  status: "MATCHED" | "NOT_FOUND" | "CREATED" | "EXISTS" | "PENDING_REVIEW" | "CONFIRMED" | "REJECTED" | "UNKNOWN" | "UNAVAILABLE";
  message: string; code?: string; customerId?: string; requestId?: string; welcomeEmailPending?: boolean;
  appointment?: { date: string; session: string; startTime: string | null; endTime: string | null; timezone: string; inspectorName?: string };
};
export type ScheduleVoiceTask = (stage: string, task: () => Promise<unknown>) => void;

/** Contact matching does not prove identity; expose no stored profile/history. */
export function voiceCustomerMatches(profile: Record<string, unknown> | undefined, businessId: string, contact: { email: string; phone: string }) {
  return !!profile && profile.registeredBusinessId === businessId && typeof profile.email === "string" &&
    profile.email.trim().toLowerCase() === contact.email && typeof profile.phone === "string" &&
    profile.phone.replace(/\D/g, "") === contact.phone;
}
