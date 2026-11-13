(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...document.querySelectorAll(selector)];
  const state = { slug: decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || ''), store: null, products: [], cart: new Map(), toastTimer: 0, orderDraft: null, orderPending: false, submitting: false };
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (value) => `${new Intl.NumberFormat('fr-FR').format(Number(value) || 0)} XOF`;
  function showError(message) { $('#shopLoading').hidden = true; $('#shopContent').hidden = true; $('#shopError').hidden = false; $('#shopErrorText').textContent = message; }
  function toast(message) { const node = $('#shopToast'); node.textContent = message; node.classList.add('visible'); clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => node.classList.remove('visible'), 3000); }
  function storageKey() { return `oymike-shop-cart:${state.slug}`; }
  function restoreCart() {
    try { const saved = JSON.parse(sessionStorage.getItem(storageKey()) || '[]'); if (Array.isArray(saved)) state.cart = new Map(saved.filter((row) => row && typeof row.id === 'string').map((row) => [row.id, Math.min(999, Math.max(1, Number(row.quantity) || 1))])); } catch (_) {}
  }
  function saveCart() { try { sessionStorage.setItem(storageKey(), JSON.stringify([...state.cart].map(([id, quantity]) => ({ id, quantity })))); } catch (_) {} }
  function orderDraftKey() { return `oymike-shop-order:${state.slug}`; }
  function restoreOrderDraft() {
    try {
      const draft = JSON.parse(sessionStorage.getItem(orderDraftKey()) || 'null');
      if (!draft || typeof draft.requestId !== 'string' || typeof draft.fingerprint !== 'string') return false;
      state.orderDraft = draft;
      if (!draft.body || JSON.stringify(draft.body) !== draft.fingerprint || !Array.isArray(draft.body.items)) return false;
      const body = draft.body;
      $('#customerName').value = body.customerName || ''; $('#customerPhone').value = body.customerPhone || '';
      $('#customerEmail').value = body.customerEmail || ''; $('#deliveryAddress').value = body.deliveryAddress || ''; $('#customerNote').value = body.note || '';
      state.cart = new Map(body.items.filter((row) => row && typeof row.productId === 'string').map((row) => [row.productId, Math.min(999, Math.max(1, Number(row.quantity) || 1))]));
      saveCart(); state.orderPending = true; return true;
    } catch (_) { return false; }
  }
  function saveOrderDraft(body) {
    const fingerprint = JSON.stringify(body); let previous = state.orderDraft;
    try { previous = JSON.parse(sessionStorage.getItem(orderDraftKey()) || 'null') || previous; } catch (_) {}
    const requestId = previous?.fingerprint === fingerprint && previous.requestId ? previous.requestId
      : (crypto.randomUUID ? crypto.randomUUID() : `order_${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`);
    state.orderDraft = { fingerprint, requestId, body: JSON.parse(fingerprint) };
    try { sessionStorage.setItem(orderDraftKey(), JSON.stringify(state.orderDraft)); } catch (_) {}
    return state.orderDraft;
  }
  function clearOrderDraft() { state.orderDraft = null; try { sessionStorage.removeItem(orderDraftKey()); } catch (_) {} }
  function updateCheckoutControls() {
    const locked = state.orderPending;
    $$('#checkoutForm input, #checkoutForm textarea').forEach((node) => { node.disabled = locked; });
    $('#clearCart').disabled = locked;
    $$('#productsGrid button[data-add], #cartLines button').forEach((button) => { button.disabled = locked; });
    const button = $('#placeOrder'); button.disabled = state.submitting;
    button.textContent = state.submitting ? 'Envoi en cours…' : locked ? 'Réessayer cette commande' : 'Envoyer ma commande';
  }
  async function loadShop() {
    try {
      const response = await fetch(`/api/public/shops/${encodeURIComponent(state.slug)}`, { cache: 'no-store' }); const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.data) throw new Error(result.error || 'Cette boutique n’est pas disponible.');
      state.store = result.data.store; state.products = result.data.products || []; restoreCart(); const pending = restoreOrderDraft();
      const store = state.store; $('#shopName').textContent = store.name; $('#shopDescription').textContent = store.description || '';
      const logo = $('#shopLogo'); const fallback = $('#shopLogoFallback');
      if (store.logo) { logo.src = store.logo; logo.hidden = false; fallback.hidden = true; } else { logo.hidden = true; fallback.hidden = false; }
      const contacts = [];
      if (store.phone) contacts.push(`<a href="tel:${esc(store.phone)}">Téléphone : ${esc(store.phone)}</a>`);
      if (store.whatsapp) contacts.push(`<a href="https://wa.me/${esc(store.whatsapp.replace(/\D/g,''))}" target="_blank" rel="noopener">WhatsApp : ${esc(store.whatsapp)}</a>`);
      if (store.address) contacts.push(`<span>${esc(store.address)}</span>`);
      if (store.deliveryNote) contacts.push(`<span>${esc(store.deliveryNote)}</span>`);
      $('#shopContact').innerHTML = contacts.join(''); document.title = `${store.name} — Oymike Tech`;
      $('#shopLoading').hidden = true; $('#shopError').hidden = true; $('#shopContent').hidden = false;
      renderProducts(); renderCart(); updateCheckoutControls();
      if (pending) { const error = $('#checkoutError'); error.textContent = 'Une tentative précédente n’a pas reçu de confirmation. Vos informations sont restaurées; réessayez pour vérifier ou reprendre la même commande.'; error.hidden = false; }
    } catch (error) { showError(error.message || 'Impossible de charger cette boutique.'); }
  }
  function renderProducts(filter = '') {
    const grid = $('#productsGrid'); const query = filter.trim().toLocaleLowerCase('fr');
    const products = state.products.filter((p) => [p.name, p.description, p.sku].join(' ').toLocaleLowerCase('fr').includes(query));
    $('#catalogueCount').textContent = `${products.length} produit${products.length === 1 ? '' : 's'}${state.store?.deliveryNote ? ' · voir les modalités de remise ci-dessus' : ''}`;
    if (!products.length) { grid.innerHTML = '<p class="empty">Aucun produit ne correspond à cette recherche.</p>'; return; }
    grid.innerHTML = products.map((p) => {
      const available = p.available !== false; const quantity = state.cart.get(p.id) || 0;
      return `<article class="public-product"><div class="public-product-image">${p.imageData ? `<img src="${esc(p.imageData)}" alt="${esc(p.name)}" loading="lazy">` : 'PHOTO'}</div><div class="public-product-content"><h3>${esc(p.name)}</h3><p>${esc(p.description || '')}</p><div class="public-product-bottom"><strong>${money(p.priceXof)}</strong>${available ? `<button class="button primary" type="button" data-add="${esc(p.id)}" ${state.orderPending ? 'disabled' : ''}>${quantity ? `Ajouter · ${quantity} au panier` : 'Ajouter au panier'}</button>` : '<span class="out-of-stock">Indisponible pour le moment</span>'}</div></div></article>`;
    }).join('');
    $$('[data-add]', grid).forEach((button) => button.addEventListener('click', () => changeQuantity(button.dataset.add, (state.cart.get(button.dataset.add) || 0) + 1)));
  }
  function changeQuantity(id, quantity) {
    const product = state.products.find((p) => p.id === id); if (state.orderPending || !product || product.available === false) return;
    if (quantity <= 0) state.cart.delete(id); else state.cart.set(id, Math.min(999, quantity));
    saveCart(); renderProducts($('#productSearch').value); renderCart();
  }
  function renderCart() {
    const root = $('#cartLines'); const lines = [...state.cart.entries()].map(([id, quantity]) => ({ product: state.products.find((p) => p.id === id), quantity })).filter((row) => row.product);
    const count = lines.reduce((sum, row) => sum + row.quantity, 0); $('#cartCount').textContent = String(count);
    if (!lines.length) { root.innerHTML = '<p class="empty">Votre panier est vide.</p>'; $('#cartTotal').textContent = money(0); return; }
    root.innerHTML = lines.map(({ product, quantity }) => `<div class="cart-line"><div><strong>${esc(product.name)}</strong><small>${money(product.priceXof)} · ${money(Number(product.priceXof) * quantity)}</small></div><div class="cart-qty"><button type="button" aria-label="Retirer une unité" data-minus="${esc(product.id)}">−</button><span>${quantity}</span><button type="button" aria-label="Ajouter une unité" data-plus="${esc(product.id)}">+</button></div></div>`).join('');
    $$('[data-minus]', root).forEach((button) => button.addEventListener('click', () => changeQuantity(button.dataset.minus, (state.cart.get(button.dataset.minus) || 0) - 1)));
    $$('[data-plus]', root).forEach((button) => button.addEventListener('click', () => changeQuantity(button.dataset.plus, (state.cart.get(button.dataset.plus) || 0) + 1)));
    $$('#cartLines button').forEach((button) => { button.disabled = state.orderPending; }); $('#clearCart').disabled = state.orderPending;
    const total = lines.reduce((sum, row) => sum + Number(row.product.priceXof) * row.quantity, 0); $('#cartTotal').textContent = money(total);
  }
  $('#checkoutForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const error = $('#checkoutError'); error.hidden = true;
    let body;
    if (state.orderPending && state.orderDraft?.body) {
      body = { ...state.orderDraft.body, items: state.orderDraft.body.items.map((item) => ({ ...item })) };
      body.clientRequestId = state.orderDraft.requestId;
    } else {
      if (!state.cart.size) { error.textContent = 'Ajoutez au moins un produit au panier.'; error.hidden = false; return; }
      const intent = { customerName: $('#customerName').value.trim(), customerPhone: $('#customerPhone').value.trim(), customerEmail: $('#customerEmail').value.trim(),
        deliveryAddress: $('#deliveryAddress').value.trim(), note: $('#customerNote').value.trim(), items: [...state.cart].map(([productId, quantity]) => ({ productId, quantity })) };
      const draft = saveOrderDraft(intent); body = { ...draft.body, clientRequestId: draft.requestId };
    }
    state.orderPending = true; state.submitting = true; updateCheckoutControls();
    let response = null;
    try {
      response = await fetch(`/api/public/shops/${encodeURIComponent(state.slug)}/orders`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { const failure = new Error(result.error || `Erreur ${response.status}`); failure.status = response.status; throw failure; }
      if (!result?.data?.order?.reference || !result?.data?.trackingToken) throw new Error('La réponse de suivi est incomplète.');
      state.cart.clear(); saveCart(); clearOrderDraft(); state.orderPending = false;
      const order = result.data.order; const target = `/order/${encodeURIComponent(order.reference)}?token=${encodeURIComponent(result.data.trackingToken)}`;
      location.assign(target);
    } catch (err) {
      const ambiguous = !response || response.status >= 500 || response.status === 409 || !err.status;
      if (ambiguous) {
        state.orderPending = true;
        error.textContent = `${err.message} Une commande a peut-être déjà été reçue. Vos informations sont conservées; réessayez avec le même contenu pour retrouver la même commande.`;
      } else {
        clearOrderDraft(); state.orderPending = false;
        error.textContent = `${err.message} Le serveur a refusé cette tentative; votre panier est conservé. Vous pouvez corriger puis réessayer.`;
      }
      error.hidden = false;
    } finally { state.submitting = false; updateCheckoutControls(); }
  });
  $('#clearCart').addEventListener('click', () => { if (state.orderPending) return; state.cart.clear(); saveCart(); renderProducts($('#productSearch').value); renderCart(); });
  $('#productSearch').addEventListener('input', () => renderProducts($('#productSearch').value));
  $('#cartJump').addEventListener('click', () => { if (window.innerWidth <= 720) $('#checkout').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  loadShop();
})();
