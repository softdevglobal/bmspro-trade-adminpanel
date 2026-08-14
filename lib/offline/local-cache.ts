import { clearIndexedDbPersistence, terminate } from "firebase/firestore";

import { db } from "@/lib/firebase/client";

/**
 * Wipes everything this device holds for the signed-in user. Called on logout,
 * where the operator's expectation is that walking away leaves nothing behind —
 * shared laptops in a workshop are the normal case, not the exception.
 *
 * Three separate stores have to be cleared, and none of them clears the others:
 *
 *  1. sessionStorage — the `bms.*` role, business profile, module and staff
 *     caches written across lib/.
 *  2. Cache Storage — the app shell held by public/sw.js.
 *  3. Firestore's IndexedDB persistence — every job, customer, quote and
 *     invoice document the SDK has read (enabled in
 *     lib/firebase/browser-firestore.ts).
 *
 * Each step is independent and failure-tolerant: a browser that denies storage
 * access, or a second tab holding the Firestore lock, must not strand the user
 * in a half-signed-out state.
 */

const SESSION_KEY_PREFIX = "bms.";

function clearSessionCaches(): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(SESSION_KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) sessionStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

async function clearServiceWorkerCaches(): Promise<void> {
  if (!("caches" in window)) return;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key.startsWith("bms-")).map((key) => caches.delete(key)),
    );
  } catch {
    /* cache storage unavailable */
  }
}

/**
 * Firestore only releases its IndexedDB files after the client is terminated,
 * and refuses while another tab still holds them. Both outcomes are acceptable:
 * the caller reloads the page immediately afterwards, which rebuilds a fresh
 * client, and a second tab still has its own signed-in session.
 */
async function clearFirestoreCache(): Promise<void> {
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch {
    /* another tab holds the cache, or persistence was never enabled */
  }
}

export async function clearLocalCaches(): Promise<void> {
  clearSessionCaches();
  await Promise.all([clearServiceWorkerCaches(), clearFirestoreCache()]);
}
