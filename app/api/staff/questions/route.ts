import { requireSophieStaff } from "@/lib/ai/email/complaints/staff-auth";
import { listStaffQuestions } from "@/lib/ai/email/complaints/staff-questions";
import { staffQuestionsEnabled } from "@/lib/ai/email/settings";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

/**
 * GET the signed-in technician's open questions from Sophie (docs/sophie-email-learning-and-auto-reply.md
 * §10.4 step 6, §10.8). Only their own, and nothing about the customer: the job code and a neutral
 * question with answers to tap.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireSophieStaff(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!staffQuestionsEnabled()) return json({ questions: [] });
    return json({ questions: await listStaffQuestions(adminDb, auth.businessId, auth.uid) });
  } catch {
    return json({ error: "Could not load your questions." }, 500);
  }
}
