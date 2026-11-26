'use strict';

// ============================================================================================
// Espace équipe : gérant général et serveuse.
//
// Principe : l'interface ne décide RIEN. Elle affiche ce que le serveur autorise et masque le
// reste, mais chaque action est de toute façon revérifiée côté serveur (403 = permission refusée).
// ============================================================================================
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = {
    session: null, shop: null, settings: null, tab: 'home', cart: [], products: [], points: [], tasks: [],
    mineOnly: false, toastTimer: 0, camera: null, lastScan: null, teamPoints: [],
  };
  const loginView = $('#loginView'); const activationView = $('#activationView'); const appView = $('#appView');
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (value) => `${new Intl.NumberFormat('fr-FR').format(Number(value) || 0)} XOF`;
  const dateTime = (value) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(d); };
  const dateOnly = (value) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(d); };
  const statusLabels = { pending: 'À confirmer', confirmed: 'Confirmée', preparing: 'En préparation', ready: 'Prête', out_for_delivery: 'En livraison', completed: 'Terminée', cancelled: 'Annulée', rejected: 'Refusée' };
  const taskLabels = { todo: 'À faire', in_progress: 'En cours', done: 'Terminée', cancelled: 'Annulée' };
  const can = (permission) => (state.session?.permissions || []).includes(permission);

  // ------------------------------------------------------------------ réseau
  async function api(url, options = {}) {
    let response;
    try { response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } }); }
    catch (error) {
      if (!navigator.onLine) { toast('Vous êtes hors ligne. Réessayez une fois reconnecté.'); throw new Error('hors ligne'); }
      throw error;
    }
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      // Un visiteur qui n'a simplement jamais ouvert de session ne doit pas lire « session expirée ».
      showLogin(sessionKnown() ? 'Votre session a expiré. Reconnectez-vous.' : '');
      throw new Error(data.error || 'Session requise.');
    }
    if (!response.ok) { const failure = new Error(data.error || `Erreur ${response.status}`); failure.status = response.status; failure.code = data.code || ''; throw failure; }
    return data;
  }
  function toast(message) { const node = $('#toast'); node.textContent = message; node.classList.add('visible'); clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => node.classList.remove('visible'), 3400); }
  function notice(message = '') { const node = $('#notice'); node.textContent = message; node.hidden = !message; }
  // Vrai dès qu'une session a réellement été ouverte dans cet onglet : le message « expirée » n'a
  // de sens qu'à ce moment-là.
  let staffSessionOpened = false;
  const sessionKnown = () => staffSessionOpened;
  function showLogin(message = '') {
    loginView.hidden = false; activationView.hidden = true; appView.hidden = true;
    const error = $('#loginError'); error.textContent = message; error.hidden = !message;
    $('#loginPassword').value = '';
  }
  function showActivation(message = '') {
    loginView.hidden = true; activationView.hidden = false; appView.hidden = true;
    const error = $('#activationError'); error.textContent = message; error.hidden = !message;
  }
  // Applique les tailles décidées par le PDG (variables CSS, aucune donnée métier touchée).
  function applyInterfaceSizes(sizes) {
    if (!sizes) return;
    const map = { title: '--ws-title', subtitle: '--ws-subtitle', text: '--ws-text', label: '--ws-label', button: '--ws-button', productName: '--ws-product-name', price: '--ws-price', orderInfo: '--ws-order-info' };
    for (const [key, variable] of Object.entries(map)) {
      const size = Number(sizes[key]);
      if (Number.isFinite(size)) document.documentElement.style.setProperty(variable, `${Math.max(14, Math.min(30, Math.round(size)))}px`);
    }
  }
  function showApp(data) {
    state.session = data.session; state.shop = data.shop; state.settings = data.settings || {};
    // Raccourcis de l'application installée (`/equipe/?tab=consignment`) : on ouvre l'onglet demandé
    // si — et seulement si — le serveur a accordé la permission correspondante.
    const wantedTab = new URLSearchParams(window.location.search).get('tab');
    if (wantedTab) {
      window.__staffStartTab = ['consignment', 'orders', 'scan', 'tasks'].includes(wantedTab) ? wantedTab : '';
    }
    loginView.hidden = true; activationView.hidden = true; appView.hidden = false;
    staffSessionOpened = true;
    $('#sessionRole').textContent = state.session.role === 'general_manager' ? 'GÉRANT GÉNÉRAL' : 'SERVEUSE';
    $('#sessionDesignation').textContent = state.session.designation || state.session.fullName || 'Mon espace';
    $('#shopName').textContent = state.shop?.name || '';
    // Onglets liés à une permission : masqués si le serveur ne l'accorde pas (il refuse de toute façon).
    $$('#staffTabs .tab').forEach((tab) => {
      const permission = tab.dataset.perm;
      const managerOnly = tab.hasAttribute('data-manager-only');
      const allowed = (!permission || can(permission)) && (!managerOnly || state.session.role === 'general_manager');
      tab.hidden = !allowed;
    });
    // Mission 10 : tailles de texte décidées par le PDG, appliquées dès l'ouverture de la session.
    if (data?.interfaceSizes) applyInterfaceSizes(data.interfaceSizes);
    // Mission 11 : le thème décidé par le marchand (ou imposé par le PDG) s'applique aussi à l'équipe.
    if (data?.interfaceTheme) window.WorkspaceShell?.applyTheme(data.interfaceTheme);
    document.body.dataset.wsApp = 'true';
    window.StaffWorkspace?.renderTiles(); window.StaffWorkspace?.renderMenu();
    if (window.__staffStartTab) { const wanted = window.__staffStartTab; window.__staffStartTab = ''; setTimeout(() => tab(wanted), 0); }
    if (state.settings.teamBlocked) notice('Toute l’équipe est bloquée par le marchand. Vous ne pouvez plus enregistrer d’action.');
    renderAccount();
  }

  // ------------------------------------------------------------------ session
  async function boot() {
    try {
      const me = await api('/api/staff/me');
      showApp(me.data); await loadDashboard();
    } catch (_) { /* showLogin est déjà appelé par api() sur 401 */ }
  }

  async function loadDashboard() {
    const dashboard = await api('/api/staff/dashboard');
    showApp(dashboard.data);
    const d = dashboard.data;
    const blocks = [];
    blocks.push(`<div class="metrics">
      <div class="metric"><span>Mes points</span><strong>${Number(d.points) || 0}</strong></div>
      <div class="metric"><span>Tâches ouvertes</span><strong>${(d.tasks || []).filter((t) => ['todo', 'in_progress'].includes(t.status)).length}</strong></div>
      <div class="metric"><span>Commandes</span><strong>${(d.recentOrders || []).length}</strong></div>
      <div class="metric"><span>Boutique</span><strong>${state.session.role === 'general_manager' ? 'Gérance' : 'Service'}</strong></div>
    </div>`);
    if (d.tasks?.length) {
      blocks.push(`<section class="card"><h3>Mes tâches en cours</h3><div class="list">${d.tasks.filter((t) => ['todo', 'in_progress'].includes(t.status)).slice(0, 5).map(taskItem).join('') || '<p class="empty">Aucune tâche en cours.</p>'}</div></section>`);
    }
    if (d.recentOrders?.length) {
      blocks.push(`<section class="card"><h3>Dernières commandes</h3><div class="list">${d.recentOrders.slice(0, 5).map(orderItem).join('')}</div></section>`);
    }
    blocks.push(`<section class="card"><h3>Ma boutique</h3><div class="item"><div class="meta"><span>${esc(state.shop?.name || '')}</span><span>${esc(state.shop?.slug || '')}</span></div>
      <div class="meta"><span>Fonction : ${state.session.role === 'general_manager' ? 'gérant général' : 'serveuse'}</span><span>Compte : ${esc(state.session.username)}</span></div></div></section>`);
    $('#homeContent').innerHTML = blocks.join('');
    bindTaskButtons($('#homeContent'));
    if (d.recentOrders) renderOrders(d.recentOrders);
  }

  // ------------------------------------------------------------------ commandes
  function orderItem(order) {
    return `<article class="item">
      <header><strong>${esc(order.reference)}</strong><span class="pill ${order.status === 'cancelled' || order.status === 'rejected' ? 'danger' : order.status === 'completed' ? 'ok' : 'warn'}">${esc(statusLabels[order.status] || order.status)}</span></header>
      <div class="meta"><span>${money(order.totalAmountXof)}</span><span>${esc(order.customerName || 'Client')}</span>${order.servicePointName ? `<span>${esc(order.servicePointName)}</span>` : ''}<span>${dateTime(order.createdAt)}</span></div>
      ${order.createdByDesignation ? `<div class="meta"><span>Saisie : ${esc(order.createdByDesignation)}</span></div>` : ''}
    </article>`;
  }
  function renderOrders(rows) {
    const node = $('#ordersList'); if (!node) return;
    node.innerHTML = rows.length ? rows.map(orderItem).join('') : '<p class="empty">Aucune commande pour le moment.</p>';
  }
  async function loadOrders() {
    const rows = (await api(`/api/staff/orders?limit=60${state.mineOnly ? '&mine=1' : ''}`)).data || [];
    renderOrders(rows);
    // Mission 10 : les mêmes données alimentent les cartes de commandes.
    window.StaffWorkspace?.setOrders(rows);
  }

  // Panier : uniquement en mémoire, jamais de produit créé en base.
  function renderCart() {
    const node = $('#cartLines'); if (!node) return;
    if (!state.cart.length) { node.innerHTML = '<p class="empty">Aucun article.</p>'; }
    else node.innerHTML = state.cart.map((line, index) => `<div class="cart-line ${line.custom ? 'tag' : ''}">
      <span>${esc(line.name)} × ${line.quantity}${line.custom ? ' <span class="pill warn">libre</span>' : ''}</span>
      <span>${money(line.unitPriceXof * line.quantity)} <button class="link-button" type="button" data-remove="${index}" aria-label="Retirer">✕</button></span></div>`).join('');
    $$('#cartLines [data-remove]').forEach((button) => button.addEventListener('click', () => { state.cart.splice(Number(button.dataset.remove), 1); renderCart(); }));
    const total = state.cart.reduce((sum, line) => sum + line.unitPriceXof * line.quantity, 0) - (Number($('#orderDiscount')?.value) || 0);
    $('#orderTotal').textContent = `Total : ${money(Math.max(total, 0))}`;
  }

  async function loadOrderForm() {
    const products = (await api('/api/staff/products')).data || [];
    state.products = products;
    $('#orderProduct').innerHTML = '<option value="">Choisir un article…</option>' + products.filter((p) => p.available !== false).map((p) => `<option value="${esc(p.id)}" data-price="${Number(p.priceXof) || 0}">${esc(p.name)} — ${money(p.priceXof)}</option>`).join('');
  }

  async function submitOrder(event) {
    event.preventDefault();
    const error = $('#orderError'); error.hidden = true;
    if (!state.cart.length) { error.textContent = 'Ajoutez au moins un article.'; error.hidden = false; return; }
    const requestId = `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    try {
      const response = await api('/api/staff/orders', { method: 'POST', body: JSON.stringify({
        requestId, orderType: $('#orderTable').value ? 'dine_in' : 'other',
        servicePointId: $('#orderTable').value || '', customerName: $('#orderCustomer').value || '', note: $('#orderNote').value || '',
        discountAmountXof: Number($('#orderDiscount').value) || 0,
        items: state.cart.map((line) => line.custom
          ? { custom: true, name: line.name, quantity: line.quantity, unitPriceXof: line.unitPriceXof }
          : { productId: line.productId, quantity: line.quantity }),
      }) });
      const order = response.data.order;
      state.cart = []; renderCart(); $('#orderNote').value = ''; $('#orderDiscount').value = '0';
      toast(`Commande ${order.reference} enregistrée.`);
      await loadOrders();
    } catch (failure) {
      error.textContent = failure.message; error.hidden = false;
    }
  }

  // ------------------------------------------------------------------ scan
  async function submitScan(event) {
    event.preventDefault();
    const result = $('#scanResult'); result.hidden = true;
    try {
      const code = $('#scanInput').value.trim();
      const response = await api('/api/staff/scan', { method: 'POST', body: JSON.stringify({ code, eventId: `ev_${Date.now().toString(36)}` }) });
      const data = response.data;
      state.lastScan = data;
      result.className = 'message ok';
      result.textContent = data.servicePoint ? `Table reconnue : ${data.servicePoint.name}.` : 'QR de boutique reconnu : choisissez la table dans le formulaire.';
      result.hidden = false;
      if (data.servicePoint) {
        const select = $('#orderTable');
        if (![...select.options].some((option) => option.value === data.servicePoint.id)) {
          select.insertAdjacentHTML('beforeend', `<option value="${esc(data.servicePoint.id)}">${esc(data.servicePoint.name)}</option>`);
        }
        select.value = data.servicePoint.id;
      }
      (data.points || []).forEach((point) => {
        const select = $('#orderTable');
        if (![...select.options].some((option) => option.value === point.id)) select.insertAdjacentHTML('beforeend', `<option value="${esc(point.id)}">${esc(point.name)}</option>`);
      });
      tab('orders');
    } catch (failure) {
      result.className = 'message error'; result.textContent = failure.message; result.hidden = false;
    }
  }

  async function startCamera() {
    // jsQR n'est chargé que si la caméra est réellement utilisée (page légère sur mobile).
    const video = $('#scanVideo');
    try {
      // Mission 10 : le décodeur (257 Ko) n'est téléchargé qu'ici, à l'ouverture de la caméra.
      if (!window.jsQR) await (window.ensureQrDecoder ? window.ensureQrDecoder() : loadScript('/vendor/jsQR.js'));
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      state.camera = stream; video.srcObject = stream; video.hidden = false; await video.play();
      const canvas = document.createElement('canvas');
      const tick = () => {
        if (!state.camera) return;
        if (video.readyState === video.HAVE_ENOUGH_DATA && window.jsQR) {
          canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const frame = context.getImageData(0, 0, canvas.width, canvas.height);
          const found = window.jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' });
          if (found?.data) { $('#scanInput').value = found.data; stopCamera(); $('#scanForm').requestSubmit(); return; }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch (error) { toast('Caméra indisponible : saisissez le code à la main.'); }
  }
  function stopCamera() { if (state.camera) { state.camera.getTracks().forEach((track) => track.stop()); state.camera = null; $('#scanVideo').hidden = true; } }
  function loadScript(src) { return new Promise((resolve, reject) => { const tag = document.createElement('script'); tag.src = src; tag.onload = resolve; tag.onerror = reject; document.head.append(tag); }); }

  // ------------------------------------------------------------------ tâches
  function taskItem(task) {
    const badge = task.status === 'done' ? 'ok' : task.status === 'cancelled' ? 'danger' : task.priority === 'urgent' ? 'danger' : 'warn';
    return `<article class="item">
      <header><strong>${esc(task.title)}</strong><span class="pill ${badge}">${esc(taskLabels[task.status] || task.status)}</span></header>
      ${task.description ? `<div class="meta">${esc(task.description)}</div>` : ''}
      <div class="meta"><span>Priorité : ${esc(task.priority)}</span>${task.dueAt ? `<span>Échéance : ${dateOnly(task.dueAt)}</span>` : '<span>Sans échéance</span>'}${task.designation ? `<span>${esc(task.designation)}</span>` : ''}</div>
      <div class="actions">
        ${task.status === 'todo' ? `<button class="button outline small" type="button" data-task="${esc(task.id)}" data-status="in_progress">Commencer</button>` : ''}
        ${['todo', 'in_progress'].includes(task.status) ? `<button class="button outline small" type="button" data-task="${esc(task.id)}" data-status="done">Terminer</button>` : ''}
      </div>
    </article>`;
  }
  function bindTaskButtons(root) {
    $$('[data-task]', root).forEach((button) => button.addEventListener('click', async () => {
      try { await api(`/api/staff/tasks/${button.dataset.task}/status`, { method: 'POST', body: JSON.stringify({ status: button.dataset.status }) }); toast('Tâche mise à jour.'); await loadTasks(); }
      catch (failure) { toast(failure.message); }
    }));
  }
  async function loadTasks() {
    state.tasks = (await api('/api/staff/tasks')).data || [];
    $('#tasksList').innerHTML = state.tasks.length ? state.tasks.map(taskItem).join('') : '<p class="empty">Aucune tâche attribuée.</p>';
    bindTaskButtons($('#tasksList'));
    const createCard = $('#taskCreateCard');
    createCard.hidden = !can('tasks.assign');
  }

  // ------------------------------------------------------------------ produits
  async function loadProducts() {
    const products = (await api('/api/staff/products')).data || [];
    $('#productsList').innerHTML = products.length ? products.map((product) => `<article class="item">
      <header><strong>${esc(product.name)}</strong><span class="pill ${product.available ? 'ok' : 'warn'}">${product.available ? 'Disponible' : 'Indisponible'}</span></header>
      <div class="meta">${product.priceXof != null ? `<span>${money(product.priceXof)}</span>` : ''}${product.trackStock ? `<span>Stock : ${Number(product.stockQuantity) || 0}</span>` : '<span>Stock non suivi</span>'}</div>
      ${can('products.availability') ? `<div class="actions"><button class="button outline small" type="button" data-availability="${esc(product.id)}" data-available="${product.available ? '0' : '1'}">${product.available ? 'Marquer indisponible' : 'Rendre disponible'}</button></div>` : ''}
    </article>`).join('') : '<p class="empty">Aucun produit dans la boutique.</p>';
    $$('[data-availability]').forEach((button) => button.addEventListener('click', async () => {
      try {
        await api(`/api/staff/products/${encodeURIComponent(button.dataset.availability)}/availability`, { method: 'POST', body: JSON.stringify({ available: button.dataset.available === '1' }) });
        toast('Disponibilité mise à jour.'); await loadProducts();
      } catch (failure) { toast(failure.message); }
    }));
  }

  // ------------------------------------------------------------------ équipe (gérant)
  async function loadTeam() {
    const rows = (await api('/api/staff/history?scope=team')).data || [];
    $('#teamActivity').innerHTML = rows.length ? rows.map((row) => `<article class="item">
      <div class="meta"><span>${dateTime(row.createdAt)}</span><span>${esc(row.designation || 'Équipe')}</span></div>
      <div>${esc(row.summary)}</div>
    </article>`).join('') : '<p class="empty">Aucune activité enregistrée.</p>';
    // Attribution de tâches : le gérant ne voit que les membres de SA boutique (liste serveur).
    if (can('tasks.assign')) {
      try {
        const tasks = (await api('/api/staff/tasks')).data || [];
        const members = [...new Map(tasks.filter((t) => t.memberId).map((t) => [t.memberId, t])).values()];
        $('#taskMember').innerHTML = members.map((m) => `<option value="${esc(m.memberId)}">${esc(m.designation || m.fullName || m.memberId)}</option>`).join('');
      } catch (_) { /* silencieux : la liste reste vide */ }
    }
  }

  // ------------------------------------------------------------------ compte
  function renderAccount() {
    const node = $('#accountInfo'); if (!node) return;
    node.innerHTML = `<div class="item"><div class="meta"><span>Fonction : ${state.session.role === 'general_manager' ? 'gérant général' : 'serveuse'}</span><span>Identifiant : ${esc(state.session.username)}</span></div>
      <div class="meta"><span>Permissions : ${(state.session.permissions || []).length}</span><span>Boutique : ${esc(state.shop?.name || '')}</span></div>
      <small>Votre rattachement à cette boutique est permanent. Seul votre marchand peut modifier votre fonction, vos permissions ou votre accès.</small></div>`;
  }
  async function loadHistory() {
    const rows = (await api('/api/staff/history')).data || [];
    $('#historyList').innerHTML = rows.length ? rows.map((row) => `<div class="item"><div class="meta"><span>${dateTime(row.createdAt)}</span></div><div>${esc(row.summary)}</div></div>`).join('') : '<p class="empty">Aucun historique.</p>';
  }

  // ------------------------------------------------------------------ navigation
  const NAMED_TABS = new Set(['home', 'orders', 'scan', 'tasks', 'products', 'mypoints', 'dashboard', 'tables', 'messaging', 'team', 'account', 'consignment']);
  function tab(name) {
    // Mission 10 : « history » n'est pas un onglet mais l'historique affiché dans le compte.
    if (name === 'history') name = 'account';
    if (!NAMED_TABS.has(name)) name = 'home';
    if (name !== 'home' || state.tab) {
      // L'onglet demandé doit être réellement affiché (permission), sinon on retombe sur l'accueil.
      const button = document.querySelector(`#staffTabs .tab[data-tab="${name}"]`);
      if (button && button.hidden) name = 'home';
    }
    state.tab = name;
    // Le menu des rubriques se synchronise ; les hubs restent masqués quand un outil est ouvert.
    window.StaffWorkspace?.sync(name);
    try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (_) { window.scrollTo(0, 0); }
    $$('#staffTabs .tab').forEach((node) => node.classList.toggle('active', node.dataset.tab === name));
    $$('.panel').forEach((node) => { node.hidden = node.id !== `panel-${name}`; });
    if (name === 'orders') { loadOrders().catch((e) => toast(e.message)); loadOrderForm().catch(() => {}); }
    if (name === 'tasks') loadTasks().catch((e) => toast(e.message));
    if (name === 'products') loadProducts().catch((e) => toast(e.message));
    if (name === 'team') loadTeam().catch((e) => toast(e.message));
    if (name === 'account') loadHistory().catch(() => {});
    if (name === 'consignment') window.StaffConsign?.render($('#staffConsignRoot'));
    if (name !== 'scan') stopCamera();
    // Vues opérationnelles (Mission 6) : rendues par staff-ops.js, toujours depuis le serveur.
    if (['mypoints', 'dashboard', 'tables', 'messaging'].includes(name)) {
      const target = { mypoints: 'points', dashboard: 'manager', tables: 'tables', messaging: 'messages' }[name];
      try { window.OpsUI?.openView(target); } catch (_) {}
    }
  }

  // Mission 10 : le menu des rubriques passe par la fonction tab() existante, qui conserve
  // toutes les vérifications de permission et les chargements déjà en place.
  window.__staffToast = (message) => toast(message);
  window.__staffReload = () => loadOrders().catch(() => {});
  window.__staffOpen = (name, hideHub = true) => {
    if (hideHub) document.querySelectorAll('.ws-hub').forEach((node) => { node.hidden = true; });
    tab(name);
  };

  // ------------------------------------------------------------------ événements
  $('#showActivation').addEventListener('click', () => showActivation());
  $('#showLogin').addEventListener('click', () => showLogin());
  // Mission 11 : le mot de passe d'équipe fait exactement six chiffres. Le serveur reste seul juge
  // (verrouillage, tentatives) : ici on évite seulement un aller-retour inutile et on explique la règle.
  const PIN6_MESSAGE = 'Le mot de passe doit comporter exactement 6 chiffres (0 à 9). Les zéros au début sont conservés.';
  $('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('#loginError'); error.hidden = true;
    const password = String($('#loginPassword').value || '');
    if (!/^\d{6}$/.test(password)) { error.textContent = PIN6_MESSAGE; error.hidden = false; return; }
    try {
      const response = await api('/api/staff/auth/login', { method: 'POST', body: JSON.stringify({ username: $('#loginUsername').value.trim(), password }) });
      showApp(response.data); await loadDashboard();
    } catch (failure) { error.textContent = failure.message; error.hidden = false; }
  });
  $('#activationForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = $('#activationPassword').value; const confirm = $('#activationPasswordConfirm').value;
    const error = $('#activationError'); error.hidden = true;
    if (!/^\d{6}$/.test(password)) { error.textContent = PIN6_MESSAGE; error.hidden = false; return; }
    if (password !== confirm) { error.textContent = 'Les deux mots de passe ne correspondent pas.'; error.hidden = false; return; }
    try {
      const response = await api('/api/staff/activate', { method: 'POST', body: JSON.stringify({ code: $('#activationCode').value, password }) });
      showApp(response.data); await loadDashboard(); toast('Compte activé.');
    } catch (failure) { error.textContent = failure.message; error.hidden = false; }
  });
  // Mission 11 : déconnexion confirmée, session fermée côté serveur, retour à l'écran de connexion.
  async function logout() {
    try { await fetch('/api/staff/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch (_) {}
    document.body.dataset.wsApp = 'false';
    try { window.history.replaceState({}, '', '/equipe/'); } catch (_) {}
    showLogin('Vous avez été déconnecté. Vos données et votre historique sont conservés.');
    window.scrollTo?.({ top: 0, behavior: 'auto' });
  }
  const askLogout = () => (window.WorkspaceShell ? window.WorkspaceShell.confirmLogout(logout) : logout());
  window.__wsLogout = askLogout;
  window.WorkspaceShell?.installLogout($('#logoutButton'), logout);
  $('#logoutButton').addEventListener('click', askLogout);
  $$('#staffTabs .tab').forEach((node) => node.addEventListener('click', () => tab(node.dataset.tab)));
  $('#toggleMine').addEventListener('click', () => { state.mineOnly = !state.mineOnly; $('#toggleMine').textContent = state.mineOnly ? 'Voir toutes les commandes' : 'Voir seulement les miennes'; loadOrders().catch((e) => toast(e.message)); });
  $('#addProductLine').addEventListener('click', () => {
    const select = $('#orderProduct'); const option = select.selectedOptions[0];
    if (!option?.value) { toast('Choisissez un article.'); return; }
    const quantity = Math.max(1, Math.min(999, Number($('#orderProductQty').value) || 1));
    const existing = state.cart.find((line) => line.productId === option.value);
    if (existing) existing.quantity += quantity;
    else state.cart.push({ productId: option.value, name: option.textContent.split(' — ')[0], unitPriceXof: Number(option.dataset.price) || 0, quantity, custom: false });
    renderCart();
  });
  $('#addCustomLine').addEventListener('click', () => {
    const name = $('#customName').value.trim() || 'Article saisi manuellement';
    const unitPriceXof = Math.max(0, Math.round(Number($('#customPrice').value) || 0));
    const quantity = Math.max(1, Math.min(999, Number($('#customQty').value) || 1));
    state.cart.push({ name, unitPriceXof, quantity, custom: true });
    $('#customName').value = ''; $('#customPrice').value = '0'; $('#customQty').value = '1';
    renderCart();
  });
  $('#orderDiscount').addEventListener('input', renderCart);
  $('#orderForm').addEventListener('submit', submitOrder);
  $('#scanForm').addEventListener('submit', submitScan);
  $('#startCamera').addEventListener('click', startCamera);
  $('#taskForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/api/staff/tasks', { method: 'POST', body: JSON.stringify({
        memberId: $('#taskMember').value, title: $('#taskTitle').value, description: $('#taskDescription').value,
        dueAt: $('#taskDue').value || undefined, priority: $('#taskPriority').value }) });
      $('#taskTitle').value = ''; $('#taskDescription').value = ''; $('#taskDue').value = '';
      toast('Tâche attribuée.'); await loadTasks();
    } catch (failure) { toast(failure.message); }
  });
  $('#passwordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('#passwordError'); error.hidden = true;
    if (!/^\d{6}$/.test(String($('#newPassword').value || ''))) { error.textContent = PIN6_MESSAGE; error.hidden = false; return; }
    try {
      await api('/api/staff/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: $('#currentPassword').value, newPassword: $('#newPassword').value }) });
      toast('Mot de passe modifié. Reconnectez-vous.'); showLogin();
    } catch (failure) { error.textContent = failure.message; error.hidden = false; }
  });

  boot();
})();
