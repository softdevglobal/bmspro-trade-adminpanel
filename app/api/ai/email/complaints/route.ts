import { complaintTypeLabel, listOpenCases } from "@/lib/ai/email/complaints/cases";
import { questionForCase } from "@/lib/ai/email/complaints/staff-questions";
import { emailComplaintsEnabled, emailTriageAvailable } from "@/lib/ai/email/settings";
import { requireSophieOwner } from "@/lib/ai/owner-call/auth";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

/** GET the complaint cases waiting on the owner (§10.4). Owner only. */
export async function GET(request: Request) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!emailTriageAvailable()) return json({ available: false });
    if (!emailComplaintsEnabled()) return json({ available: true, cases: [] });
    const cases = await listOpenCases(adminDb, auth.businessId);
    const questions = await Promise.all(cases.map((item) => questionForCase(adminDb, auth.businessId, item.id).catch(() => null)));
    return json({
      available: true,
      cases: cases.map((item, index) => ({
        id: item.id,
        typeLabel: complaintTypeLabel(item.type),
        customerName: item.customerName,
        customerEmail: item.customerEmail,
        summary: item.summary,
        status: item.status,
        replyBy: item.replyBy,
        jobNote: item.jobNote,
        facts: item.facts,
        timeline: item.timeline.slice(-8),
        createdAt: item.createdAt,
        // The times offered, so the owner can book the one the customer picked (no-charge visits only).
        offered: item.remedy?.noCharge && !item.remedy.revisitJobId ? item.remedy.offeredSlots ?? [] : [],
        // Internal: only the owner ever sees what the technician said (§10.4 step 6).
        staffQuestion: questions[index] ? {
          staffName: questions[index]!.staffName,
          status: questions[index]!.status,
          answer: questions[index]!.answer,
        } : null,
      })),
    });
  } catch {
    return json({ error: "Could not load complaint cases." }, 500);
  }
}
