// MyNews service worker.
// Strategy: STALE-WHILE-REVALIDATE everywhere — instant page loads from cache,
// fresh data fetched in the background. The user never waits on a cold server.

const CACHE_NAME = 'mynews-v3';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.svg',
  './icon-maskable.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Stale-while-revalidate handler — serves the cached response immediately if
// available, then fetches a fresh copy in the background and updates the cache
// for next time. Falls back to whatever's in cache if the network is dead.
function staleWhileRevalidate(req) {
  return caches.open(CACHE_NAME).then(async (cache) => {
    const cached = await cache.match(req);
    const network = fetch(req)
      .then((res) => {
        // Only cache real, successful, basic responses
        if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
          cache.put(req, res.clone()).catch(() => {});
        }
        return res;
      })
      .catch(() => cached);   // network failed → fall back to cache
    return cached || network; // cache hit → return instantly; otherwise wait
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Same-origin (app shell + /api/*) → stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // External RSS proxy (used only in static-PWA fallback mode) → same strategy
  if (url.hostname === 'api.rss2json.com') {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Everything else (article images, third-party CDNs) — pass through with
  // cache fallback only if the network is down.
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});
