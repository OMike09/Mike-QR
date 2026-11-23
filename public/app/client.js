'use strict';

// ============================================================================================
// Application CLIENT — aucune donnée privée n'est calculée ici : tout vient du serveur, qui
// vérifie la session à chaque appel. L'interface ne fait que refléter des droits déjà tranchés.
// ============================================================================================

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const state = { client: null, view: 'commandes', deferredPrompt: null, scanStream: null, scanTimer: 0 };
const STATUS_LABELS = { pending: 'En attente', confirmed: 'Acceptée', preparing: 'En préparation', ready: 'Prête', completed: 'Terminée', cancelled: 'Annulée' };

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtMoney(n) { return `${Number(n || 0).toLocaleString('fr-FR')} FCFA`; }
function fmtDate(value) {
  if (!value) return '—';
  try { return new Date(value).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch (_) { return String(value); }
}
function toast(text) {
  const node = $('#toast'); node.textContent = text; node.hidden = false;
  clearTimeout(toast._timer); toast._timer = setTimeout(() => { node.hidden = true; }, 4200);
}
async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  let payload = null;
  try { payload = await response.json(); } catch (_) {}
  if (!response.ok) {
    const error = new Error(payload?.error || `Erreur ${response.status}`);
    error.status = response.status; error.code = payload?.code; throw error;
  }
  return payload;
}

// ------------------------------------------------------------------ navigation
function showView(name) {
  $('#view-auth').hidden = name !== 'auth';
  $('#view-app').hidden = name !== 'app';
}
function switchPanel(view) {
  state.view = view;
  for (const tab of $$('.tab')) tab.classList.toggle('active', tab.dataset.view === view);
  for (const panel of $$('.panel')) panel.hidden = panel.id !== `panel-${view}`;
  if (view === 'commandes') loadOrders();
  if (view === 'consignations') loadConsignments();
  if (view === 'boutiques') loadStores();
  if (view === 'compte') loadProfile();
}
for (const tab of $$('.tab')) tab.addEventListener('click', () => switchPanel(tab.dataset.view));

// ------------------------------------------------------------------ authentification
$('#requestForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('button[type=submit]', event.currentTarget); button.disabled = true;
  const message = $('#authMessage'); message.hidden = true; $('#otpNotice').hidden = true;
  try {
    const result = await api('/api/client/auth/request-code', { method: 'POST', body: JSON.stringify({ phone: $('#phone').value }) });
    const data = result.data || {};
    const notice = $('#otpNotice'); notice.hidden = false;
    notice.textContent = data.message || '';
    if (data.devCode) {
      notice.textContent += ` Code technique : ${data.devCode}`;
      $('#otpCode').value = data.devCode;
    }
    $('#verifyForm').hidden = false;
  } catch (error) { message.textContent = error.message; message.hidden = false; }
  finally { button.disabled = false; }
});

$('#verifyForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('button[type=submit]', event.currentTarget); button.disabled = true;
  const message = $('#authMessage');
  try {
    const result = await api('/api/client/auth/verify-code', { method: 'POST', body: JSON.stringify({ phone: $('#phone').value, code: $('#otpCode').value }) });
    state.client = result.data?.client || null;
    await startSession();
    if (result.data?.linkedOrders) toast(`${result.data.linkedOrders} commande(s) rattachée(s) à votre numéro.`);
  } catch (error) { message.textContent = error.message; message.hidden = false; }
  finally { button.disabled = false; }
});

// Retrouver une consignation sans compte : code seul, boutique obligatoire, aucune donnée d'autrui.
$('#codeForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const target = $('#codeResult'); target.hidden = false; target.innerHTML = '<p class="muted">Vérification…</p>';
  try {
    const slug = extractSlug($('#codeStore').value);
    const response = await fetch(`/api/public/shops/${encodeURIComponent(slug)}/consignments/lookup`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: $('#codeValue').value }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Consignation introuvable.');
    target.innerHTML = renderConsignment(payload.data, { readOnly: true });
  } catch (error) { target.innerHTML = `<p class="message">${esc(error.message)}</p>`; }
});

async function startSession() {
  showView('app');
  try { await api('/api/client/auth/me'); } catch (_) { showView('auth'); return; }
  connectEvents();
  switchPanel('commandes');
}

$('#logoutBtn').addEventListener('click', async () => {
  try { await api('/api/client/auth/logout', { method: 'POST', body: '{}' }); } catch (_) {}
  state.client = null; showView('auth'); toast('Vous êtes déconnecté.');
});

// ------------------------------------------------------------------ commandes
async function loadOrders() {
  const list = $('#ordersList'); list.innerHTML = '<p class="empty">Chargement…</p>';
  try {
    const result = await api('/api/client/orders');
    const orders = result.data || [];
    if (!orders.length) {
      list.innerHTML = '<p class="empty">Aucune commande pour l’instant. Scannez le QR code d’une boutique pour commencer.</p>';
      return;
    }
    list.innerHTML = orders.map(renderOrder).join('');
    for (const button of $$('[data-cancel-order]', list)) {
      button.addEventListener('click', () => cancelOrder(button.dataset.cancelOrder, button));
    }
    for (const button of $$('[data-order-detail]', list)) {
      button.addEventListener('click', () => openOrder(button.dataset.orderDetail));
    }
  } catch (error) {
    list.innerHTML = `<p class="message">${esc(error.message)}</p>`;
  }
}

function renderOrder(order) {
  const items = (order.items || []).map((item) => `${esc(item.name)} × ${item.quantity}`).join(' · ');
  const canCancel = !['completed', 'cancelled'].includes(order.status);
  return `<article class="order" data-order="${esc(order.id)}">
    <div class="order-head">
      <div><div class="order-ref">${esc(order.reference)}</div><div class="order-store">${esc(order.storeName)} · ${esc(fmtDate(order.createdAt))}</div></div>
      <span class="badge ${esc(order.status)}">${esc(STATUS_LABELS[order.status] || order.status)}</span>
    </div>
    ${items ? `<div class="order-items">${items}</div>` : ''}
    <div class="order-total">${fmtMoney(order.totalAmountXof)}</div>
    <div class="order-actions">
      <button class="btn ghost" type="button" data-order-detail="${esc(order.reference)}">Détail et suivi</button>
      ${canCancel ? `<button class="btn danger" type="button" data-cancel-order="${esc(order.reference)}">Demander l’annulation</button>` : ''}
    </div>
  </article>`;
}

async function openOrder(reference) {
  try {
    const result = await api(`/api/client/orders/${encodeURIComponent(reference)}`);
    const order = result.data;
    const history = (order.history || []).map((h) => `<div>${esc(fmtDate(h.at))} — ${esc(STATUS_LABELS[h.status] || h.status)}${h.note ? ` · ${esc(h.note)}` : ''}</div>`).join('');
    toast(`${order.reference} · ${STATUS_LABELS[order.status] || order.status}`);
    const first = $(`[data-order="${CSS.escape(order.id)}"]`);
    if (first) {
      let detail = first.querySelector('.history');
      if (!detail) { detail = document.createElement('div'); detail.className = 'history'; first.appendChild(detail); }
      detail.innerHTML = history || '<div>Aucun historique.</div>';
    }
  } catch (error) { toast(error.message); }
}

async function cancelOrder(reference, button) {
  button.disabled = true;
  try {
    const requestId = `cr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await api(`/api/client/orders/${encodeURIComponent(reference)}/cancel`, { method: 'POST', body: JSON.stringify({ requestId, reason: 'Demande du client depuis son application.' }) });
    if (result.data?.autoAccepted) toast('Commande annulée.');
    else toast('Votre demande a été transmise à la boutique.');
    await loadOrders();
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}

// ------------------------------------------------------------------ consignations
async function loadConsignments() {
  const list = $('#consignList'); list.innerHTML = '<p class="empty">Chargement…</p>';
  try {
    const result = await api('/api/client/consignments');
    const items = result.data || [];
    if (!items.length) {
      list.innerHTML = '<p class="empty">Aucune consignation enregistrée avec votre numéro. Vous pouvez aussi retrouver une consignation avec son code secret.</p>';
      return;
    }
    list.innerHTML = items.map((item) => renderConsignment(item)).join('');
  } catch (error) { list.innerHTML = `<p class="message">${esc(error.message)}</p>`; }
}

function renderConsignment(item, { readOnly = false } = {}) {
  if (!item) return '<p class="empty">Aucune consignation.</p>';
  const isBottle = item.kind === 'bottle';
  const main = isBottle
    ? `${item.balanceQuantity} / ${item.quantityDeposited} bouteille(s)`
    : `${fmtMoney(item.balanceAmountXof)} sur ${fmtMoney(item.amountDepositedXof)}`;
  return `<article class="order">
    <div class="order-head">
      <div><div class="order-ref">${esc(item.reference)}</div>
        <div class="order-store">${esc(item.storeName || item.bottleTypeLabel || '')} · ${esc(fmtDate(item.createdAt))}</div></div>
      <span class="badge ${esc(item.status)}">${item.status === 'settled' ? 'Soldée' : item.status === 'cancelled' ? 'Annulée' : 'En cours'}</span>
    </div>
    <div class="stat-grid">
      <div class="stat"><span>${isBottle ? 'Bouteilles déposées' : 'Montant déposé'}</span><strong>${isBottle ? item.quantityDeposited : fmtMoney(item.amountDepositedXof)}</strong></div>
      <div class="stat"><span>${isBottle ? 'Récupérées' : 'Utilisé'}</span><strong>${isBottle ? item.quantityRecovered : fmtMoney(item.amountUsedXof)}</strong></div>
      <div class="stat"><span>${isBottle ? 'Restant' : 'Remboursé'}</span><strong>${isBottle ? item.balanceQuantity : fmtMoney(item.amountRefundedXof)}</strong></div>
      <div class="stat"><span>Solde</span><strong>${isBottle ? `${item.balanceQuantity} bouteille(s)` : fmtMoney(item.balanceAmountXof)}</strong></div>
    </div>
    <p class="muted" style="margin:8px 0 0">${esc(item.bottleTypeLabel || item.reason || '')}${item.createdByLabel ? ` · enregistré par ${esc(item.createdByLabel)}` : ''}</p>
    ${item.codeHint ? `<p class="muted" style="margin:4px 0 0">Code client : <strong>${esc(item.codeHint)}</strong> (les caractères manquants ne sont jamais affichés)</p>` : ''}
    ${readOnly ? '' : '<p class="muted" style="margin:4px 0 0">Présentez votre code secret en boutique pour récupérer vos bouteilles ou utiliser votre crédit.</p>'}
  </article>`;
}

$('#lookupForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const slug = extractSlug($('#lookupStore').value);
    const result = await api('/api/client/consignments/lookup', { method: 'POST', body: JSON.stringify({ storeSlug: slug, code: $('#lookupCode').value }) });
    const node = $('#consignList');
    node.innerHTML = renderConsignment(result.data) + node.innerHTML;
    toast('Consignation retrouvée.');
  } catch (error) { toast(error.message); }
});

// ------------------------------------------------------------------ boutiques
async function loadStores() {
  const list = $('#storesList'); list.innerHTML = '<p class="empty">Chargement…</p>';
  try {
    const result = await api('/api/client/stores');
    const stores = result.data || [];
    if (!stores.length) { list.innerHTML = '<p class="empty">Aucune boutique visitée pour l’instant.</p>'; return; }
    list.innerHTML = stores.map((store) => `<article class="order">
      <div class="order-head"><div><div class="order-ref">${esc(store.name)}</div>
      <div class="order-store">Dernière visite : ${esc(fmtDate(store.lastSeenAt))}</div></div></div>
      <div class="order-actions"><a class="btn ghost" href="/shop/${encodeURIComponent(store.slug)}">Ouvrir la boutique</a></div>
    </article>`).join('');
  } catch (error) { list.innerHTML = `<p class="message">${esc(error.message)}</p>`; }
}

// ------------------------------------------------------------------ compte
async function loadProfile() {
  try {
    const me = await api('/api/client/auth/me');
    const client = me.data.client;
    $('#phoneShown').textContent = client.phoneLast4 ? `•••• ••${client.phoneLast4}` : '—';
    $('#displayName').value = client.displayName || '';
    $('#notifyOrders').checked = client.notifyOrders !== false;
    $('#notifyConsignments').checked = client.notifyConsignments !== false;
    const notifs = await api('/api/client/notifications');
    const list = $('#notifList');
    list.innerHTML = (notifs.data || []).length
      ? notifs.data.map((n) => `<div class="order"><div class="order-ref">${esc(n.title)}</div><div class="order-store">${esc(fmtDate(n.createdAt))}</div><p style="margin:6px 0 0">${esc(n.message)}</p></div>`).join('')
      : '<p class="empty">Aucune notification.</p>';
    api('/api/client/notifications/read', { method: 'POST', body: '{}' }).catch(() => {});
  } catch (error) { toast(error.message); }
}

$('#profileForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = $('#profileMessage');
  try {
    await api('/api/client/profile', { method: 'PUT', body: JSON.stringify({
      displayName: $('#displayName').value, notifyOrders: $('#notifyOrders').checked, notifyConsignments: $('#notifyConsignments').checked }) });
    message.className = 'message success'; message.textContent = 'Informations enregistrées.'; message.hidden = false;
  } catch (error) { message.className = 'message'; message.textContent = error.message; message.hidden = false; }
});

// ------------------------------------------------------------------ notifications temps réel
function connectEvents() {
  try {
    const source = new EventSource('/api/client/events');
    source.addEventListener('message', (event) => {
      let payload = null; try { payload = JSON.parse(event.data); } catch (_) { return; }
      if (payload?.type === 'client_notification') {
        toast(payload.notification.title);
        if (state.view === 'commandes') loadOrders();
        if (state.view === 'consignations') loadConsignments();
      }
    });
    source.addEventListener('error', () => { /* reconnexion automatique gérée par le navigateur */ });
  } catch (_) {}
}

// ------------------------------------------------------------------ scan
function extractSlug(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const shop = url.pathname.match(/\/shop\/([^/?#]+)/);
      if (shop) return decodeURIComponent(shop[1]);
      const code = url.pathname.match(/\/r\/([^/?#]+)/);
      if (code) return `code:${decodeURIComponent(code[1])}`;
      return url.hostname;
    } catch (_) { return ''; }
  }
  if (raw.startsWith('code:')) return raw;
  return raw.replace(/^@/, '').replace(/^.*\/shop\//, '');
}

async function openScanned(raw) {
  const slug = extractSlug(raw);
  if (!slug) { toast('Lien non reconnu.'); return; }
  // Le scan est compté comme un scan CLIENT, jamais comme une opération du personnel.
  try {
    await fetch('/api/client/scan', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: raw }) });
  } catch (_) {}
  if (slug.startsWith('code:')) window.location.assign(`/r/${encodeURIComponent(slug.slice(5))}`);
  else window.location.assign(`/shop/${encodeURIComponent(slug)}`);
}

$('#scanManualGo').addEventListener('click', () => openScanned($('#scanManual').value));

$('#scanStart').addEventListener('click', async () => {
  const status = $('#scanStatus');
  try {
    if (!('BarcodeDetector' in window)) {
      status.hidden = false; status.className = 'message';
      status.textContent = 'Ce navigateur ne sait pas lire les QR codes en direct. Saisissez le lien affiché sous le QR code.';
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    state.scanStream = stream;
    const video = $('#scanVideo'); video.srcObject = stream; video.hidden = false; await video.play();
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    status.hidden = false; status.className = 'message success'; status.textContent = 'Présentez le QR code dans le cadre.';
    const tick = async () => {
      if (!state.scanStream) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length) {
          stopScan();
          await openScanned(codes[0].rawValue);
          return;
        }
      } catch (_) {}
      state.scanTimer = setTimeout(tick, 350);
    };
    tick();
  } catch (error) {
    status.hidden = false; status.className = 'message';
    status.textContent = 'Caméra indisponible ou refusée. Saisissez le lien affiché sous le QR code.';
  }
});
function stopScan() {
  clearTimeout(state.scanTimer); state.scanTimer = 0;
  if (state.scanStream) { for (const track of state.scanStream.getTracks()) track.stop(); state.scanStream = null; }
  const video = $('#scanVideo'); video.srcObject = null; video.hidden = true;
}

// ------------------------------------------------------------------ installation (PWA)
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault(); state.deferredPrompt = event; $('#installBtn').hidden = false;
});
$('#installBtn').addEventListener('click', async () => {
  if (!state.deferredPrompt) { toast('Utilisez le menu du navigateur → « Installer l’application ».'); return; }
  state.deferredPrompt.prompt();
  const choice = await state.deferredPrompt.userChoice.catch(() => null);
  state.deferredPrompt = null; $('#installBtn').hidden = true;
  if (choice?.outcome === 'accepted') toast('Application installée.');
});
window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; toast('Merci ! L’application est installée.'); });

// iPhone : pas de bannière d'installation automatique, on explique le geste exact.
if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches) {
  const hint = document.createElement('p');
  hint.className = 'ios-hint';
  hint.textContent = 'Sur iPhone : appuyez sur Partager (carré avec une flèche), puis « Sur l’écran d’accueil ».';
  $('.hero')?.appendChild(hint);
}

// ------------------------------------------------------------------ démarrage
(async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => {});
  }
  try {
    const me = await api('/api/client/auth/me');
    state.client = me.data.client;
    await startSession();
  } catch (_) { showView('auth'); }
  const params = new URLSearchParams(window.location.search);
  const wanted = params.get('vue');
  if (wanted && $('#view-app').hidden === false) switchPanel(['commandes', 'consignations', 'scan', 'boutiques', 'compte'].includes(wanted) ? wanted : 'commandes');
})();
