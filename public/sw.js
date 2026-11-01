// A deliberately tiny service worker: it makes the site installable and always goes to the network, so an installed app never shows an old copy.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  for (const key of await caches.keys()) await caches.delete(key);   // drop any copy an earlier build kept
  await self.clients.claim();
})()));
self.addEventListener('fetch', () => { /* no respondWith: the browser handles every request itself */ });
