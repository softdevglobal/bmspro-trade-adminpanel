import type { FirebaseApp } from "firebase/app";
import {
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  setLogLevel,
  type Firestore,
} from "firebase/firestore";

const cacheByApp = new Map<string, Firestore>();

/** Browser Firestore with dev-safe caching (memory in dev, persistent multi-tab in prod). */
export function initBrowserFirestore(app: FirebaseApp): Firestore {
  const cached = cacheByApp.get(app.name);
  if (cached) return cached;

  const settings =
    process.env.NODE_ENV === "development"
      ? { localCache: memoryLocalCache() }
      : {
          localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager(),
          }),
        };

  let db: Firestore;
  try {
    db = initializeFirestore(app, settings);
  } catch {
    db = getFirestore(app);
  }

  // Firestore logs routine reconnects ("Listen stream transport errored")
  // as warnings when the browser drops its live connection (sleep, network
  // change, background tab); it reconnects by itself. Keep real errors only.
  setLogLevel("error");

  cacheByApp.set(app.name, db);
  return db;
}
