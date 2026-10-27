// Minimal service worker: Chrome on Android wants one before it offers to
// install the site. It caches nothing, so game updates are live straight away.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
