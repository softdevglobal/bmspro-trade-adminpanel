import "server-only";

import { isBusinessModuleEnabled, parseBusinessModuleSettings } from "@/lib/business/module-settings";
import { adminDb } from "@/lib/firebase/admin";
import { listCatalogItems } from "@/lib/items/server";
import { listBusinessServices } from "@/lib/onboarding/services/server";
import { requireQuotationAuthor } from "@/lib/quotations/author-auth";
import {
  voiceDraftConfig,
  type VoiceDraftCatalogItem,
  type VoiceDraftConfig,
  type VoiceDraftContext,
  type VoiceDraftService,
} from "./voice-draft";

type Author = Extract<Awaited<ReturnType<typeof requireQuotationAuthor>>, { ok: true }>;

export type VoiceQuotationSetup =
  | {
      ok: true;
      auth: Author;
      config: VoiceDraftConfig;
      requestId: string | null;
      context: VoiceDraftContext;
      services: VoiceDraftService[];
      items: VoiceDraftCatalogItem[];
    }
  | { ok: false; status: number; error: string };

/**
 * Shared checks for both voice quotation steps (transcribe, then draft):
 * the caller may author quotations, the feature is on, the business has
 * quotations enabled, and staff may only use visits assigned to them.
 * Loads the business's active services and item list.
 */
export async function setUpVoiceQuotation(request: Request, rawRequestId: unknown): Promise<VoiceQuotationSetup> {
  const auth = await requireQuotationAuthor(request);
  if (!auth.ok) return auth;

  const config = voiceDraftConfig();
  if (!config) return { ok: false, status: 503, error: "Voice quotations are not turned on." };

  const business = (await adminDb.collection("businesses").doc(auth.businessId).get()).data();
  if (!business || !isBusinessModuleEnabled(parseBusinessModuleSettings(business), "quotations")) {
    return { ok: false, status: 403, error: "Quotations are turned off for this business." };
  }

  const requestId = typeof rawRequestId === "string" && rawRequestId.trim() ? rawRequestId.trim() : null;
  let context: VoiceDraftContext = {};
  if (requestId) {
    const visit = (await adminDb.collection("requests").doc(requestId).get()).data();
    if (!visit || visit.businessId !== auth.businessId) return { ok: false, status: 404, error: "Request not found." };
    const assignedUid = (visit.assignedTo as { uid?: string } | null)?.uid;
    if (auth.role === "staff" && assignedUid !== auth.uid) {
      return { ok: false, status: 403, error: "You can only create quotations for visits assigned to you." };
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

  return { ok: true, auth, config, requestId, context, services, items };
}
