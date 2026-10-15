'use strict';

// This worker makes the scoped manager area installable without caching private API data.
// Requests remain network-backed; there is deliberately no offline payment/session cache.
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {
  // Deliberately network-only; authenticated responses are never cached.
});
