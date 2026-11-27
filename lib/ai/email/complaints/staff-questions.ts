import "server-only";

import { createHash } from "node:crypto";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { moveCase, noteCase } from "./cases";
import { addWorkingMinutes, nextWorkingMoment, type WorkingSchedule } from "./working-time";
import type { ComplaintType } from "../types";

/**
 * Asking the technician what happened (docs/sophie-email-learning-and-auto-reply.md §10.4 step 6,
 * §10.8). A neutral, factual question to the technician named on the job, only during their working
 * hours, with one reminder and a 4-working-hour deadline. Silence means nothing (S02): after the
 * deadline the owner just sees "hasn't answered yet".
 *
 * The answer is INTERNAL. Only the owner sees it. It never goes to the customer as written, never
 * into Sophie's memory or knowledge, and Sophie never uses it for discipline (S02).
 *
 * Never asked for conduct, billing, safety or "no update" complaints, which are the owner's alone.
 */

export const STAFF_QUESTIONS_COLLECTION = "ai_staff_questions";
export const ANSWER_NOTE_MAX = 1_000;
const WORKING_HOURS_TO_ANSWER = 4;
/** The answer is kept for this long after its case closes (open decision 17). */
export const ANSWER_KEPT_AFTER_CLOSE_MS = 90 * 24 * 60 * 60_000;
export const QUESTION_TTL_MS = 180 * 24 * 60 * 60_000;

/** Complaint types where asking the technician is right: factual questions only (§10.2). */
export const ASKABLE: readonly ComplaintType[] = ["late_arrival", "missed_visit", "work_unfinished", "repeat_fault", "quality", "damage"];

export const ANSWER_OPTIONS = [
  "The previous job ran over",
  "Traffic or travel",
  "Waiting on parts or access",
  "The work isn't finished yet",
  "I wasn't on this job",
  "Something else",
] as const;

const WHAT: Record<string, string> = {
  late_arrival: "the start time of the visit",
  missed_visit: "whether the visit went ahead",
  work_unfinished: "whether the work was finished",
  repeat_fault: "the same problem coming back",
  quality: "how the site was left",
  damage: "something at the site after the visit",
};

/** The question, in neutral words: it never says "you were late" or what the customer said about a person. */
export function questionText(type: ComplaintType, jobCode: string): { title: string; body: string } {
  return {
    title: "Question from Sophie",
    body: `About job ${jobCode}. A customer has contacted us about ${WHAT[type] ?? "this job"}. Could you tell us what happened? Only your manager sees your answer.`,
  };
}

export type StaffQuestionStatus = "waiting" | "sent" | "answered" | "expired" | "cancelled";

export type StaffQuestion = {
  id: string;
  businessId: string;
  caseId: string;
  jobId: string;
  jobCode: string;
  staffUid: string;
  staffName: string | null;
  type: ComplaintType;
  title: string;
  body: string;
  options: string[];
  status: StaffQuestionStatus;
  askAfter: number;
  reminderAt: number;
  deadline: number;
  remindedAt: number | null;
  answer: { choice: string; note: string | null } | null;
  answeredAt: number | null;
};

const toMillis = (value: unknown) => (value instanceof Timestamp ? value.toMillis() : typeof value === "number" ? value : null);

export const questionIdFor = (businessId: string, caseId: string) =>
  createHash("sha256").update(`${businessId}\nstaff-question\n${caseId}`).digest("hex").slice(0, 40);

export function mapQuestion(id: string, data: Record<string, unknown>): StaffQuestion {
  const answer = data.answer as { choice?: unknown; note?: unknown } | null | undefined;
  return {
    id,
    businessId: String(data.businessId ?? ""),
    caseId: String(data.caseId ?? ""),
    jobId: String(data.jobId ?? ""),
    jobCode: String(data.jobCode ?? ""),
    staffUid: String(data.staffUid ?? ""),
    staffName: typeof data.staffName === "string" ? data.staffName : null,
    type: String(data.type ?? "late_arrival") as ComplaintType,
    title: String(data.title ?? "Question from Sophie"),
    body: String(data.body ?? ""),
    options: Array.isArray(data.options) ? data.options.map(String) : [...ANSWER_OPTIONS],
    status: (["waiting", "sent", "answered", "expired", "cancelled"] as const).find((value) => value === data.status) ?? "waiting",
    askAfter: toMillis(data.askAfter) ?? 0,
    reminderAt: toMillis(data.reminderAt) ?? 0,
    deadline: toMillis(data.deadline) ?? 0,
    remindedAt: toMillis(data.remindedAt),
    answer: answer && typeof answer.choice === "string" ? { choice: answer.choice, note: typeof answer.note === "string" ? answer.note : null } : null,
    answeredAt: toMillis(data.answeredAt),
  };
}

export type CreateQuestion =
  | { outcome: "created"; id: string; askAfter: number; deadline: number }
  | { outcome: "exists"; id: string }
  | { outcome: "not_asked"; reason: "not_askable" | "no_technician" | "no_working_time" };

/** Creates the question for a case, once. Not asked at all unless it's right to ask this technician now or soon. */
export async function createStaffQuestion(
  db: Firestore,
  input: { businessId: string; caseId: string; jobId: string; jobCode: string; staffUid: string | null; staffName: string | null; type: ComplaintType | null; schedule: WorkingSchedule | null },
  now: number,
): Promise<CreateQuestion> {
  if (!input.type || !ASKABLE.includes(input.type)) return { outcome: "not_asked", reason: "not_askable" };
  if (!input.staffUid) return { outcome: "not_asked", reason: "no_technician" };
  const askAfter = input.schedule ? nextWorkingMoment(now, input.schedule) : null;
  const reminderAt = askAfter !== null && input.schedule ? addWorkingMinutes(askAfter, (WORKING_HOURS_TO_ANSWER * 60) / 2, input.schedule) : null;
  const deadline = askAfter !== null && input.schedule ? addWorkingMinutes(askAfter, WORKING_HOURS_TO_ANSWER * 60, input.schedule) : null;
  if (askAfter === null || reminderAt === null || deadline === null) return { outcome: "not_asked", reason: "no_working_time" };

  const id = questionIdFor(input.businessId, input.caseId);
  const ref = db.collection(STAFF_QUESTIONS_COLLECTION).doc(id);
  const text = questionText(input.type, input.jobCode);
  return db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) return { outcome: "exists" as const, id };
    tx.set(ref, {
      businessId: input.businessId,
      caseId: input.caseId,
      jobId: input.jobId,
      jobCode: input.jobCode,
      staffUid: input.staffUid,
      staffName: input.staffName,
      type: input.type,
      templateId: "complaint_what_happened",
      ...text,
      options: [...ANSWER_OPTIONS],
      status: "waiting",
      askAfter: Timestamp.fromMillis(askAfter),
      reminderAt: Timestamp.fromMillis(reminderAt),
      deadline: Timestamp.fromMillis(deadline),
      remindedAt: null,
      answer: null,
      answeredAt: null,
      createdAt: Timestamp.fromMillis(now),
      expireAt: Timestamp.fromMillis(now + QUESTION_TTL_MS),
    });
    return { outcome: "created" as const, id, askAfter, deadline };
  });
}

export type ScanDeps = {
  /** Pushes one staff member. Resolves when it was handed to the push service. */
  push(uid: string, push: { title: string; body: string; data: Record<string, string> }): Promise<void>;
};

export type ScanResult = { sent: number; reminded: number; expired: number };

/**
 * The scan (§10.9 step 9), run every few minutes: sends questions whose time has come, sends the one
 * reminder, and ends a question at its deadline by telling the owner it hasn't been answered.
 */
export async function scanStaffQuestions(db: Firestore, deps: ScanDeps, now: number): Promise<ScanResult> {
  const result: ScanResult = { sent: 0, reminded: 0, expired: 0 };
  const collection = db.collection(STAFF_QUESTIONS_COLLECTION);
  const [waiting, sent] = await Promise.all([
    collection.where("status", "==", "waiting").limit(200).get(),
    collection.where("status", "==", "sent").limit(200).get(),
  ]);

  for (const doc of waiting.docs) {
    const question = mapQuestion(doc.id, doc.data() ?? {});
    if (question.askAfter > now) continue;
    try {
      await deps.push(question.staffUid, { title: question.title, body: `About job ${question.jobCode}. Tap to answer.`, data: { type: "staff_question", questionId: question.id } });
    } catch (error) {
      console.error("[complaints] staff push failed", (error as Error)?.name);
      continue;
    }
    await doc.ref.set({ status: "sent", sentAt: Timestamp.fromMillis(now) }, { merge: true });
    result.sent++;
  }

  for (const doc of sent.docs) {
    const question = mapQuestion(doc.id, doc.data() ?? {});
    if (question.deadline <= now) {
      await doc.ref.set({ status: "expired" }, { merge: true });
      await moveCase(db, { businessId: question.businessId, caseId: question.caseId, to: "waiting_owner", event: `${question.staffName ?? "The technician"} hasn't answered yet.`, by: "sophie" }, now);
      result.expired++;
    } else if (question.remindedAt === null && question.reminderAt <= now) {
      try {
        await deps.push(question.staffUid, { title: "Reminder: question from Sophie", body: `About job ${question.jobCode}. Tap to answer.`, data: { type: "staff_question", questionId: question.id } });
      } catch (error) {
        console.error("[complaints] staff reminder failed", (error as Error)?.name);
        continue;
      }
      await doc.ref.set({ remindedAt: Timestamp.fromMillis(now) }, { merge: true });
      result.reminded++;
    }
  }
  return result;
}

/** The technician's open questions: only their own, with nothing about the customer. */
export async function listStaffQuestions(db: Firestore, businessId: string, staffUid: string): Promise<Pick<StaffQuestion, "id" | "jobCode" | "title" | "body" | "options" | "deadline">[]> {
  const snap = await db.collection(STAFF_QUESTIONS_COLLECTION).where("staffUid", "==", staffUid).where("status", "==", "sent").limit(20).get();
  return snap.docs
    .map((doc) => mapQuestion(doc.id, doc.data() ?? {}))
    .filter((question) => question.businessId === businessId && question.staffUid === staffUid)
    .map(({ id, jobCode, title, body, options, deadline }) => ({ id, jobCode, title, body, options, deadline }));
}

export type AnswerResult = { ok: true } | { ok: false; status: number; error: string };

/** The technician's answer. Only the technician it was sent to, in their business, and only once. */
export async function answerStaffQuestion(
  db: Firestore,
  input: { businessId: string; staffUid: string; questionId: string; choice: unknown; note: unknown },
  now: number,
): Promise<AnswerResult> {
  if (!/^[0-9a-f]{40}$/.test(input.questionId)) return { ok: false, status: 404, error: "Question not found." };
  const ref = db.collection(STAFF_QUESTIONS_COLLECTION).doc(input.questionId);
  const outcome = await db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data();
    if (!data || data.businessId !== input.businessId || data.staffUid !== input.staffUid) return { ok: false as const, status: 404, error: "Question not found." };
    const question = mapQuestion(input.questionId, data);
    if (question.status === "answered") return { ok: false as const, status: 409, error: "You've already answered this." };
    if (question.status !== "sent" && question.status !== "expired") return { ok: false as const, status: 409, error: "This question isn't open." };
    if (typeof input.choice !== "string" || !question.options.includes(input.choice)) return { ok: false as const, status: 400, error: "Choose one of the answers." };
    const note = typeof input.note === "string" ? input.note.replace(/\s+/g, " ").trim().slice(0, ANSWER_NOTE_MAX) : "";
    tx.set(ref, { status: "answered", answer: { choice: input.choice, note: note || null }, answeredAt: Timestamp.fromMillis(now) }, { merge: true });
    return { ok: true as const, question };
  });
  if (!outcome.ok) return outcome;
  const { question } = outcome;
  const event = `${question.staffName ?? "The technician"} answered${question.status === "expired" ? " (after the deadline)" : ""}.`;
  // Waiting on the technician: now it's the owner's. Otherwise just note it.
  const moved = await moveCase(db, { businessId: question.businessId, caseId: question.caseId, to: "waiting_owner", event, by: "sophie" }, now);
  if (!moved.ok) await noteCase(db, { businessId: question.businessId, caseId: question.caseId, event, by: "sophie" }, now);
  return { ok: true };
}

/** The question and answer for one case, for the owner's card only. */
export async function questionForCase(db: Firestore, businessId: string, caseId: string): Promise<StaffQuestion | null> {
  const data = (await db.collection(STAFF_QUESTIONS_COLLECTION).doc(questionIdFor(businessId, caseId)).get()).data();
  return data && data.businessId === businessId ? mapQuestion(questionIdFor(businessId, caseId), data) : null;
}

/** When a case closes, its answer is kept 90 days more and then deleted (open decision 17). */
export async function expireQuestionAfterClose(db: Firestore, businessId: string, caseId: string, now: number): Promise<void> {
  const ref = db.collection(STAFF_QUESTIONS_COLLECTION).doc(questionIdFor(businessId, caseId));
  const data = (await ref.get()).data();
  if (!data || data.businessId !== businessId) return;
  await ref.set({ expireAt: Timestamp.fromMillis(now + ANSWER_KEPT_AFTER_CLOSE_MS) }, { merge: true });
}
