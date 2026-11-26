// Mission 10 — Espace équipe (serveuse, serveur, gérant général) : menu en 5 rubriques,
// accueil à trois grandes actions et cartes de commandes.
//
// RÈGLE ABSOLUE : ce fichier ne donne aucune permission. Il lit les boutons historiques de
// #staffTabs (masqués par staff.js selon les permissions renvoyées par le serveur) et n'affiche
// que ce qui est réellement autorisé. Un bouton masqué reste inaccessible ; le serveur refuse
// de toute façon.
(() => {
  'use strict';

  const STORAGE_KEY = 'oymike:staff-pins:v1';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ICONS = {
    home: 'M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z',
    orders: 'M6 3h12l2 4v14H4V7zM9 11h6M9 15h6',
    scan: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16',
    plus: 'M12 5v14M5 12h14',
    activity: 'M3 12h4l3 8 4-16 3 8h4',
    money: 'M3 7h18v10H3zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    bottle: 'M10 3h4v4l2 3v11H8V10l2-3zM8 15h8',
    team: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2M17 11a3 3 0 1 0 0-6M22 20v-2a4 4 0 0 0-3-3.8',
    gear: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3H9.8l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4.4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.06-.4.1-.8.1-1.2z',
    message: 'M4 5h16v11H9l-5 4z',
    table: 'M4 7h16M6 7v13M18 7v13M6 12h12',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
    box: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
    check: 'M4 12l5 5L20 6',
    chart: 'M4 20V4M4 20h16M8 16V11M12 16V7M16 16v-3',
    list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
    logout: 'M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3M10 8l-4 4 4 4M6 12h9',
  };
  const svg = (name) => `<span class="ws-menu-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[name] || ICONS.list}"/></svg></span>`;

  // Chaque entrée pointe vers un onglet historique. `perm` reprend exactement la permission
  // exigée par staff.js pour cet onglet ; `managerOnly` reproduit les boutons « gérant ».
  const RUBRICS = [
    { id: 'home', label: 'Accueil', title: 'Accueil', icon: 'home', items: [
      { tab: 'home', label: 'Vue d’ensemble', hint: 'Commandes, tables, activité', icon: 'home' },
      { tab: 'orders', label: 'Commandes', hint: 'Prendre et suivre les commandes', icon: 'orders', perm: 'orders.view' },
      { tab: 'scan', label: 'Scanner', hint: 'Caméra arrière, lecture automatique', icon: 'scan', perm: 'scans.use' },
      { tab: 'history', label: 'Voir les historiques', hint: 'Filtres par période et recherche', icon: 'list' },
    ] },
    { id: 'orders', label: 'Commandes', title: 'Commandes et scan', icon: 'orders', items: [
      { tab: 'scan', label: 'Scanner', hint: 'Caméra arrière, table reconnue', icon: 'scan', perm: 'scans.use' },
      { tab: 'orders', label: 'Prendre une commande', hint: 'Panier, table, remise', icon: 'plus', perm: 'orders.view' },
      { tab: 'orders', label: 'Mes commandes', hint: 'Suivi et mise à jour', icon: 'orders', perm: 'orders.view' },
    ] },
    { id: 'history', label: 'Historiques', title: 'Voir les historiques', icon: 'list', items: [
      { tab: 'history', label: 'Voir les historiques', hint: 'Mes actions autorisées, filtrables', icon: 'list' },
    ] },
    { id: 'activity', label: 'Mes activités', title: 'Mes activités', icon: 'activity', items: [
      { tab: 'mypoints', label: 'Mes points', hint: 'Points et classement', icon: 'chart' },
      { tab: 'tasks', label: 'Tâches', hint: 'À faire, en cours, terminées', icon: 'check' },
      { tab: 'messaging', label: 'Messagerie', hint: 'Répondre à l’équipe', icon: 'message', perm: 'messaging.reply' },
      { tab: 'consignment', label: 'Consignation', hint: 'Bouteilles et monnaie', icon: 'bottle', perm: 'consignment.view' },
    ] },
    { id: 'manager', label: 'Établissement', title: 'Établissement', icon: 'table', items: [
      { tab: 'dashboard', label: 'Tableau de bord', hint: 'Activité de la boutique', icon: 'chart', managerOnly: true },
      { tab: 'tables', label: 'Tables', hint: 'Occupation des emplacements', icon: 'table', perm: 'tables.view_all' },
      { tab: 'products', label: 'Produits', hint: 'Catalogue de la boutique', icon: 'box', perm: 'products.view' },
      { tab: 'team', label: 'Équipe', hint: 'Activité des membres', icon: 'team', managerOnly: true },
    ] },
    { id: 'account', label: 'Compte', title: 'Mon compte', icon: 'user', items: [
      { tab: 'account', label: 'Mon compte', hint: 'Mot de passe et informations', icon: 'user' },
    ] },
  ];

  const state = { pins: new Set(), menu: null, tiles: null, allowed: new Set(), manager: false, active: 'home', previous: 'home' };

  function buttonFor(tabName) { return $(`#staffTabs .tab[data-tab="${tabName}"]`); }
  function allowed(tabName) {
    const button = buttonFor(tabName);
    if (!button) return true; // onglet sans bouton (ex. historique) : visible comme avant
    return button.hidden !== true;
  }
  function tabsFor(rubric) {
    return rubric.items.filter((item) => allowed(item.tab));
  }

  function loadPins() {
    try { const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); state.pins = new Set(Array.isArray(raw) ? raw.filter((id) => RUBRICS.some((row) => row.id === id)) : []); }
    catch (_) { state.pins = new Set(); }
    for (const id of ['home', 'orders']) state.pins.add(id); // actions de terrain toujours visibles
  }
  function savePins() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.pins])); } catch (_) {} }

  function renderMenu() {
    if (!state.menu) return;
    const order = [...RUBRICS.map((row) => row.id)].sort((a, b) => Number(state.pins.has(b)) - Number(state.pins.has(a)));
    state.menu.innerHTML = order.map((id) => {
      const rubric = RUBRICS.find((row) => row.id === id);
      const visible = tabsFor(rubric).length > 0;
      if (!visible) return '';
      return `<button type="button" data-rubric="${esc(id)}" ${state.active === id ? 'aria-current="page"' : ''}>${svg(rubric.icon)}<span>${esc(id === 'orders' ? 'Commandes' : rubric.label)}</span></button>`;
    }).join('');
    $$('[data-rubric]', state.menu).forEach((button) => button.addEventListener('click', () => openRubric(button.dataset.rubric)));
    // Mission 11 : « Se déconnecter » est toujours la dernière entrée, après toutes les rubriques.
    state.menu.insertAdjacentHTML('beforeend', `<button type="button" class="ws-logout-entry" data-ws-logout-entry title="Se déconnecter">${svg('logout')}<span>Se déconnecter</span></button>`);
    $('[data-ws-logout-entry]', state.menu)?.addEventListener('click', () => window.__wsLogout?.());
  }

  // Tuiles de l'accueil : elles restent TOUJOURS affichées (la barre permanente les reprend sur les
  // pages secondaires). Aucune tuile n'est retirée quand on quitte l'accueil.
  function renderTiles() {
    const root = state.tiles; if (!root) return;
    const tiles = [];
    if (allowed('orders')) tiles.push(`<button class="ws-tile is-orders" type="button" data-staff-action="orders">
      <div class="ws-tile-top"><span class="ws-tile-icon">${svg('orders')}</span>
      <span class="ws-tile-text"><span class="ws-tile-label">Commandes</span><span class="ws-tile-hint">Prendre une commande, suivre les miennes</span></span></div>
      <span class="ws-tile-count" id="staffTileOrderCount" hidden>0</span></button>`);
    if (allowed('scan')) tiles.push(`<button class="ws-tile is-scan" type="button" data-staff-action="scan">
      <div class="ws-tile-top"><span class="ws-tile-icon">${svg('scan')}</span>
      <span class="ws-tile-text"><span class="ws-tile-label">Scanner</span><span class="ws-tile-hint">Caméra arrière, lecture automatique</span></span></div></button>`);
    tiles.push(`<button class="ws-tile" type="button" data-staff-action="overview">
      <div class="ws-tile-top"><span class="ws-tile-icon">${svg('chart')}</span>
      <span class="ws-tile-text"><span class="ws-tile-label">Vue d’ensemble</span><span class="ws-tile-hint">Nouvelles commandes, en cours, terminées, tables</span></span></div></button>`);
    root.innerHTML = tiles.join('');
    root.hidden = false;
    $$('[data-staff-action]', root).forEach((button) => button.addEventListener('click', () => {
      const action = button.dataset.staffAction;
      if (action === 'scan') { openScan(); return; }
      if (action === 'orders') { openTab('orders'); return; }
      openRubric('home');
    }));
    renderRail();
  }

  // Barre permanente (Commandes / Scanner / Vue d'ensemble) : même principe que côté marchand,
  // elle ne disparaît jamais et ne remplace aucune tuile.
  function renderRail() {
    const rail = document.getElementById('staffPermanentRail');
    if (!rail) return;
    $$('[data-staff-rail]', rail).forEach((button) => {
      if (button.dataset.requires === 'orders') button.hidden = !allowed('orders');
      if (button.dataset.requires === 'scan') button.hidden = !allowed('scan');
      const target = button.dataset.staffRail;
      const current = target === 'home' ? state.active === 'home' : state.active === target;
      button.setAttribute('aria-current', current ? 'page' : 'false');
    });
  }

  // Ouvre le scanner caméra de l'espace équipe : caméra arrière, lecture automatique, redirection
  // immédiate vers la prise de commande avec la table reconnue.
  function openScan() {
    const target = allowed('scan') ? 'scan' : 'home';
    openTab(target);
    // Après l'affichage, on démarre la caméra du panneau (bouton dédié, un seul chemin de code).
    setTimeout(() => { document.getElementById('startCamera')?.click(); }, 60);
  }

  function renderHub(rubric) {
    const panel = $(`#panel-hub-${rubric.id}`); if (!panel) return;
    const items = tabsFor(rubric);
    panel.innerHTML = `<div class="ws-hub-head"><h2>${esc(rubric.title)}</h2><p>Choisissez une action.</p></div>
      <div class="ws-hub-grid">${items.map((item) => `<div class="ws-hub-card">
        <button class="ws-hub-open" type="button" data-hub-tab="${esc(item.tab)}"${item.tab === 'history' ? ' data-history-entry="true"' : ''}>
          <span class="ws-tile-icon">${svg(item.icon)}</span>
          <span><strong>${esc(item.label)}</strong><small>${esc(item.hint)}</small></span>
        </button>
        <button class="ws-pin" type="button" data-pin-rubric="${esc(rubric.id)}" aria-pressed="${state.pins.has(rubric.id)}" title="Mettre en exergue" aria-label="Mettre cette rubrique en exergue">★</button>
      </div>`).join('')}</div>
      <button type="button" class="ws-hub-history" data-history-entry="true">${svg('list')}<span>Voir les historiques</span></button>`;
  }

  function setPanels(id) {
    $$('.panel').forEach((node) => {
      if (node.classList.contains('ws-hub')) { node.hidden = true; return; }
      node.hidden = node.id !== `panel-${id}`;
    });
    const visible = $$('.panel:not(.ws-hub)').filter((node) => !node.hidden);
    if (visible.length > 1) visible.slice(1).forEach((node) => { node.hidden = true; });
  }
  function hideHubs() { $$('.ws-hub').forEach((node) => { node.hidden = true; }); }

  // Barre de retour : visible dès qu'on quitte l'accueil, ramène à la vue précédente.
  function showBackBar(visible, label = '') {
    let bar = $('#wsBackBar');
    if (!bar) {
      const host = $('.staff-app') || $('.app-wrap') || document.body;
      bar = document.createElement('div');
      bar.id = 'wsBackBar'; bar.className = 'ws-backbar'; bar.hidden = true;
      bar.innerHTML = `<button type="button" class="ws-back-button" data-ws-back-home="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg><span>Retour</span></button><span class="ws-crumb" id="wsCrumb"></span>`;
      // Juste avant la barre permanente : elle ne la recouvre jamais.
      const rail = document.getElementById('staffPermanentRail');
      if (rail && rail.parentNode === host) host.insertBefore(bar, rail);
      else {
        const intro = host.querySelector('.staff-intro, .page-intro, header');
        if (intro && intro.nextSibling) host.insertBefore(bar, intro.nextSibling); else host.prepend(bar);
      }
      // Le clic est branché par WorkspaceShell (une seule fois) : pas de double retour.
    }
    window.WorkspaceShell?.installBackButtons();
    bar.hidden = !visible;
    const crumb = $('#wsCrumb', bar); if (crumb) crumb.textContent = visible ? label : '';
  }

  // Les tuiles d'accueil ne sont plus jamais masquées : `toggleTiles` reste un point d'entrée
  // neutre pour les appels existants (aucune régression, aucun raccourci perdu).
  function toggleTiles() { if (state.tiles) state.tiles.hidden = false; }

  // Vue mémorisée localement : au rechargement ou à la reconnexion, on retrouve l'écran quitté.
  const VIEW_KEY = 'oymike:staff-view:v1';
  function rememberView(view) {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ view, at: Date.now() })); } catch (_) {}
  }
  function rememberedView() {
    try {
      const raw = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
      if (!raw || Date.now() - Number(raw.at || 0) > 12 * 60 * 60 * 1000) return '';
      const known = new Set([...RUBRICS.map((row) => row.id), ...RUBRICS.flatMap((row) => row.items.map((item) => item.tab)), 'home']);
      return known.has(raw.view) ? raw.view : '';
    } catch (_) { return ''; }
  }

  function openRubric(id, { fromBack = false } = {}) {
    const rubric = RUBRICS.find((row) => row.id === id); if (!rubric) return;
    state.active = id; renderMenu(); renderRail();
    rememberView(id);
    try { window.history.replaceState({ oymikeView: id }, '', window.location.href); } catch (_) {}
    // Historique : on mémorise la vue d'où l'on part, pour que « Retour » y ramène.
    if (!fromBack) window.WorkspaceShell?.pushView(state.previous || 'home');
    state.previous = id;
    // Écrans directs : aucune page intermédiaire.
    if (id === 'home') { setPanels('home'); hideHubs(); window.__staffOpen?.(id, false); showBackBar(false); return; }
    if (id === 'scan') { openTabDirect('scan', rubric.title); return; }
    if (id === 'orders') { openTabDirect('orders', rubric.title); return; }
    if (id === 'history') { openTabDirect('history', 'Voir les historiques'); return; }
    if (id === 'account') { setPanels(id); hideHubs(); window.__staffOpen?.(id, false); showBackBar(true, rubric.title); return; }
    renderHub(rubric); setPanels(`hub-${id}`); toggleTiles(); renderRail();
    showBackBar(true, rubric.title);
    try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (_) {}
  }

  // Ouvre un panneau réel (permissions vérifiées par staff.js) sans passer par un hub.
  function openTabDirect(tabName, label) {
    const item = RUBRICS.flatMap((row) => row.items).find((row) => row.tab === tabName);
    showBackBar(tabName !== 'home', label || item?.label || '');
    window.__staffOpen?.(tabName, true);
    setPanels(tabName === 'scan' ? 'scan' : tabName);
    if (tabName === 'history') window.HistoryView?.open();
  }

  function openTab(tabName, options = {}) {
    // Appels historiques (`openTab('orders')`) et appels riches (`{ overviewView }`) acceptés.
    const fromBack = options === true || options.fromBack === true;
    toggleTiles();
    const rubric = RUBRICS.find((row) => row.items.some((item) => item.tab === tabName));
    const item = rubric?.items.find((row) => row.tab === tabName);
    showBackBar(tabName !== 'home', item?.label || rubric?.title || '');
    if (!fromBack) window.WorkspaceShell?.pushView(state.previous || 'home');
    state.previous = tabName;
    state.active = tabName;
    rememberView(tabName);
    if (tabName === 'orders') {
      // Mission 10 : « Mes commandes » ouvre les cartes ; le formulaire de prise de commande
      // reste juste en dessous, intact.
      const panel = $('#panel-orders');
      if (panel && !$('#staffOrderBoard')) {
        panel.insertAdjacentHTML('afterbegin', '<section class="ws-board" id="staffOrderBoard" aria-live="polite"></section>');
        renderBoard();
        loadOrders();
      }
    }
    window.__staffOpen?.(tabName, true);
    setPanels(tabName === 'scan' ? 'scan' : tabName);
    renderRail(); renderMenu();
    if (tabName === 'history') window.HistoryView?.open();
    if (tabName === 'home') window.OverviewView?.open();
    // Carte de la vue d'ensemble → liste de commandes déjà filtrée (aucun rechargement).
    if (tabName === 'orders' && options.overviewView) {
      const wanted = { new: 'new', active: 'preparing', done: 'done' }[options.overviewView] || 'new';
      setTimeout(() => { document.querySelector(`[data-staff-filter="${wanted}"]`)?.click(); }, 260);
    }
  }

  // ---------------------------------------------------------------- commandes (cartes)
  // Mêmes appels serveur qu'avant : /api/staff/orders et /api/staff/orders/:id/status. Le serveur
  // borne le périmètre et revérifie la permission orders.update à chaque changement d'état.
  async function loadOrders() {
    try {
      const response = await fetch('/api/staff/orders?limit=60', { credentials: 'same-origin' });
      if (!response.ok) return;
      const data = await response.json();
      setOrders(data.data || []);
    } catch (_) { /* hors ligne : les cartes restent vides, la liste serveur reste disponible */ }
  }

  const STATUS_LABELS = { pending: 'À confirmer', confirmed: 'Confirmée', preparing: 'En préparation', ready: 'Prête', out_for_delivery: 'En livraison', completed: 'Terminée', cancelled: 'Annulée', rejected: 'Refusée' };
  const FILTERS = [
    { id: 'new', label: 'Nouvelles', statuses: ['pending'] },
    { id: 'preparing', label: 'En préparation', statuses: ['confirmed', 'preparing'] },
    { id: 'ready', label: 'Prêtes', statuses: ['ready', 'out_for_delivery'] },
    { id: 'done', label: 'Terminées', statuses: ['completed'] },
    { id: 'cancelled', label: 'Annulées', statuses: ['cancelled', 'rejected'] },
  ];
  const board = { filter: 'new', orders: [] };

  function money(value) { return `${new Intl.NumberFormat('fr-FR').format(Number(value) || 0)} XOF`; }
  function clock(value) { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(d); }

  function orderCard(order) {
    const isNew = order.status === 'pending';
    const items = Array.isArray(order.items) ? order.items : [];
    const place = order.servicePointName || order.deliveryAddress || 'Retrait / comptoir';
    const quick = { pending: [['confirmed', 'Confirmer']], confirmed: [['preparing', 'Préparer']], preparing: [['ready', 'Prête']], ready: [['completed', 'Terminer']], out_for_delivery: [['completed', 'Terminée']] }[order.status] || [];
    return `<article class="ws-order${isNew ? ' is-new' : ''}${order.status === 'ready' ? ' is-ready' : ''}${['cancelled', 'rejected'].includes(order.status) ? ' is-cancelled' : ''}" data-order-card="${esc(order.id)}">
      <header class="ws-order-head"><div><span class="ws-order-ref">${esc(order.reference || '—')}</span>
        <span class="ws-order-tag${isNew ? ' is-new' : ''}">${isNew ? 'Nouvelle' : clock(order.createdAt)}</span></div>
        <span class="ws-order-status ${esc(order.status)}">${esc(STATUS_LABELS[order.status] || order.status)}</span></header>
      <div class="ws-order-meta"><span><strong>${esc(order.customerName || 'Client')}</strong></span><span>${esc(place)}</span><span>${esc(clock(order.createdAt))}</span></div>
      <ul class="ws-order-items">${items.slice(0, 4).map((item) => `<li><span><span class="ws-qty">${Number(item.quantity) || 0}×</span> ${esc(item.name)}</span><span>${money(Number(item.unitPriceXof) * Number(item.quantity))}</span></li>`).join('') || '<li><span>Aucun article détaillé</span></li>'}</ul>
      <footer class="ws-order-foot"><span class="ws-order-total">${money(order.totalAmountXof)}</span>
        <span class="ws-order-actions">${quick.map(([next, label]) => `<button type="button" class="is-primary" data-staff-order-next="${esc(order.id)}" data-staff-order-status="${esc(next)}">${esc(label)}</button>`).join('')}</span></footer>
    </article>`;
  }

  function renderBoard() {
    const host = $('#staffOrderBoard'); if (!host) return;
    const counts = Object.fromEntries(FILTERS.map((row) => [row.id, board.orders.filter((order) => row.statuses.includes(order.status)).length]));
    const active = FILTERS.find((row) => row.id === board.filter) || FILTERS[0];
    const rows = board.orders.filter((order) => active.statuses.includes(order.status));
    host.innerHTML = `<nav class="ws-board-filters" id="staffOrderFilters" aria-label="Filtrer les commandes">${FILTERS.map((row) => `<button type="button" data-staff-filter="${row.id}" aria-pressed="${active.id === row.id}">${esc(row.label)}<span class="ws-count">${counts[row.id]}</span></button>`).join('')}</nav>
      <div class="ws-board-list">${rows.map(orderCard).join('')}</div>${rows.length ? '' : '<p class="ws-empty">Aucune commande dans ce filtre.</p>'}`;
    $$('[data-staff-filter]', host).forEach((button) => button.addEventListener('click', () => { board.filter = button.dataset.staffFilter; renderBoard(); }));
    const tile = $('#staffTileOrderCount');
    if (tile) { tile.textContent = String(counts.new || 0); tile.hidden = !counts.new; }
    $$('[data-staff-order-next]', host).forEach((button) => button.addEventListener('click', () => changeStatus(button.dataset.staffOrderNext, button.dataset.staffOrderStatus, button)));
  }

  async function changeStatus(orderId, status, button) {
    const order = board.orders.find((row) => row.id === orderId);
    const label = STATUS_LABELS[status] || status;
    if (order && !window.confirm(`${label} la commande ${order.reference} ?`)) return;
    if (button) button.disabled = true;
    try {
      // Même route que le changement d'état existant : la permission orders.update est revérifiée.
      const response = await fetch(`/api/staff/orders/${encodeURIComponent(orderId)}/status`, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
      window.__staffToast?.(`Commande mise à jour : ${label}.`);
      // Rechargement de la seule liste : la page, la saisie en cours et les raccourcis restent en place.
      window.__staffReload?.();
      await loadOrders();
    } catch (error) {
      window.__staffToast?.(error.message);
    } finally { if (button) button.disabled = false; }
  }

  function setOrders(rows) { board.orders = Array.isArray(rows) ? rows : []; renderBoard(); }

  function sync(activeTab) {
    state.active = activeTab;
    renderMenu();
    renderRail();
  }

  function togglePin(id) {
    if (['home', 'orders'].includes(id)) return;
    if (state.pins.has(id)) state.pins.delete(id); else state.pins.add(id);
    savePins(); renderMenu();
    const rubric = RUBRICS.find((row) => row.id === id); if (rubric) renderHub(rubric);
  }

  function bind() {
    loadPins();
    state.menu = $('#workspaceMenu'); state.tiles = $('#staffTiles');
    renderTiles(); renderMenu(); renderRail();
    const rail = document.getElementById('staffPermanentRail');
    if (rail) {
      $$('[data-staff-rail]', rail).forEach((button) => button.addEventListener('click', () => {
        const target = button.dataset.staffRail;
        if (target === 'scan') { openScan(); return; }
        if (target === 'orders') { openRubric('orders'); return; }
        openRubric('home');
      }));
    }
    document.addEventListener('click', (event) => {
      if (event.target.closest?.('[data-history-entry]')) { openRubric('history'); return; }
      const hubTab = event.target.closest?.('[data-hub-tab]');
      if (hubTab) { openTab(hubTab.dataset.hubTab); return; }
      const pin = event.target.closest?.('[data-pin-rubric]');
      if (pin) togglePin(pin.dataset.pinRubric);
    });
    // Retour (bouton de la barre ou bouton natif du téléphone) : on réouvre la vue précédente.
    document.addEventListener('workspace:back', (event) => {
      // Le shell a déjà dépilé : la dernière vue de la pile est celle à réafficher.
      const stack = window.WorkspaceShell?.history || [];
      const raw = event.detail?.view || 'home';
      const view = raw.startsWith('rubric:') ? raw.slice(7) : raw;
      if (RUBRICS.some((row) => row.id === view)) { openRubric(view, { fromBack: true }); return; }
      openTab(view, { fromBack: true });
    });
  }

  // Restauration de la vue après actualisation ou reconnexion : on revient sur l'écran quitté.
  let restored = false;
  function restoreView() {
    if (restored) return;
    const app = document.getElementById('appView');
    if (!app || app.hidden) return;
    restored = true;
    const target = rememberedView();
    if (!target || target === 'home') { openRubric('home', { fromBack: true }); return; }
    if (RUBRICS.some((row) => row.id === target)) { openRubric(target, { fromBack: true }); return; }
    openTab(target, { fromBack: true });
  }
  window.__staffRestoreView = restoreView;

  window.StaffWorkspace = { sync, openRubric, openTab, openScan, renderTiles, renderMenu, renderRail, setOrders, loadOrders, showBackBar, restoreView, get active() { return state.active; } };

  function boot() {
    if (state.menu) { renderMenu(); renderTiles(); renderRail(); return; }
    bind();
    // L'espace équipe s'ouvre après la vérification de session : on observe ce passage pour
    // restaurer la vue, sans dépendre de l'ordre exact des scripts.
    const app = document.getElementById('appView');
    if (app) {
      const observer = new MutationObserver(() => { if (!app.hidden) { restoreView(); observer.disconnect(); } });
      observer.observe(app, { attributes: true, attributeFilter: ['hidden'] });
      if (!app.hidden) restoreView();
    }
  }
  if (document.body) boot();
  document.addEventListener('DOMContentLoaded', boot, { once: true });
})();
