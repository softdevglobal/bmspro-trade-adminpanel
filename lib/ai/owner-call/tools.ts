import { z } from "zod";
import { ownerBriefingTools } from "@/lib/ai/mcp/tools/owner-briefing.tools";

const offset = z.number().int().min(0).max(10000).optional();
type Briefing = ReturnType<typeof ownerBriefingTools>;

export const ownerVoiceTools = [
  {
    name: "get_daily_summary",
    description: "Get today's jobs and inspections by status, visit times, unassigned visits and the number of jobs awaiting scheduling.",
    run: (tools: Briefing, offset: number) => tools.dailySummary(offset),
  },
  {
    name: "list_jobs_awaiting_scheduling",
    description: "List accepted jobs awaiting scheduling with preferred slots and reasons when available.",
    run: (tools: Briefing, offset: number) => tools.awaitingScheduling(offset),
  },
  {
    name: "get_staff_working_today",
    description: "List staff off days, approved leave, current check-ins and today's assignments. An assignment does not prove attendance.",
    run: (tools: Briefing, offset: number) => tools.staffWorking(offset),
  },
].map((tool) => ({
  ...tool,
  description: `${tool.description} Use nextOffset if the owner asks for more results.`,
  args: { offset },
}));
