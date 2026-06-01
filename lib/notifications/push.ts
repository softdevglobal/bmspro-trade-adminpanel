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
 * Sends a data-only message so the mobile app does not show a system
 * notification while foreground (Firestore listener handles that). Background
 * delivery is handled by the app's FCM background handler.
 */
export async function sendOwnerMobilePush(
  input: OwnerPushInput,
): Promise<void> {
  try {
    const userSnap = await adminDb.collection("users").doc(input.ownerUid).get();
    const fcmToken = userSnap.data()?.fcmToken;
    if (typeof fcmToken !== "string" || !fcmToken.trim()) return;

    await getMessaging(adminApp).send({
      token: fcmToken.trim(),
      data: {
        ...input.data,
        title: input.title,
        body: input.body,
        message: input.body,
      },
      android: {
        priority: "high",
      },
      apns: {
        headers: {
          "apns-priority": "10",
          "apns-push-type": "background",
        },
        payload: {
          aps: {
            "content-available": 1,
          },
        },
      },
    });
  } catch {
    /* push is best-effort */
  }
}
