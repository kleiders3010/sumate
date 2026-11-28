// The page shown with no connection (Juntos UX review U-J14, ported: the Android app showed Chrome's error page).
// Pages and files still come fresh from the server every time (network first); only when the network fails is the
// small offline page shown. Nothing else is cached.
const CACHE = "sumate-offline-2";
const OFFLINE = new URL("offline", self.registration.scope).href;
const FILES = ["offline", "offline.js", "i18n.js", "feedback.js", "style.css", "img/icon-192.png"].map((f) => new URL(f, self.registration.scope).href);

self.addEventListener("install", (e) => {
  // a failed copy fails the install: the browser tries again on the next visit (it went live with nothing kept)
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match(OFFLINE).then((r) => r || Response.error())));
    return;
  }
  const url = req.url.split(/[?#]/)[0];
  if (FILES.includes(url)) e.respondWith(fetch(req).catch(() => caches.match(url).then((r) => r || Response.error())));
});
