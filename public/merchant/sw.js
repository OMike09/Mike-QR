'use strict';

// Mission 13 : ajout de l'accueil marchand (merchant-home.js/.css) — version de cache incrémentée.
// Mission 12 : le cache périmé de la coquille servait d'anciens scripts (scanner cassé après mise à
// jour). On change de version et le code applicatif (JS/CSS) passe en RÉSEAU D'ABORD : une mise à
// jour est prise en compte au premier rechargement, le cache ne sert qu'en secours hors-ligne.
const CACHE_NAME = 'oymike-merchant-shell-v7';
const SHELL_URLS = [
  '/merchant/',
  '/merchant/manifest.webmanifest',
  '/merchant.js',
  // Mission 13 : la page d'accueil a son propre module et sa feuille de style.
  '/merchant-home.js',
  '/merchant-home.css',
  '/qr-camera.js',
  '/vendor/jsQR.js',
  '/table-manager.js',
  '/member-accounts.js',
  '/merchant-team.js',
  '/merchant.css',
  '/vendor/qrcode.js',
  '/pwa-install.css',
  '/pwa-install.js',
  '/icons/oymike-brand/oymike-180.png',
  '/icons/oymike-brand/oymike-192.png',
  '/icons/oymike-brand/oymike-512.png',
  '/icons/oymike-brand/oymike-512-maskable.png',
  '/icons/oymike-brand/oymike-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(SHELL_URLS.map(async (url) => {
      try {
        const response = await fetch(new Request(url, { cache: 'reload' }));
        if (response.ok && response.type !== 'opaque') await cache.put(url, response);
      } catch (_) { /* The worker can still install when some optional shell asset is offline. */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('oymike-merchant-') && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate' && (url.pathname === '/merchant/' || url.pathname === '/merchant')) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) { const cache = await caches.open(CACHE_NAME); await cache.put('/merchant/', response.clone()); }
        return response;
      } catch (_) {
        return (await caches.match('/merchant/')) || new Response('Oymike Tech · Espace marchand — Connexion requise. Reconnectez-vous pour synchroniser vos données.', {
          status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      }
    })());
    return;
  }

  // Code de l'application (scripts, styles, coquille) : réseau d'abord, cache seulement si le
  // réseau est indisponible. C'est ce qui garantit qu'une correction (scanner, tables, comptes)
  // est réellement exécutée par le navigateur, et non une ancienne version restée en cache.
  const isAppCode = /\.(?:js|css|webmanifest)$/.test(url.pathname);
  if (isAppCode || SHELL_URLS.includes(url.pathname)) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: 'no-store' });
        if (response.ok && response.type !== 'opaque') {
          const cache = await caches.open(CACHE_NAME);
          cache.put(url.pathname, response.clone()).catch(() => {});
        }
        return response;
      } catch (_) {
        const cached = await caches.match(url.pathname);
        if (cached) return cached;
        return new Response('', { status: 503, headers: { 'Cache-Control': 'no-store' } });
      }
    })());
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { body: event.data?.text?.() || '' }; }
  const title = String(data.title || 'Oymike Tech · Espace marchand');
  const options = { body: String(data.body || 'Vous avez une nouvelle information.'),
    icon: '/icons/oymike-brand/oymike-192.png', badge: '/icons/oymike-brand/oymike-32.png', tag: data.orderId ? `merchant-order-${data.orderId}` : 'merchant-notification',
    renotify: false, data: { url: String(data.url || '/merchant/') } };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/merchant/', self.location.origin);
  if (targetUrl.origin !== self.location.origin || !targetUrl.pathname.startsWith('/merchant/')) targetUrl.pathname = '/merchant/';
  const target = targetUrl.href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && new URL(client.url).pathname.startsWith('/merchant/')) { await client.navigate(target); return client.focus(); }
    }
    return self.clients.openWindow(target);
  })());
});
