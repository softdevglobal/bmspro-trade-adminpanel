import { z } from "zod";

/**
 * AI call logs: one document per call answered by Sophie, written by the voice
 * bridge after hang-up (POST /api/ai/calls) and shown to the business owner on
 * the AI calls page. Contains the conversation text, so the collection is
 * Admin-SDK-only and every document expires after the retention period.
 */
export const CALL_LOGS_COLLECTION = "ai_call_logs";

const isoDate = z.string().datetime({ offset: true });
const code = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/);

/** What the bridge sends. Business and DID come from the authenticated binding, never the body. */
export const callLogInput = z.object({
  callId: z.string().uuid(),
  startedAt: isoDate,
  answeredAt: isoDate.nullable(),
  endedAt: isoDate,
  durationMs: z.number().int().min(0).max(6 * 3_600_000),
  setupMs: z.number().int().min(0).max(600_000).nullable(),
  endReason: z.string().trim().min(1).max(120),
  callerNumber: z.string().regex(/^\d{6,15}$/).nullable(),
  callbackAttemptId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  ownerScheduledCall: z.literal(true).optional(),
  quotationFollowUpCall: z.literal(true).optional(),
  tools: z.array(z.object({ name: code, status: code, durationMs: z.number().int().min(0).max(600_000) }).strict()).max(100),
  outcomes: z.array(z.object({
    tool: code, status: code, reference: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).nullable(),
  }).strict()).max(10),
  transcript: z.array(z.object({
    speaker: z.enum(["caller", "sophie"]),
    atMs: z.number().int().min(0).max(6 * 3_600_000),
    text: z.string().min(1).max(4000),
  }).strict()).max(500),
}).strict();
export type CallLogInput = z.infer<typeof callLogInput>;

export type CallOutcome = "booked" | "request_sent" | "needs_staff" | "no_booking";
export type CallLogSummary = {
  recipientType?: "owner";
  id: string;
  startedAt: number | null;
  durationMs: number;
  answered: boolean;
  endReason: string;
  callerNumber: string | null;
  outcome: CallOutcome;
  firstCallerLine: string | null;
  toolCount: number;
  turnCount: number;
  knowledgeSearches: number;
};
export type CallLogDetail = CallLogSummary & {
  tools: CallLogInput["tools"];
  outcomes: CallLogInput["outcomes"];
  transcript: CallLogInput["transcript"];
};

/** One headline result per call, from the booking tools' statuses. */
export function callOutcome(outcomes: CallLogInput["outcomes"]): CallOutcome {
  const writes = outcomes.filter(item => item.tool !== "register_customer");
  if (writes.some(item => item.status === "CONFIRMED")) return "booked";
  if (writes.some(item => item.status === "PENDING_REVIEW")) return "request_sent";
  if (writes.some(item => item.status === "UNKNOWN")) return "needs_staff";
  return "no_booking";
}

const millis = (value: unknown) =>
  typeof (value as { toMillis?: () => number })?.toMillis === "function" ? (value as { toMillis: () => number }).toMillis() : null;

export function toCallLogSummary(id: string, data: Record<string, unknown>): CallLogSummary {
  return {
    id,
    ...(data.recipientType === "owner" ? { recipientType: "owner" as const } : {}),
    startedAt: millis(data.startedAt),
    durationMs: Number(data.durationMs ?? 0),
    answered: data.answered === true,
    endReason: String(data.endReason ?? ""),
    callerNumber: typeof data.callerNumber === "string" ? data.callerNumber : null,
    outcome: (["booked", "request_sent", "needs_staff", "no_booking"] as const).includes(data.outcome as CallOutcome)
      ? data.outcome as CallOutcome : "no_booking",
    firstCallerLine: typeof data.firstCallerLine === "string" ? data.firstCallerLine : null,
    toolCount: Number(data.toolCount ?? 0),
    turnCount: Number(data.turnCount ?? 0),
    knowledgeSearches: Number(data.knowledgeSearches ?? 0),
  };
}

export function toCallLogDetail(id: string, data: Record<string, unknown>): CallLogDetail {
  return {
    ...toCallLogSummary(id, data),
    tools: Array.isArray(data.tools) ? data.tools as CallLogDetail["tools"] : [],
    outcomes: Array.isArray(data.outcomes) ? data.outcomes as CallLogDetail["outcomes"] : [],
    transcript: Array.isArray(data.transcript) ? data.transcript as CallLogDetail["transcript"] : [],
  };
}

/** Days a call log is kept before Firestore's TTL policy deletes it. */
export function callLogRetentionDays(env: Readonly<Record<string, string | undefined>> = process.env) {
  const days = Number(env.AI_CALL_LOG_RETENTION_DAYS || 90);
  return Number.isInteger(days) && days >= 1 && days <= 730 ? days : 90;
}

export function callConversationHighlights(transcript: CallLogInput["transcript"]) {
  const count = 24;
  const positions = new Set(Array.from({ length: Math.min(count, transcript.length) }, (_, i) =>
    transcript.length <= count ? i : Math.round(i * (transcript.length - 1) / (count - 1))));
  return transcript.filter((_, index) => positions.has(index)).map(turn => ({
    speaker: turn.speaker, atMs: turn.atMs, text: turn.text.slice(0, 350),
  }));
}
