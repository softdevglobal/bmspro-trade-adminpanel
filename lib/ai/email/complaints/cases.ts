import "server-only";

import { createHash } from "node:crypto";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { zonedDateTimeToUtcMs } from "@/lib/platform/zoned-datetime";

import { clockLabel, dateLabel } from "../hours";
import type { ComplaintType } from "../types";
import type { Fact } from "./facts";

/**
 * Complaint cases (docs/sophie-email-learning-and-auto-reply.md §10.4 step 4, §10.7, §10.8):
 * one `ai_complaint_cases` record per complaint, linking the customer, the job and the email, with
 * the fact sheet and a timeline of everything that happens. Server-only. Sophie opens and updates
 * a case; only the owner closes it. Nothing here changes a job, an invoice or any money.
 */

export const COMPLAINT_CASES_COLLECTION = "ai_complaint_cases";
/** Cases are deleted this long after they open (retention, step 11). */
export const CASE_TTL_MS = 180 * 24 * 60 * 60_000;

export const CASE_STATUSES = [
  "open", "waiting_staff", "waiting_owner", "escalated", "waiting_customer",
  "revisit_booked", "follow_up", "resolved", "resolved_no_reply", "closed_by_owner",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** The moves in §10.7. A move not listed here is refused. */
const MOVES: Record<CaseStatus, readonly CaseStatus[]> = {
  open: ["waiting_staff", "waiting_owner"],
  waiting_staff: ["waiting_owner", "waiting_customer"],
  waiting_owner: ["escalated", "waiting_customer", "resolved", "closed_by_owner"],
  escalated: ["waiting_owner", "waiting_customer", "resolved", "closed_by_owner"],
  waiting_customer: ["revisit_booked", "resolved", "waiting_owner", "resolved_no_reply", "closed_by_owner"],
  revisit_booked: ["follow_up", "waiting_owner", "closed_by_owner"],
  follow_up: ["resolved", "waiting_owner", "closed_by_owner"],
  resolved: [],
  resolved_no_reply: [],
  closed_by_owner: [],
};
export const canMove = (from: CaseStatus, to: CaseStatus) => MOVES[from]?.includes(to) === true;
export const isClosed = (status: CaseStatus) => MOVES[status].length === 0;

/** What the owner calls each kind of complaint. */
export const COMPLAINT_TYPE_LABELS: Record<string, string> = {
  late_arrival: "Late arrival", missed_visit: "Missed visit", work_unfinished: "Work not finished", repeat_fault: "Same fault again",
  quality: "Quality of work", damage: "Damage", conduct: "Conduct", billing: "Billing", safety: "Safety", no_update: "No update",
};
export const complaintTypeLabel = (type: string | null) => (type && COMPLAINT_TYPE_LABELS[type]) || "Complaint";

export type CaseEvent = { at: number; event: string; by: string };

export type ComplaintCase = {
  id: string;
  businessId: string;
  triageId: string;
  customerEmail: string | null;
  customerName: string | null;
  jobId: string | null;
  /** Why no job is linked, for the owner: "Two visits match. Pick the right one." */
  jobNote: string | null;
  threadId: string;
  type: ComplaintType | null;
  summary: string;
  status: CaseStatus;
  replyBy: number;
  facts: Fact[];
  /** What the records showed, kept for the owner's return-visit and compensation checks (never from the email). */
  measures: CaseMeasures | null;
  /** What the owner decided to do about it (§10.8). */
  remedy: CaseRemedy | null;
  timeline: CaseEvent[];
  createdAt: number;
  closedAt: number | null;
};

export type CaseMeasures = {
  /** YYYY-MM-DD of the job's visit. */
  jobDate: string | null;
  jobStatus: string | null;
  minutesAfterWindowStart: number | null;
  minutesAfterWindowEnd: number | null;
  /** The original visit's length in minutes, when recorded. */
  durationMinutes: number | null;
  staffUid: string | null;
};

export type CaseRemedy = {
  kind: "return_visit";
  noCharge: boolean;
  /** The times offered, as written to the customer. */
  offered: string[];
  /** The same times, as data, so the owner can book the one the customer picks. */
  offeredSlots?: { date: string; startTime: string; endTime: string; label: string }[];
  revisitJobId: string | null;
  decidedBy: string;
  decidedAt: number;
};

export const caseIdFor = (businessId: string, triageId: string) =>
  createHash("sha256").update(`${businessId}\ncomplaint\n${triageId}`).digest("hex").slice(0, 40);

const toMillis = (value: unknown) => (value instanceof Timestamp ? value.toMillis() : typeof value === "number" ? value : null);

export function mapCase(id: string, data: Record<string, unknown>): ComplaintCase {
  const status = CASE_STATUSES.includes(data.status as CaseStatus) ? (data.status as CaseStatus) : "waiting_owner";
  return {
    id,
    businessId: String(data.businessId ?? ""),
    triageId: String(data.triageId ?? ""),
    customerEmail: typeof data.customerEmail === "string" ? data.customerEmail : null,
    customerName: typeof data.customerName === "string" ? data.customerName : null,
    jobId: typeof data.jobId === "string" ? data.jobId : null,
    jobNote: typeof data.jobNote === "string" ? data.jobNote : null,
    threadId: String(data.threadId ?? ""),
    type: typeof data.type === "string" ? (data.type as ComplaintType) : null,
    summary: typeof data.summary === "string" ? data.summary : "",
    status,
    replyBy: toMillis(data.replyBy) ?? 0,
    facts: Array.isArray(data.facts) ? (data.facts as Fact[]) : [],
    measures: (data.measures as CaseMeasures | null | undefined) ?? null,
    remedy: data.remedy && typeof data.remedy === "object" ? { ...(data.remedy as CaseRemedy), decidedAt: toMillis((data.remedy as { decidedAt?: unknown }).decidedAt) ?? 0 } : null,
    timeline: (Array.isArray(data.timeline) ? data.timeline : []).map((item: Record<string, unknown>) => ({
      at: toMillis(item.at) ?? 0, event: String(item.event ?? ""), by: String(item.by ?? "sophie"),
    })),
    createdAt: toMillis(data.createdAt) ?? 0,
    closedAt: toMillis(data.closedAt),
  };
}

/**
 * When the owner will have replied by: `hours` from now, kept inside the business's email day
 * (7 am to 8 pm). Earlier than 7 am becomes 9 am that day, and later than 8 pm 9 am the next day.
 */
export function replyByTime(now: number, timeZone: string, hours = 24): number {
  const target = now + hours * 60 * 60_000;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(target));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const date = `${read("year")}-${read("month")}-${read("day")}`;
  const hour = Number(read("hour"));
  if (hour >= 7 && hour < 20) return target;
  const day = hour < 7 ? date : new Date(Date.parse(`${date}T00:00:00Z`) + 24 * 60 * 60_000).toISOString().slice(0, 10);
  return zonedDateTimeToUtcMs(day, "09:00", timeZone) ?? target;
}

/** "9 am Thursday 4 December". */
export function replyByLabel(at: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${clockLabel(`${read("hour")}:${read("minute")}`)} ${dateLabel(`${read("year")}-${read("month")}-${read("day")}`)}`;
}

export type NewCase = Omit<ComplaintCase, "id" | "timeline" | "closedAt" | "createdAt" | "measures" | "remedy"> & { measures?: CaseMeasures | null };

/** Opens a case. The same email always gives the same case, so a retried run finds the one it made. */
export async function openComplaintCase(db: Firestore, input: NewCase, now = Date.now()): Promise<{ id: string; created: boolean }> {
  const id = caseIdFor(input.businessId, input.triageId);
  const ref = db.collection(COMPLAINT_CASES_COLLECTION).doc(id);
  return db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) return { id, created: false };
    tx.set(ref, {
      businessId: input.businessId,
      triageId: input.triageId,
      customerEmail: input.customerEmail,
      customerName: input.customerName,
      jobId: input.jobId,
      jobNote: input.jobNote,
      threadId: input.threadId,
      type: input.type,
      summary: input.summary.slice(0, 300),
      status: input.status,
      replyBy: Timestamp.fromMillis(input.replyBy),
      facts: input.facts,
      measures: input.measures ?? null,
      remedy: null,
      timeline: [{ at: Timestamp.fromMillis(now), event: "Case opened from the customer's email.", by: "sophie" }],
      createdAt: Timestamp.fromMillis(now),
      closedAt: null,
      expireAt: Timestamp.fromMillis(now + CASE_TTL_MS),
    });
    return { id, created: true };
  });
}

type Move = { ok: true; case: ComplaintCase } | { ok: false; status: number; error: string };

/** Moves a case along §10.7 and adds to its timeline. */
export async function moveCase(
  db: Firestore,
  input: { businessId: string; caseId: string; to: CaseStatus; event: string; by: string; note?: string | null },
  now = Date.now(),
): Promise<Move> {
  if (!/^[0-9a-f]{40}$/.test(input.caseId)) return { ok: false, status: 404, error: "Case not found." };
  const ref = db.collection(COMPLAINT_CASES_COLLECTION).doc(input.caseId);
  return db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data();
    if (!data || data.businessId !== input.businessId) return { ok: false as const, status: 404, error: "Case not found." };
    const current = mapCase(input.caseId, data);
    if (!canMove(current.status, input.to)) return { ok: false as const, status: 409, error: "This case can't move there from where it is." };
    const note = input.note?.replace(/\s+/g, " ").trim().slice(0, 500);
    const event = note ? `${input.event} “${note}”` : input.event;
    const timeline = [...(Array.isArray(data.timeline) ? data.timeline : []), { at: Timestamp.fromMillis(now), event, by: input.by }].slice(-100);
    const closing = isClosed(input.to);
    tx.set(ref, { status: input.to, timeline, ...(closing ? { closedAt: Timestamp.fromMillis(now) } : {}) }, { merge: true });
    return { ok: true as const, case: { ...current, status: input.to, closedAt: closing ? now : null, timeline: [...current.timeline, { at: now, event, by: input.by }] } };
  });
}

/** Records what the owner decided (a return visit offer), once. */
export async function setRemedy(db: Firestore, input: { businessId: string; caseId: string; remedy: Omit<CaseRemedy, "decidedAt"> }, now = Date.now()): Promise<boolean> {
  const ref = db.collection(COMPLAINT_CASES_COLLECTION).doc(input.caseId);
  return db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data();
    if (!data || data.businessId !== input.businessId) return false;
    tx.set(ref, { remedy: { ...input.remedy, decidedAt: Timestamp.fromMillis(now) } }, { merge: true });
    return true;
  });
}

/** Adds a line to a case's timeline without moving it. */
export async function noteCase(db: Firestore, input: { businessId: string; caseId: string; event: string; by: string }, now = Date.now()): Promise<boolean> {
  const ref = db.collection(COMPLAINT_CASES_COLLECTION).doc(input.caseId);
  return db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data();
    if (!data || data.businessId !== input.businessId) return false;
    const timeline = [...(Array.isArray(data.timeline) ? data.timeline : []), { at: Timestamp.fromMillis(now), event: input.event, by: input.by }].slice(-100);
    tx.set(ref, { timeline }, { merge: true });
    return true;
  });
}

/** Cases that still need the owner, newest first. */
export async function listOpenCases(db: Firestore, businessId: string, limit = 20): Promise<ComplaintCase[]> {
  const snap = await db.collection(COMPLAINT_CASES_COLLECTION).where("businessId", "==", businessId).where("closedAt", "==", null).limit(limit * 2).get();
  return snap.docs
    .map((doc) => mapCase(doc.id, doc.data() ?? {}))
    .filter((item) => item.businessId === businessId && !isClosed(item.status))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}
