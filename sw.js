// Keeps the page working with no signal. Every file is served from one cache that a new version
// fills completely before it takes over, so a weak connection can never mix old and new modules.
// tools/deploy-web.sh stamps VERSION from the site's files, so any change makes a new worker.
const VERSION = "833d95da9780";
const CACHE_NAME = `sms-izbori-${VERSION}`;
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./src/ui.js",
  "./src/app.js",
  "./src/domain.js",
  "./src/store.js",
  "./src/sms.js",
  "./vendor/preact-htm-3.1.1.js",
  "./icons/icon-any.svg",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  // Any failed file fails the install, and the old version stays in charge.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        ASSETS.map(async (url) => {
          // Past the HTTP cache, so a new version never precaches an old file.
          const response = await fetch(url, { cache: "reload" });
          if (!response.ok) throw new Error(`${url}: ${response.status}`);
          await cache.put(url, response);
        }),
      )
    ).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Navigations may carry tracking parameters from the app that shared the link.
    const cached = event.request.mode === "navigate"
      ? await cache.match("./index.html")
      : await cache.match(event.request, { ignoreSearch: true });
    return cached ?? fetch(event.request);
  })());
});
