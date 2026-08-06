// Canteen MS service worker — app-shell cache + network-first pages.
// Goal: survive flaky canteen networks; never serve stale data as fresh.
const CACHE = "canteen-v1";
const SHELL = ["/offline", "/manifest.json", "/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return; // never cache mutations
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return; // API always network

  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok && (url.pathname.startsWith("/_next/static") || SHELL.includes(url.pathname))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          const offline = await caches.match("/offline");
          if (offline) return offline;
        }
        return new Response("offline", { status: 503 });
      })
  );
});
