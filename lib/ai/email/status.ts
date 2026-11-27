import type { MailboxCustomerContext } from "@/lib/email-integration/types";

import { dateLabel } from "./hours";
import type { CustomerIntent } from "./types";

/**
 * "Where's my booking / request / quote?" (docs/sophie-email-learning-and-auto-reply.md §9.1).
 * Pure: the caller loads the customer's records, and this picks the ONE record that answers the
 * question and the plain sentence for its status. Never an amount (§9.3). Anything unclear, such
 * as two open bookings, a status Sophie has no words for, or a date she can't be sure of, is left
 * to the owner: she never guesses which record they mean.
 */

export const STATUS_INTENTS: readonly CustomerIntent[] = ["booking_status", "request_status", "quote_status"];

export type StatusFact = {
  intent: "booking_status" | "request_status" | "quote_status";
  /** One plain sentence about the record: "Your booking J-1042 is scheduled for Friday 27 November." */
  sentence: string;
  /** YYYY-MM-DD of a scheduled visit, when the sentence names one. */
  date?: string;
};

export const isStatusIntent = (intent: unknown): intent is StatusFact["intent"] =>
  typeof intent === "string" && (STATUS_INTENTS as readonly string[]).includes(intent);

const OPEN_JOB = new Set(["awaiting", "scheduled", "ongoing"]);

/** The calendar date of a moment in the business time zone, YYYY-MM-DD. */
function localDay(at: number, timeZone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
  } catch {
    return null;
  }
}

export function statusFact(
  intent: unknown,
  context: Pick<MailboxCustomerContext, "jobs" | "inspections" | "quotes">,
  timeZone: string,
): StatusFact | null {
  if (!isStatusIntent(intent)) return null;

  if (intent === "booking_status") {
    // Open bookings only. Two of them means we can't tell which one they mean.
    const open = context.jobs.filter((job) => OPEN_JOB.has(job.status));
    if (open.length !== 1) return null;
    const [job] = open;
    if (job.status === "scheduled") {
      const day = job.date === null ? null : localDay(job.date, timeZone);
      if (!day) return null;
      return { intent, sentence: `Your booking ${job.code} is scheduled for ${dateLabel(day)}.`, date: day };
    }
    if (job.status === "ongoing") return { intent, sentence: `Your booking ${job.code} is under way.` };
    return { intent, sentence: `We have your booking ${job.code}, and we'll confirm a time with you.` };
  }

  if (intent === "request_status") {
    // A request still waiting for a time is the one Sophie can speak for; once it's booked, the
    // visit date lives on the job, so the owner answers.
    const pending = context.inspections.filter((item) => item.status === "pending");
    if (pending.length !== 1 || context.inspections.length > 1) return null;
    return { intent, sentence: `We've received your request ${pending[0].code}, and we'll be in touch to confirm a time.` };
  }

  const sent = context.quotes.filter((quote) => quote.status === "sent");
  const accepted = context.quotes.filter((quote) => quote.status === "accepted");
  const declined = context.quotes.filter((quote) => quote.status === "declined");
  if (context.quotes.length !== 1) return null;
  if (sent.length === 1) return { intent, sentence: `Your quote ${sent[0].code} has been sent to you, and we're waiting to hear back.` };
  if (accepted.length === 1) return { intent, sentence: `Your quote ${accepted[0].code} has been accepted. Thank you.` };
  if (declined.length === 1) return { intent, sentence: `Your quote ${declined[0].code} is marked as declined.` };
  return null;
}
