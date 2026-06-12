import "server-only";

import { getMessaging } from "firebase-admin/messaging";

import { adminApp, adminDb } from "@/lib/firebase/admin";

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

type OwnerPushInput = {
  ownerUid: string;
  title: string;
  body: string;
  data: Record<string, string>;
};

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
  try {
    const userSnap = await adminDb.collection("users").doc(input.ownerUid).get();
    const fcmToken = userSnap.data()?.fcmToken;
    if (typeof fcmToken !== "string" || !fcmToken.trim()) {
      console.warn("[push] No FCM token for owner", input.ownerUid);
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
    console.error("[push] Owner mobile push failed:", error);
  }
}
