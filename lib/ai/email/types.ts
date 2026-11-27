/**
 * Types for Sophie's email sorting (docs/sophie-email-learning-and-auto-reply.md §13).
 * The fixed lists are arrays, so the classifier's JSON schema and the answer check use one source.
 * Later steps add decisions, rules, actions and templates here.
 */

import type { InspectionRequestInput } from "@/lib/inspection/types";

import type { ConfirmedDetails } from "./details";
import type { CustomTemplateRef, ReplyTemplateId } from "./templates";
import type { SenderIdentity, AuthResult, IdentityReason } from "./identity";
import type { PrecheckOutcome, PrecheckSignal, PromotionSignal, BlockedSender } from "./precheck";

export const BUILT_IN_EMAIL_KINDS = [
  "inspection_request", "job_request", "customer_enquiry", "customer_question", "hours_question", "friendly",
  "quote_reply", "invoice_reply", "payment_claim",
  "supplier_bill", "supplier_other", "staff", "other_business",
  "promotion", "private", "complaint", "suspicious",
  "system", "unknown",
] as const;

/** Built-in types plus the owner's own (`custom:<name>`, step 7). */
export type EmailKind = (typeof BUILT_IN_EMAIL_KINDS)[number] | `custom:${string}`;

/** §9.1: what a known customer is asking about. */
export const CUSTOMER_INTENTS = [
  "booking_status", "request_status", "quote_status", "document_request",
  "booking_change", "booking_cancel", "repeat_fault", "history_question",
  "repeat_booking", "call_follow_up", "other",
] as const;
export type CustomerIntent = (typeof CUSTOMER_INTENTS)[number];

/** §10.2. */
export const COMPLAINT_TYPES = [
  "late_arrival", "missed_visit", "work_unfinished", "repeat_fault",
  "quality", "damage", "conduct", "billing", "safety", "no_update",
] as const;
export type ComplaintType = (typeof COMPLAINT_TYPES)[number];

/** §8.8. */
export const FRIENDLY_TYPES = ["thanks", "compliment_staff", "season_greeting", "closing", "mixed"] as const;
export type FriendlyType = (typeof FRIENDLY_TYPES)[number];

export const EMAIL_RISK_FLAGS = [
  "complaint", "payment_claim", "bank_change", "legal", "safety",
  "hardship", "asks_to_change_rules", "personal",
] as const;
export type EmailRiskFlag = (typeof EMAIL_RISK_FLAGS)[number];

/** §6.1: now = U1 push at once, today = U2, routine = U3 in-app queue, info = U4 daily summary. */
export const EMAIL_URGENCIES = ["now", "today", "routine", "info"] as const;
export type EmailUrgency = (typeof EMAIL_URGENCIES)[number];

export type ExtractedDetails = {
  customerName?: string;
  phone?: string;
  address?: string;
  suburb?: string;
  service?: string;
  /** As written; the AI never turns them into a booking. */
  preferredTimes?: string[];
  supplierName?: string;
  /** As written, never a verified amount. */
  billAmount?: string;
  billDueDate?: string;
  billReference?: string;
  /** A deadline, renewal or appointment date written in the email, for calendar reminders. As written. */
  importantDate?: string;
};

/** What the classifier returns, after the code's own checks. Anything else is thrown away. */
export type EmailTriageResult = {
  kind: EmailKind;
  /** 0..1 */
  confidence: number;
  /** ≤ 300 characters, with phone numbers, email addresses and long numbers removed. */
  summary: string;
  urgency: EmailUrgency;
  /** Only for customer_question. */
  customerIntent: CustomerIntent | null;
  /** Only for complaint. */
  complaintType: ComplaintType | null;
  /** For friendly, or `mixed` when thanks come with another request. */
  friendlyType: FriendlyType | null;
  /** A job reference written in the email, if any. */
  jobRef: string | null;
  /** Candidates only, shown to the owner. Never verified facts. */
  extracted: ExtractedDetails;
  flags: EmailRiskFlag[];
};

export type EmailTriageStatus = "processing" | "new" | "asked" | "auto_done" | "owner_done" | "ignored" | "held" | "failed";

/**
 * The fixed action list (§13). Rules and owners can only pick from it. Step 5 records them on
 * decisions; step 6 runs them. Reply, resend, reschedule and previous-job actions join the list in
 * the steps that build their templates and records (6, 8, 9).
 */
export type EmailAction =
  | { kind: "save_customer" }
  | { kind: "link_thread" }
  | { kind: "create_inspection" }
  | { kind: "create_job_request" }
  | { kind: "add_bill_item" }
  | { kind: "pause_reminders"; reason: "payment_claim" | "dispute" }
  | { kind: "move_folder"; folder: string }
  | { kind: "mark_read" }
  | { kind: "add_calendar_reminder"; daysBefore: number }
  | { kind: "notify_owner"; urgency: "now" | "today" | "routine" }
  /** A built-in template reply (templates.ts), filled only from records (step 8). */
  | { kind: "reply"; template: ReplyTemplateId | CustomTemplateRef }
  /** The platform's own quote or invoice email again, for the thread's document (step 8b). */
  | { kind: "resend_document" }
  /** Opens a complaint case with the job and the fact sheet, for the owner's card (step 9). */
  | { kind: "open_complaint_case" }
  /** Finds free times for the customer's booking and tells the owner (step 9). Changes nothing on the job. */
  | { kind: "propose_reschedule" }
  | { kind: "ignore" };

export type EmailActionKind = EmailAction["kind"];

/** `ai_email_decisions/{triageId}`: the owner's answer about one email (§5.7). One per email. */
export type EmailDecision = {
  businessId: string;
  triageId: string;
  /** The email_messages doc id. */
  messageId: string;
  confirmedKind: EmailKind;
  /** What Sophie guessed, for accuracy. Null when the AI failed. */
  guessedKind: EmailKind | null;
  actions: EmailAction[];
  /** A stable string of the actions, for counting "the same decision". */
  actionsKey: string;
  /** An edited reply is saved to memory but doesn't count towards a rule. */
  replyEdited: boolean;
  /** Sophie's guess matched: same type and same actions. */
  matchedSuggestion: boolean;
  /** Hashed sender (senders.ts senderKey), for narrow rules. */
  senderKey: string | null;
  decidedBy: string;
  /** "rule": Sophie decided alone, under an approved rule (step 7). */
  via: "app" | "voice" | "summary" | "rule";
  /** The exact rule version behind a rule decision. */
  ruleId?: string | null;
  ruleVersion?: number | null;
  /** Set when one of its actions was undone: it no longer counts towards a rule. */
  undone?: boolean;
  /**
   * not_run: shadow mode, the answer only teaches Sophie. pending: waiting for the runner.
   * Then done, partial (some need the owner), dry_run (AI_AGENT_DRY_RUN) or blocked (paused).
   */
  actionsStatus: "not_run" | "pending" | "done" | "partial" | "dry_run" | "blocked";
  /** What happened to each action, by kind. A retry skips any that already have a result (T06). */
  results?: Partial<Record<EmailActionKind, ActionResult>>;
  /** The customer details the owner confirmed on the card (step 6b), when an action needs them. */
  details?: ConfirmedDetails | null;
  /** The request to add, already checked with the platform's own rules. */
  requestInput?: InspectionRequestInput | null;
  decidedAt: number;
};

export type ActionResultStatus =
  | "done"
  | "skipped"
  /** Sophie needs something from the owner, such as a due date she couldn't find. */
  | "needs_details"
  /** Not something Sophie can do yet: the owner does it. */
  | "manual"
  | "blocked"
  | "dry_run"
  | "failed"
  /** Waiting to be done later, e.g. a reply held until 7 am. */
  | "held"
  | "undoing"
  | "undone";

export type ActionResult = {
  status: ActionResultStatus;
  /** One plain sentence for the owner. */
  summary: string;
  /** What Undo needs (ids of what was created, the folder it moved to …). */
  undo: Record<string, unknown> | null;
  at: number;
  undoneAt?: number;
  undoneBy?: string;
};

/** One nearest past email from this business's memory (§7.2). */
export type ExampleHit = {
  id: string;
  kind: EmailKind;
  summary: string;
  actionsKey: string;
  distance: number;
};

/**
 * `ai_email_triage/{triageId}`: one per email. The id is a hash of the mailbox and the Message-ID
 * header, so the same email arriving twice (an IMAP folder move gives it a new id) is one row.
 */
export type EmailTriage = {
  businessId: string;
  connectionId: string;
  /** The email_messages doc id. */
  messageId: string;
  threadId: string;
  eventId: string;
  precheck: PrecheckOutcome;
  signals: PrecheckSignal[];
  promotionSignals: PromotionSignal[];
  neverReply: boolean;
  blocked: BlockedSender | null;
  identity: SenderIdentity | null;
  identityReasons: IdentityReason[];
  authResult: AuthResult | null;
  /** Set only when exactly one customer name matches the From address. */
  customerName: string | null;
  /** Null for private, system and blocked mail, and when the AI failed (see aiError). */
  result: EmailTriageResult | null;
  aiError: string | null;
  similarExampleIds: string[];
  examplesAgree: boolean;
  ruleId: string | null;
  ruleVersion: number | null;
  status: EmailTriageStatus;
  /** Shadow mode (AI_EMAIL_TRIAGE_DRY_RUN): logged only; cards say "Here's what I would have done". */
  shadow: boolean;
  decisionId: string | null;
  createdAt: number;
};
