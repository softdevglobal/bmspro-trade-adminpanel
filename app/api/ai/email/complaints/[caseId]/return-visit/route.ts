import { z } from "zod";

import { emailActionDeps } from "@/lib/ai/agent/handlers";
import { COMPLAINT_CASES_COLLECTION, mapCase } from "@/lib/ai/email/complaints/cases";
import { bookReturnVisit, linkReturnVisit, offerReturnVisit, previewReturnVisit } from "@/lib/ai/email/complaints/return-visit";
import { emailComplaintsEnabled, emailTriageAvailable } from "@/lib/ai/email/settings";
import { requireSophieOwner } from "@/lib/ai/owner-call/auth";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";
export const maxDuration = 30;

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), ownerConfirmsOurWork: z.boolean().optional() }).strict(),
  z.object({
    action: z.literal("offer"),
    ownerConfirmsOurWork: z.boolean(),
    chosen: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), startTime: z.string().regex(/^\d{2}:\d{2}$/) }).strict()).min(1).max(2),
  }).strict(),
  z.object({ action: z.literal("link"), jobId: z.string().min(1).max(100) }).strict(),
  /** Books the time the customer picked from the offer (no-charge visits only). */
  z.object({ action: z.literal("book"), date: z.string().regex(/^d{4}-d{2}-d{2}$/), startTime: z.string().regex(/^d{2}:d{2}$/) }).strict(),
]);

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

async function gate(request: Request) {
  const auth = await requireSophieOwner(request);
  if (!auth.ok) return { error: json({ error: auth.error }, auth.status) };
  if (!emailTriageAvailable() || !emailComplaintsEnabled()) return { error: json({ error: "Complaint handling isn't switched on yet." }, 404) };
  return { auth };
}

/** GET this customer's other jobs, to link the return visit once it's booked in the calendar. Owner only. */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const checked = await gate(request);
    if (!checked.auth) return checked.error;
    const { caseId } = await params;
    const data = /^[0-9a-f]{40}$/.test(caseId) ? (await adminDb.collection(COMPLAINT_CASES_COLLECTION).doc(caseId).get()).data() : null;
    if (!data || data.businessId !== checked.auth.businessId) return json({ error: "Case not found." }, 404);
    const found = mapCase(caseId, data);
    const jobs = found.customerEmail ? await emailActionDeps(adminDb).complaintJobs(checked.auth.businessId, found.customerEmail) : [];
    return json({
      jobs: jobs.filter((job) => job.id !== found.jobId && job.status !== "cancelled" && job.status !== "completed")
        .slice(0, 10).map((job) => ({ id: job.id, code: job.code, status: job.status, date: job.date, serviceName: job.serviceName })),
    });
  } catch {
    return json({ error: "Could not load this customer's jobs." }, 500);
  }
}

/**
 * POST the return-visit steps for one case (§10.10): `preview` the times that fit the owner's
 * approved rule, `offer` the times the owner chose, or `link` the visit once it's booked. Nothing
 * here books a visit or touches a price. Owner only.
 */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const checked = await gate(request);
    if (!checked.auth) return checked.error;
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return json({ error: "Choose what to do with the return visit." }, 400);
    const { caseId } = await params;
    const deps = emailActionDeps(adminDb);
    const businessId = checked.auth.businessId;
    if (body.data.action === "preview") {
      const preview = await previewReturnVisit(deps, { businessId, caseId, ownerConfirmsOurWork: body.data.ownerConfirmsOurWork === true });
      return preview ? json(preview) : json({ error: "Case not found." }, 404);
    }
    if (body.data.action === "offer") {
      const result = await offerReturnVisit(deps, { businessId, caseId, actorUid: checked.auth.uid, chosen: body.data.chosen, ownerConfirmsOurWork: body.data.ownerConfirmsOurWork });
      return result.ok ? json({ ok: true, offered: result.offered }) : json({ error: result.error }, result.status);
    }
    if (body.data.action === "book") {
      const booked = await bookReturnVisit(deps, { businessId, caseId, date: body.data.date, startTime: body.data.startTime, actorUid: checked.auth.uid });
      return booked.ok ? json({ ok: true, code: booked.code }) : json({ error: booked.error }, booked.status);
    }
    const result = await linkReturnVisit(deps, { businessId, caseId, jobId: body.data.jobId, actorUid: checked.auth.uid });
    return result.ok ? json({ ok: true }) : json({ error: result.error }, result.status);
  } catch {
    return json({ error: "Could not do that." }, 500);
  }
}
