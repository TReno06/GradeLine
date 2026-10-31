// GradeLine service worker (PLAN.md Stage 4) — hand-rolled, no library,
// same spirit as makeZip()/the PDF writer in src/export.ts. Only exists
// to make the Pages-hosted copy installable and usable offline; the
// file:// distribution (tinviewer.html) never registers this at all
// (see src/pwa.ts's protocol guard).
//
// Strategy: cache-first for instant offline load, refreshing the cache
// from the network in the background on every fetch so a later online
// visit quietly picks up a new deploy — no version number to remember to
// bump in this file for that to keep working.
const CACHE_NAME = 'gradeline-v1';
const PRECACHE_URLS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Only this app's own same-origin files are precached/managed here —
  // never intercept the Google Fonts stylesheet/font requests (CLAUDE.md
  // already documents that dependency as a known, gracefully-degrading
  // exception to offline-first, not something this worker should try to
  // cache or fake a response for when offline).
  if (new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        // Offline (or otherwise unreachable): fall back to whatever's
        // cached — and if nothing is, a real (if empty) Response rather
        // than `undefined`, which respondWith() can't use.
        .catch(() => cached || new Response('', {status: 503, statusText: 'Offline and not cached'}));
      return cached || networkFetch;
    })
  );
});
