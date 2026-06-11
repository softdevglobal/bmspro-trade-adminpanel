/* Debug script: checks owner FCM token and sends a test push. */
import { readFileSync } from "node:fs";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (key) => {
  const match = env.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!match) return undefined;
  let value = match[1].trim();
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
  return value;
};

const app = initializeApp({
  credential: cert({
    projectId: get("FIREBASE_ADMIN_PROJECT_ID"),
    clientEmail: get("FIREBASE_ADMIN_CLIENT_EMAIL"),
    privateKey: get("FIREBASE_ADMIN_PRIVATE_KEY").replace(/\\n/g, "\n"),
  }),
});

const db = getFirestore(app);

const businesses = await db.collection("businesses").limit(20).get();
console.log("=== Businesses and owner FCM tokens ===");
for (const doc of businesses.docs) {
  const data = doc.data();
  const ownerUid = data.ownerUid;
  console.log(`\nBusiness: ${data.businessName ?? doc.id} (${doc.id})`);
  console.log(`  ownerUid: ${ownerUid ?? "MISSING"}`);
  if (!ownerUid) continue;
  const userSnap = await db.collection("users").doc(ownerUid).get();
  if (!userSnap.exists) {
    console.log("  users doc: MISSING");
    continue;
  }
  const user = userSnap.data();
  console.log(`  email: ${user.email ?? "?"}`);
  console.log(`  role: ${user.role ?? "?"}`);
  console.log(
    `  fcmToken: ${user.fcmToken ? `present (${String(user.fcmToken).length} chars)` : "MISSING"}`,
  );
  console.log(`  platform: ${user.platform ?? "?"}`);
  console.log(
    `  fcmTokenUpdatedAt: ${user.fcmTokenUpdatedAt?.toDate?.()?.toISOString?.() ?? "?"}`,
  );

  if (user.fcmToken) {
    try {
      const id = await getMessaging(app).send({
        token: String(user.fcmToken),
        notification: {
          title: "Test push",
          body: "Background push debug test from server",
        },
        data: { type: "request_created", requestId: "debug-test" },
        android: {
          priority: "high",
          notification: {
            channelId: "appointments",
            priority: "high",
            sound: "default",
          },
        },
      });
      console.log(`  ✅ Test push sent OK: ${id}`);
    } catch (error) {
      console.log(`  ❌ Test push FAILED: ${error.code ?? ""} ${error.message}`);
    }
  }
}
process.exit(0);
