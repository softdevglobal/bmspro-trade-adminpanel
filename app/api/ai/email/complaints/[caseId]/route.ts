import { z } from "zod";

import { moveCase } from "@/lib/ai/email/complaints/cases";
import { expireQuestionAfterClose } from "@/lib/ai/email/complaints/staff-questions";
import { emailTriageAvailable } from "@/lib/ai/email/settings";
import { requireSophieOwner } from "@/lib/ai/owner-call/auth";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

const bodySchema = z.object({
  /** "resolve": sorted out. "close": closed without a resolution. "acknowledge": seen an overdue case. "reopen": it's still not fixed. */
  action: z.enum(["resolve", "close", "acknowledge", "reopen"]),
  note: z.string().max(500).optional(),
}).strict();

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

/** PATCH one case: only the owner resolves or closes it (§10.7). Owner only. */
export async function PATCH(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!emailTriageAvailable()) return json({ error: "Sophie's email sorting isn't available yet." }, 404);
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return json({ error: "Choose whether it's resolved or closed." }, 400);
    const { caseId } = await params;
    const { action } = body.data;
    const result = await moveCase(adminDb, {
      businessId: auth.businessId,
      caseId,
      to: action === "resolve" ? "resolved" : action === "close" ? "closed_by_owner" : "waiting_owner",
      event: action === "resolve" ? "The owner marked it resolved." : action === "close" ? "The owner closed the case." : action === "reopen" ? "The customer says it's still not fixed." : "The owner saw the overdue case.",
      by: auth.uid,
      note: body.data.note,
    });
    if (!result.ok) return json({ error: result.error }, result.status);
    // The technician's answer is kept 90 days after the case closes, then deleted (open decision 17).
    if (action === "resolve" || action === "close") await expireQuestionAfterClose(adminDb, auth.businessId, caseId, Date.now()).catch(() => undefined);
    return json({ ok: true, status: result.case.status });
  } catch {
    return json({ error: "Could not update the case." }, 500);
  }
}
