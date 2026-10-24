// Firefly's service worker: makes the site installable and quick to open.
// Pages are fetched fresh when online (cached copy offline); pictures, sounds and music are cached.
// The API is never cached.
const CACHE = "firefly-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put("/", c)); return r; })
      .catch(() => caches.match("/")));
    return;
  }
  if (/\.(webp|png|mp3|mp4|webm|webmanifest)$/.test(url.pathname)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
      if (r.ok && r.status === 200) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); }
      return r;
    })));
  }
});
