/**
 * The details the owner confirms on a card before Sophie saves a customer or adds a site inspection
 * or job request (docs/sophie-email-learning-and-auto-reply.md step 6b). What the AI found in the
 * email is only a suggestion in the form (§4.2: "candidates, never verified facts"); what's saved is
 * what the owner confirmed. Checked when the owner presses the button, with the platform's own
 * request rules, so a problem shows on the card at once instead of failing later.
 */

import { parseInspectionRequestInput, type InspectionRequestInput } from "@/lib/inspection/types";

import type { EmailActionKind, EmailTriageResult } from "./types";

/** Actions that need the owner's confirmed details. */
export const DETAIL_ACTIONS: readonly EmailActionKind[] = ["save_customer", "create_inspection", "create_job_request"];

export const needsDetails = (kinds: readonly EmailActionKind[]) => kinds.some((kind) => DETAIL_ACTIONS.includes(kind));

export type ConfirmedDetails = {
  fullName: string;
  phone: string;
  address: { street: string; suburb: string; state: string; postcode: string };
  preferredSlots: { date: string; timeRange: "morning" | "afternoon" }[];
  /** The work or the problem, in a few words. */
  title: string;
  description: string;
};

/** What the form starts with: the sender, and what the AI read in the email. The owner checks it all. */
export function detailsPrefill(input: {
  sender: { name: string | null; address: string };
  subject: string;
  result: EmailTriageResult | null;
}): ConfirmedDetails & { email: string; askedFor: string[] } {
  const extracted = input.result?.extracted ?? {};
  return {
    email: input.sender.address,
    fullName: (extracted.customerName || input.sender.name || "").slice(0, 120),
    phone: (extracted.phone ?? "").slice(0, 40),
    address: { street: (extracted.address ?? "").slice(0, 200), suburb: (extracted.suburb ?? "").slice(0, 80), state: "", postcode: "" },
    preferredSlots: [],
    title: (extracted.service || input.subject || "").slice(0, 120),
    description: (input.result?.summary ?? "").slice(0, 1000),
    // Shown as a hint only: the owner picks real dates.
    askedFor: extracted.preferredTimes ?? [],
  };
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

export type ParsedDetails =
  | { ok: true; details: ConfirmedDetails; requestInput: InspectionRequestInput | null }
  | { ok: false; error: string };

/**
 * Checks the owner's details for the chosen actions. A customer needs a name and phone. A request
 * also needs what the work is and at least one preferred date; the site address is optional, as for
 * requests the owner makes on the dashboard.
 */
export function parseCardDetails(
  raw: unknown,
  input: { kinds: readonly EmailActionKind[]; email: string; timeZone: string },
): ParsedDetails {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Check the customer's details first." };
  const value = raw as Record<string, unknown>;
  const address = (value.address ?? {}) as Record<string, unknown>;
  const details: ConfirmedDetails = {
    fullName: text(value.fullName, 120),
    phone: text(value.phone, 40),
    address: { street: text(address.street, 200), suburb: text(address.suburb, 80), state: text(address.state, 20), postcode: text(address.postcode, 10) },
    preferredSlots: Array.isArray(value.preferredSlots)
      ? value.preferredSlots.slice(0, 3).map((slot) => {
          const item = (slot ?? {}) as Record<string, unknown>;
          return { date: text(item.date, 10), timeRange: item.timeRange === "afternoon" ? "afternoon" : "morning" };
        })
      : [],
    title: text(value.title, 120),
    description: text(value.description, 1000),
  };
  if (!details.fullName) return { ok: false, error: "Add the customer's name." };
  if (details.phone.replace(/\D/g, "").length < 8) return { ok: false, error: "Add the customer's phone number." };

  const wantsRequest = input.kinds.includes("create_inspection") || input.kinds.includes("create_job_request");
  if (!wantsRequest) return { ok: true, details, requestInput: null };

  const parsed = parseInspectionRequestInput({
    requestType: "custom_quote",
    serviceId: null,
    customRequest: { title: details.title, description: details.description },
    customer: { fullName: details.fullName, email: input.email, phone: details.phone },
    address: details.address,
    preferredSlots: details.preferredSlots,
    customerNotes: null,
    budgetAud: null,
    customerImageUrls: [],
  }, input.timeZone, { requireAddress: false });
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, details, requestInput: parsed.value };
}
