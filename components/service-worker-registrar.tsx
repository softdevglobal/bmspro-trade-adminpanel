"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js so the app shell survives a flaky connection.
 *
 * Development is deliberately excluded and actively cleaned up: Turbopack
 * rebuilds chunk URLs constantly, and a worker left over from a visit to the
 * deployed site would serve them from cache and produce exactly the
 * ChunkLoadError that Providers already works around.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => {
          for (const registration of registrations) void registration.unregister();
        })
        .catch(() => undefined);
      return;
    }

    // `updateViaCache: "none"` keeps the browser from serving sw.js itself from
    // the HTTP cache, so a deploy is picked up on the next navigation.
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((error) => {
        console.warn("[sw] registration failed", error);
      });
  }, []);

  return null;
}
