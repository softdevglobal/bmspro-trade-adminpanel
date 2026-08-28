/**
 * Shared product language for the whole system.
 *
 * Core rule: never call something a "booking" until the business owner has
 * confirmed the time. Customers submit an *inspection request*; it only
 * becomes a *job* once a time is confirmed.
 *
 * Import these constants instead of hard-coding customer-facing wording so
 * "book" / "visit" / "request" cannot drift between pages.
 */

/* ==========================================================================
 * Canonical pipeline
 * ========================================================================== */

/** The ordered stages a piece of work moves through, end to end. */
export const PIPELINE_STAGES = [
  "inspection_request",
  "inspection_confirmed",
  "quote_sent",
  "job_confirmed",
  "invoice",
  "completed",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  inspection_request: "Inspection Request",
  inspection_confirmed: "Confirm Inspection",
  quote_sent: "Quote Sent",
  job_confirmed: "Job Confirmed",
  invoice: "Invoice",
  completed: "Completed",
};

/* ==========================================================================
 * Status tone
 * ========================================================================== */

/**
 * Status colour rules:
 * - `blue`  — request received, or the customer needs to act
 * - `amber` — waiting, or not confirmed yet (preferences live here)
 * - `green` — confirmed only
 * - `grey`  — completed or archived
 * - `red`   — cancelled or failed
 *
 * Green is reserved for genuinely confirmed states. A customer preference is
 * never green.
 */
export const STATUS_TONES = ["blue", "amber", "green", "grey", "red"] as const;
export type StatusTone = (typeof STATUS_TONES)[number];

export const STATUS_TONE_MEANINGS: Record<StatusTone, string> = {
  blue: "Request received or customer action",
  amber: "Waiting or not confirmed",
  green: "Confirmed only",
  grey: "Completed or archived",
  red: "Cancelled or failed",
};

/** Tailwind classes for a status pill, keyed by tone. */
export const STATUS_TONE_PILL_CLASSES: Record<StatusTone, string> = {
  blue: "border border-sky-200 bg-sky-50 text-sky-800",
  amber: "border border-amber-200 bg-amber-50 text-amber-800",
  green: "border border-emerald-200 bg-emerald-50 text-emerald-700",
  grey: "border border-outline-variant bg-surface-container-low text-on-surface-variant",
  red: "border border-red-200 bg-red-50 text-red-700",
};

/** Solid dot/marker colour for a tone, for calendar legends and chips. */
export const STATUS_TONE_DOT_CLASSES: Record<StatusTone, string> = {
  blue: "bg-sky-500",
  amber: "bg-amber-500",
  green: "bg-emerald-500",
  grey: "bg-outline",
  red: "bg-red-500",
};

/* ==========================================================================
 * Customer-facing copy
 * ========================================================================== */

/**
 * Customer-facing labels. Keep every "book a visit" style string here so the
 * booking engine, portal and dashboard stay in step.
 */
export const CUSTOMER_COPY = {
  /** Hero heading. `{business}` is replaced with the business name. */
  requestHeading: "Request a {business} Site Inspection",
  requestHeadingFallback: "Request a Site Inspection",
  /** Availability pill on the public booking page. */
  acceptingRequests: "Site inspections available",
  /** Section heading above the date picker. */
  preferredTimes: "Preferred site inspection times",
  /** Helper under the date picker, shown once a date is chosen. */
  preferenceNotConfirmed: "Preference selected — not confirmed yet",
  /** Primary submit button. */
  submitRequest: "Submit site inspection request",
  /** Budget field. */
  budgetLabel: "Budget range, if known",
  budgetHelper: "Optional. Helps us recommend suitable options.",
  /** Past-tense label for the budget on an existing request/job record. */
  budgetProvided: "Budget provided",
  /** Address field — for an inspection the site address matters. */
  siteAddressLabel: "Site address",
  /** Top-of-page explainer. `{business}` is replaced with the business name. */
  requestIntro:
    "Tell us what work you need, choose a few preferred inspection times, and {business} will contact you to confirm the final appointment.",
  /** Request state sentences shown at the top of a customer card. */
  awaitingConfirmation: "Your inspection request is waiting for confirmation",
  inspectionConfirmed: "Your inspection is confirmed",
  /** History page title — it holds future work and quotes too. */
  historyTitle: "My Requests & Jobs",
  /** Collapsed section holding the original submission. */
  originalRequestDetails: "Original request details",
} as const;

/** Fills `{business}` in a copy template. */
export function withBusinessName(
  template: string,
  businessName: string | null | undefined,
): string {
  const name = businessName?.trim();
  if (!name) {
    return template
      .replace(/\s*\{business\}\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  return template.replace(/\{business\}/g, name);
}

/* ==========================================================================
 * Admin-facing copy
 * ========================================================================== */

/**
 * Admin labels. Actions say what they do — "Schedule job", not "Book".
 */
export const ADMIN_COPY = {
  scheduleJob: "Schedule job",
  waitingForCustomer: "Waiting for customer",
  /** Prefix used when a job originated from an inspection request. */
  fromInspectionRequest: "From inspection request",
  /** Public booking link description on the settings page. */
  bookingLinkShare:
    "Share this with customers. They can request a site inspection and it will land in your dashboard.",
  /** Invoice with nothing outstanding. */
  noAmountDue: "No amount due",
  draftIssue: "Draft issue",
} as const;

/* ==========================================================================
 * Communication model
 * ========================================================================== */

/** Who a message belongs to. Audit logs stay separate from these. */
export const MESSAGE_OWNERS = [
  "customer",
  "business",
  "system",
  "internal",
] as const;
export type MessageOwner = (typeof MESSAGE_OWNERS)[number];

export const MESSAGE_OWNER_LABELS: Record<MessageOwner, string> = {
  customer: "Customer",
  business: "Business",
  system: "System update",
  internal: "Internal note",
};

/** How a message reached the recipient. */
export const MESSAGE_CHANNELS = [
  "portal",
  "email",
  "sms",
  "internal_note",
] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export const MESSAGE_CHANNEL_LABELS: Record<MessageChannel, string> = {
  portal: "Portal",
  email: "Email",
  sms: "SMS",
  internal_note: "Internal note",
};

/** Source labels for customer notifications. */
export const NOTIFICATION_SOURCE_LABELS = {
  business: "From {business}",
  system: "System update",
  action: "Action needed",
} as const;
