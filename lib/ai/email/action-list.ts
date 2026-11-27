/**
 * The words for Sophie's fixed action list (docs/sophie-email-learning-and-auto-reply.md §13):
 * what she suggests for each email type, the plain-English label, the key used to count "the same
 * decision", and the check on anything an owner or a request sends in. Pure.
 */

import { isStatusIntent } from "./status";
import { isReplyTemplate, templateTitle } from "./templates";
import type { ComplaintType, CustomerIntent, EmailAction, EmailActionKind, EmailKind, FriendlyType } from "./types";

/** What else about the email shapes the suggestion. */
export type SuggestionHints = {
  friendlyType?: FriendlyType | null;
  customerIntent?: CustomerIntent | null;
  /** The quote or invoice whose thread this email replies in. */
  documentType?: "quote" | "invoice" | null;
  complaintType?: ComplaintType | null;
};

export const ADVERTISING_FOLDER = "Advertising";
const FOLDER = /^[\p{L}\p{N} _-]{1,40}$/u;
const MAX_ACTIONS = 6;

/** Every action an owner can pick today, in the order a card lists them. */
export const PICKABLE_ACTIONS: EmailActionKind[] = [
  "save_customer", "link_thread", "create_inspection", "create_job_request", "add_bill_item",
  "pause_reminders", "add_calendar_reminder", "reply", "resend_document", "open_complaint_case", "propose_reschedule", "move_folder", "mark_read", "notify_owner", "ignore",
];

/** An example of each pickable action, for "Do something else" and the owner's own types. */
export const PICKABLE_EXAMPLES: EmailAction[] = PICKABLE_ACTIONS.map((kind): EmailAction => {
  switch (kind) {
    case "move_folder": return { kind, folder: ADVERTISING_FOLDER };
    case "notify_owner": return { kind, urgency: "today" };
    case "pause_reminders": return { kind, reason: "payment_claim" };
    case "add_calendar_reminder": return { kind, daysBefore: 7 };
    case "reply": return { kind, template: "enquiry_received" };
    default: return { kind } as EmailAction;
  }
});

/** What Sophie suggests for each type (§4.3). Replies arrive with the templates in step 8. */
export function defaultActions(kind: EmailKind | null, hints: SuggestionHints = {}): EmailAction[] {
  const friendlyType = hints.friendlyType ?? null;
  switch (kind) {
    case "inspection_request":
      return [{ kind: "save_customer" }, { kind: "create_inspection" }, { kind: "reply", template: "request_received" }, { kind: "notify_owner", urgency: "today" }];
    case "job_request":
      return [{ kind: "save_customer" }, { kind: "create_job_request" }, { kind: "reply", template: "request_received" }, { kind: "notify_owner", urgency: "today" }];
    case "customer_enquiry":
      return [{ kind: "save_customer" }, { kind: "reply", template: "enquiry_received" }, { kind: "notify_owner", urgency: "routine" }];
    case "customer_question":
    case "quote_reply":
    case "invoice_reply":
      // "Can you send the invoice again?" in the invoice's own thread (§9.1).
      if (hints.customerIntent === "document_request" && hints.documentType) {
        return [{ kind: "link_thread" }, { kind: "resend_document" }, { kind: "notify_owner", urgency: "routine" }];
      }
      // "Can we move Thursday's visit to Friday?": free times for the owner, and a careful acknowledgement (§9.1).
      if (hints.customerIntent === "booking_change") {
        return [{ kind: "link_thread" }, { kind: "propose_reschedule" }, { kind: "reply", template: "reschedule_received" }, { kind: "notify_owner", urgency: "today" }];
      }
      // "When is your technician coming?": a verified customer's own record answers it (§9.1).
      if (hints.customerIntent && isStatusIntent(hints.customerIntent)) {
        return [{ kind: "link_thread" }, { kind: "reply", template: "status_answer" }, { kind: "notify_owner", urgency: "routine" }];
      }
      return [{ kind: "link_thread" }, { kind: "notify_owner", urgency: "today" }];
    case "hours_question":
      return [{ kind: "reply", template: "hours_answer" }, { kind: "mark_read" }];
    case "payment_claim":
      // Never marks anything paid (C13).
      return [{ kind: "link_thread" }, { kind: "pause_reminders", reason: "payment_claim" }, { kind: "notify_owner", urgency: "today" }];
    case "supplier_bill":
      return [{ kind: "add_bill_item" }, { kind: "notify_owner", urgency: "routine" }];
    case "promotion":
      return [{ kind: "move_folder", folder: ADVERTISING_FOLDER }, { kind: "mark_read" }];
    case "friendly":
      // A reply to "ok, see you Tuesday" only starts a back-and-forth (§8.8).
      if (friendlyType === "thanks") return [{ kind: "reply", template: "friendly_thanks" }, { kind: "mark_read" }];
      if (friendlyType === "compliment_staff") return [{ kind: "reply", template: "compliment_thanks" }, { kind: "notify_owner", urgency: "routine" }];
      if (friendlyType === "season_greeting") return [{ kind: "reply", template: "season_greeting" }, { kind: "mark_read" }];
      return [{ kind: "mark_read" }];
    case "supplier_other":
      return [{ kind: "mark_read" }];
    case "complaint":
      // Danger now: the owner is told straight away and the safety reply goes (§10.5), nothing else first.
      if (hints.complaintType === "safety") return [{ kind: "notify_owner", urgency: "now" }];
      return [{ kind: "open_complaint_case" }, { kind: "reply", template: "complaint_received" }, { kind: "notify_owner", urgency: "now" }];
    case "suspicious":
      return [{ kind: "notify_owner", urgency: "now" }];
    case "system":
      return [{ kind: "ignore" }];
    case "private":
      return [];
    default:
      return [{ kind: "notify_owner", urgency: "routine" }];
  }
}

export function actionLabel(action: EmailAction): string {
  switch (action.kind) {
    case "save_customer": return "Save the sender as a customer (new ones need your review)";
    case "link_thread": return "Link the email to the customer's records";
    case "create_inspection": return "Add a pending site inspection (you still confirm it)";
    case "create_job_request": return "Add a pending job request (you still confirm it)";
    case "add_bill_item": return "Add it to this week's bills (amount as written, not checked)";
    case "pause_reminders": return "Pause payment reminders for that invoice";
    case "move_folder": return `Move it to the "${action.folder}" folder`;
    case "mark_read": return "Mark it as read";
    case "add_calendar_reminder": return `Add a calendar reminder ${action.daysBefore} day${action.daysBefore === 1 ? "" : "s"} before the date`;
    case "notify_owner":
      return action.urgency === "now" ? "Tell me straight away" : action.urgency === "today" ? "Notify me" : "Show it in my queue";
    case "reply": return `Reply with “${templateTitle(action.template)}” (Sophie says she's an AI assistant)`;
    case "resend_document": return "Send them the quote or invoice again (only to the address on record)";
    case "open_complaint_case": return "Open a complaint case with the facts from your records";
    case "propose_reschedule": return "Find free times for their booking and tell me (I change nothing)";
    case "ignore": return "Ignore it";
  }
}

function actionPart(action: EmailAction): string {
  switch (action.kind) {
    case "move_folder": return `move_folder:${action.folder.toLowerCase()}`;
    case "notify_owner": return `notify_owner:${action.urgency}`;
    case "pause_reminders": return `pause_reminders:${action.reason}`;
    case "add_calendar_reminder": return `add_calendar_reminder:${action.daysBefore}`;
    case "reply": return `reply:${action.template}`;
    default: return action.kind;
  }
}

/** A stable string for a set of actions: order doesn't matter, parameters do. */
export function actionsKey(actions: readonly EmailAction[]): string {
  return [...new Set(actions.map(actionPart))].sort().join("+") || "none";
}

/** Checks a list of actions from outside (a request body). Null when anything is off the list or malformed. */
export function parseActions(raw: unknown): EmailAction[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_ACTIONS) return null;
  const actions: EmailAction[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const value = item as Record<string, unknown>;
    let action: EmailAction | null = null;
    switch (value.kind) {
      case "save_customer":
      case "link_thread":
      case "create_inspection":
      case "create_job_request":
      case "add_bill_item":
      case "resend_document":
      case "open_complaint_case":
      case "propose_reschedule":
      case "mark_read":
      case "ignore":
        action = { kind: value.kind };
        break;
      case "pause_reminders":
        if (value.reason === "payment_claim" || value.reason === "dispute") action = { kind: "pause_reminders", reason: value.reason };
        break;
      case "move_folder":
        if (typeof value.folder === "string" && FOLDER.test(value.folder.trim())) action = { kind: "move_folder", folder: value.folder.trim() };
        break;
      case "add_calendar_reminder":
        if (Number.isInteger(value.daysBefore) && (value.daysBefore as number) >= 1 && (value.daysBefore as number) <= 60) {
          action = { kind: "add_calendar_reminder", daysBefore: value.daysBefore as number };
        }
        break;
      case "notify_owner":
        if (value.urgency === "now" || value.urgency === "today" || value.urgency === "routine") action = { kind: "notify_owner", urgency: value.urgency };
        break;
      case "reply":
        if (isReplyTemplate(value.template)) action = { kind: "reply", template: value.template };
        break;
    }
    if (!action) return null;
    // One of each kind: two folders or two urgencies for one email makes no sense.
    if (seen.has(action.kind)) return null;
    seen.add(action.kind);
    actions.push(action);
  }
  // "Ignore" means do nothing else.
  if (seen.has("ignore") && actions.length > 1) return null;
  return actions;
}
