'use strict';

// ============================================================================================
// Service worker de l'application CLIENT (portée /app/ uniquement).
//
// Règle de sécurité : aucune réponse privée n'est mise en cache. Seul le squelette de
// l'application est conservé pour qu'elle s'ouvre même sans réseau ; les données (commandes,
// consignations, profil) sont TOUJOURS demandées au serveur, avec session obligatoire.
// ============================================================================================

const VERSION = 'oymike-client-v2';
const SHELL = [
  '/app/',
  '/app/client.css',
  '/app/client.js',
  '/app/manifest.webmanifest',
  '/icons/oymike-brand/oymike-192.png',
  '/icons/oymike-brand/oymike-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION && key.startsWith('oymike-client')).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Jamais de cache pour l'API : une donnée privée ne doit pas survivre à la déconnexion.
  // On ne touche pas du tout à ces requêtes (pas de respondWith) : le navigateur garde la main,
  // et un 401 n'apparaît jamais comme une erreur du service worker dans la console.
  if (url.pathname.startsWith('/api/')) return;
  // Le reste est réseau d'abord, avec repli sur le squelette (utile en zone sans réseau).
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && url.pathname.startsWith('/app/')) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('/app/'))),
  );
});
