// Logistics Desk — lets the phone install the site as an app and open it without a connection.
// Always asks the live site first, so a new version on GitHub shows at once; the saved copy
// is used only when there is no connection. Google Sheet sync calls are never touched.
const CACHE = 'logistics-desk-v2';
const CORE = ['./', './index.html'];                                   // must be saved
const EXTRA = ['./manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png']; // nice to have
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c =>
    // a missing icon must not stop the app from working offline
    c.addAll(CORE).then(() => Promise.all(EXTRA.map(f => c.add(f).catch(() => {}))))
  ).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return; // sheet sync etc. go straight to the network
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
