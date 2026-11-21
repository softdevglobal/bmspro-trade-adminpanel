import {z} from "zod";

export const ownerVisitsEnabled = (env: Readonly<Record<string, string | undefined>> = process.env) => env.AI_OWNER_VOICE_VISITS_ENABLED === "true";
export const JOB_CREATE_TOOL = "prepare_job_create";
export const INSPECTION_CREATE_TOOL = "prepare_inspection_create";
export const VISIT_PREPARE_TOOLS = ["prepare_job_schedule", "prepare_job_assignment", "prepare_job_cancel", "prepare_inspection_schedule", "prepare_inspection_assignment", "prepare_inspection_cancel"] as const;
export const visitActionInput = z.object({
  reference: z.string().trim().min(1).max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
  endTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
  staffName: z.string().trim().min(1).max(120).optional(),
  assignTo: z.enum(["owner", "staff"]).optional(),
}).strict();
export const visitListInput = z.object({kind: z.enum(["job", "inspection"]).optional(), status: z.enum(["scheduled", "awaiting", "pending", "owner_proposed", "ongoing", "completed", "cancelled", "missed"]).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), search: z.string().trim().max(120).optional()}).strict();
export type VisitActionInput = z.infer<typeof visitActionInput>;
export type VisitKind = "job" | "inspection";
export type VisitOperation = "schedule" | "assignment" | "cancel";

/** One record/action per confirmation. Multi-visit and already active work use the editor. */
export function visitActionBlock(kind: VisitKind, row: Record<string, unknown>): string | null {
  if (row.seriesId || row.recurrence || row.recurrenceRule || Array.isArray(row.additionalJobDays) && row.additionalJobDays.length) return "Use the Trade editor for recurring or multi-day work; voice changes one visit only.";
  if (kind === "inspection" && row.bookingId) return "This inspection is linked to a job. Use the Trade editor to manage the linked records.";
  if (row.visitStartedAt || row.visitEndedAt || row.startedAt) return "This visit has already started. Use the Trade editor.";
  const allowed = kind === "job" ? ["awaiting", "scheduled"] : ["pending", "owner_proposed", "scheduled"];
  if (!allowed.includes(String(row.status))) return "Only pending or scheduled work can be changed by voice. Use the Trade editor for started, completed, missed or cancelled work.";
  return null;
}
