(() => {
  'use strict';
  // Static fallback for an inactive QR or a briefly unavailable database.
  // Works without any API call: the server sends the reason through X-QR-Status / X-QR-Reason.
  const status = (() => { try { return performance.getEntriesByType('navigation')[0]?.responseStatus || 0; } catch (_) { return 0; } })();
  const params = new URLSearchParams(location.search);
  // When the request was sent by the QR handler itself, the original link is embedded in the URL.
  const originalQr = params.get('qr');
  const unavailable = params.get('unavailable') === '1' || status === 503;
  const title = document.getElementById('title');
  const message = document.getElementById('message');
  const badge = document.getElementById('badge');
  const retry = document.getElementById('retry');
  if (unavailable) {
    badge.className = 'badge pending';
    badge.textContent = 'Service momentanément indisponible';
    title.textContent = 'Réessayez dans quelques secondes';
    message.textContent = 'La boutique n’a pas pu répondre à temps. Votre QR est valide : aucune nouvelle inscription n’est nécessaire.';
    retry.style.display = 'inline-flex';
  }
  retry.addEventListener('click', () => {
    retry.disabled = true; retry.textContent = 'Nouvelle tentative…';
    // Re-open the original QR link recorded in the query string, or simply reload.
    const target = params.get('qr');
    location.replace(target ? (() => { try { const url = new URL(target, location.origin); return url.pathname + url.search; } catch (_) { return location.href; } })() : location.href);
  });
})();
