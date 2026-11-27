/**
 * Plain-English names for Sophie's email types (docs/sophie-email-learning-and-auto-reply.md §4.3).
 * No server imports: the dashboard uses these too.
 */

export const EMAIL_KIND_LABELS: Record<string, string> = {
  inspection_request: "Site inspection request",
  job_request: "Job request",
  customer_enquiry: "Enquiry",
  customer_question: "Customer question",
  hours_question: "Opening hours question",
  friendly: "Thanks or greeting",
  quote_reply: "Quote reply",
  invoice_reply: "Invoice reply",
  payment_claim: "Says they've paid",
  supplier_bill: "Supplier bill",
  supplier_other: "Supplier notice",
  staff: "From staff",
  other_business: "Council, insurer or other business",
  promotion: "Promotion",
  private: "Private",
  complaint: "Complaint",
  suspicious: "Suspicious",
  system: "Automatic notice",
  unknown: "Not sure",
};

/** Always sorted and shown: the owner can't switch these off (§5.1, §10). */
export const KINDS_ALWAYS_ON: readonly string[] = ["private", "complaint", "suspicious", "payment_claim", "system", "unknown"];

export function emailKindLabel(kind: string | null | undefined): string {
  if (!kind) return "Not sorted";
  if (kind.startsWith("custom:")) {
    const name = kind.slice("custom:".length).replace(/_/g, " ").trim();
    return name ? name[0].toUpperCase() + name.slice(1) : "Your own type";
  }
  return EMAIL_KIND_LABELS[kind] ?? "Not sure";
}
