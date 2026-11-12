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
export const voiceAddress = z.object({ street: z.string().trim().max(300), suburb: z.string().trim().min(1).max(200), state: z.string().trim().min(1).max(100), postcode: z.string().regex(/^\d{4}$/) }).strict();
export const inspectionArguments = z.object({
  requestKey: z.string().trim().min(16).max(128), customerConfirmed: z.literal(true),
  requestType: z.enum(["existing_service", "custom_quote"]).default("existing_service"),
  serviceId: voiceId.nullable().default(null),
  customRequest: z.object({ title: z.string().trim().min(3).max(120), description: z.string().trim().max(1500).default("") }).strict().nullable().default(null),
  customerId: voiceId.nullable().default(null), customer: voiceCustomer,
  address: voiceAddress,
  preferredSlots: z.array(z.object({ date: voiceDate, timeRange: z.enum(["morning", "afternoon"]) }).strict()).min(1).max(3),
  budgetAud: z.number().finite().positive().max(99_999_999).nullable().default(null),
  customerNotes: z.string().trim().max(2000).default(""),
}).strict();
/** One short, self-contained question about this business. No business ID. */
export const knowledgeQuestionArguments = z.object({
  question: z.string().trim().min(3).max(300),
}).strict();
/** Spoken references arrive with spaces or without the BK prefix; stored codes are `BK` + nine characters. */
export const voiceJobCode = z.string().trim().max(40).transform(value => {
  const compact = value.toUpperCase().replace(/[^0-9A-Z]/g, "");
  return compact.length === 11 && compact.startsWith("BK") ? compact.slice(2) : compact;
}).refine(value => /^[2-9A-HJKMNP-Z]{9}$/.test(value), "Use the job reference from the booking message.").transform(value => `BK ${value}`);
const voiceClock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour HH:MM time.");
/** A preferred session, optionally with the exact start the caller asked for. */
export const voiceJobSlot = z.object({ date: voiceDate, timeRange: z.enum(["morning", "afternoon"]), startTime: voiceClock.nullable().default(null) }).strict();
const voiceJobBookingSlot = voiceJobSlot.extend({ endTime: voiceClock.nullish() }).refine(
  (slot) => !slot.startTime || !slot.endTime || slot.startTime < slot.endTime,
  "The finish time must be after the start time.",
);
const requestKey = z.string().trim().min(16).max(128);
export const jobBookingArguments = z.object({
  requestKey, customerConfirmed: z.literal(true), serviceId: voiceId, customerId: voiceId.nullable().default(null), customer: voiceCustomer,
  address: voiceAddress, preferredSlots: z.array(voiceJobBookingSlot).min(1).max(3), deferScheduling: z.boolean().optional(),
  customerNotes: z.string().trim().max(2000).default(""),
}).strict();
export const jobLookupArguments = voiceContact.extend({ jobCode: voiceJobCode }).strict();
export const jobRescheduleArguments = jobLookupArguments.extend({ requestKey, customerConfirmed: z.literal(true), preferredSlots: z.array(voiceJobSlot).min(1).max(3) }).strict();
export const jobCancelArguments = jobLookupArguments.extend({ requestKey, customerConfirmed: z.literal(true), reason: z.string().trim().max(500).default("") }).strict();
export type VoiceJobSlot = z.infer<typeof voiceJobBookingSlot>;
export type VoiceCustomerInput = z.infer<typeof voiceCustomer>;
export type VoiceInspectionInput = z.infer<typeof inspectionArguments>;
export type VoiceActionResult = {
  status: "MATCHED" | "NOT_FOUND" | "CREATED" | "EXISTS" | "PENDING_REVIEW" | "CONFIRMED" | "CANCELLED" | "REJECTED" | "UNKNOWN" | "UNAVAILABLE";
  message: string; code?: string; customerId?: string; requestId?: string; welcomeEmailPending?: boolean;
  /** Job reference the caller can quote later; internal document IDs are never spoken. */
  jobCode?: string;
  job?: { jobCode: string; status: string; serviceName: string | null; date: string | null; startTime: string | null; endTime: string | null; timezone: string; staffName?: string; suburb: string | null; canChange: boolean };
  appointment?: { date: string; session: string; startTime: string | null; endTime: string | null; timezone: string; inspectorName?: string };
};
export type ScheduleVoiceTask = (stage: string, task: () => Promise<unknown>) => void;

/** Contact matching does not prove identity; expose no stored profile/history. */
export function voiceCustomerMatches(profile: Record<string, unknown> | undefined, businessId: string, contact: { email: string; phone: string }) {
  return !!profile && profile.registeredBusinessId === businessId && typeof profile.email === "string" &&
    profile.email.trim().toLowerCase() === contact.email && typeof profile.phone === "string" &&
    profile.phone.replace(/\D/g, "") === contact.phone;
}
