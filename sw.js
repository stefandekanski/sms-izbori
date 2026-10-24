// Keeps the page working with no signal. Every file is served from one cache that a new version
// fills completely before it takes over, so a weak connection can never mix old and new modules.
// tools/deploy-web.sh stamps VERSION from the site's files, so any change makes a new worker.
const VERSION = "bedd263aa9e6";
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

// The guide's videos are stored after the version takes over, not before: they are large, and a slow
// download shouldn't hold back the app's own files. Each time a page opens, any that are missing are
// fetched in the background; until then they come from the network.
const VIDEOS = ["./video/slanje.mp4", "./video/instalacija.mp4"];
let storingVideos = null;
function storeVideos() {
  storingVideos ??= caches.open(CACHE_NAME).then((cache) =>
    Promise.all(VIDEOS.map(async (url) => {
      if (await cache.match(url)) return;
      const response = await fetch(`${url}?v=${VERSION}`, { cache: "reload" });
      if (response.ok) await cache.put(url, response);
    }))
  ).catch(() => {}).finally(() => (storingVideos = null));
  return storingVideos;
}

// Safari on iPhone plays a video only from answers to its range requests, so a stored video is
// answered in the parts asked for.
async function videoPart(stored, request) {
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("Range") ?? "");
  if (!range || (range[1] === "" && range[2] === "")) return stored;
  const body = await stored.arrayBuffer();
  const size = body.byteLength;
  const start = range[1] === "" ? Math.max(size - Number(range[2]), 0) : Number(range[1]);
  const end = range[1] === "" || range[2] === "" ? size - 1 : Math.min(Number(range[2]), size - 1);
  if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  return new Response(body.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
    },
  });
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (event.request.mode === "navigate") event.waitUntil(storeVideos());
  if (new URL(event.request.url).pathname.endsWith(".mp4")) {
    event.respondWith((async () => {
      const stored = await (await caches.open(CACHE_NAME)).match(event.request, { ignoreSearch: true });
      if (stored) return videoPart(stored, event.request);
      event.waitUntil(storeVideos());
      return fetch(event.request);
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Navigations may carry tracking parameters from the app that shared the link. A page of its own (the
    // guide) is served as itself, any other address in scope as the app.
    const cached = await cache.match(event.request, { ignoreSearch: true }) ??
      (event.request.mode === "navigate" ? await cache.match("./index.html") : undefined);
    return cached ?? fetch(event.request);
  })());
});
