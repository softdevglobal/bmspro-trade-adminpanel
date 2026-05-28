/**
 * Separate Firebase client app used for customer-facing auth (booking pages,
 * /account). Keeps customer sessions isolated from the business-owner auth
 * context so both can coexist in the same browser tab.
 */
import {
  getApp,
  getApps,
  initializeApp,
  type FirebaseApp,
} from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

const CUSTOMER_APP_NAME = "customer";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

function loadCustomerApp(): FirebaseApp {
  const existing = getApps().find((app) => app.name === CUSTOMER_APP_NAME);
  if (existing) return existing;
  try {
    return getApp(CUSTOMER_APP_NAME);
  } catch {
    return initializeApp(firebaseConfig, CUSTOMER_APP_NAME);
  }
}

export const customerApp: FirebaseApp = loadCustomerApp();
export const customerAuth: Auth = getAuth(customerApp);
