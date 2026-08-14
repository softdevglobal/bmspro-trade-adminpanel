import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Offline - BMS Pro Trade",
  description: "You are offline. Reconnect to load this page.",
};

/**
 * Precached by public/sw.js and served only when a page is requested that has
 * never been cached and the network is unavailable. Deliberately static — it
 * must render with no data, no client JS, and no network.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <span
        aria-hidden
        className="material-symbols-outlined text-5xl text-on-surface-variant"
      >
        cloud_off
      </span>
      <h1 className="text-2xl font-semibold text-on-background">
        You&rsquo;re offline
      </h1>
      <p className="max-w-md text-on-surface-variant">
        This page hasn&rsquo;t been saved to your device yet. Pages you&rsquo;ve
        already opened will still load, and your work syncs once you&rsquo;re
        back online.
      </p>
    </main>
  );
}
