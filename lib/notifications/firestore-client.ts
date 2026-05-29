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
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";

const MAX_BATCH = 400;
/** Badge / unread-only listener cap. */
export const NOTIFICATION_UNREAD_LIMIT = 25;
/** Full panel listener cap. */
export const NOTIFICATION_FULL_LIMIT = 50;

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

/** Unread notifications only — cheap badge listener. */
export function subscribeBusinessNotificationsUnread(
  businessId: string,
  onData: (notifications: NotificationRecord[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const q = query(
    collection(businessDb, BUSINESS_NOTIFICATION_COLLECTION),
    where("businessId", "==", businessId),
    where("read", "==", false),
    limit(NOTIFICATION_UNREAD_LIMIT),
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

/** Full feed — only while the notification panel is open. */
export function subscribeBusinessNotificationsFull(
  businessId: string,
  onData: (notifications: NotificationRecord[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const q = query(
    collection(businessDb, BUSINESS_NOTIFICATION_COLLECTION),
    where("businessId", "==", businessId),
    limit(NOTIFICATION_FULL_LIMIT),
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

/** Customer feed keyed by uid (one listener). */
export function subscribeCustomerNotifications(
  customerId: string,
  _customerEmail: string,
  onData: (notifications: NotificationRecord[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const q = query(
    collection(customerDb, CUSTOMER_NOTIFICATION_COLLECTION),
    where("customerId", "==", customerId),
    limit(NOTIFICATION_FULL_LIMIT),
  );

  return onSnapshot(
    q,
    (snapshot) => {
      onData(
        sortNotificationsNewestFirst(
          mapQueryDocs("customer", snapshot.docs),
        ),
      );
    },
    (error) => onError?.(error),
  );
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
