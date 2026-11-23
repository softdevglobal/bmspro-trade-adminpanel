import type { Query, QuerySnapshot, DocumentData } from "firebase-admin/firestore";

export function logFirestoreDocuments(query: string, documents: number) {
  if (process.env.FIRESTORE_READ_METRICS === "true") {
    console.info("[firestore-reads]", { query, documents });
  }
}

/** Only a missing/building index permits a compatibility fallback. */
export function isMissingFirestoreIndex(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (code === 9 || code === "failed-precondition") &&
    typeof message === "string" && /index/i.test(message);
}

export async function getIndexedQuery(
  name: string,
  query: Query<DocumentData>,
  fallback: Query<DocumentData>,
): Promise<QuerySnapshot<DocumentData>> {
  let snapshot: QuerySnapshot<DocumentData>;
  let usedFallback = false;
  try {
    snapshot = await query.get();
  } catch (error) {
    if (!isMissingFirestoreIndex(error)) throw error;
    usedFallback = true;
    console.warn(`[firestore-reads] ${name}: index unavailable; using compatibility query. Deploy firestore indexes.`);
    snapshot = await fallback.get();
  }
  if (process.env.FIRESTORE_READ_METRICS === "true") {
    // Returned documents only, not a billing estimate or index-entry count.
    console.info("[firestore-reads]", { query: name, documents: snapshot.size, fallback: usedFallback });
  }
  return snapshot;
}
