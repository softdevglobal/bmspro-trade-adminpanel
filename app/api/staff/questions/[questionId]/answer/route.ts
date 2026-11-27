import { z } from "zod";

import { requireSophieStaff } from "@/lib/ai/email/complaints/staff-auth";
import { ANSWER_NOTE_MAX, answerStaffQuestion } from "@/lib/ai/email/complaints/staff-questions";
import { staffQuestionsEnabled } from "@/lib/ai/email/settings";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

const bodySchema = z.object({ choice: z.string().max(100), note: z.string().max(ANSWER_NOTE_MAX * 2).optional() }).strict();

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

/**
 * POST the technician's answer to one of Sophie's questions (§10.8): one of the answers to tap, and
 * an optional note. Only the technician it was sent to. Only the owner sees the answer.
 */
export async function POST(request: Request, { params }: { params: Promise<{ questionId: string }> }) {
  try {
    const auth = await requireSophieStaff(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!staffQuestionsEnabled()) return json({ error: "Not available." }, 404);
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return json({ error: "Choose one of the answers." }, 400);
    const { questionId } = await params;
    const result = await answerStaffQuestion(adminDb, {
      businessId: auth.businessId, staffUid: auth.uid, questionId, choice: body.data.choice, note: body.data.note,
    }, Date.now());
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ ok: true });
  } catch {
    return json({ error: "Could not save your answer." }, 500);
  }
}
