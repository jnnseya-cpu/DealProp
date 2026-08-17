/**
 * Service worker.
 *
 * Deliberately minimal. Its job is to make the app installable and to show
 * something other than the browser's dinosaur when the network is gone — not
 * to cache the application.
 *
 * WHY SO LITTLE CACHING: every page here renders live deal figures, seller
 * screening answers and match results from the store. A cache-first strategy
 * would serve yesterday's Deal Score as though it were current, which on a
 * platform whose entire claim is that its numbers are trustworthy is worse than
 * being offline. Next.js already fingerprints and immutably caches its own
 * static assets, so there is nothing left worth duplicating here.
 *
 * Bump CACHE_VERSION to force every client to discard its cache on next load.
 */

const CACHE_VERSION = "lode-v1";
const OFFLINE_URL = "/offline";

// Only the offline fallback and the icons it needs. Nothing data-bearing.
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      // Take over without waiting for every tab to close, so a fixed worker
      // reaches users on their next navigation rather than their next session.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Navigations only. Everything else — static assets, server actions, API
  // routes — goes straight to the network untouched, so no response carrying
  // deal data is ever read from a cache.
  if (request.mode !== "navigate") return;

  // Never intercept a write. A queued or replayed POST could double-submit a
  // seller enquiry or a newsletter signup.
  if (request.method !== "GET") return;

  event.respondWith(
    fetch(request).catch(async () => {
      const cache = await caches.open(CACHE_VERSION);
      const offline = await cache.match(OFFLINE_URL);
      return (
        offline ??
        new Response("Offline", {
          status: 503,
          headers: { "content-type": "text/plain" },
        })
      );
    }),
  );
});
