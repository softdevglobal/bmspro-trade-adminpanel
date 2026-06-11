import "server-only";

import { getMessaging } from "firebase-admin/messaging";
import { adminApp, adminDb } from "@/lib/firebase/admin";
import { CALL_CENTER_AGENTS_COLLECTION } from "@/lib/chat/types";

type PushInput = {
  targetUid: string;
  title: string;
  body: string;
  data: Record<string, string>;
};

async function resolveFcmToken(uid: string): Promise<string | null> {
  const agentSnap = await adminDb
    .collection(CALL_CENTER_AGENTS_COLLECTION)
    .doc(uid)
    .get();
  const agentToken = agentSnap.data()?.fcmToken;
  if (typeof agentToken === "string" && agentToken.trim()) {
    return agentToken.trim();
  }

  const userSnap = await adminDb.collection("users").doc(uid).get();
  const userToken = userSnap.data()?.fcmToken;
  return typeof userToken === "string" && userToken.trim()
    ? userToken.trim()
    : null;
}

export async function sendChatPush(input: PushInput): Promise<void> {
  try {
    const token = await resolveFcmToken(input.targetUid);
    if (!token) return;

    await getMessaging(adminApp).send({
      token,
      data: {
        ...input.data,
        title: input.title,
        body: input.body,
        message: input.body,
      },
      android: { priority: "high" },
      apns: {
        headers: {
          "apns-priority": "10",
          "apns-push-type": "background",
        },
        payload: { aps: { "content-available": 1 } },
      },
    });
  } catch {
    /* push is best-effort */
  }
}

export async function fanOutToActiveAgents(
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<void> {
  const snapshot = await adminDb
    .collection(CALL_CENTER_AGENTS_COLLECTION)
    .where("isOnline", "==", true)
    .limit(50)
    .get();

  if (snapshot.empty) {
    const usersSnap = await adminDb
      .collection("users")
      .where("role", "==", "call_center")
      .where("isActive", "==", true)
      .limit(50)
      .get();
    await Promise.all(
      usersSnap.docs.map((doc) =>
        sendChatPush({ targetUid: doc.id, title, body, data }),
      ),
    );
    return;
  }

  await Promise.all(
    snapshot.docs.map((doc) =>
      sendChatPush({ targetUid: doc.id, title, body, data }),
    ),
  );
}
