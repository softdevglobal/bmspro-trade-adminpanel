import { setDefaultResultOrder } from "node:dns";

import {
  cert,
  getApp,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage, type Storage } from "firebase-admin/storage";

// Some local networks advertise IPv6 without a working route to it, which makes
// gRPC (used by the Admin SDK below) hang or fail with EHOSTUNREACH when DNS
// returns an AAAA record first. Prefer IPv4 results so Firestore/Auth/Storage
// calls don't attempt the broken IPv6 path.
//
// This lives here rather than in `instrumentation.ts` because that file is
// compiled for the Edge runtime too, where `node:dns` doesn't resolve — a
// `NEXT_RUNTIME` check doesn't help, since the bundler follows the import
// before any of it runs.
setDefaultResultOrder("ipv4first");

function loadAdminApp(): App {
  if (getApps().length > 0) return getApp();

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Missing Firebase Admin credentials. Check FIREBASE_ADMIN_* env vars."
    );
  }

  const storageBucket = getStorageBucketName();

  return initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    storageBucket,
  });
}

export function getStorageBucketName(): string {
  const fromEnv =
    process.env.FIREBASE_ADMIN_STORAGE_BUCKET ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (fromEnv?.trim()) return fromEnv.trim();

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  if (projectId) return `${projectId}.appspot.com`;

  throw new Error(
    "Storage bucket is not configured. Set NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET.",
  );
}

export const adminApp: App = loadAdminApp();
export const adminAuth: Auth = getAuth(adminApp);
export const adminDb: Firestore = getFirestore(adminApp);
export const adminStorage: Storage = getStorage(adminApp);
