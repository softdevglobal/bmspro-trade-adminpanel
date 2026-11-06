import { buildVoiceQuotationDraft, audioExtension, MAX_AUDIO_BYTES, VoiceDraftError, voiceDraftConfig } from "@/lib/ai/quotation/voice-draft";
import { logAuditEvent } from "@/lib/audit/server";
import { actorRoleFromClaim } from "@/lib/audit/types";
import { isBusinessModuleEnabled, parseBusinessModuleSettings } from "@/lib/business/module-settings";
import { adminDb } from "@/lib/firebase/admin";
import { listCatalogItems } from "@/lib/items/server";
import { listBusinessServices } from "@/lib/onboarding/services/server";
import { requireQuotationAuthor } from "@/lib/quotations/author-auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
// Transcription and drafting each take a few seconds to around half a minute.
export const maxDuration = 120;

const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

/**
 * POST /api/quotations/voice-draft (multipart form)
 *   audio      the recording (m4a, mp3, wav, webm, ogg or flac; up to 4 MB)
 *   requestId  optional site inspection the quotation is for
 *
 * Returns a quotation draft for the staff member to review. Nothing is saved
 * and the recording is not stored.
 */
export async function POST(request: Request) {
  const auth = await requireQuotationAuthor(request);
  if (!auth.ok) return fail(auth.status, auth.error);

  const config = voiceDraftConfig();
  if (!config) return fail(503, "Voice quotations are not turned on.");

  const business = (await adminDb.collection("businesses").doc(auth.businessId).get()).data();
  if (!business || !isBusinessModuleEnabled(parseBusinessModuleSettings(business), "quotations")) {
    return fail(403, "Quotations are turned off for this business.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "Send the recording as a form upload.");
  }
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return fail(400, "The recording is missing.");
  if (audio.size > MAX_AUDIO_BYTES) return fail(413, "The recording is too long. Keep it under about 10 minutes.");
  const filename = audio instanceof File && audio.name ? audio.name : "recording.m4a";
  if (!audioExtension(filename)) return fail(415, "Unsupported recording format.");

  // Optional visit context. Staff may only use visits assigned to them, as when saving a quotation.
  const requestId = typeof form.get("requestId") === "string" ? String(form.get("requestId")).trim() : "";
  let context: { serviceName?: string | null; customTitle?: string | null; customerNotes?: string | null } = {};
  if (requestId) {
    const visit = (await adminDb.collection("requests").doc(requestId).get()).data();
    if (!visit || visit.businessId !== auth.businessId) return fail(404, "Request not found.");
    const assignedUid = (visit.assignedTo as { uid?: string } | null)?.uid;
    if (auth.role === "staff" && assignedUid !== auth.uid) {
      return fail(403, "You can only create quotations for visits assigned to you.");
    }
    const custom = (visit.customRequest ?? {}) as { title?: unknown };
    context = {
      serviceName: typeof visit.serviceName === "string" ? visit.serviceName : null,
      customTitle: typeof custom.title === "string" ? custom.title : null,
      customerNotes: typeof visit.customerNotes === "string" ? visit.customerNotes : null,
    };
  }

  const [servicesResult, items] = await Promise.all([
    listBusinessServices(auth.businessId),
    listCatalogItems(auth.businessId),
  ]);
  const services = servicesResult.ok
    ? servicesResult.services.filter((s) => s.isActive).map((s) => ({ id: s.id, name: s.name, requiredSkill: s.requiredSkill }))
    : [];

  try {
    const draft = await buildVoiceQuotationDraft({ config, audio, filename, services, items, context });
    await logAuditEvent({
      businessId: auth.businessId,
      category: "quotation",
      action: "quotation.voice_draft",
      actor: { uid: auth.uid, role: actorRoleFromClaim(auth.role), name: auth.name, email: auth.email },
      source: "mobile_app",
      summary: `Prepared a quotation draft from a voice note (${draft.lineItems.length} lines)`,
      targetId: requestId || null,
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
    console.error("[voice-quotation] failed", error);
    return fail(500, "We couldn't prepare the quotation. Try again.");
  }
}
