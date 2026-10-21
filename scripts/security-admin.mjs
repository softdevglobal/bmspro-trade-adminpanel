import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

export function securityAdmin() {
  const requested = process.argv[process.argv.indexOf("--project") + 1];
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  if (!process.argv.includes("--project") || !requested || requested !== projectId) {
    throw new Error("Specify --project matching FIREBASE_ADMIN_PROJECT_ID. No changes were made.");
  }
  const app = initializeApp({ credential: cert({ projectId,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n") }),
    storageBucket: process.env.FIREBASE_ADMIN_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET });
  return { projectId, auth: getAuth(app), db: getFirestore(app), storage: getStorage(app) };
}
