import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import type { AppendSmsLogInput, SmsLogEntry } from "@/lib/sms/sms-log-types";
import { SMS_LOGS_COLLECTION } from "@/lib/sms/sms-log-types";
import { FieldValue } from "firebase-admin/firestore";

function toMillis(value: unknown): number | null {
  if (value && typeof value === "object" && "toMillis" in value) {
    const fn = (value as { toMillis?: () => number }).toMillis;
    if (typeof fn === "function") return fn.call(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

async function resolveSenderName(
  businessId: string | null,
  override: string | null | undefined,
): Promise<string> {
  if (override?.trim()) return override.trim();
  if (!businessId) return "System";
  try {
    const snap = await adminDb.collection("businesses").doc(businessId).get();
    const data = snap.data() ?? {};
    const businessName =
      typeof data.businessName === "string" ? data.businessName.trim() : "";
    return businessName || businessId;
  } catch {
    return businessId;
  }
}

/** Persists an SMS delivery attempt. Best-effort — never throws. */
export async function appendSmsLog(input: AppendSmsLogInput): Promise<void> {
  try {
    const businessId = input.businessId?.trim() || null;
    const senderName = await resolveSenderName(businessId, input.senderName);
    const receiverPhone = input.receiverPhone?.trim() || "—";
    const message = input.message?.trim() || "";
    const status = input.status;
    const statusDetail = input.statusDetail?.trim() || null;
    const source = input.source?.trim() || null;
    const receiverName = input.receiverName?.trim() || null;

    await adminDb.collection(SMS_LOGS_COLLECTION).add({
      businessId,
      senderName,
      receiverPhone,
      receiverName,
      message,
      status,
      statusDetail,
      source,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error("[sms-log] could not persist entry:", error);
  }
}

function mapSmsLogDoc(
  id: string,
  data: Record<string, unknown>,
): SmsLogEntry {
  const status = data.status;
  return {
    id,
    businessId:
      typeof data.businessId === "string" && data.businessId.trim()
        ? data.businessId.trim()
        : null,
    senderName:
      typeof data.senderName === "string" && data.senderName.trim()
        ? data.senderName.trim()
        : "System",
    receiverPhone:
      typeof data.receiverPhone === "string" ? data.receiverPhone : "—",
    receiverName:
      typeof data.receiverName === "string" && data.receiverName.trim()
        ? data.receiverName.trim()
        : null,
    message: typeof data.message === "string" ? data.message : "",
    status:
      status === "sent" || status === "failed" || status === "skipped"
        ? status
        : "failed",
    statusDetail:
      typeof data.statusDetail === "string" && data.statusDetail.trim()
        ? data.statusDetail.trim()
        : null,
    source:
      typeof data.source === "string" && data.source.trim()
        ? data.source.trim()
        : null,
    createdAt: toMillis(data.createdAt),
  };
}

/** Super-admin SMS delivery history, newest first. */
export async function listSmsLogs(limit = 200): Promise<SmsLogEntry[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const snap = await adminDb
    .collection(SMS_LOGS_COLLECTION)
    .orderBy("createdAt", "desc")
    .limit(safeLimit)
    .get()
    .catch(async () => {
      const fallback = await adminDb
        .collection(SMS_LOGS_COLLECTION)
        .limit(safeLimit)
        .get();
      return fallback;
    });

  return snap.docs
    .map((doc) => mapSmsLogDoc(doc.id, doc.data() ?? {}))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** Tenant-scoped SMS delivery history for a single business. */
export async function listSmsLogsForBusiness(
  businessId: string,
  limit = 100,
): Promise<SmsLogEntry[]> {
  const trimmedId = businessId.trim();
  if (!trimmedId) return [];

  const safeLimit = Math.min(Math.max(1, limit), 200);
  const snap = await adminDb
    .collection(SMS_LOGS_COLLECTION)
    .where("businessId", "==", trimmedId)
    .orderBy("createdAt", "desc")
    .limit(safeLimit)
    .get()
    .catch(async () => {
      const fallback = await adminDb
        .collection(SMS_LOGS_COLLECTION)
        .where("businessId", "==", trimmedId)
        .limit(safeLimit)
        .get();
      return fallback;
    });

  return snap.docs
    .map((doc) => mapSmsLogDoc(doc.id, doc.data() ?? {}))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}
