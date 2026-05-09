/* Solomon's Forge — minimal service worker.
   Purpose: make the site installable as a PWA on Android Chrome and ensure
   iOS treats it as a standalone app. We intentionally don't cache API or
   tRPC traffic so live data always comes from the local server. */
const CACHE = "solomon-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Network-first for APIs and tRPC; never cache them.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/trpc/")) {
    return;
  }
  // Cache-first for the static shell, fall back to network.
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request))
  );
});
