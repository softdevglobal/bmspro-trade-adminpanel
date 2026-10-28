import "server-only";

import { FieldValue, type DocumentSnapshot } from "firebase-admin/firestore";
import type { CallCenterTenantAuth } from "@/lib/callcenter/tenant";
import { adminDb } from "@/lib/firebase/admin";

/**
 * Call logs (`agent_activities`). Same document shape as BMS Black / Pink so
 * Command Center can report across brands; `ownerId` mirrors `businessId`.
 */

const COLLECTION = "agent_activities";
const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const OPTIONAL_FIELDS = [
  "callerName", "agentNote", "didNumber", "branchId", "branchName", "queueId", "queueName",
] as const;

const RECORDING_KEYS = [
  "recordingUrl", "recordingFileUrl", "recording_file_url", "recordingPath",
  "recording_path", "recordingFile", "recording_file",
] as const;

/** A URL, gs:// path, or path / filename with an extension. */
function looksLikeStorageRef(value: string): boolean {
  return /^https?:\/\//i.test(value) || value.startsWith("gs://") || /[^/\\]\.[a-z0-9]{2,5}$/i.test(value);
}

function resolveRecording(body: Record<string, unknown>) {
  const url = RECORDING_KEYS.map((key) => str(body[key])).find(looksLikeStorageRef) ?? "";
  const bareFile = str(body.recordingFile);
  const fileName = str(body.recordingFileName) || str(body.recording_file_name) ||
    (bareFile && !/[/\\]/.test(bareFile) && looksLikeStorageRef(bareFile) ? bareFile : "");
  return { recordingUrl: url, recordingFileName: fileName };
}

function iso(value: unknown): string | null {
  if (value && typeof value === "object" && "toDate" in value) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

function millis(value: unknown): number {
  if (value && typeof value === "object" && "toMillis" in value) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}

export function serializeActivity(snap: DocumentSnapshot) {
  const d = snap.data() ?? {};
  return { id: snap.id, ...d, createdAt: iso(d.createdAt), updatedAt: iso(d.updatedAt) };
}

export async function createAgentActivity(
  auth: CallCenterTenantAuth,
  body: Record<string, unknown>,
): Promise<
  | { ok: true; id: string; activity: ReturnType<typeof serializeActivity> }
  | { ok: false; status: number; error: string }
> {
  const callId = str(body.callId);
  const callerNumber = str(body.callerNumber);
  if (!callId) return { ok: false, status: 400, error: "Missing callId." };
  if (!callerNumber) return { ok: false, status: 400, error: "Missing callerNumber." };

  const businessName = str((auth.business as Record<string, unknown>).businessName);
  const doc: Record<string, unknown> = {
    callId,
    callerNumber,
    agentName: auth.name ?? "",
    agentUserId: auth.uid,
    agentEmail: auth.email ?? "",
    agentRole: auth.isAi ? "ai_receptionist" : "call_center",
    recordedByKind: auth.isAi ? "ai" : "agent",
    businessId: auth.businessId,
    businessName,
    ownerId: auth.businessId,
    ownerName: businessName,
    ownerTimezone: auth.timeZone,
    brand: "trade",
    ...resolveRecording(body),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  for (const key of OPTIONAL_FIELDS) doc[key] = str(body[key]);

  const ref = await adminDb.collection(COLLECTION).add(doc);
  return { ok: true, id: ref.id, activity: serializeActivity(await ref.get()) };
}

export async function listAgentActivities(
  businessId: string,
  filters: { agentUserId?: string; agentEmail?: string; callId?: string; limit: number },
) {
  // Read a wider window and filter in memory, so no composite index is needed.
  const readLimit = Math.min(Math.max(filters.limit * 5, 100), 500);
  const snap = await adminDb.collection(COLLECTION).where("businessId", "==", businessId).limit(readLimit).get();
  const email = filters.agentEmail?.toLowerCase();
  return snap.docs
    .filter((doc) => {
      const d = doc.data();
      return (!filters.agentUserId || d.agentUserId === filters.agentUserId) &&
        (!filters.callId || d.callId === filters.callId) &&
        (!email || String(d.agentEmail ?? "").toLowerCase() === email);
    })
    .sort((a, b) => millis(b.data().createdAt) - millis(a.data().createdAt))
    .slice(0, filters.limit)
    .map(serializeActivity);
}
