// Server-only gurde: build fails if this is imported into client code
import "server-only";
// FieldValue gives us server-side timestamps in firestore
import { FieldValue } from "firebase-admin/firestore";
// Firebase Admin firestore instance
import { adminDb } from "@/lib/firebase/admin";
// Name of the firestore collection that holds knowledge sources 
import { KNOWLEDGE_SOURCES_COLLECTION, type KnowledgeKind } from "../data/knowledge-sources";

import { chunkTableText, chunkText } from "./chunker";
import { describePurpose } from "../data/knowledge-purpose";

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
    // Every passage starts with the title and, for imports, what the file is
    // (e.g. "These are products this business sells…"), so Sophie reads it in context.
    const heading = [String(data.title), describePurpose(data.purpose, data.purposeNote)].filter(Boolean).join("\n");
    // Spreadsheets split into small groups of whole rows; everything else by paragraph.
    const tabular = ["xlsx", "csv"].includes(String(data.origin?.type));
    const chunks = tabular ? chunkTableText(heading, String(data.body)) : chunkText(heading, String(data.body));
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
 // Build a plain-text facts block, one line per fact
  const facts = [
    `Business name: ${business.businessName ?? ""}`,
    business.businessPhone ? `Business phone: ${business.businessPhone}` : "",
    business.businessEmail ? `Business email: ${business.businessEmail}` : "",
    business.businessAddress ? `Business address: ${business.businessAddress}` : "",
     // Only include service areas if it is a non-empty array
    Array.isArray(business.serviceAreas) && business.serviceAreas.length
      ? `Service areas: ${business.serviceAreas.join(", ")}` : "",
    // Only include working hours if both start and end exist
    business.workingHours?.startTime && business.workingHours?.endTime
      ? `Usual working hours: ${business.workingHours.startTime} to ${business.workingHours.endTime}` : "",
    // Fall back to Melbourne time if no timezone is set
      `Timezone: ${business.timezone || "Australia/Melbourne"}`,
  ].filter(Boolean).join("\n");

    // Fetch all services belonging to this business
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
// Creates or updates one generated source, then re-indexes it if it changed
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
  // A few entries at a time: much faster than one by one, gentle on OpenAI rate limits.
  const ids = snapshot.docs.map(doc => doc.id);
  let next = 0;
  const worker = async () => { while (next < ids.length) await indexKnowledgeSource(ids[next++]); };
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
}
