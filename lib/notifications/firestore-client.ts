"use client";

import { customerApp } from "@/lib/firebase/customer-client";
import { db as businessDb } from "@/lib/firebase/client";
import {
  mapNotificationDoc,
  sortNotificationsNewestFirst,
} from "@/lib/notifications/map-notification-doc";
import {
  BUSINESS_NOTIFICATION_COLLECTION,
  CUSTOMER_NOTIFICATION_COLLECTION,
  notificationCollectionFor,
  type NotificationAudience,
  type NotificationRecord,
} from "@/lib/notifications/types";
import { normalizeEmail } from "@/lib/customer/types";
import {
  collection,
  deleteDoc,
  doc,
  getFirestore,
  limit,
  onSnapshot,
  query,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";

const MAX_BATCH = 400;
/** Caps notification listener reads per audience. */
export const NOTIFICATION_LIST_LIMIT = 100;

const customerDb: Firestore = getFirestore(customerApp);

function firestoreForAudience(audience: NotificationAudience): Firestore {
  return audience === "business" ? businessDb : customerDb;
}

function mapQueryDocs(
  audience: NotificationAudience,
  docs: QueryDocumentSnapshot[],
): NotificationRecord[] {
  return docs.map((snap) =>
    mapNotificationDoc(snap.id, audience, snap.data() as Record<string, unknown>),
  );
}

/** Live business notification feed (Firebase real-time channel, no HTTP polling). */
export function subscribeBusinessNotifications(
  businessId: string,
  onData: (notifications: NotificationRecord[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const constraints: QueryConstraint[] = [
    where("businessId", "==", businessId),
    limit(NOTIFICATION_LIST_LIMIT),
  ];
  const q = query(
    collection(businessDb, BUSINESS_NOTIFICATION_COLLECTION),
    ...constraints,
  );
  return onSnapshot(
    q,
    (snapshot) => {
      onData(
        sortNotificationsNewestFirst(
          mapQueryDocs("business", snapshot.docs),
        ),
      );
    },
    (error) => onError?.(error),
  );
}

/**
 * Customer feed: merges notifications keyed by uid and by normalized email
 * (same as the server list API).
 */
export function subscribeCustomerNotifications(
  customerId: string,
  customerEmail: string,
  onData: (notifications: NotificationRecord[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const email = normalizeEmail(customerEmail);
  const byId = new Map<string, NotificationRecord>();
  const byEmail = new Map<string, NotificationRecord>();

  const publish = () => {
    const merged = new Map<string, NotificationRecord>();
    for (const record of byId.values()) merged.set(record.id, record);
    for (const record of byEmail.values()) {
      if (!merged.has(record.id)) merged.set(record.id, record);
    }
    onData(sortNotificationsNewestFirst(Array.from(merged.values())));
  };

  const qById = query(
    collection(customerDb, CUSTOMER_NOTIFICATION_COLLECTION),
    where("customerId", "==", customerId),
    limit(NOTIFICATION_LIST_LIMIT),
  );

  const unsubId = onSnapshot(
    qById,
    (snapshot) => {
      byId.clear();
      for (const record of mapQueryDocs("customer", snapshot.docs)) {
        byId.set(record.id, record);
      }
      publish();
    },
    (error) => onError?.(error),
  );

  let unsubEmail: Unsubscribe = () => {};
  if (email) {
    const qByEmail = query(
      collection(customerDb, CUSTOMER_NOTIFICATION_COLLECTION),
      where("customerEmail", "==", email),
      limit(NOTIFICATION_LIST_LIMIT),
    );
    unsubEmail = onSnapshot(
      qByEmail,
      (snapshot) => {
        byEmail.clear();
        for (const record of mapQueryDocs("customer", snapshot.docs)) {
          byEmail.set(record.id, record);
        }
        publish();
      },
      (error) => onError?.(error),
    );
  }

  return () => {
    unsubId();
    unsubEmail();
  };
}

export async function markNotificationReadClient(
  audience: NotificationAudience,
  id: string,
): Promise<void> {
  const db = firestoreForAudience(audience);
  await updateDoc(
    doc(db, notificationCollectionFor(audience), id),
    { read: true },
  );
}

export async function deleteNotificationClient(
  audience: NotificationAudience,
  id: string,
): Promise<void> {
  const db = firestoreForAudience(audience);
  await deleteDoc(doc(db, notificationCollectionFor(audience), id));
}

export async function markAllNotificationsReadClient(
  audience: NotificationAudience,
  notifications: NotificationRecord[],
): Promise<void> {
  const unread = notifications.filter((note) => !note.read);
  if (unread.length === 0) return;
  const db = firestoreForAudience(audience);
  const collectionName = notificationCollectionFor(audience);
  for (let i = 0; i < unread.length; i += MAX_BATCH) {
    const batch = writeBatch(db);
    for (const record of unread.slice(i, i + MAX_BATCH)) {
      batch.update(doc(db, collectionName, record.id), { read: true });
    }
    await batch.commit();
  }
}

export async function deleteAllNotificationsClient(
  audience: NotificationAudience,
  notifications: NotificationRecord[],
): Promise<void> {
  if (notifications.length === 0) return;
  const db = firestoreForAudience(audience);
  const collectionName = notificationCollectionFor(audience);
  for (let i = 0; i < notifications.length; i += MAX_BATCH) {
    const batch = writeBatch(db);
    for (const record of notifications.slice(i, i + MAX_BATCH)) {
      batch.delete(doc(db, collectionName, record.id));
    }
    await batch.commit();
  }
}
