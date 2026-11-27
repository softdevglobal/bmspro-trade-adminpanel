import { moveCase, openComplaintCase, replyByTime, type CaseStatus } from "../complaints/cases";
import { buildFacts, latenessMinutes } from "../complaints/facts";
import { findComplaintJob, type ComplaintJob } from "../complaints/find-job";
import { createStaffQuestion } from "../complaints/staff-questions";
import { emailComplaintsEnabled, staffQuestionsEnabled } from "../settings";
import type { ComplaintType, EmailTriageResult } from "../types";
import type { ActionHandler } from "./context";
import { Timestamp } from "firebase-admin/firestore";

/**
 * Open a complaint case (docs/sophie-email-learning-and-auto-reply.md §10.4 steps 1, 4 and 5): find
 * the job, collect the facts from the records, and file it for the owner's case card. Read-only on
 * everything else: it never touches a job, an invoice or any money, and never writes to the customer.
 *
 * The job is only looked for when the sender is a verified customer (§9.2). Otherwise the case
 * opens without one, and the owner links it. Safety complaints don't come here: the owner and the
 * safety reply come first (§10.5).
 */

const VERIFIED = new Set(["verified_sender", "verified_thread"]);

/** Conduct and billing complaints go to the owner only; the rest wait for a staff question, which isn't built yet. */
const OWNER_ONLY: readonly ComplaintType[] = ["conduct", "billing", "damage", "safety"];

const NOTE: Record<"not_found" | "several" | "none_recent", string> = {
  not_found: "The booking reference in the email didn't match one of this customer's jobs.",
  several: "More than one visit could be the one they mean. Check which.",
  none_recent: "I couldn't find a visit in the last 30 days to link.",
};

export const openComplaintCaseAction: ActionHandler = {
  async run(context) {
    const { deps, businessId, triage, message, now } = context;
    if (!emailComplaintsEnabled(deps.env ?? process.env)) {
      return { status: "manual", summary: "I didn't open a case: complaint cases aren't switched on yet. Handle it from your inbox." };
    }
    const result = (triage.result ?? null) as EmailTriageResult | null;
    if (result?.complaintType === "safety") {
      return { status: "manual", summary: "This is a safety complaint, so you and the safety reply come first. I didn't open a case." };
    }
    const timeZone = await deps.timeZone(businessId);
    const email = typeof message?.fromAddress === "string" ? message.fromAddress.trim().toLowerCase() : typeof triage.sender?.address === "string" ? triage.sender.address.toLowerCase() : null;
    const decided = context.decision?.decidedAt;
    const from = decided instanceof Timestamp ? decided.toMillis() : now;

    let job: ComplaintJob | null = null;
    let jobsForFacts: ComplaintJob[] = [];
    let jobNote: string | null = "I only link a job for a verified customer.";
    if (email && VERIFIED.has(String(triage.identity))) {
      const jobs = await deps.complaintJobs(businessId, email);
      jobsForFacts = jobs;
      const found = findComplaintJob({ jobRef: result?.jobRef ?? null, jobs, now, timeZone });
      if (found.outcome === "one") {
        job = found.job;
        jobNote = null;
      } else {
        jobNote = NOTE[found.reason];
      }
    }
    const checkIns = job?.staffUid ? await deps.staffCheckIns(businessId, job.staffUid) : [];
    const facts = job ? buildFacts({ type: result?.complaintType ?? null, job, checkIns, timeZone, otherJobs: jobsForFacts }) : [];
    // Conduct, billing and safety never go to the technician: they wait for the owner (§10.2).
    // A case starts "open", then waits for the technician or for the owner (§10.7).
    const status: CaseStatus = "open";
    const opened = await openComplaintCase(deps.db, {
      businessId,
      triageId: context.triageId,
      customerEmail: email,
      customerName: typeof triage.customerName === "string" ? triage.customerName : null,
      jobId: job?.id ?? null,
      jobNote,
      threadId: String(message?.threadId ?? triage.threadId ?? ""),
      type: result?.complaintType ?? null,
      summary: result?.summary ?? "",
      status,
      replyBy: replyByTime(from, timeZone),
      facts,
      measures: job ? {
        jobDate: job.date, jobStatus: job.status, staffUid: job.staffUid, durationMinutes: job.durationMinutes,
        minutesAfterWindowStart: latenessMinutes(job, timeZone)?.afterStart ?? null,
        minutesAfterWindowEnd: latenessMinutes(job, timeZone)?.afterEnd ?? null,
      } : null,
    }, now);
    // Ask the technician named on the job, when that's switched on and right for this kind of complaint.
    let asked = "";
    let waitingOnStaff = false;
    if (opened.created && job && staffQuestionsEnabled(deps.env ?? process.env)) {
      const schedule = job.staffUid ? await deps.staffSchedule(businessId, job.staffUid) : null;
      const question = await createStaffQuestion(deps.db, {
        businessId, caseId: opened.id, jobId: job.id, jobCode: job.code, staffUid: job.staffUid, staffName: job.staffName,
        type: result?.complaintType ?? null, schedule,
      }, now);
      if (question.outcome === "created") {
        waitingOnStaff = true;
        asked = ` I'll ask ${job.staffName ?? "the technician"} what happened during their working hours.`;
      }
    }
    if (opened.created) {
      await moveCase(deps.db, {
        businessId, caseId: opened.id, to: waitingOnStaff ? "waiting_staff" : "waiting_owner",
        event: waitingOnStaff ? `Asked ${job?.staffName ?? "the technician"} what happened.` : "Waiting for you.", by: "sophie",
      }, now);
    }
    const where = job ? `linked to ${job.code}` : "without a linked job";
    return {
      status: "done",
      summary: opened.created
        ? `Opened a complaint case, ${where}${OWNER_ONLY.includes(result?.complaintType as ComplaintType) ? " (for you only)" : ""}. It's under Emails → Sophie.${asked}`
        : "The complaint case was already open.",
    };
  },
};
