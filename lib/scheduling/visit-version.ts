import type { DocumentData, DocumentReference, DocumentSnapshot } from "firebase-admin/firestore";

export function visitVersion(snapshot: Pick<DocumentSnapshot, "updateTime">): string {
  return snapshot.updateTime ? `${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}` : "";
}

/** Voice confirmations bind the write to the exact visit read back to the owner. */
export async function updateVisitVersioned(ref: DocumentReference, snapshot: DocumentSnapshot, updates: DocumentData, expected?: string) {
  if (!expected) { await ref.update(updates); return true; }
  if (!snapshot.updateTime || visitVersion(snapshot) !== expected) return false;
  try { await ref.update(updates, { lastUpdateTime: snapshot.updateTime }); return true; }
  catch (error) {
    if ((error as {code?: unknown}).code === 9 || (error as {code?: unknown}).code === 5) return false;
    throw error;
  }
}
