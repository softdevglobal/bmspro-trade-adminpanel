import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { logAuditEvent } from "@/lib/audit/server";
import { isTenantAccessAllowed } from "@/lib/onboarding/business-status";
import { parseVoiceBusinesses, type VoiceBusiness } from "../config";
import { assertMappingVersion, didMappingInput, DidMappingError,
  type DidMappingRow, type StoredDidMapping, type DidBusinessOption } from "./did-mapping-types";

export const DID_MAPPINGS_COLLECTION = "ai_did_mappings";
function parseStored(did: string, data: Record<string, unknown> | undefined): StoredDidMapping | null {
  if (!data) return null;
  const result = didMappingInput.safeParse({ did: data.did, businessId: data.businessId, isActive: data.isActive, version: data.version });
  if (!result.success || result.data.did !== did || result.data.version < 1) throw new DidMappingError(503, "A saved phone mapping is invalid. Contact support.");
  return result.data;
}
const setupMappings = () => parseVoiceBusinesses(process.env.AI_VOICE_TRADE_DID_CONFIG_JSON ?? "[]");

export type VoiceDidRoute = { state: "unmapped" } | { state: "disabled" } | { state: "active"; binding: VoiceBusiness };
export async function lookupVoiceDidRoute(did: string): Promise<VoiceDidRoute> {
  if (!/^\d{6,15}$/.test(did)) return { state: "unmapped" };
  const snapshot = await adminDb.collection(DID_MAPPINGS_COLLECTION).doc(did).get();
  const stored = parseStored(did, snapshot.data());
  if (!stored) return { state: "unmapped" };
  if (!stored.isActive) return { state: "disabled" };
  const business = (await adminDb.collection("businesses").doc(stored.businessId).get()).data();
  if (!business || !isTenantAccessAllowed(business.status, business.isActive)) return { state: "disabled" };
  return { state: "active", binding: { did, businessId: stored.businessId } };
}

export async function resolveVoiceDidMapping(did: string): Promise<VoiceBusiness | null> {
  const route = await lookupVoiceDidRoute(did);
  return route.state === "active" ? route.binding : null;
}

export async function listVoiceDidMappings(): Promise<{ mappings: DidMappingRow[]; businesses: DidBusinessOption[] }> {
  const [saved, businessSnapshot] = await Promise.all([
    adminDb.collection(DID_MAPPINGS_COLLECTION).get(),
    adminDb.collection("businesses").select("businessName", "status", "isActive").get(),
  ]);
  const businesses = businessSnapshot.docs.map(doc => {
    const data = doc.data();
    return { id: doc.id, name: typeof data.businessName === "string" ? data.businessName : doc.id,
      isActive: isTenantAccessAllowed(data.status, data.isActive) };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const byBusiness = new Map(businesses.map(business => [business.id, business]));
  const mappings = new Map<string, DidMappingRow>();
  const row = (binding: StoredDidMapping, source: "dashboard" | "setup", updatedAt: number | null): DidMappingRow => ({
    ...binding, source, updatedAt, businessName: byBusiness.get(binding.businessId)?.name ?? "Unavailable business",
    businessActive: byBusiness.get(binding.businessId)?.isActive ?? false,
  });
  for (const binding of setupMappings()) mappings.set(binding.did, row({ ...binding, isActive: true, version: 0 }, "setup", null));
  for (const doc of saved.docs) {
    const data = doc.data(), stored = parseStored(doc.id, data)!;
    const updatedAt = data.updatedAt?.toMillis?.();
    mappings.set(doc.id, row(stored, "dashboard", typeof updatedAt === "number" ? updatedAt : null));
  }
  return { mappings: [...mappings.values()].sort((a, b) => a.did.localeCompare(b.did)), businesses };
}

type MappingActor = { uid: string | null; email?: string; role: "super_admin" | "system" };
export async function saveVoiceDidMapping(raw: unknown, actor: MappingActor) {
  const parsed = didMappingInput.safeParse(raw);
  if (!parsed.success) throw new DidMappingError(400, parsed.error.issues[0]?.message ?? "Check the mapping details.");
  const input = parsed.data;
  const ref = adminDb.collection(DID_MAPPINGS_COLLECTION).doc(input.did);
  const outcome = await adminDb.runTransaction(async tx => {
    const [existing, business] = await tx.getAll(ref, adminDb.collection("businesses").doc(input.businessId));
    const current = parseStored(input.did, existing.data());
    assertMappingVersion(current, input.version);
    const businessData = business.data();
    if (input.isActive && (!businessData || !isTenantAccessAllowed(businessData.status, businessData.isActive))) {
      throw new DidMappingError(400, "Choose an active business before enabling this number.");
    }
    const version = (current?.version ?? 0) + 1;
    tx.set(ref, { did: input.did, businessId: input.businessId, isActive: input.isActive, version,
      createdAt: existing.data()?.createdAt ?? FieldValue.serverTimestamp(),
      createdBy: existing.data()?.createdBy ?? actor.uid, updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() });
    return { version, previousBusinessId: current?.businessId ?? null };
  });
  await logAuditEvent({ businessId: input.businessId, category: "integration", action: "voice.did_mapping.updated",
    actor: { uid: actor.uid, role: actor.role, email: actor.email ?? null, name: null }, source: actor.role === "system" ? "system" : "admin_panel",
    summary: `Phone number ${input.did} ${input.isActive ? "assigned" : "disabled"} for AI reception.`, targetId: input.did, targetLabel: input.did,
    metadata: { did: input.did, previousBusinessId: outcome.previousBusinessId, isActive: input.isActive, version: outcome.version } });
  return { did: input.did, businessId: input.businessId, isActive: input.isActive, version: outcome.version };
}
