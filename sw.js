// Keeps the page working with no signal. Every file is served from one cache that a new version
// fills completely before it takes over, so a weak connection can never mix old and new modules.
// tools/deploy-web.sh stamps VERSION from the site's files, so any change makes a new worker.
const VERSION = "0a4f787bc08c";
const CACHE_NAME = `sms-izbori-${VERSION}`;
const ASSETS = [
  "./",
  "./index.html",
  "./uputstvo.html",
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
  "./video/slanje.jpg",
  "./video/instalacija.jpg",
];

self.addEventListener("install", (event) => {
  // Any failed file fails the install, and the old version stays in charge.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        ASSETS.map(async (url) => {
          // Past the HTTP cache and, with the version in the address, past GitHub's CDN too, which can
          // serve an old copy of a file for a few minutes after a deploy; mixed files would break the app.
          const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}v=${VERSION}`, { cache: "reload" });
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
  // The guide's videos go to the network as if there were no worker: Safari on iPhone plays a video only
  // from answers to its range requests, which a cached copy doesn't give. Their cover pictures are cached.
  if (new URL(event.request.url).pathname.endsWith(".mp4")) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Navigations may carry tracking parameters from the app that shared the link. A page of its own (the
    // guide) is served as itself, any other address in scope as the app.
    const cached = await cache.match(event.request, { ignoreSearch: true }) ??
      (event.request.mode === "navigate" ? await cache.match("./index.html") : undefined);
    return cached ?? fetch(event.request);
  })());
});
