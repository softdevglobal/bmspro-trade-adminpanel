import type { FirebaseApp } from "firebase/app";
import {
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
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

  cacheByApp.set(app.name, db);
  return db;
}
