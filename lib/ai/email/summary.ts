/**
 * Sophie's daily email summary (docs/sophie-email-learning-and-auto-reply.md §6.4). Pure, like
 * mailbox/digest.ts: the cron reads the rows, this builds the page and the push.
 *
 * Private email is only ever a count. Nothing here reads or repeats an email body.
 */

import { emailKindLabel } from "./labels";
import type { EmailKind, EmailTriageStatus, FriendlyType } from "./types";

/** `ai_email_summaries/{businessId}_{YYYY-MM-DD}`: one per local day, shown under Emails → Sophie. */
export const EMAIL_SUMMARIES_COLLECTION = "ai_email_summaries";

export type SummaryRow = {
  id: string;
  status: EmailTriageStatus;
  precheck: string;
  kind: EmailKind | null;
  friendlyType: FriendlyType | null;
  senderName: string | null;
  senderAddress: string | null;
  subject: string | null;
  createdAt: number | null;
  /** One in every 20 automatic decisions: "Check one of mine" (§5.5). */
  spotCheck?: boolean;
};

export type DailySummary = {
  dateKey: string;
  dateLabel: string;
  /** What Sophie did alone (automatic rules, step 7) and what she set aside. */
  handled: { label: string; count: number }[];
  handledTotal: number;
  waiting: { triageId: string; line: string; since: string | null }[];
  waitingTotal: number;
  /** Unknown email grouped by sender: "How should I handle these?" (§6.3). */
  newKinds: { label: string; count: number; triageIds: string[] }[];
  kindWords: string[];
  privateCount: number;
  /** "Check one of mine": an email a rule handled, for the owner to mark Right or Wrong (§5.5). */
  spotChecks: { triageId: string; line: string }[];
  /** Complaint cases still open (docs §10.9 step 11): who, what, and how it stands. */
  openComplaints: { caseId: string; line: string; overdue: boolean }[];
  /** Null when there's nothing to say: no push goes out. */
  push: { title: string; body: string } | null;
};

const MAX_LINES = 10;
const COMPLAINT_STATUS: Record<string, string> = {
  open: "just opened", waiting_staff: "waiting for the technician", waiting_owner: "waiting for you", escalated: "overdue, waiting for you",
  waiting_customer: "waiting for the customer", revisit_booked: "return visit booked", follow_up: "checking the fix",
};
const FRIENDLY_WORDS: Partial<Record<FriendlyType, string>> = {
  thanks: "said thanks",
  compliment_staff: "complimented the team",
  season_greeting: "sent season's greetings",
};

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const clip = (value: string, max: number) => {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};
const who = (row: SummaryRow) => row.senderName?.trim() || row.senderAddress || "Someone";

function localParts(now: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(now));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { dateKey: `${read("year")}-${read("month")}-${read("day")}`, minutes: Number(read("hour")) * 60 + Number(read("minute")) };
}

/**
 * Due once per local day, at or after the owner's hour (T18). Checking "at or after" rather than
 * "exactly at" means a missed cron run, or an hour skipped by daylight saving, still sends it.
 */
export function summaryDue(
  now: number,
  timeZone: string,
  summaryHour: number,
  lastSummaryDate: string | null,
): { due: boolean; dateKey: string } {
  const { dateKey, minutes } = localParts(now, timeZone);
  return { due: minutes >= summaryHour * 60 && lastSummaryDate !== dateKey, dateKey };
}

export function buildDailySummary(input: {
  /** Rows created since the last summary. */
  recent: readonly SummaryRow[];
  /** Everything still waiting for the owner, whenever it arrived. */
  waiting: readonly SummaryRow[];
  now: number;
  timeZone: string;
  /** Open complaint cases, newest first. */
  complaints?: readonly { id: string; typeLabel: string; customerName: string | null; status: string; replyBy: number }[];
}): DailySummary {
  const { dateKey } = localParts(input.now, input.timeZone);
  const dateLabel = new Intl.DateTimeFormat("en-AU", { timeZone: input.timeZone, weekday: "short", day: "numeric", month: "short" })
    .format(new Date(input.now));
  // Newer ICU puts a narrow no-break space before "pm"; plain spaces read the same everywhere.
  const time = (at: number | null) => at === null ? null
    : new Intl.DateTimeFormat("en-AU", { timeZone: input.timeZone, hour: "numeric", minute: "2-digit" })
      .format(new Date(at)).replace(/\s+/g, " ");

  const handledCounts = new Map<string, number>();
  const count = (label: string) => handledCounts.set(label, (handledCounts.get(label) ?? 0) + 1);
  let privateCount = 0;
  const kindWords: string[] = [];
  const spotChecks: DailySummary["spotChecks"] = [];
  for (const row of input.recent) {
    if (row.precheck === "private") { privateCount++; continue; }
    if (row.precheck === "system") { count("automatic notices ignored"); continue; }
    if (row.precheck === "blocked") { count("from blocked senders, set aside"); continue; }
    if (row.status === "auto_done" && row.kind) count(`${emailKindLabel(row.kind).toLowerCase()} handled`);
    if (row.status === "auto_done" && row.spotCheck && spotChecks.length < 3) {
      spotChecks.push({ triageId: row.id, line: `${emailKindLabel(row.kind)} from ${clip(who(row), 40)}${row.subject ? `: ${clip(row.subject, 60)}` : ""}` });
    }
    const words = row.kind === "friendly" && row.friendlyType ? FRIENDLY_WORDS[row.friendlyType] : undefined;
    if (words && kindWords.length < MAX_LINES) kindWords.push(`${who(row)} ${words}`);
  }

  const unknown = new Map<string, { label: string; ids: string[] }>();
  const waitingLines: DailySummary["waiting"] = [];
  for (const row of input.waiting) {
    if (row.kind === "unknown") {
      const domain = row.senderAddress?.split("@")[1] ?? "unknown senders";
      const group = unknown.get(domain) ?? { label: row.senderName?.trim() || domain, ids: [] };
      group.ids.push(row.id);
      unknown.set(domain, group);
      continue;
    }
    if (waitingLines.length < MAX_LINES) {
      waitingLines.push({
        triageId: row.id,
        line: `${emailKindLabel(row.kind)} from ${clip(who(row), 40)}${row.subject ? `: ${clip(row.subject, 60)}` : ""}`,
        since: time(row.createdAt),
      });
    }
  }
  const unknownTotal = [...unknown.values()].reduce((sum, group) => sum + group.ids.length, 0);
  const waitingTotal = input.waiting.length - unknownTotal;
  const newKinds = [...unknown.values()].map((group) => ({
    label: `${plural(group.ids.length, "email")} from ${clip(group.label, 40)}`,
    count: group.ids.length,
    triageIds: group.ids,
  }));
  const handled = [...handledCounts.entries()].map(([label, value]) => ({ label: `${value} ${label}`, count: value }));
  const handledTotal = handled.reduce((sum, item) => sum + item.count, 0);

  const openComplaints = (input.complaints ?? []).slice(0, MAX_LINES).map((item) => ({
    caseId: item.id,
    line: `${item.typeLabel}${item.customerName ? ` from ${clip(item.customerName, 40)}` : ""}: ${COMPLAINT_STATUS[item.status] ?? "open"}`,
    overdue: item.status === "escalated" || (item.replyBy > 0 && item.replyBy < input.now),
  }));

  const parts = [
    openComplaints.length > 0 ? plural(openComplaints.length, "open complaint") : null,
    waitingTotal > 0 ? `${waitingTotal} waiting for you` : null,
    newKinds.length > 0 ? plural(newKinds.length, "new kind") + " of email to teach me" : null,
    handledTotal > 0 ? `${handledTotal} handled` : null,
    kindWords.length > 0 ? plural(kindWords.length, "kind message") : null,
    privateCount > 0 ? `${privateCount} kept private` : null,
    spotChecks.length > 0 ? "check one of mine" : null,
  ].filter((part): part is string => part !== null);

  return {
    dateKey,
    dateLabel,
    handled,
    handledTotal,
    waiting: waitingLines,
    waitingTotal,
    newKinds,
    kindWords,
    privateCount,
    spotChecks,
    openComplaints,
    push: parts.length > 0 ? { title: `Sophie's email summary: ${dateLabel}`, body: parts.join(" · ") } : null,
  };
}
