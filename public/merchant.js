(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { merchant: null, store: null, products: [], orders: [], activeTab: 'store', toastTimer: 0, searchTimer: 0, eventSource: null };
  const loginView = $('#loginView'); const passwordView = $('#passwordView'); const appView = $('#appView');
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (value) => `${new Intl.NumberFormat('fr-FR').format(Number(value) || 0)} XOF`;
  const dateTime = (value) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(d); };
  const statusLabels = { pending: 'À confirmer', confirmed: 'Confirmée', preparing: 'En préparation', ready: 'Prête', completed: 'Terminée', cancelled: 'Annulée' };
  const transitions = { pending: [['confirmed', 'Confirmer'], ['cancelled', 'Annuler']], confirmed: [['preparing', 'Préparer'], ['cancelled', 'Annuler']], preparing: [['ready', 'Marquer prête'], ['cancelled', 'Annuler']], ready: [['completed', 'Terminer'], ['cancelled', 'Annuler']], completed: [], cancelled: [] };

  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) { if (data.code === 'TEMP_PASSWORD_EXPIRED') showLogin(data.error); else showLogin(data.error || 'Votre session a expiré. Reconnectez-vous.'); throw new Error(data.error || 'Session expirée.'); }
    if (response.status === 403 && data.code === 'PASSWORD_CHANGE_REQUIRED') { showPasswordGate(); throw new Error(data.error); }
    if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
    return data;
  }
  function toast(message) { const node = $('#toast'); node.textContent = message; node.classList.add('visible'); clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => node.classList.remove('visible'), 3200); }
  function showLogin(message = '') { closeEvents(); loginView.hidden = false; passwordView.hidden = true; appView.hidden = true; $('#loginPassword').value = ''; const error = $('#loginError'); error.textContent = message; error.hidden = !message; }
  function showPasswordGate() { loginView.hidden = true; passwordView.hidden = false; appView.hidden = true; $('#newPassword').value = ''; $('#confirmPassword').value = ''; $('#passwordError').hidden = true; }
  function showApp(merchant) {
    state.merchant = merchant; loginView.hidden = true; passwordView.hidden = true; appView.hidden = false;
    $('#merchantName').textContent = merchant.displayName || 'Marchand'; $('#merchantUsername').textContent = `@${merchant.username || ''}`;
  }
  function setNotice(message, visible = true) { const node = $('#notice'); node.textContent = message; node.hidden = !visible; }
  function tab(name) {
    state.activeTab = name;
    $$('.tab').forEach((node) => node.classList.toggle('active', node.dataset.tab === name));
    $$('.tab-panel').forEach((node) => { node.hidden = node.id !== `panel-${name}`; });
    if (name === 'products') loadProducts().catch((e) => toast(e.message));
    if (name === 'orders') loadOrders().catch((e) => toast(e.message));
  }
  function attachProductPhoto(source) {
    const image = $('#productImagePreview'); const fallback = $('#productImageFallback');
    $('#productImageData').value = source || '';
    if (source) { image.src = source; image.hidden = false; fallback.hidden = true; }
    else { image.removeAttribute('src'); image.hidden = true; fallback.hidden = false; }
  }
  function attachStoreLogo(source) {
    const image = $('#storeLogoPreview'); const fallback = $('#storeLogoFallback');
    $('#storeLogoData').value = source || '';
    if (source) { image.src = source; image.hidden = false; fallback.hidden = true; }
    else { image.removeAttribute('src'); image.hidden = true; fallback.hidden = false; }
  }
  function readFile(file, target) {
    if (!file) return;
    const maxBytes = 345 * 1024;
    const imagePromise = typeof createImageBitmap === 'function' ? createImageBitmap(file) : new Promise((resolve, reject) => {
      const image = new Image(); const url = URL.createObjectURL(file); image.onload = () => { URL.revokeObjectURL(url); resolve(image); }; image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Impossible de lire ce fichier image.')); }; image.src = url;
    });
    imagePromise.then(async (image) => {
      let width = image.width; let height = image.height; const maxEdge = 1400;
      if (Math.max(width, height) > maxEdge) { const scale = maxEdge / Math.max(width, height); width = Math.round(width * scale); height = Math.round(height * scale); }
      const canvas = document.createElement('canvas'); const context = canvas.getContext('2d');
      let encoded = '';
      for (let attempt = 0; attempt < 8; attempt++) {
        canvas.width = width; canvas.height = height;
        context.clearRect(0, 0, width, height); context.drawImage(image, 0, 0, width, height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', Math.max(.42, .86 - attempt * .07)));
        if (!blob) throw new Error('Ce navigateur n’a pas pu compresser l’image.');
        if (blob.size <= maxBytes) { encoded = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); }); break; }
        width = Math.max(220, Math.round(width * .82)); height = Math.max(220, Math.round(height * .82));
      }
      if (!encoded) throw new Error('L’image reste trop volumineuse après compression. Choisissez une image plus petite.');
      target(encoded);
      // The image is imported in place: no form replacement, focus reset, or scroll adjustment occurs here.
      if (typeof image.close === 'function') image.close();
    }).catch((error) => toast(error.message || 'Impossible de traiter cette image.'));
  }

  function fillStore(store) {
    state.store = store || null;
    $('#storeName').value = store?.name || '';
    $('#storeDescription').value = store?.description || '';
    $('#storePhone').value = store?.phone || '';
    $('#storeWhatsApp').value = store?.whatsapp || '';
    $('#storeEmail').value = store?.email || '';
    $('#storeAddress').value = store?.address || '';
    $('#deliveryNote').value = store?.deliveryNote || '';
    $('#storeSlug').value = store?.slug || '';
    $('#storeSlug').disabled = Boolean(store);
    $('#storePublished').checked = Boolean(store?.isPublished);
    attachStoreLogo(store?.logo || '');
    const statePill = $('#publishState'); statePill.textContent = store ? (store.isPublished ? 'Catalogue publié' : 'Brouillon privé') : 'Boutique à créer'; statePill.classList.toggle('published', Boolean(store?.isPublished));
    if (store) {
      $('#storeSlug').placeholder = store.slug;
      const link = `/shop/${encodeURIComponent(store.slug)}`; const publicLink = $('#publicShopLink'); publicLink.href = link; publicLink.hidden = false;
    } else $('#publicShopLink').hidden = true;
    const storeSection = $('#panel-store');
    storeSection.classList.toggle('store-exists', Boolean(store));
    updateQrLink().catch(() => {});
  }
  async function loadStore() {
    const result = await api('/api/merchant/store'); fillStore(result.data || null);
    $('#productForm').hidden = !result.data;
    if (result.data) await Promise.all([loadProducts(), loadStats()]); else { renderProducts([]); $('#metricProducts').textContent = '0'; }
  }
  function storePayload() {
    return { name: $('#storeName').value.trim(), slug: $('#storeSlug').value.trim(), description: $('#storeDescription').value.trim(),
      phone: $('#storePhone').value.trim(), whatsapp: $('#storeWhatsApp').value.trim(), email: $('#storeEmail').value.trim(), address: $('#storeAddress').value.trim(),
      deliveryNote: $('#deliveryNote').value.trim(), logo: $('#storeLogoData').value, isPublished: $('#storePublished').checked };
  }
  $('#storeForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const button = $('button[type="submit"]', event.currentTarget); button.disabled = true; $('#storeSaveState').textContent = 'Enregistrement…';
    try { const result = await api('/api/merchant/store', { method: 'PUT', body: JSON.stringify(storePayload()) }); fillStore(result.data); $('#storeSaveState').textContent = 'Enregistré'; toast('Les informations de la boutique ont été enregistrées.'); await loadStats(); }
    catch (error) { $('#storeSaveState').textContent = ''; toast(error.message); }
    finally { button.disabled = false; }
  });

  async function loadQr() {
    const result = await api('/api/merchant/qr'); const data = result.data; const message = $('#qrMessage');
    if (!data?.path) { message.textContent = 'Le QR de boutique n’a pas encore été créé par le PDG ou un gestionnaire autorisé.'; $('#qrPublicLink').hidden = true; $('#qrImageWrap').hidden = true; return; }
    const url = data.url?.startsWith('http') ? data.url : `${window.location.origin}${data.path}`;
    message.textContent = 'Ce lien mène au catalogue de la boutique. Le contenu commercial est chargé depuis vos informations et produits actuels.';
    const link = $('#qrPublicLink'); link.href = url; link.textContent = url; link.hidden = false;
    try { const qr = qrcode(0, 'M'); qr.addData(url); qr.make(); const size = 220; const moduleCount = qr.getModuleCount(); const ctx = $('#storeQrCanvas').getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,size,size); ctx.fillStyle = '#14251f'; const margin = 4; const cell = size/(moduleCount+margin*2); for(let r=0;r<moduleCount;r++) for(let c=0;c<moduleCount;c++) if(qr.isDark(r,c)) ctx.fillRect((c+margin)*cell,(r+margin)*cell,Math.ceil(cell),Math.ceil(cell)); $('#qrImageWrap').hidden = false; }
    catch (_) { $('#qrImageWrap').hidden = true; }
  }
  async function updateQrLink() { await loadQr(); }

  function productPayload() { return { name: $('#productName').value.trim(), sku: $('#productSku').value.trim(), priceXof: Number($('#productPrice').value), stockQuantity: Number($('#productStock').value || 0),
    description: $('#productDescription').value.trim(), imageData: $('#productImageData').value, trackStock: $('#productTrackStock').checked, status: $('#productActive').checked ? 'active' : 'unavailable' }; }
  async function loadProducts() {
    if (!state.store) return renderProducts([]);
    const result = await api('/api/merchant/products'); state.products = result.data || []; renderProducts(state.products); $('#productForm').hidden = false; $('#metricProducts').textContent = String(state.products.filter((p) => p.status !== 'archived').length);
  }
  function renderProducts(products) {
    const list = $('#productList');
    if (!products.length) { list.innerHTML = '<p class="empty">Aucun produit. Ajoutez un article pour démarrer votre catalogue.</p>'; return; }
    list.innerHTML = products.map((p) => `<article class="product-card" data-product="${esc(p.id)}"><div class="product-thumb">${p.imageData ? `<img src="${esc(p.imageData)}" alt="">` : 'PHOTO'}</div><div class="product-info"><strong>${esc(p.name)}</strong><p>${esc(p.description || 'Aucune description.')}</p><div class="product-meta"><span class="tag">${money(p.priceXof)}</span>${p.sku ? `<span class="tag">Réf. ${esc(p.sku)}</span>` : ''}<span class="tag ${p.available ? 'good' : 'low'}">${p.status === 'unavailable' ? 'Indisponible' : p.trackStock ? `${Number(p.stockQuantity)} en stock` : 'Stock non suivi'}</span></div></div><div class="product-actions"><button type="button" data-edit-product="${esc(p.id)}">Modifier</button><button class="danger" type="button" data-archive-product="${esc(p.id)}">Archiver</button></div></article>`).join('');
    $$('[data-edit-product]', list).forEach((button) => button.addEventListener('click', () => editProduct(button.dataset.editProduct)));
    $$('[data-archive-product]', list).forEach((button) => button.addEventListener('click', () => archiveProduct(button.dataset.archiveProduct)));
  }
  function clearProductForm() {
    $('#productForm').reset(); $('#productId').value = ''; $('#productStock').value = '0'; $('#productFormTitle').textContent = 'Ajouter un produit'; $('#productActive').checked = true; $('#productTrackStock').checked = true; attachProductPhoto(''); $('#productImageFile').value = '';
  }
  function editProduct(id) {
    const product = state.products.find((p) => p.id === id); if (!product) return;
    $('#productForm').hidden = false; $('#productId').value = product.id; $('#productName').value = product.name; $('#productSku').value = product.sku || ''; $('#productPrice').value = product.priceXof;
    $('#productStock').value = product.stockQuantity; $('#productDescription').value = product.description || ''; $('#productTrackStock').checked = product.trackStock !== false;
    $('#productActive').checked = product.status === 'active'; $('#productFormTitle').textContent = `Modifier « ${product.name} »`; attachProductPhoto(product.imageData || '');
    tab('products'); $('#productName').focus({ preventScroll: true });
  }
  $('#productForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget; const id = $('#productId').value; const button = $('button[type="submit"]', form); button.disabled = true;
    try { await api(id ? `/api/merchant/products/${encodeURIComponent(id)}` : '/api/merchant/products', { method: id ? 'PUT' : 'POST', body: JSON.stringify(productPayload()) });
      clearProductForm(); await Promise.all([loadProducts(), loadStats()]); toast(id ? 'Produit mis à jour.' : 'Produit ajouté au catalogue.'); }
    catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  });
  async function archiveProduct(id) {
    const product = state.products.find((p) => p.id === id); if (!product || !window.confirm(`Archiver « ${product.name} » ? Il ne sera plus commandable, mais restera dans l’historique.`)) return;
    try { await api(`/api/merchant/products/${encodeURIComponent(id)}`, { method: 'DELETE' }); await Promise.all([loadProducts(), loadStats()]); toast('Produit archivé.'); }
    catch (error) { toast(error.message); }
  }

  async function loadOrders() {
    const params = new URLSearchParams({ page: '1', limit: '50', search: $('#orderSearch').value.trim(), status: $('#orderStatusFilter').value });
    const result = await api(`/api/merchant/orders?${params}`); state.orders = result.data || []; renderOrders(state.orders);
    const pending = Number(state.orders.filter((o) => o.status === 'pending').length); const badge = $('#orderBadge'); badge.textContent = String(pending); badge.hidden = pending === 0; $('#metricPending').textContent = `${pending} en attente`;
  }
  function renderOrders(orders) {
    const list = $('#orderList');
    if (!orders.length) { list.innerHTML = '<p class="empty">Aucune commande dans ce filtre.</p>'; return; }
    list.innerHTML = orders.map((order) => `<article class="order-card"><header class="order-head"><div><strong>${esc(order.reference)}</strong><small>Reçue le ${esc(dateTime(order.createdAt))}</small></div><span class="order-status ${esc(order.status)}">${esc(statusLabels[order.status] || order.status)}</span></header><div class="order-body"><div class="order-customer"><span><strong>Client :</strong> ${esc(order.customerName)}</span><span><strong>Téléphone :</strong> <a href="tel:${esc(order.customerPhone)}">${esc(order.customerPhone)}</a></span>${order.customerEmail ? `<span><strong>E-mail :</strong> ${esc(order.customerEmail)}</span>` : ''}<span><strong>Remise :</strong> ${esc(order.deliveryAddress)}</span>${order.note ? `<span><strong>Note :</strong> ${esc(order.note)}</span>` : ''}</div><ul class="order-items">${order.items.map((item) => `<li><span>${esc(item.name)} × ${item.quantity}</span><strong>${money(Number(item.unitPriceXof) * Number(item.quantity))}</strong></li>`).join('')}</ul><div class="order-total"><span>Total de la commande · ${order.currency}</span><span>${money(order.totalAmountXof)}</span></div></div><footer class="order-foot"><small class="muted">Aucun paiement en ligne n’a été enregistré.</small><div class="order-actions">${(transitions[order.status] || []).map(([next, label]) => `<button class="button ${next === 'cancelled' ? 'quiet' : 'primary'}" type="button" data-order-id="${esc(order.id)}" data-next-status="${next}">${label}</button>`).join('')}</div></footer></article>`).join('');
    $$('[data-next-status]', list).forEach((button) => button.addEventListener('click', () => setOrderStatus(button.dataset.orderId, button.dataset.nextStatus)));
  }
  async function setOrderStatus(id, status) {
    const order = state.orders.find((item) => item.id === id); if (!order) return;
    const action = statusLabels[status] || status; if (!window.confirm(`${action} la commande ${order.reference} ?`)) return;
    try { await api(`/api/merchant/orders/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify({ status }) }); await Promise.all([loadOrders(), loadStats()]); toast(`Commande ${order.reference} mise à jour : ${statusLabels[status]}.`); }
    catch (error) { toast(error.message); }
  }
  async function loadStats() {
    const result = await api('/api/merchant/stats'); const stats = result.data || {};
    $('#metricProducts').textContent = new Intl.NumberFormat('fr-FR').format(stats.products || 0);
    $('#metricOrders').textContent = new Intl.NumberFormat('fr-FR').format(stats.orders || 0);
    $('#metricPending').textContent = `${new Intl.NumberFormat('fr-FR').format(stats.pendingOrders || 0)} en attente`;
    $('#metricOrderValue').textContent = money(stats.orderValueXof || 0); $('#metricScans').textContent = new Intl.NumberFormat('fr-FR').format(stats.qrScans || 0);
  }
  function closeEvents() { if (state.eventSource) { state.eventSource.close(); state.eventSource = null; } }
  function connectEvents() {
    closeEvents(); state.eventSource = new EventSource('/api/merchant/events');
    state.eventSource.addEventListener('commerce', (event) => {
      let data = {}; try { data = JSON.parse(event.data); } catch (_) {}
      if (data.type === 'new_order') toast(`Nouvelle commande reçue${data.reference ? ` : ${data.reference}` : ''}.`);
      Promise.all([loadStats(), state.activeTab === 'orders' ? loadOrders() : Promise.resolve()]).catch(() => {});
    });
    state.eventSource.onerror = () => { /* EventSource retries automatically; the periodic refresh is the offline fallback. */ };
  }
  async function loadAppData(merchant) {
    showApp(merchant); await loadStore(); connectEvents();
    if (!state.pollTimer) state.pollTimer = setInterval(() => {
      loadStats().catch(() => {});
      if (state.activeTab === 'orders') loadOrders().catch(() => {});
    }, 20_000);
  }
  async function boot() {
    try { const result = await api('/api/merchant/auth/me'); const merchant = result.data; if (merchant.mustChangePassword) showPasswordGate(); else await loadAppData(merchant); }
    catch (_) { showLogin(); }
  }

  $('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const button = $('button[type="submit"]', event.currentTarget); button.disabled = true;
    const error = $('#loginError'); error.hidden = true;
    try { const response = await api('/api/merchant/auth/login', { method: 'POST', body: JSON.stringify({ username: $('#loginUsername').value.trim(), password: $('#loginPassword').value }) });
      if (response.data?.mustChangePassword) showPasswordGate(); else await loadAppData(response.data); }
    catch (e) { error.textContent = e.message; error.hidden = false; }
    finally { button.disabled = false; }
  });
  $('#passwordForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const password = $('#newPassword').value; const confirmPassword = $('#confirmPassword').value; const message = $('#passwordError');
    if (password.length < 12 || password !== confirmPassword) { message.textContent = password !== confirmPassword ? 'Les deux mots de passe ne correspondent pas.' : 'Le mot de passe doit contenir au moins 12 caractères.'; message.hidden = false; return; }
    const button = $('button[type="submit"]', event.currentTarget); button.disabled = true;
    try { const result = await api('/api/merchant/auth/change-password', { method: 'POST', body: JSON.stringify({ password, confirmPassword }) }); await loadAppData(result.data); }
    catch (error) { message.textContent = error.message; message.hidden = false; }
    finally { button.disabled = false; }
  });
  async function logout() { try { await api('/api/merchant/auth/logout', { method: 'POST', body: '{}' }); } catch (_) {} closeEvents(); showLogin(); }
  $('#logoutButton').addEventListener('click', logout); $('#passwordLogout').addEventListener('click', logout);
  $$('.tab').forEach((button) => button.addEventListener('click', () => tab(button.dataset.tab)));
  $('#newProductButton').addEventListener('click', () => { clearProductForm(); $('#productForm').hidden = false; $('#productName').focus({ preventScroll: true }); });
  $('#cancelProductEdit').addEventListener('click', clearProductForm);
  $('#refreshOrders').addEventListener('click', () => loadOrders().catch((e) => toast(e.message)));
  $('#orderStatusFilter').addEventListener('change', () => loadOrders().catch((e) => toast(e.message)));
  $('#orderSearch').addEventListener('input', () => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(() => loadOrders().catch((e) => toast(e.message)), 250); });
  $('#storeLogoFile').addEventListener('change', (event) => readFile(event.target.files?.[0], attachStoreLogo));
  $('#productImageFile').addEventListener('change', (event) => readFile(event.target.files?.[0], attachProductPhoto));
  $('#removeStoreLogo').addEventListener('click', () => { attachStoreLogo(''); $('#storeLogoFile').value = ''; });
  $('#removeProductImage').addEventListener('click', () => { attachProductPhoto(''); $('#productImageFile').value = ''; });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !appView.hidden) { loadStats().catch(() => {}); if (state.activeTab === 'orders') loadOrders().catch(() => {}); } });
  boot();
})();
