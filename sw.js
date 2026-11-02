// Chloe Mobile service worker: caches the app's own files (code only) so it opens offline.
// Never caches GitHub API responses: work data stays in the private repo, not in a cache.
const CACHE = "chloe-v1793588653";
const FILES = ["./", "index.html", "style.css", "app.js", "hud.js", "gh.js", "chloe.js", "speech.js",
  "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;            // GitHub API: straight to the network
  e.respondWith(fetch(e.request).then((r) => {                 // network first, so updates arrive at once
    const copy = r.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request)));
});
