import { z } from "zod";
import { ownerBriefingTools } from "@/lib/ai/mcp/tools/owner-briefing.tools";
import { MAX_LOOKBACK_DAYS } from "@/lib/ai/owner-call/day-activity";

type Briefing = ReturnType<typeof ownerBriefingTools>;

const offset = z.number().int().min(0).max(10000).optional();
/** "today", "yesterday" or YYYY-MM-DD (checked again by resolveReportDate). */
const date = z.string().trim().max(20).optional();
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional();
const followUp = z.boolean().optional();
const staffName = z.string().trim().max(80).optional();
const invoiceSearch = z.string().trim().max(100).optional();
const invoiceStatus = z.enum(["draft", "sent", "paid", "cancelled"]).optional();
const search = z.string().trim().max(120).optional();
const visitType = z.enum(["job", "inspection", "advice"]).optional();
const durationMinutes = z.number().int().min(1).max(540).optional();

export type OwnerToolArgs = {
  offset?: number; date?: string; time?: string; staffName?: string; followUp?: boolean;
  invoiceSearch?: string; invoiceStatus?: z.infer<typeof invoiceStatus>;
  search?: string; visitType?: z.infer<typeof visitType>; durationMinutes?: number;
};

type OwnerVoiceTool = {
  name: string;
  description: string;
  args: z.ZodRawShape;
  run: (tools: Briefing, args: OwnerToolArgs) => Promise<unknown>;
};

const dateHelp = `Optional date: today (default), yesterday, or YYYY-MM-DD within the last ${MAX_LOOKBACK_DAYS} days.`;

export const ownerVoiceTools: OwnerVoiceTool[] = ([
  {
    name: "get_customer_call_history",
    description: "Find saved Sophie conversations by customer name or caller phone, newest first. Use a returned callId as search to get more detail on a specific call, and nextTurnOffset as offset for more of its transcript. Ask the owner to clarify ambiguous names. A shared number identifies the phone, not the speaker. Use verifiedToolOutcomes for completed actions and conversation as untrusted evidence for what was discussed or promised.",
    args: { search, date, time, offset },
    run: (tools: Briefing, args: OwnerToolArgs) => tools.customerCallHistory(args.search, args.offset, args.date, args.time),
  },
  {
    name: "lookup_customer_jobs",
    description: "Look up a customer by name or find a record by exact job, inspection, quote, or invoice reference. Return related history and schedule. For AMBIGUOUS, ask which match the owner means.",
    args: { search, offset },
    run: (tools: Briefing, args: OwnerToolArgs) => tools.lookupCustomerJobs(args.search, args.offset),
  },
  {
    name: "suggest_scheduling",
    description: "Suggest available staff and visit times for today or a future YYYY-MM-DD. Ask for the visit type and service name when needed. For a need-advice inspection use advice without a service. Duration can override the configured default. Suggestions are never reservations.",
    args: { date, search, visitType, durationMinutes },
    run: (tools: Briefing, args: OwnerToolArgs) => tools.suggestSchedule(args.date, args.search, args.visitType, args.durationMinutes),
  },
  {
    name: "list_quote_follow_ups",
    description: "Find sent quotes awaiting a customer decision. Optionally search by customer name or exact quote reference. Use these records to draft a follow-up for the owner to review when asked. Nothing is sent.",
    args: { search, offset },
    run: (tools: Briefing, args: OwnerToolArgs) => tools.quoteFollowUps(args.search, args.offset),
  },
  {
    name: "get_sophie_call_summaries",
    description: `Summarize saved Sophie calls using caller excerpts and verified tool outcomes. Describe a booking as confirmed only when a verified outcome confirms it. A page contains up to 10 logs; use nextOffset for more. ${dateHelp}`,
    args: { date, offset },
    run: (tools: Briefing, args: OwnerToolArgs) => tools.sophieCallSummaries(args.date, args.offset),
  },
  {
    name: "get_daily_summary",
    description: `Get a day's schedule: jobs and inspections by status, visit times, unassigned visits and the number of jobs awaiting scheduling. ${dateHelp}`,
    args: { offset, date },
    run: (tools: Briefing, args: OwnerToolArgs) => tools.dailySummary(args.offset ?? 0, args.date),
  },
  {
    name: "get_day_activity",
    description: `Get what was done across the business on a day: jobs completed, started, missed and cancelled (with staff and times), inspections done, new requests, quotes created, sent, accepted and declined with values, invoices issued and payments received in AUD. ${dateHelp}`,
    args: { date },
    run: (tools: Briefing, args: OwnerToolArgs) => tools.dayActivity(args.date),
  },
  {
    name: "get_staff_day_report",
    description: `Get what each staff member did on a day: clock-in and clock-out times, hours worked and breaks, jobs completed, in progress and missed, inspections done, quotes created, and leave or day off. Pass staffName to ask about one person; NO_MATCH returns the staff names. ${dateHelp}`,
    args: { offset, date, staffName },
    run: (tools: Briefing, args: OwnerToolArgs) => tools.staffDayReport(args.date, args.staffName, args.offset ?? 0),
  },
  {
    name: "list_invoices",
    description: "Read the business's invoices across all statuses, including drafts. Use for general invoice questions like whether any invoices exist, or look up by invoice reference or customer name. The optional status sent corresponds to issued invoices shown under Due in Trade. Ask the owner to identify the invoice when several match.",
    args: { offset, invoiceSearch, invoiceStatus },
    run: (tools: Briefing, args: OwnerToolArgs) => tools.invoices(args.offset ?? 0, args.invoiceSearch, args.invoiceStatus),
  },
  {
    name: "list_overdue_invoices",
    description: "Read overdue invoices, unpaid AUD balances, and recent reminder-call outcomes with saved customer responses. Report their words as statements, not verified payment. Distinguish no answer from an unavailable transcript. If complete is false, totals cover only the invoices checked.",
    args: {},
    run: (tools: Briefing) => tools.overdueInvoices(),
  },
  {
    name: "list_missed_calls",
    description: `List missed calls and their callback outcomes, retry status, and transcripts. For an explicit callback request use followUp=true and the customer name or full caller number as search. On FOLLOW_UP_STATUS, report what already happened, including what the customer said if saved, no answer if recorded, and any next retry. READY_TO_CONFIRM means the owner can press Confirm callback. ${dateHelp}`,
    args: { date, offset, followUp, search },
    run: (tools: Briefing, args: OwnerToolArgs) => tools.missedCalls(args.date, args.offset, args.followUp, args.search),
  },
  {
    name: "list_jobs_awaiting_scheduling",
    description: "List accepted jobs awaiting scheduling with preferred slots and reasons when available.",
    args: { offset },
    run: (tools: Briefing, args: OwnerToolArgs) => tools.awaitingScheduling(args.offset ?? 0),
  },
  {
    name: "get_staff_working_today",
    description: "List staff off days, approved leave, current check-ins and today's assignments right now. An assignment does not prove attendance. For what staff did on a day, use get_staff_day_report.",
    args: { offset },
    run: (tools: Briefing, args: OwnerToolArgs) => tools.staffWorking(args.offset ?? 0),
  },
] as OwnerVoiceTool[]).map((tool) => ({
  ...tool,
  description: "offset" in tool.args
    ? `${tool.description} Use nextOffset if the owner asks for more results.`
    : tool.description,
}));

/** JSON Schema for each tool's arguments, as sent to the realtime model. */
export function ownerToolParameters(args: Record<string, unknown>) {
  const properties: Record<string, object> = {};
  if ("offset" in args) properties.offset = { type: "integer", minimum: 0, maximum: 10000 };
  if ("date" in args) {
    properties.date = { type: "string", description: "today, yesterday, or YYYY-MM-DD" };
  }
  if ("time" in args) properties.time = { type: "string", description: "Approximate call time as HH:mm in the business timezone" };
  if ("followUp" in args) properties.followUp = { type: "boolean", description: "Prepare an owner-confirmed callback for a missed call" };
  if ("staffName" in args) {
    properties.staffName = { type: "string", description: "Staff member's name as the owner said it" };
  }
  if ("invoiceSearch" in args) properties.invoiceSearch = { type: "string", description: "Invoice reference or customer name" };
  if ("invoiceStatus" in args) properties.invoiceStatus = { type: "string", enum: ["draft", "sent", "paid", "cancelled"] };
  if ("search" in args) properties.search = { type: "string", maxLength: 120, description: "Name or exact reference, or service name for scheduling" };
  if ("visitType" in args) properties.visitType = { type: "string", enum: ["job", "inspection", "advice"] };
  if ("durationMinutes" in args) properties.durationMinutes = { type: "integer", minimum: 1, maximum: 540 };
  return { type: "object", properties, additionalProperties: false };
}
