// Mission 10 — chargement des gros décodeurs QR uniquement quand ils servent.
// Avant, jsQR (257 Ko) et la bibliothèque de dessin de QR (57 Ko) étaient téléchargés et
// analysés à chaque ouverture de l'espace marchand, même sans jamais scanner ni afficher de QR.
(() => {
  'use strict';
  const pending = new Map();
  window.loadScriptOnce = function loadScriptOnce(src) {
    if (!src) return Promise.reject(new Error('Source de script manquante.'));
    if (pending.has(src)) return pending.get(src);
    const promise = new Promise((resolve, reject) => {
      const existing = [...document.scripts].find((tag) => tag.src === new URL(src, location.href).href);
      if (existing) { if (existing.dataset.loaded === '1') resolve(true); else { existing.addEventListener('load', () => resolve(true), { once: true }); existing.addEventListener('error', reject, { once: true }); } return; }
      const tag = document.createElement('script');
      tag.src = src; tag.async = true;
      tag.onload = () => { tag.dataset.loaded = '1'; resolve(true); };
      tag.onerror = () => reject(new Error(`Impossible de charger ${src}.`));
      document.head.append(tag);
    });
    pending.set(src, promise);
    promise.catch(() => pending.delete(src));
    return promise;
  };
  // Alias explicite pour les modules existants qui attendent window.jsQR.
  window.ensureQrDecoder = () => (window.jsQR ? Promise.resolve(true) : window.loadScriptOnce('/vendor/jsQR.js'));
  window.ensureQrEncoder = () => (window.qrcode ? Promise.resolve(true) : window.loadScriptOnce('/vendor/qrcode.js'));
})();
