import { z } from "zod";
import { ownerBriefingTools } from "@/lib/ai/mcp/tools/owner-briefing.tools";
import { MAX_LOOKBACK_DAYS } from "@/lib/ai/owner-call/day-activity";

type Briefing = ReturnType<typeof ownerBriefingTools>;

const offset = z.number().int().min(0).max(10000).optional();
/** "today", "yesterday" or YYYY-MM-DD (checked again by resolveReportDate). */
const date = z.string().trim().max(20).optional();
const staffName = z.string().trim().max(80).optional();

export type OwnerToolArgs = { offset?: number; date?: string; staffName?: string };

type OwnerVoiceTool = {
  name: string;
  description: string;
  args: z.ZodRawShape;
  run: (tools: Briefing, args: OwnerToolArgs) => Promise<unknown>;
};

const dateHelp = `Optional date: today (default), yesterday, or YYYY-MM-DD within the last ${MAX_LOOKBACK_DAYS} days.`;

export const ownerVoiceTools: OwnerVoiceTool[] = ([
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
  if ("staffName" in args) {
    properties.staffName = { type: "string", description: "Staff member's name as the owner said it" };
  }
  return { type: "object", properties, additionalProperties: false };
}
