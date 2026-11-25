import "server-only";
import { z } from "zod";
import { ownerVoiceToolList, ownerToolParameters, type OwnerToolArgs } from "@/lib/ai/owner-call/tools";

const allowed = new Set(["get_customer_call_history","lookup_customer_jobs","suggest_scheduling","list_quote_follow_ups",
  "get_sophie_call_summaries","get_daily_summary","get_day_activity","get_staff_day_report","list_invoices",
  "list_overdue_invoices","list_missed_calls","list_jobs_awaiting_scheduling","get_staff_working_today"]);
export function ownerPhoneReadTools() {
  return ownerVoiceToolList({knowledge:false}).filter(tool=>allowed.has(tool.name) && !tool.usesActions && !tool.usesServices && !tool.usesKnowledge)
    .map(tool=>{
      const args={...tool.args};
      delete args.followUp;
      return {...tool,args,description:tool.name==="list_missed_calls"
        ? "Read missed calls and their callback outcomes and transcripts. Read only; never initiate callbacks. Optional date, offset and customer search."
        : tool.description};
    });
}
export function ownerPhoneToolDefinitions() {
  return ownerPhoneReadTools().map(tool=>({type:"function",name:tool.name,description:tool.description,
    parameters:ownerToolParameters(tool.args,tool.required),strict:false}));
}
export function parseOwnerPhoneTool(name:string,args:unknown) {
  const tool=ownerPhoneReadTools().find(tool=>tool.name===name);
  if (!tool) return null;
  const parsed=z.object(tool.args).strict().safeParse(args);
  return parsed.success ? {tool,args:parsed.data as OwnerToolArgs} : null;
}
