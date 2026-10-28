import "server-only";

import { FieldValue, Timestamp, type DocumentData, type QuerySnapshot } from "firebase-admin/firestore";
import { chunk } from "@/lib/callcenter/tenant";
import { adminDb } from "@/lib/firebase/admin";
import { REQUESTS_COLLECTION } from "@/lib/inspection/types";
import { mapNotificationDoc } from "@/lib/notifications/map-notification-doc";
import { CUSTOMER_NOTIFICATION_COLLECTION, type NotificationRecord } from "@/lib/notifications/types";
import { toMillis } from "@/lib/onboarding/services/display";

/**
 * Customer inbox for call-center follow-up. Rows come from Trade's
 * `customer_notifications` collection (what customers see in the portal),
 * enriched with the request's phone / code / service so an agent can call.
 */

export type CustomerNotificationRow = NotificationRecord & {
  requestCode: string | null;
  serviceName: string | null;
  customerPhone: string | null;
  calledCustomer: boolean;
  calledCustomerAt: number | null;
  calledCustomerByUid: string | null;
  calledCustomerByName: string | null;
  calledCustomerByEmail: string | null;
  notificationReviewed: boolean;
  notificationReviewedAt: number | null;
  notificationReviewedByUid: string | null;
  notificationReviewedByName: string | null;
  notificationReviewedByEmail: string | null;
};

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

function tracking(data: Record<string, unknown>) {
  return {
    calledCustomer: data.calledCustomer === true,
    calledCustomerAt: toMillis(data.calledCustomerAt),
    calledCustomerByUid: str(data.calledCustomerByUid),
    calledCustomerByName: str(data.calledCustomerByName),
    calledCustomerByEmail: str(data.calledCustomerByEmail),
    notificationReviewed: data.notificationReviewed === true,
    notificationReviewedAt: toMillis(data.notificationReviewedAt),
    notificationReviewedByUid: str(data.notificationReviewedByUid),
    notificationReviewedByName: str(data.notificationReviewedByName),
    notificationReviewedByEmail: str(data.notificationReviewedByEmail),
  };
}

async function enrich(
  docs: { id: string; data: Record<string, unknown> }[],
): Promise<CustomerNotificationRow[]> {
  const requestIds = [...new Set(docs.map((d) => d.data.requestId).filter((id): id is string => typeof id === "string" && !!id))];
  const requests = new Map<string, Record<string, unknown>>();
  for (const part of chunk(requestIds, 100)) {
    const snaps = await adminDb.getAll(...part.map((id) => adminDb.collection(REQUESTS_COLLECTION).doc(id)));
    for (const snap of snaps) if (snap.exists) requests.set(snap.id, snap.data() ?? {});
  }
  return docs.map(({ id, data }) => {
    const request = requests.get(String(data.requestId ?? ""));
    const customer = (request?.customer ?? {}) as Record<string, unknown>;
    return {
      ...mapNotificationDoc(id, "customer", data),
      requestCode: str(request?.requestCode),
      serviceName: str(request?.serviceName) ?? str((request?.customRequest as Record<string, unknown> | undefined)?.title),
      customerPhone: str(customer.phone),
      ...tracking(data),
    };
  });
}

export type NotificationListOptions = { unreadOnly: boolean; limit: number; sinceDays: number };

/** `businessIds = "all"` → platform-wide feed (super admins only). */
export async function listCustomerNotificationsFor(
  businessIds: string[] | "all",
  options: NotificationListOptions,
): Promise<CustomerNotificationRow[]> {
  const since = Date.now() - options.sinceDays * 86_400_000;
  const readLimit = Math.min(options.limit * 3, 600);
  const col = adminDb.collection(CUSTOMER_NOTIFICATION_COLLECTION);
  let snaps: QuerySnapshot<DocumentData>[];
  if (businessIds === "all") {
    snaps = [await col.where("createdAt", ">=", Timestamp.fromMillis(since)).orderBy("createdAt", "desc").limit(readLimit).get()];
  } else {
    if (businessIds.length === 0) return [];
    snaps = await Promise.all(chunk(businessIds).map((ids) => col.where("businessId", "in", ids).limit(readLimit).get()));
  }
  const docs = snaps
    .flatMap((s) => s.docs.map((doc) => ({ id: doc.id, data: doc.data() ?? {} })))
    .filter((d) => (toMillis(d.data.createdAt) ?? 0) >= since)
    .filter((d) => !options.unreadOnly || d.data.read !== true)
    .sort((a, b) => (toMillis(b.data.createdAt) ?? 0) - (toMillis(a.data.createdAt) ?? 0))
    .slice(0, options.limit);
  return enrich(docs);
}

export async function getCustomerNotificationBusinessId(
  id: string,
): Promise<{ ok: true; businessId: string } | { ok: false; status: number; error: string }> {
  if (!/^[^/]{1,128}$/.test(id) || [".", ".."].includes(id)) {
    return { ok: false, status: 400, error: "Missing notification id." };
  }
  const snap = await adminDb.collection(CUSTOMER_NOTIFICATION_COLLECTION).doc(id).get();
  if (!snap.exists) return { ok: false, status: 404, error: "Notification not found." };
  const businessId = snap.data()?.businessId;
  if (typeof businessId !== "string" || !businessId) {
    return { ok: false, status: 422, error: "Notification is missing business information." };
  }
  return { ok: true, businessId };
}

export type TrackingKind = "called-customer" | "notification-reviewed";

/** Sets or clears a tracking flag; the actor comes from the token, never the body. */
export async function setNotificationTracking(
  id: string,
  kind: TrackingKind,
  value: boolean,
  actor: { uid: string; name: string | null; email: string | null },
) {
  const prefix = kind === "called-customer" ? "calledCustomer" : "notificationReviewed";
  const ref = adminDb.collection(CUSTOMER_NOTIFICATION_COLLECTION).doc(id);
  await ref.update(
    value
      ? {
          [prefix]: true,
          [`${prefix}At`]: FieldValue.serverTimestamp(),
          [`${prefix}ByUid`]: actor.uid,
          [`${prefix}ByName`]: actor.name,
          [`${prefix}ByEmail`]: actor.email,
        }
      : {
          [prefix]: false,
          [`${prefix}At`]: null,
          [`${prefix}ByUid`]: null,
          [`${prefix}ByName`]: null,
          [`${prefix}ByEmail`]: null,
        },
  );
  const fresh = (await ref.get()).data() ?? {};
  return {
    ok: true,
    notificationId: id,
    collection: CUSTOMER_NOTIFICATION_COLLECTION,
    documentPath: `${CUSTOMER_NOTIFICATION_COLLECTION}/${id}`,
    [prefix]: fresh[prefix] === true,
    [`${prefix}ByUid`]: str(fresh[`${prefix}ByUid`]),
    [`${prefix}ByName`]: str(fresh[`${prefix}ByName`]),
    [`${prefix}ByEmail`]: str(fresh[`${prefix}ByEmail`]),
  };
}
