import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { KNOWLEDGE_SOURCES_COLLECTION, type KnowledgeKind } from "../data/knowledge-sources";
import { chunkText } from "./chunker";
import { createEmbedder } from "./embeddings";
import { knowledgeSettings } from "./settings";
import { createVectorStore } from "./vector-store";

const sources = () => adminDb.collection(KNOWLEDGE_SOURCES_COLLECTION);

/** Chunks, embeds and stores one source. Safe to run more than once. Returns false on failure. */
export async function indexKnowledgeSource(sourceId: string): Promise<boolean> {
  const settings = knowledgeSettings();
  const store = createVectorStore(adminDb);
  const ref = sources().doc(sourceId);
  const data = (await ref.get()).data();
  if (!data) return false;

  if (data.status === "archived") {
    await store.deleteSource(sourceId);
    await ref.update({ chunkCount: 0, indexedVersion: data.version, indexError: null });
    return true;
  }

  const version = Number(data.version);
  try {
    const chunks = chunkText(String(data.title), String(data.body));
    const vectors = chunks.length ? await createEmbedder(settings)(chunks.map(chunk => chunk.text)) : [];
    await store.replaceSourceChunks({
      businessId: String(data.businessId),
      sourceId,
      sourceTitle: String(data.title),
      kind: data.kind as KnowledgeKind,
      sourceVersion: version,
      status: data.status === "published" ? "published" : "draft",
      model: settings.model,
      chunks: chunks.map((chunk, index) => ({ ...chunk, embedding: vectors[index] })),
    });
    // Only move indexedVersion forward; an older overlapping run must not overwrite a newer one.
    await adminDb.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (!current || Number(current.indexedVersion ?? 0) > version) return;
      tx.update(ref, { indexedVersion: version, chunkCount: chunks.length, indexError: null, indexedAt: FieldValue.serverTimestamp() });
    });
    return true;
  } catch {
    // Old chunks stay searchable. Store a short safe message only, never the provider response.
    await ref.update({ indexError: "Indexing failed. Try Reindex, or check the embedding settings." }).catch(() => {});
    return false;
  }
}

/** Builds draft "Business facts" and "Service descriptions" from current settings. */
export async function refreshGeneratedSources(businessId: string) {
  const business = (await adminDb.collection("businesses").doc(businessId).get()).data();
  if (!business) return;

  const facts = [
    `Business name: ${business.businessName ?? ""}`,
    business.businessPhone ? `Business phone: ${business.businessPhone}` : "",
    business.businessEmail ? `Business email: ${business.businessEmail}` : "",
    business.businessAddress ? `Business address: ${business.businessAddress}` : "",
    Array.isArray(business.serviceAreas) && business.serviceAreas.length
      ? `Service areas: ${business.serviceAreas.join(", ")}` : "",
    business.workingHours?.startTime && business.workingHours?.endTime
      ? `Usual working hours: ${business.workingHours.startTime} to ${business.workingHours.endTime}` : "",
    `Timezone: ${business.timezone || "Australia/Melbourne"}`,
  ].filter(Boolean).join("\n");

  const services = await adminDb.collection("services").where("businessId", "==", businessId).get();
  const serviceText = services.docs
    .map(doc => doc.data())
    .filter(service => service.isActive === true && typeof service.name === "string")
    .map(service => {
      const description = typeof service.description === "string" && service.description.trim()
        ? service.description.trim() : "No description provided.";
      return `## ${service.name}\n${description}`;
    })
    .join("\n\n");

  await upsertGenerated(businessId, "business_facts", "Business facts", facts);
  if (serviceText) await upsertGenerated(businessId, "service_descriptions", "Service descriptions", serviceText);
}

async function upsertGenerated(businessId: string, kind: "business_facts" | "service_descriptions", title: string, body: string) {
  const ref = sources().doc(`${businessId}__${kind}`);
  const changed = await adminDb.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    // Unchanged, or the owner deleted (archived) it: leave it alone.
    if (current && (current.body === body || current.status === "archived")) return false;
    tx.set(ref, {
      businessId, kind, title, body, generated: true,
      // New generated text starts as a draft. An owner-published source stays published when settings change.
      status: current?.status === "published" ? "published" : "draft",
      flags: [],
      version: Number(current?.version ?? 0) + 1,
      indexedVersion: Number(current?.indexedVersion ?? 0),
      chunkCount: Number(current?.chunkCount ?? 0),
      indexError: null,
      createdAt: current?.createdAt ?? FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
  if (changed) await indexKnowledgeSource(ref.id);
}

export async function reindexBusiness(businessId: string) {
  const snapshot = await sources().where("businessId", "==", businessId).get();
  for (const doc of snapshot.docs) await indexKnowledgeSource(doc.id);
}
