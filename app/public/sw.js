// Retired service worker (2026-11-08). The website used to be installable
// as an app with an offline cache; that's gone — the Windows desktop app
// comes from the Tauri installer. Browsers that installed the old site
// still check this file for updates: this version deletes GradeLine's
// caches, unregisters itself and reloads any open page so it comes
// straight from the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('gradeline-')).map((k) => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((c) => c.navigate(c.url));
  })());
});
