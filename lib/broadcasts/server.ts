import "server-only";

import { getMessaging } from "firebase-admin/messaging";
import { FieldValue } from "firebase-admin/firestore";

import { adminApp, adminDb } from "@/lib/firebase/admin";
import { toMillis } from "@/lib/onboarding/services/display";
import {
  BROADCAST_COLLECTION,
  BROADCAST_USER_STATE_COLLECTION,
  type BroadcastAudience,
  type BroadcastForUser,
  type BroadcastPlatform,
  type BroadcastPlatforms,
  type BroadcastRecord,
} from "@/lib/broadcasts/types";

/** FCM accepts up to 500 messages per multicast batch. */
const MAX_PUSH_BATCH = 500;
const BROADCAST_LIST_LIMIT = 100;

function mapBroadcastDoc(
  id: string,
  data: Record<string, unknown>,
): BroadcastRecord {
  const platforms = (data.platforms ?? {}) as Record<string, unknown>;
  return {
    id,
    title: typeof data.title === "string" ? data.title : "",
    body: typeof data.body === "string" ? data.body : "",
    platforms: {
      admin: platforms.admin === true,
      mobile: platforms.mobile === true,
    },
    audience: data.audience === "all" ? "all" : "owners",
    active: data.active !== false,
    createdAt: toMillis(data.createdAt) ?? 0,
    createdByUid:
      typeof data.createdByUid === "string" ? data.createdByUid : null,
    createdByEmail:
      typeof data.createdByEmail === "string" ? data.createdByEmail : null,
    mobilePushCount:
      typeof data.mobilePushCount === "number" ? data.mobilePushCount : null,
  };
}

function sortNewestFirst(records: BroadcastRecord[]): BroadcastRecord[] {
  return records.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** All broadcasts, newest first (super admin history view). */
export async function listAllBroadcasts(): Promise<BroadcastRecord[]> {
  const snapshot = await adminDb
    .collection(BROADCAST_COLLECTION)
    .limit(BROADCAST_LIST_LIMIT)
    .get();
  return sortNewestFirst(
    snapshot.docs.map((doc) => mapBroadcastDoc(doc.id, doc.data() ?? {})),
  );
}

type CreateBroadcastInput = {
  title: string;
  body: string;
  platforms: BroadcastPlatforms;
  audience: BroadcastAudience;
  createdByUid: string | null;
  createdByEmail: string | null;
};

export type CreateBroadcastResult = {
  id: string;
  mobilePushCount: number;
};

/**
 * Stores a broadcast and, when it targets the mobile app, sends a best-effort
 * FCM push to every targeted user across all businesses.
 */
export async function createBroadcast(
  input: CreateBroadcastInput,
): Promise<CreateBroadcastResult> {
  const ref = adminDb.collection(BROADCAST_COLLECTION).doc();

  let mobilePushCount = 0;
  if (input.platforms.mobile) {
    mobilePushCount = await sendBroadcastPush(
      input.audience,
      input.title,
      input.body,
      ref.id,
    );
  }

  await ref.set({
    id: ref.id,
    title: input.title,
    body: input.body,
    platforms: {
      admin: input.platforms.admin === true,
      mobile: input.platforms.mobile === true,
    },
    audience: input.audience,
    active: true,
    createdAt: FieldValue.serverTimestamp(),
    createdByUid: input.createdByUid,
    createdByEmail: input.createdByEmail,
    mobilePushCount,
  });

  return { id: ref.id, mobilePushCount };
}

export async function setBroadcastActive(
  id: string,
  active: boolean,
): Promise<boolean> {
  const ref = adminDb.collection(BROADCAST_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.update({ active });
  return true;
}

export async function deleteBroadcast(id: string): Promise<boolean> {
  const ref = adminDb.collection(BROADCAST_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  return true;
}

/** Roles that should receive a broadcast for the given audience. */
function rolesForAudience(audience: BroadcastAudience): string[] {
  return audience === "all"
    ? ["owner", "admin", "business_owner", "staff"]
    : ["owner", "admin", "business_owner"];
}

/**
 * Collects FCM tokens for every user whose role matches the audience.
 * Firestore `in` queries are capped at 10 values, well above our role count.
 */
async function collectTokensForAudience(
  audience: BroadcastAudience,
): Promise<string[]> {
  const snapshot = await adminDb
    .collection("users")
    .where("role", "in", rolesForAudience(audience))
    .get();

  const tokens = new Set<string>();
  for (const doc of snapshot.docs) {
    const token = doc.data()?.fcmToken;
    if (typeof token === "string" && token.trim()) {
      tokens.add(token.trim());
    }
  }
  return Array.from(tokens);
}

/** Best-effort multicast push. Returns the number of tokens attempted. */
async function sendBroadcastPush(
  audience: BroadcastAudience,
  title: string,
  body: string,
  broadcastId: string,
): Promise<number> {
  let tokens: string[];
  try {
    tokens = await collectTokensForAudience(audience);
  } catch (error) {
    console.error("[broadcast] Failed to collect FCM tokens:", error);
    return 0;
  }

  if (tokens.length === 0) return 0;

  const messaging = getMessaging(adminApp);
  for (let i = 0; i < tokens.length; i += MAX_PUSH_BATCH) {
    const batch = tokens.slice(i, i + MAX_PUSH_BATCH);
    try {
      await messaging.sendEachForMulticast({
        tokens: batch,
        notification: { title, body },
        data: {
          type: "system_message",
          broadcastId,
          title,
          body,
          message: body,
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
              alert: { title, body },
              sound: "default",
              badge: 1,
            },
          },
        },
      });
    } catch (error) {
      console.error("[broadcast] Push batch failed:", error);
    }
  }

  return tokens.length;
}

type UserBroadcastState = {
  read: Record<string, boolean>;
  dismissed: Record<string, boolean>;
};

async function readUserState(uid: string): Promise<UserBroadcastState> {
  const snap = await adminDb
    .collection(BROADCAST_USER_STATE_COLLECTION)
    .doc(uid)
    .get();
  const data = snap.data() ?? {};
  return {
    read: (data.read as Record<string, boolean>) ?? {},
    dismissed: (data.dismissed as Record<string, boolean>) ?? {},
  };
}

function matchesAudience(
  audience: BroadcastAudience,
  role: string,
): boolean {
  if (audience === "all") return true;
  // Owners-only: owner/admin web roles. Staff are excluded.
  return role === "owner" || role === "admin";
}

/**
 * Active broadcasts targeting `platform` that this user (by role) should see,
 * excluding ones the user dismissed, annotated with read state.
 */
export async function listBroadcastsForUser(
  uid: string,
  role: string,
  platform: BroadcastPlatform,
): Promise<BroadcastForUser[]> {
  const [snapshot, state] = await Promise.all([
    adminDb
      .collection(BROADCAST_COLLECTION)
      .where("active", "==", true)
      .where(`platforms.${platform}`, "==", true)
      .limit(BROADCAST_LIST_LIMIT)
      .get(),
    readUserState(uid),
  ]);

  const records = snapshot.docs
    .map((doc) => mapBroadcastDoc(doc.id, doc.data() ?? {}))
    .filter((record) => matchesAudience(record.audience, role))
    .filter((record) => !state.dismissed[record.id]);

  return records
    .map<BroadcastForUser>((record) => ({
      id: record.id,
      title: record.title,
      body: record.body,
      audience: record.audience,
      createdAt: record.createdAt,
      read: state.read[record.id] === true,
    }))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export async function markBroadcastRead(
  uid: string,
  broadcastId: string,
): Promise<void> {
  await adminDb
    .collection(BROADCAST_USER_STATE_COLLECTION)
    .doc(uid)
    .set(
      {
        read: { [broadcastId]: true },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

export async function markAllBroadcastsRead(
  uid: string,
  role: string,
  platform: BroadcastPlatform,
): Promise<void> {
  const items = await listBroadcastsForUser(uid, role, platform);
  if (items.length === 0) return;
  const read: Record<string, boolean> = {};
  for (const item of items) read[item.id] = true;
  await adminDb
    .collection(BROADCAST_USER_STATE_COLLECTION)
    .doc(uid)
    .set(
      { read, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
}

export async function dismissBroadcast(
  uid: string,
  broadcastId: string,
): Promise<void> {
  await adminDb
    .collection(BROADCAST_USER_STATE_COLLECTION)
    .doc(uid)
    .set(
      {
        dismissed: { [broadcastId]: true },
        read: { [broadcastId]: true },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

export async function dismissAllBroadcasts(
  uid: string,
  role: string,
  platform: BroadcastPlatform,
): Promise<void> {
  const items = await listBroadcastsForUser(uid, role, platform);
  if (items.length === 0) return;
  const dismissed: Record<string, boolean> = {};
  const read: Record<string, boolean> = {};
  for (const item of items) {
    dismissed[item.id] = true;
    read[item.id] = true;
  }
  await adminDb
    .collection(BROADCAST_USER_STATE_COLLECTION)
    .doc(uid)
    .set(
      { dismissed, read, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
}