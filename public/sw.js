/**
 * BMS Pro Trade service worker — app-shell caching only.
 *
 * What this does and does not store is the whole point, so read this first:
 *
 *  - Cached: the HTML shell of app routes, `/_next/static/*` bundles, and
 *    public files such as icons. Dashboard HTML is prerendered and identical
 *    for every user — auth and all tenant data are resolved client-side — so
 *    nothing here is user-specific.
 *  - Never cached: `/api/*` (bearer-authenticated tenant data), React Server
 *    Component payloads, `/_next/image` (which proxies customer uploads), and
 *    the public `/pay/*` and `/booknow/*` pages, which render customer detail
 *    against a token in the URL.
 *
 * Structured business data — jobs, customers, calendar, invoices — is NOT
 * cached here. It is read through Firestore, whose own IndexedDB persistence is
 * enabled in lib/firebase/browser-firestore.ts. That layer understands document
 * versioning and is cleared on logout by lib/offline/local-cache.ts; duplicating
 * it in Cache Storage would mean stale copies nobody invalidates.
 *
 * Versioning: bump CACHE_VERSION to retire every cache this worker owns. The
 * browser re-fetches this file on navigation (it is served no-store, see
 * next.config.ts), the new worker precaches, takes over, and `activate` deletes
 * every cache not named below.
 */

const CACHE_VERSION = "v1";
const SHELL_CACHE = `bms-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `bms-assets-${CACHE_VERSION}`;
const OWNED_CACHES = [SHELL_CACHE, ASSET_CACHE];

const OFFLINE_URL = "/offline";
const PRECACHE_URLS = [OFFLINE_URL, "/icons/icon-192.png"];

/** How long to wait for the network before falling back to a cached shell. */
const NETWORK_TIMEOUT_MS = 3500;

/** Path prefixes whose responses must never touch the device cache. */
const NEVER_CACHE_PREFIXES = ["/api/", "/pay/", "/booknow/", "/_next/image"];

/** Extensions safe to serve stale while refreshing in the background. */
const STATIC_ASSET_PATTERN = /\.(?:css|js|mjs|png|jpg|jpeg|svg|webp|ico|woff2?|webmanifest)$/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      // A precache miss must not block activation; runtime caching recovers.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("bms-") && !OWNED_CACHES.includes(key))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Logout clears these caches from the page itself — see
// lib/offline/local-cache.ts. Cache Storage is origin-scoped and reachable from
// both sides, and doing it page-side works even when no worker is controlling
// the tab, so this file deliberately has no clear-cache message handler.

function isCacheable(response) {
  return (
    response &&
    response.status === 200 &&
    response.type === "basic" &&
    !(response.headers.get("cache-control") ?? "").includes("no-store")
  );
}

/**
 * Network-first, because a stale shell after a deploy is worse than a slow one.
 * The timeout is what makes a flaky connection usable: rather than hanging on a
 * request that may never settle, fall back to the last good shell and let the
 * page hydrate from Firestore's cache.
 */
async function handleNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);

  const network = fetch(request)
    .then((response) => {
      if (isCacheable(response)) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve(undefined), NETWORK_TIMEOUT_MS);
  });

  const fast = await Promise.race([network, timeout]);
  if (fast) return fast;

  const cached = (await cache.match(request)) ?? (await cache.match(OFFLINE_URL));
  if (cached) return cached;

  // Nothing cached yet: the network is the only remaining option.
  return (
    (await network) ??
    new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } })
  );
}

/** For fingerprinted `/_next/static/*`: the URL changes when the bytes change. */
async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (isCacheable(response)) cache.put(request, response.clone());
  return response;
}

/** For unfingerprinted public files: serve immediately, refresh behind it. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (isCacheable(response)) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached ?? (await network) ?? Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;
  // Devtools "only-if-cached" probes are same-origin only and must be ignored.
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;

  const url = new URL(request.url);

  // Firebase, Google Fonts, DiceBear and friends: always straight to network.
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return;
  // RSC/Flight payloads are tied to a build and can carry route data; a stale
  // one breaks navigation in ways a stale document does not.
  if (url.searchParams.has("_rsc") || request.headers.get("RSC") === "1") return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (STATIC_ASSET_PATTERN.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
