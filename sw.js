const CACHE_NAME = "sms-izbori-v1";
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
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        ASSETS.map((url) =>
          // Past the HTTP cache, so a new version never precaches an old file.
          fetch(url, { cache: "reload" })
            .then((response) => {
              if (response && response.ok) {
                return cache.put(url, response);
              }
            })
            .catch(() => {})
        )
      );
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Network timeout")), 3000);
      });

      const networkPromise = (async () => {
        const response = await fetch(event.request);
        if (response && response.status === 200) {
          cache.put(event.request, response.clone());
        }
        return response;
      })();

      try {
        return await Promise.race([networkPromise, timeoutPromise]);
      } catch {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        if (event.request.mode === "navigate") {
          const fallback = (await cache.match("./index.html")) || (await cache.match("./"));
          if (fallback) return fallback;
        }
        throw new Error("Offline and not cached");
      }
    })()
  );
});
