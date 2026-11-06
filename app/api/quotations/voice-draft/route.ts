import { draftFromTranscript, MAX_TRANSCRIPT_CHARS, VoiceDraftError } from "@/lib/ai/quotation/voice-draft";
import { setUpVoiceQuotation } from "@/lib/ai/quotation/voice-route";
import { logAuditEvent } from "@/lib/audit/server";
import { actorRoleFromClaim } from "@/lib/audit/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

/**
 * POST /api/quotations/voice-draft (JSON)
 *   transcript  the voice note text, as reviewed and corrected by the staff member
 *   requestId   optional site inspection the quotation is for
 *
 * Step 2 of a voice quotation: returns a quotation draft for the staff member
 * to edit in the quotation form. Nothing is saved.
 */
export async function POST(request: Request) {
  const parsed: unknown = await request.json().catch(() => null);
  const body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  // Check the caller before reporting anything about the body.
  const setup = await setUpVoiceQuotation(request, body?.requestId);
  if (!setup.ok) return fail(setup.status, setup.error);
  if (!body) return fail(400, "Invalid request body.");

  const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
  if (!transcript) return fail(400, "Add the voice note text.");
  if (transcript.length > MAX_TRANSCRIPT_CHARS) return fail(413, "The text is too long.");

  try {
    const draft = await draftFromTranscript({
      config: setup.config,
      transcript,
      services: setup.services,
      items: setup.items,
      context: setup.context,
    });
    const { auth } = setup;
    await logAuditEvent({
      businessId: auth.businessId,
      category: "quotation",
      action: "quotation.voice_draft",
      actor: { uid: auth.uid, role: actorRoleFromClaim(auth.role), name: auth.name, email: auth.email },
      source: "mobile_app",
      summary: `Prepared a quotation draft from a voice note (${draft.lineItems.length} lines)`,
      targetId: setup.requestId,
      // Counts only: the transcript can contain customer details.
      metadata: {
        lines: draft.lineItems.length,
        unpricedLines: draft.lineItems.filter((line) => line.needsPrice).length,
        serviceMatched: draft.serviceId !== null,
      },
    });
    return NextResponse.json({ ok: true, draft });
  } catch (error) {
    if (error instanceof VoiceDraftError) return fail(error.status, error.message);
    console.error("[voice-quotation] draft failed", error);
    return fail(500, "We couldn't prepare the quotation. Try again.");
  }
}
