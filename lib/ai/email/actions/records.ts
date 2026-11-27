import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { PERSONAL_EVENTS_COLLECTION } from "@/lib/calendar/personal-events/types";
import { EMAIL_MESSAGES_COLLECTION } from "@/lib/email-integration/config";

import { daysBefore, parseWrittenDate } from "../dates";
import type { EmailTriageResult } from "../types";
import type { ActionContext, ActionHandler } from "./context";

/**
 * Actions on the business's own records: bills, invoice reminders, calendar reminders and links.
 * Every record has a fixed id built from the email, so a run that's tried again finds what it already
 * made instead of making a second one (T06). Nothing here pays, credits or marks anything paid.
 */

export const EMAIL_BILL_ITEMS_COLLECTION = "email_bill_items";
/** lib/invoices/server.ts INVOICE_COLLECTION (not imported: it would load Firebase in tests). */
const INVOICES_COLLECTION = "invoices";

const result = (context: ActionContext) => (context.triage.result ?? null) as EmailTriageResult | null;
const sender = (context: ActionContext) => (context.triage.sender ?? {}) as { name?: string | null; address?: string };
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);
const sentAt = (context: ActionContext) =>
  context.message?.sentAt instanceof Timestamp ? context.message.sentAt.toMillis() : context.now;

function addMinutes(clock: string, minutes: number): string {
  const [hours, mins] = clock.split(":").map(Number);
  const total = Math.min(23 * 60 + 59, (hours || 0) * 60 + (mins || 0) + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

async function today(context: ActionContext): Promise<{ date: string; timeZone: string }> {
  const timeZone = await context.deps.timeZone(context.businessId);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(context.now));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${read("year")}-${read("month")}-${read("day")}`, timeZone };
}

/** A calendar entry the owner sees with their other personal events. Staff can see these, so no amounts. */
async function writeCalendarEntry(context: ActionContext, id: string, entry: { title: string; notes: string; date: string }) {
  const start = await context.deps.dayStart(context.businessId);
  const now = Timestamp.fromMillis(context.now);
  await context.deps.db.collection(PERSONAL_EVENTS_COLLECTION).doc(id).set({
    businessId: context.businessId,
    title: clip(entry.title, 120),
    notes: entry.notes,
    date: entry.date,
    startTime: start,
    endTime: addMinutes(start, 30),
    createdByUid: context.actorUid,
    createdBy: "sophie",
    createdAt: now,
    updatedAt: now,
  });
}

async function deleteCalendarEntry(context: ActionContext, id: string) {
  const ref = context.deps.db.collection(PERSONAL_EVENTS_COLLECTION).doc(id);
  const snap = await ref.get();
  if (snap.exists && snap.data()?.businessId === context.businessId && snap.data()?.createdBy === "sophie") await ref.delete();
}

export const ignore: ActionHandler = {
  async run() {
    return { status: "done", summary: "Left it as it is." };
  },
};

export const notifyOwner: ActionHandler = {
  async run(context) {
    // On a card the owner is already looking at it. Rules (step 7) push instead.
    if (context.authority === "owner") return { status: "skipped", summary: "You've already seen it." };
    if (context.action.kind !== "notify_owner") throw new Error("Wrong action.");
    const from = sender(context);
    await context.deps.pushOwner(context.businessId, {
      title: context.action.urgency === "now" ? "Urgent email needs you" : "New email",
      body: `${clip(from.name || from.address || "Unknown sender", 40)}: ${clip(String(context.triage.subject ?? "(no subject)"), 80)}`,
      data: { type: "email_card", link: "/dashboard/emails?tab=sophie", triageId: context.triageId },
    });
    return { status: "done", summary: "Told you about it." };
  },
};

export const linkThread: ActionHandler = {
  async run(context) {
    const message = context.message;
    const address = sender(context).address;
    if (!message || !address) return { status: "skipped", summary: "The email is no longer in the mailbox." };
    // Only the sender's own address links, never someone in Cc (§9.2).
    if (context.triage.identity === "none" || !context.triage.identity) {
      return { status: "skipped", summary: "The sender isn't a saved customer yet, so there's nothing to link." };
    }
    const emails: unknown = message.customerEmails;
    if (message.linked === true && Array.isArray(emails) && emails.includes(address)) {
      return { status: "skipped", summary: "It was already linked." };
    }
    const previous = {
      matchMethod: message.matchMethod ?? "none",
      customerEmails: Array.isArray(emails) ? emails : [],
      customerName: message.customerName ?? null,
      linked: message.linked === true,
    };
    await context.deps.db.collection(EMAIL_MESSAGES_COLLECTION).doc(String(context.triage.messageId)).set({
      matchMethod: "customer",
      customerEmails: [address],
      customerName: context.triage.customerName ?? null,
      linked: true,
    }, { merge: true });
    return {
      status: "done",
      summary: `Linked it to ${context.triage.customerName || address}.`,
      undo: { messageId: String(context.triage.messageId), previous },
    };
  },
  async undo(context, data) {
    await context.deps.db.collection(EMAIL_MESSAGES_COLLECTION).doc(String(data.messageId))
      .set(data.previous as Record<string, unknown>, { merge: true });
    return "Unlinked it.";
  },
};

export const addBillItem: ActionHandler = {
  async run(context) {
    const triage = result(context);
    // A "bank details changed" email never becomes a bill (T10, playbook C15).
    if (triage?.kind === "suspicious" || triage?.flags.includes("bank_change")) {
      return { status: "skipped", summary: "Not added: this email asks to change bank or payment details. Check with the supplier by phone first." };
    }
    const extracted = triage?.extracted ?? {};
    const { timeZone } = await today(context);
    const dueDate = parseWrittenDate(extracted.billDueDate, sentAt(context), timeZone);
    if (!dueDate) return { status: "needs_details", summary: "I couldn't find the due date. Add this bill yourself." };
    const from = sender(context);
    const supplierName = clip(extracted.supplierName || from.name || from.address?.split("@")[1] || "Supplier", 80);
    // As written in the email, never parsed into a ledger or a payment (T19).
    const amountAsWritten = clip(extracted.billAmount ?? "", 40);
    const reference = extracted.billReference ? clip(extracted.billReference, 60) : null;
    const eventId = `sophie_bill_${context.triageId}`;
    await context.deps.db.collection(EMAIL_BILL_ITEMS_COLLECTION).doc(context.triageId).set({
      businessId: context.businessId,
      supplierName,
      amountAsWritten,
      dueDate,
      reference,
      sourceMessageId: String(context.triage.messageId),
      triageId: context.triageId,
      calendarEventId: eventId,
      status: "to_review",
      createdBy: "sophie",
      createdAt: Timestamp.fromMillis(context.now),
    });
    await writeCalendarEntry(context, eventId, {
      title: `Bill due: ${supplierName}${reference ? ` (${reference})` : ""}`,
      notes: "Added by Sophie from an email. The amount is under Emails → Sophie, as written and not checked.",
      date: dueDate,
    });
    return {
      status: "done",
      summary: `Added to bills due ${dueDate}: ${supplierName}, ${amountAsWritten || "amount not stated"} as written, not checked.`,
      undo: { billId: context.triageId, eventId },
    };
  },
  async undo(context, data) {
    const ref = context.deps.db.collection(EMAIL_BILL_ITEMS_COLLECTION).doc(String(data.billId));
    const snap = await ref.get();
    if (snap.exists && snap.data()?.businessId === context.businessId) {
      await ref.set({ status: "dismissed", dismissedAt: Timestamp.fromMillis(context.now) }, { merge: true });
    }
    await deleteCalendarEntry(context, String(data.eventId));
    return "Took the bill off the calendar.";
  },
};

export const pauseReminders: ActionHandler = {
  async run(context) {
    if (context.action.kind !== "pause_reminders") throw new Error("Wrong action.");
    const reason = context.action.reason;
    const document = (context.message?.platformDocument ?? null) as { type?: string; id?: string; code?: string } | null;
    if (document?.type !== "invoice" || !document.id) {
      return { status: "needs_details", summary: "I couldn't tell which invoice this is about. Pause its reminders from the invoice." };
    }
    const ref = context.deps.db.collection(INVOICES_COLLECTION).doc(document.id);
    const outcome = await context.deps.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data();
      if (!snap.exists || data?.businessId !== context.businessId) return "missing";
      if (data.status === "paid" || data.status === "cancelled") return `already_${data.status}`;
      if (data.remindersPause?.triageId === context.triageId) return "paused";
      if (data.remindersPause) return "already_paused";
      tx.set(ref, {
        remindersPause: { source: "sophie_email", reason, triageId: context.triageId, at: Timestamp.fromMillis(context.now) },
      }, { merge: true });
      return "paused";
    });
    const code = document.code || "the invoice";
    if (outcome === "missing") return { status: "needs_details", summary: "I couldn't find that invoice. Pause its reminders from the invoice." };
    if (outcome === "already_paid") return { status: "skipped", summary: `${code} is already marked paid.` };
    if (outcome === "already_cancelled") return { status: "skipped", summary: `${code} is cancelled.` };
    if (outcome === "already_paused") return { status: "skipped", summary: `Reminders for ${code} were already paused.` };
    // "Accounts notified" (T09). The invoice is never marked paid by Sophie (C13).
    const from = sender(context);
    await context.deps.pushOwner(context.businessId, {
      title: reason === "payment_claim" ? `Customer says ${code} is paid` : `${code} is disputed`,
      body: `${clip(from.name || from.address || "The customer", 40)}. Reminders are paused. Check the payment, then mark it paid yourself.`,
      data: { type: "email_invoice", link: "/dashboard/invoices", invoiceId: document.id },
    });
    return {
      status: "done",
      summary: `Paused reminders for ${code}. It is not marked paid.`,
      undo: { invoiceId: document.id },
    };
  },
  async undo(context, data) {
    const ref = context.deps.db.collection(INVOICES_COLLECTION).doc(String(data.invoiceId));
    await context.deps.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.data();
      if (current?.businessId === context.businessId && current.remindersPause?.triageId === context.triageId) {
        tx.set(ref, { remindersPause: FieldValue.delete() }, { merge: true });
      }
    });
    return "Turned the invoice reminders back on.";
  },
};

export const addCalendarReminder: ActionHandler = {
  async run(context) {
    if (context.action.kind !== "add_calendar_reminder") throw new Error("Wrong action.");
    const extracted = result(context)?.extracted ?? {};
    const { date: todayDate, timeZone } = await today(context);
    const date = parseWrittenDate(extracted.importantDate ?? extracted.billDueDate, sentAt(context), timeZone);
    if (!date) return { status: "needs_details", summary: "I couldn't find a date in the email. Add the reminder yourself." };
    if (date < todayDate) return { status: "skipped", summary: `The date (${date}) has already passed.` };
    const remindOn = [daysBefore(date, context.action.daysBefore), todayDate].sort().at(-1)!;
    const eventId = `sophie_reminder_${context.triageId}`;
    const from = sender(context);
    await writeCalendarEntry(context, eventId, {
      title: `Reminder: ${String(context.triage.subject || "email")}`,
      notes: `For ${date}, from an email from ${from.name || from.address || "a sender"}. Added by Sophie.`,
      date: remindOn,
    });
    return { status: "done", summary: `Added a reminder on ${remindOn} for ${date}.`, undo: { eventId } };
  },
  async undo(context, data) {
    await deleteCalendarEntry(context, String(data.eventId));
    return "Took the reminder off the calendar.";
  },
};
