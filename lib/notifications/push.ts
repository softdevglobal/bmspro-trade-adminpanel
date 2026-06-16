import "server-only";

import { getMessaging } from "firebase-admin/messaging";

import { adminApp, adminDb } from "@/lib/firebase/admin";

const OWNER_ROLES = new Set(["owner", "admin", "business_owner"]);

/** Resolves the Firebase Auth UID of the business owner. */
export async function resolveBusinessOwnerUid(
  businessId: string,
): Promise<string | null> {
  try {
    const snap = await adminDb.collection("businesses").doc(businessId).get();
    if (!snap.exists) return null;
    const ownerUid = snap.data()?.ownerUid;
    return typeof ownerUid === "string" && ownerUid.trim()
      ? ownerUid.trim()
      : null;
  } catch {
    return null;
  }
}

/** UIDs of business owners/admins who should receive platform alerts (not staff). */
export async function resolveBusinessAdminUids(
  businessId: string,
): Promise<string[]> {
  const uids = new Set<string>();
  try {
    const ownerUid = await resolveBusinessOwnerUid(businessId);
    if (ownerUid) uids.add(ownerUid);

    const members = await adminDb
      .collection("users")
      .where("businessId", "==", businessId)
      .get();
    for (const doc of members.docs) {
      const role = doc.data()?.role;
      if (typeof role === "string" && OWNER_ROLES.has(role)) {
        uids.add(doc.id);
      }
    }
  } catch (error) {
    console.error("[push] resolveBusinessAdminUids failed:", error);
  }
  return Array.from(uids);
}

type OwnerPushInput = {
  ownerUid: string;
  title: string;
  body: string;
  data: Record<string, string>;
};

type UserPushInput = {
  uid: string;
  title: string;
  body: string;
  data: Record<string, string>;
};

async function sendUserMobilePush(input: UserPushInput): Promise<void> {
  try {
    const userSnap = await adminDb.collection("users").doc(input.uid).get();
    const fcmToken = userSnap.data()?.fcmToken;
    if (typeof fcmToken !== "string" || !fcmToken.trim()) {
      console.warn("[push] No FCM token for user", input.uid);
      return;
    }

    await getMessaging(adminApp).send({
      token: fcmToken.trim(),
      notification: {
        title: input.title,
        body: input.body,
      },
      data: {
        ...input.data,
        title: input.title,
        body: input.body,
        message: input.body,
      },
      android: {
        priority: "high",
        notification: {
          channelId: "appointments",
          priority: "high",
          sound: "default",
        },
      },
      apns: {
        headers: {
          "apns-priority": "10",
          "apns-push-type": "alert",
        },
        payload: {
          aps: {
            alert: {
              title: input.title,
              body: input.body,
            },
            sound: "default",
            badge: 1,
          },
        },
      },
    });
  } catch (error) {
    console.error("[push] Mobile push failed for", input.uid, error);
  }
}

/**
 * Best-effort FCM push to the owner's mobile device.
 *
 * Includes a notification payload so Android/iOS show a system tray alert when
 * the app is backgrounded or closed. Data fields are included for tap navigation.
 * Foreground UI is handled separately by the mobile app's SSE/Firestore listeners.
 */
export async function sendOwnerMobilePush(
  input: OwnerPushInput,
): Promise<void> {
  await sendUserMobilePush({
    uid: input.ownerUid,
    title: input.title,
    body: input.body,
    data: input.data,
  });
}

/** Push an owner/admin alert to every business admin — never to staff. */
export async function sendBusinessAdminMobilePush(
  businessId: string,
  input: Omit<OwnerPushInput, "ownerUid">,
): Promise<void> {
  const uids = await resolveBusinessAdminUids(businessId);
  await Promise.all(
    uids.map((uid) =>
      sendUserMobilePush({
        uid,
        title: input.title,
        body: input.body,
        data: input.data,
      }),
    ),
  );
}

/** Push to a single staff member (assignments, leave decisions, etc.). */
export async function sendStaffMobilePush(
  input: UserPushInput,
): Promise<void> {
  await sendUserMobilePush(input);
}
