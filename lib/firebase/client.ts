import { getApps, getApp, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

import { initBrowserFirestore } from "@/lib/firebase/browser-firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

/**
 * Resolve the Firebase app idempotently. Wrapped in try/catch because under
 * Next.js Fast Refresh the module can be re-evaluated while Firebase's internal
 * app registry is mid-reset, which can make a bare `getApp()` throw even when
 * `getApps()` reported an existing app.
 */
function resolveFirebaseApp(): FirebaseApp {
  if (getApps().length > 0) {
    try {
      return getApp();
    } catch {
      return initializeApp(firebaseConfig);
    }
  }
  return initializeApp(firebaseConfig);
}

export const firebaseApp: FirebaseApp = resolveFirebaseApp();

export const auth: Auth = getAuth(firebaseApp);

export const db = initBrowserFirestore(firebaseApp);
