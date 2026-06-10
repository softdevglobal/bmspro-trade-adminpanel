import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { REQUESTS_COLLECTION } from "@/lib/inspection/types";
import type {
  DocumentReference,
  DocumentSnapshot,
} from "firebase-admin/firestore";

/** Legacy collection name before the requests rename. */
const LEGACY_REQUESTS_COLLECTION = "inspection_requests";

export async function getRequestDocument(
  id: string,
): Promise<DocumentSnapshot | null> {
  const trimmed = id.trim();
  if (!trimmed) return null;

  const primary = await adminDb
    .collection(REQUESTS_COLLECTION)
    .doc(trimmed)
    .get();
  if (primary.exists) return primary;

  const legacy = await adminDb
    .collection(LEGACY_REQUESTS_COLLECTION)
    .doc(trimmed)
    .get();
  if (legacy.exists) return legacy;

  return null;
}

export async function getRequestDocumentRef(
  id: string,
): Promise<DocumentReference | null> {
  const snap = await getRequestDocument(id);
  return snap?.exists ? snap.ref : null;
}
