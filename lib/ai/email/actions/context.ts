import type { DocumentData, Firestore } from "firebase-admin/firestore";

import type { MailboxCustomerContext, MailboxFolder } from "@/lib/email-integration/types";
import type { InspectionRequestInput } from "@/lib/inspection/types";

import type { ComplaintJob } from "../complaints/find-job";
import type { StaffCheckIn } from "../complaints/facts";
import type { WorkingSchedule } from "../complaints/working-time";
import type { EmailAction } from "../types";

/**
 * What every email action gets, and what it gives back (docs/sophie-email-learning-and-auto-reply.md
 * §13, step 6). The services come in through `deps`, so each action is tested without Firebase,
 * the mail provider or push.
 */

export type ActionMailbox = {
  moveToFolder(messageIds: string[], folderName: string): Promise<void>;
  restoreToInbox(targets: { id: string; messageIdHeader: string }[], folderName: string): Promise<void>;
  setRead(target: { threadId: string; id: string; folder: MailboxFolder }, read: boolean): Promise<void>;
  /** Re-reads stored copies after a change, so the mailbox lists update at once. */
  refresh(messageIds: string[]): Promise<void>;
};

export type ReplySend = {
  idempotencyKey: string;
  to: string;
  subject: string;
  bodyText: string;
  /** The message replied to, for threading. */
  replyTo: { providerMessageId: string; threadId: string; messageIdHeader: string; references: string };
  actorUid: string;
};

export type ReplyMailbox = {
  send(input: ReplySend): Promise<{ ok: true; messageIdHeader: string | null } | { ok: false; error: string; code?: string }>;
};

export type ActionDeps = {
  db: Firestore;
  env?: Readonly<Record<string, string | undefined>>;
  /** Null when the mailbox can't be changed now: signed out, or no permission to organise it. */
  mailbox(businessId: string, connectionId: string): Promise<ActionMailbox | null>;
  /** Pushes the business owner. Sender names and subjects only, never an email body. */
  pushOwner(businessId: string, push: { title: string; body: string; data: Record<string, string> }): Promise<void>;
  timeZone(businessId: string): Promise<string>;
  /** When the business's day starts ("08:00"), for calendar entries. */
  dayStart(businessId: string): Promise<string>;
  /** An undone decision is no longer a clean example for Sophie's memory (§7.2). */
  retireExample?(businessId: string, exampleId: string): Promise<unknown>;
  /**
   * Saves a customer account without a welcome email (lib/customer/server.ts ensureCustomerAccount).
   * Throws when the address already belongs to a customer with different details.
   */
  ensureCustomer(input: { businessId: string; email: string; fullName: string; phone: string; actorUid: string }): Promise<{ uid: string; created: boolean }>;
  /** The one customer of this business with this email, or null. */
  findCustomer(businessId: string, email: string): Promise<string | null>;
  /** Adds a pending request under a fixed id; returns the existing one when it was already added. */
  createRequest(input: {
    businessId: string;
    requestId: string;
    request: InspectionRequestInput;
    customerId: string | null;
    triageId: string;
    kind: "inspection_request" | "job_request";
  }): Promise<{ ok: true; requestCode: string | null; existing: boolean } | { ok: false; error: string }>;
  /** The business's name and phone, and the owner's first name, for replies (step 8). */
  businessProfile(businessId: string): Promise<{ name: string | null; phone: string | null; ownerFirstName: string | null }>;
  /**
   * Null when the mailbox can't send now. `send` queues one reply in the outbox under the key, as
   * Sophie's own automatic mail, and returns its Message-ID. The same key and content is a no-op.
   */
  replyMailbox(businessId: string, connectionId: string): Promise<ReplyMailbox | null>;
  /**
   * Hours replies (§8.6): the saved working hours (null when never saved), open weekdays (null until
   * set) and the closed dates between two YYYY-MM-DD dates. Never a closure's reason.
   */
  /** A verified customer's records, for "where's my booking?" (§9.1). Null when not this business's customer. */
  /** A customer's jobs, newest first, for finding what a complaint is about (§10.4). */
  complaintJobs(businessId: string, email: string): Promise<ComplaintJob[]>;
  /** A technician's working hours, off days and approved leave, for when it's right to ask them. Null when unknown. */
  staffSchedule(businessId: string, staffUid: string): Promise<WorkingSchedule | null>;
  /** A technician's booked times between two YYYY-MM-DD dates, for finding a free spot. */
  /**
   * Books a no-charge return visit through the platform's own job path (a $0 accepted quote and a
   * scheduled job, the customer told as for any job). Returns the new job. Never prices anything.
   */
  createReturnJob(input: {
    businessId: string;
    originalJobId: string;
    date: string;
    startTime: string;
    endTime: string;
    actorUid: string;
  }): Promise<{ ok: true; jobId: string; code: string } | { ok: false; error: string }>;
  staffBusy(businessId: string, staffUid: string, fromDate: string, toDate: string): Promise<{ start: number; end: number }[]>;
  /** A staff member's check-ins, for the fact sheet. */
  staffCheckIns(businessId: string, staffUid: string): Promise<StaffCheckIn[]>;
  customerRecords(businessId: string, email: string): Promise<Pick<MailboxCustomerContext, "jobs" | "inspections" | "quotes"> | null>;
  businessHours(businessId: string, fromDate: string, toDate: string): Promise<{ startTime: string | null; endTime: string | null; openDays: number[] | null; closedDates: string[] }>;
  /**
   * Sends the platform's own quote or invoice email again (enqueueDocumentEmail), only to the
   * customer address on the document, and only when it is `requester`. The same key is a no-op.
   */
  resendDocument(input: {
    businessId: string;
    connectionId: string;
    documentType: "quote" | "invoice";
    documentId: string;
    requester: string;
    idempotencyKey: string;
    actorUid: string;
  }): Promise<{ ok: true; code: string } | { ok: false; reason: "not_found" | "address_mismatch" | "not_sendable" | "needs_reconnect" | "already_queued" | "failed"; error?: string }>;
  /**
   * Cancels a request Sophie added from this email, while it is still pending. Returns why not
   * otherwise (it's been scheduled, or someone changed it), so a confirmed visit is never undone.
   */
  cancelRequest(input: { businessId: string; requestId: string; triageId: string; actorUid: string }): Promise<{ ok: true } | { ok: false; reason: string }>;
};

export type ActionContext = {
  deps: ActionDeps;
  businessId: string;
  triageId: string;
  /** The ai_email_triage row. */
  triage: DocumentData;
  /** The email_messages doc, or null when it's gone. */
  message: DocumentData | null;
  /** Who allowed it: the owner on a card, or an approved rule (step 7). */
  authority: "owner" | "rule";
  /** The uid that made the decision, for records that need an owner. */
  actorUid: string;
  /** The ai_email_decisions doc: the confirmed details live here. */
  decision: DocumentData;
  action: EmailAction;
  now: number;
};

export type ActionOutcome = {
  status: "done" | "skipped" | "needs_details" | "manual";
  summary: string;
  /** What undo() needs later. Null when there's nothing to undo. */
  undo?: Record<string, unknown> | null;
};

export type ActionHandler = {
  /** Must be safe to run twice: a run that dies after acting is tried again (T06). */
  run(context: ActionContext): Promise<ActionOutcome>;
  /** Returns one sentence for the owner. Missing when the action can't be undone. */
  undo?(context: ActionContext, data: Record<string, unknown>): Promise<string>;
};
