// Mission 10 — Navigation et accueil des espaces de travail.
// Principe : 7 rubriques visibles, aucun onglet métier supprimé. Les panneaux historiques
// (#panel-orders, #panel-ops, …) restent la source d'affichage ; ce module se contente de les
// ranger et de rendre leur entrée lisible. Aucune permission n'est créée ni retirée ici.
(() => {
  'use strict';

  const STORAGE_KEY = 'oymike:workspace-pins:v1';

  const ICONS = {
    home: 'M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z',
    orders: 'M6 3h12l2 4v14H4V7zM9 11h6M9 15h6',
    scan: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16',
    place: 'M4 20V9l8-5 8 5v11M9 20v-6h6v6',
    team: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2M17 11a3 3 0 1 0 0-6M22 20v-2a4 4 0 0 0-3-3.8',
    money: 'M3 7h18v10H3zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 7v10M18 7v10',
    gear: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3H9.8l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4.4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.06-.4.1-.8.1-1.2z',
    bell: 'M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6zM10 19a2 2 0 0 0 4 0',
    shop: 'M4 9h16l-1-5H5zM5 9v11h14V9M9 20v-6h6v6',
    bag: 'M6 8h12l1 12H5zM9 8V6a3 3 0 0 1 6 0v2',
    chart: 'M4 20V4M4 20h16M8 16V11M12 16V7M16 16v-3',
    cart: 'M3 5h2l2 10h10l2-7H6M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM17 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
    box: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
    ticket: 'M4 7h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
    trash: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13',
    paint: 'M4 4h16v9H4zM12 13v4a2 2 0 0 0 2 2h2',
    message: 'M4 5h16v11H9l-5 4z',
    table: 'M4 7h16M6 7v13M18 7v13M6 12h12',
    flame: 'M12 3c3 4 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-8z',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
    check: 'M4 12l5 5L20 6',
    plus: 'M12 5v14M5 12h14',
    list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  };

  const svg = (name) => `<span class="ws-menu-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[name] || ICONS.list}"/></svg></span>`;

  // Une rubrique = un titre court + la liste des panneaux historiques qu'elle contient.
  // `extra` ajoute une entrée vers un onglet qui ne vit pas dans un panneau (ex. écran Scanner).
  const RUBRICS = [
    { id: 'home', label: 'Accueil', icon: 'home', items: [{ tab: 'home', label: 'Vue d’ensemble', hint: 'Chiffres, dernières commandes, tendance', icon: 'chart' }] },
    { id: 'ops', label: 'Commandes', icon: 'orders', items: [
      { tab: 'orders', label: 'Commandes reçues', hint: 'Cartes, filtres, actions rapides', icon: 'orders' },
      { tab: 'assisted', label: 'Prendre une commande', hint: 'Saisie assistée pour un client', icon: 'plus' },
      { tab: 'ops', label: 'Opérations', hint: 'Points, traçabilité, tables', icon: 'chart' },
      { tab: 'ops-messages', label: 'Messagerie', hint: 'Échanges avec l’équipe', icon: 'message' },
      { tab: 'notifications', label: 'Notifications', hint: 'Activité de la boutique', icon: 'bell' },
      { tab: 'scans', label: 'Scans & activation', hint: 'Statistiques de scans, étapes d’activation', icon: 'scan' },
    ] },
    { id: 'scan', label: 'Scanner', icon: 'scan', items: [
      { tab: 'scan', label: 'Scanner un QR', hint: 'Caméra arrière, action immédiate', icon: 'scan' },
      { tab: 'scans', label: 'Scans & activation', hint: 'Compteurs, historique, activation', icon: 'chart' },
    ] },
    { id: 'catalog', label: 'Établissement', icon: 'shop', items: [
      { tab: 'store', label: 'Ma boutique', hint: 'Profil public, horaires, livraison', icon: 'shop' },
      { tab: 'products', label: 'Mes produits', hint: 'Prix, stock, photos', icon: 'box' },
      { tab: 'catalog', label: 'Catalogue', hint: 'Modèles à ajouter', icon: 'cart' },
      { tab: 'customize', label: 'Personnaliser', hint: 'Couleurs, police, sections', icon: 'paint' },
    ] },
    { id: 'team', label: 'Équipe', icon: 'team', items: [
      { tab: 'team', label: 'Mon équipe', hint: 'Gérants, serveuses, demandes', icon: 'team' },
      { tab: 'ops', label: 'Points et tables', hint: 'Classement, occupation', icon: 'table' },
    ] },
    { id: 'finance', label: 'Finances', icon: 'money', items: [
      { tab: 'consignment', label: 'Consignation', hint: 'Bouteilles et monnaie', icon: 'money' },
      { tab: 'advanced', label: 'Marketing & QR', hint: 'QR de table, offres, bons cadeaux', icon: 'ticket' },
    ] },
    { id: 'settings', label: 'Paramètres', icon: 'gear', items: [
      { tab: 'account', label: 'Mon compte', hint: 'Sécurité et code personnel', icon: 'user' },
      { tab: 'customize', label: 'Personnaliser', hint: 'Identité de la boutique', icon: 'paint' },
      { tab: 'store', label: 'Ma boutique', hint: 'Informations publiques', icon: 'shop' },
      { tab: 'notifications', label: 'Notifications', hint: 'Alertes et appareils', icon: 'bell' },
    ] },
  ];

  // Libellés courts pour les panneaux ouverts depuis un hub.
  const PANEL_TITLES = {
    'panel-orders': 'Commandes reçues', 'panel-assisted': 'Prendre une commande', 'panel-ops': 'Opérations',
    'panel-ops-messages': 'Messagerie', 'panel-notifications': 'Notifications', 'panel-scans': 'Scans & activation',
    'panel-store': 'Ma boutique', 'panel-products': 'Mes produits', 'panel-catalog': 'Catalogue',
    'panel-customize': 'Personnaliser', 'panel-team': 'Mon équipe', 'panel-consignment': 'Consignation',
    'panel-advanced': 'Marketing & QR', 'panel-account': 'Mon compte', 'panel-home': 'Vue d’ensemble',
    'panel-scan': 'Scanner un QR',
  };

  const state = { active: 'home', pins: new Set(), menu: null, merchantName: '' };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function loadPins() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      state.pins = new Set(Array.isArray(raw) ? raw.filter((id) => RUBRICS.some((r) => r.id === id)) : []);
    } catch (_) { state.pins = new Set(); }
    // Les trois actions de terrain restent toujours accessibles et ne peuvent pas être masquées.
    for (const id of ['home', 'ops', 'scan']) state.pins.add(id);
  }
  function savePins() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.pins])); } catch (_) {}
  }

  function rubricForTab(tabName) {
    for (const rubric of RUBRICS) if (rubric.items.some((item) => item.tab === tabName)) return rubric;
    return null;
  }

  function highlightedRubrics() {
    // Une rubrique « mise en exergue » remonte en tête du menu, sans rien masquer.
    const order = RUBRICS.map((rubric) => rubric.id);
    const pinned = order.filter((id) => state.pins.has(id));
    return { pinned, rest: order.filter((id) => !state.pins.has(id)) };
  }

  function renderMenu() {
    const menu = state.menu; if (!menu) return;
    const { pinned, rest } = highlightedRubrics();
    const byId = new Map(RUBRICS.map((rubric) => [rubric.id, rubric]));
    menu.innerHTML = [...pinned, ...rest].map((id) => {
      const rubric = byId.get(id);
      const current = state.active === id || (state.active !== 'home' && rubricForTab(state.active)?.id === id);
      const label = id === 'ops' ? 'Commandes' : rubric.label;
      return `<button type="button" data-rubric="${esc(id)}" ${current ? 'aria-current="page"' : ''} title="${esc(rubric.label)}">${svg(rubric.icon)}<span>${esc(label)}</span></button>`;
    }).join('');
    $$('button[data-rubric]', menu).forEach((button) => button.addEventListener('click', () => open(button.dataset.rubric)));
  }

  function setPanels(name) {
    $$('.tab-panel').forEach((node) => { node.hidden = node.id !== `panel-${name}`; });
  }
  // Les trois grandes tuiles ne restent affichées que sur l'accueil : ailleurs, elles
  // voleraient la première hauteur d'écran utile au travail en cours.
  function toggleTiles(visible) {
    const tiles = $('#homeTiles'); if (tiles) tiles.hidden = !visible;
  }

  function renderHub(rubric) {
    const panel = $(`#panel-hub-${rubric.id}`); if (!panel) return;
    const items = rubric.items.filter((item, index, rows) => rows.findIndex((row) => row.tab === item.tab) === index);
    panel.innerHTML = `
      <div class="ws-hub-head"><span class="eyebrow">${esc(rubric.label.toUpperCase())}</span><h2>${esc(rubric.label)}</h2>
        <p>Choisissez une rubrique. Rien n’a été supprimé : chaque outil reste à sa place.</p></div>
      <div class="ws-hub-grid">${items.map((item) => `
        <div class="ws-hub-card${state.pins.has(rubric.id) ? ' is-highlighted' : ''}">
          <button class="ws-hub-open" type="button" data-hub-tab="${esc(item.tab)}">
            <span class="ws-tile-icon" aria-hidden="true">${svg(item.icon)}</span>
            <span><strong>${esc(item.label)}</strong><small>${esc(item.hint)}</small></span>
          </button>
          <button class="ws-pin" type="button" data-pin-rubric="${esc(rubric.id)}" aria-pressed="${state.pins.has(rubric.id)}"
            aria-label="${state.pins.has(rubric.id) ? 'Retirer la mise en exergue' : 'Mettre cette rubrique en exergue'}" title="Mettre en exergue">★</button>
        </div>`).join('')}</div>
      <p class="ws-hub-note">★ met la rubrique en tête du menu. L’accueil, les commandes et le scanner restent toujours visibles.</p>`;
  }

  function openRubric(id) {
    const rubric = RUBRICS.find((row) => row.id === id); if (!rubric) return;
    state.active = id;
    renderMenu();
    // Accueil et Scanner sont des écrans directs : aucune page intermédiaire.
    if (rubric.id === 'home') { openTab('home'); return; }
    if (rubric.id === 'scan') { openTab('scan'); return; }
    renderHub(rubric);
    setPanels(`hub-${id}`);
    toggleTiles(false);
    window.scrollTo?.({ top: 0, behavior: 'auto' });
  }

  function highlightTab(tabName) {
    $$('.tab').forEach((node) => node.classList.toggle('active', node.dataset.tab === tabName));
  }

  // `notify = false` quand c'est merchant.js qui pilote déjà l'onglet : évite tout aller-retour.
  function openTab(tabName, notify = true) {
    const rubric = rubricForTab(tabName);
    if (rubric) { state.active = rubric.id; renderMenu(); }
    // Ouvrir un outil masque son hub : le retour se fait par le menu.
    const hub = $(`#panel-hub-${rubric?.id}`);
    if (hub) hub.hidden = true;
    setPanels(tabName === 'scan' ? 'scan' : tabName);
    toggleTiles(tabName === 'home');
    highlightTab(tabName);
    window.scrollTo?.({ top: 0, behavior: 'auto' });
    if (notify) document.dispatchEvent(new CustomEvent('workspace:tab', { detail: { tab: tabName } }));
  }

  function open(id) {
    if (id === 'scan') { openRubric('scan'); return; }
    if (['home', 'ops', 'catalog', 'finance', 'settings', 'team'].includes(id)) { openRubric(id); return; }
    openTab(id);
  }

  function togglePin(id) {
    if (!RUBRICS.some((rubric) => rubric.id === id)) return;
    if (['home', 'ops', 'scan'].includes(id)) return; // toujours visibles
    if (state.pins.has(id)) state.pins.delete(id); else state.pins.add(id);
    savePins(); renderMenu();
    const rubric = RUBRICS.find((row) => row.id === id); if (rubric) renderHub(rubric);
  }

  // ------------------------------------------------------------------ cartes de commandes
  function orderCard(order, statusLabels) {
    const isNew = order.status === 'pending';
    const items = Array.isArray(order.items) ? order.items : [];
    const money = (value) => `${new Intl.NumberFormat('fr-FR').format(Number(value) || 0)} XOF`;
    const time = (value) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(date); };
    const quick = {
      pending: [['confirmed', 'Confirmer']], confirmed: [['preparing', 'Préparer']], preparing: [['ready', 'Prête']],
      ready: [['completed', 'Terminer']], out_for_delivery: [['completed', 'Terminée']],
    }[order.status] || [];
    const place = order.servicePointName || order.tableName || order.deliveryAddress || 'Retrait';
    return `<article class="ws-order${isNew ? ' is-new' : ''}${order.status === 'ready' ? ' is-ready' : ''}${['cancelled', 'rejected'].includes(order.status) ? ' is-cancelled' : ''}" data-order-card="${esc(order.id)}">
      <header class="ws-order-head">
        <div><span class="ws-order-ref">${esc(order.reference || '—')}</span>
          <span class="ws-order-tag${isNew ? ' is-new' : ''}">${isNew ? 'Nouvelle' : time(order.createdAt)}</span></div>
        <span class="ws-order-status ${esc(order.status)}">${esc(statusLabels[order.status] || order.status)}</span>
      </header>
      <div class="ws-order-meta">
        <span><strong>${esc(order.customerName || 'Client')}</strong></span>
        <span>${esc(place)}</span>
        <span>${esc(time(order.createdAt))}</span>
      </div>
      <ul class="ws-order-items">${items.slice(0, 4).map((item) => `<li><span><span class="ws-qty">${Number(item.quantity) || 0}×</span> ${esc(item.name)}</span></li>`).join('') || '<li><span>Aucun article détaillé</span></li>'}${items.length > 4 ? `<li><span class="muted">+ ${items.length - 4} autre(s) article(s)</span></li>` : ''}</ul>
      <footer class="ws-order-foot">
        <span class="ws-order-total">${money(order.totalAmountXof)}</span>
        <span class="ws-order-actions">
          ${quick.map(([next, label]) => `<button type="button" class="is-primary" data-order-next="${esc(order.id)}" data-order-status="${esc(next)}">${esc(label)}</button>`).join('')}
          <button type="button" data-order-detail="${esc(order.id)}">Détail</button>
        </span>
      </footer>
    </article>`;
  }

  const FILTERS = [
    { id: 'new', label: 'Nouvelles', statuses: ['pending'] },
    { id: 'preparing', label: 'En préparation', statuses: ['confirmed', 'preparing'] },
    { id: 'ready', label: 'Prêtes', statuses: ['ready', 'out_for_delivery'] },
    { id: 'done', label: 'Terminées', statuses: ['completed'] },
    { id: 'cancelled', label: 'Annulées', statuses: ['cancelled', 'rejected'] },
  ];
  const board = { filter: 'new', orders: [] };

  function renderBoard() {
    const list = $('#wsOrderBoardList'); const filters = $('#wsOrderFilters'); const empty = $('#wsOrderBoardEmpty');
    if (!list || !filters) return;
    const counts = Object.fromEntries(FILTERS.map((row) => [row.id, board.orders.filter((order) => row.statuses.includes(order.status)).length]));
    filters.innerHTML = FILTERS.map((row) => `<button type="button" data-board-filter="${row.id}" aria-pressed="${board.filter === row.id}">${esc(row.label)}<span class="ws-count">${counts[row.id]}</span></button>`).join('');
    $$('[data-board-filter]', filters).forEach((button) => button.addEventListener('click', () => { board.filter = button.dataset.boardFilter; renderBoard(); }));
    const filter = FILTERS.find((row) => row.id === board.filter);
    const rows = board.orders.filter((order) => filter.statuses.includes(order.status));
    list.innerHTML = rows.map((order) => orderCard(order, window.__wsStatusLabels || {})).join('');
    if (empty) empty.hidden = rows.length > 0;
    const badge = $('#tileOrdersCount');
    if (badge) { badge.textContent = String(counts.new || 0); badge.hidden = !counts.new; }
    const hint = $('#tileOrdersHint');
    if (hint) hint.textContent = counts.new ? `${counts.new} nouvelle${counts.new > 1 ? 's' : ''} à traiter` : 'Recevoir et traiter';
  }

  function setOrders(orders) { board.orders = Array.isArray(orders) ? orders : []; renderBoard(); }

  function scanMessage(text, isError) {
    const node = $('#wsScanMessage'); if (!node) return;
    node.textContent = text || ''; node.hidden = !text; node.classList.toggle('is-error', Boolean(isError));
    if (text) node.classList.toggle('error', Boolean(isError));
  }

  function renderScanResult(result) {
    const box = $('#wsScanLast'); if (!box || !result) return;
    box.hidden = false;
    const point = result.servicePoint;
    $('#wsScanLastTitle').textContent = point ? `${point.type === 'table' ? 'Table' : 'Emplacement'} : ${point.name}` : 'QR de boutique reconnu';
    $('#wsScanLastDetail').textContent = point
      ? `${point.zone ? `${point.zone} · ` : ''}Commande sur place prête à être saisie.`
      : 'Choisissez la table ou l’emplacement, ou prenez une commande au comptoir.';
    $('#wsScanLastActions').innerHTML = `<button type="button" class="is-primary" data-scan-action="assisted">Prendre une commande</button><button type="button" data-scan-action="orders">Voir les commandes</button>`;
    $$('[data-scan-action]', box).forEach((button) => button.addEventListener('click', () => openTab(button.dataset.scanAction === 'orders' ? 'orders' : 'assisted')));
  }

  // ------------------------------------------------------------------ tailles décidées par le PDG
  // Le serveur renvoie huit tailles (14–30 px). Elles sont posées en variables CSS : les textes,
  // les boutons et les cartes grandissent ensemble, sans débordement (voir workspace.css).
  function applyTypography(sizes) {
    if (!sizes || typeof sizes !== 'object') return;
    const root = document.documentElement;
    const map = { title: '--ws-title', subtitle: '--ws-subtitle', text: '--ws-text', label: '--ws-label', button: '--ws-button', productName: '--ws-product-name', price: '--ws-price', orderInfo: '--ws-order-info' };
    for (const [key, variable] of Object.entries(map)) {
      const size = Number(sizes[key]);
      if (Number.isFinite(size)) root.style.setProperty(variable, `${Math.max(14, Math.min(30, Math.round(size)))}px`);
    }
  }

  function setGreeting(name) {
    state.merchantName = name || '';
    const title = $('#workspaceTitle');
    if (title && name) title.textContent = `Bonjour ${name}`;
  }

  function bind() {
    loadPins();
    state.menu = $('#workspaceMenu');
    renderMenu();

    // Tuiles d'accueil.
    $$('[data-home-action]').forEach((button) => button.addEventListener('click', () => open(button.dataset.homeAction)));
    // Boutons « aller à l'onglet » déjà présents dans les panneaux.
    $$('[data-go-tab]').forEach((button) => button.addEventListener('click', () => openTab(button.dataset.goTab)));
    // Scanner : ouverture directe de la caméra, permission demandée à ce moment-là seulement.
    $('#wsScanButton')?.addEventListener('click', () => {
      if (!window.QRMerchantScanner) { scanMessage('Le scanner n’a pas pu être chargé. Utilisez la saisie manuelle.', true); return; }
      // Le décodeur (257 Ko) n'est téléchargé qu'à l'ouverture réelle de la caméra.
      scanMessage('Ouverture de la caméra…');
      window.QRMerchantScanner.start({
        onRead: (value) => window.__wsScanRead?.(value),
        onError: (message) => scanMessage(message, true),
      }).catch((error) => scanMessage(error.message, true));
    });
    $('#wsScanManualForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = $('#wsScanManualInput').value.trim();
      if (!value) { scanMessage('Saisissez le code ou collez le lien du QR.', true); return; }
      window.__wsScanRead?.(value, 'manual');
    });

    document.addEventListener('click', (event) => {
      const hubTab = event.target.closest?.('[data-hub-tab]');
      if (hubTab) { openTab(hubTab.dataset.hubTab); return; }
      const pin = event.target.closest?.('[data-pin-rubric]');
      if (pin) { togglePin(pin.dataset.pinRubric); }
    });

    // Écoute globale : passerelles vers les fonctions déjà existantes de merchant.js.
    document.addEventListener('workspace:tab', (event) => {
      window.__wsOnTab?.(event.detail.tab);
    });
  }

  window.WorkspaceUI = {
    open, openTab, openRubric, renderMenu, renderHub, togglePin, setOrders, renderScanResult, applyTypography,
    scanMessage, setGreeting, orderCard, get active() { return state.active; },
    get pins() { return new Set(state.pins); },
    RUBRICS, FILTERS,
  };

  // Le script est chargé en defer : le corps du document est déjà lu. On branche tout de suite,
  // et on réessaie sur DOMContentLoaded si le navigateur n'a pas encore terminé l'analyse.
  function boot() {
    if (state.menu) { renderMenu(); return; }
    bind();
  }
  window.__wsBoot = boot;
  if (document.body) boot();
  document.addEventListener('DOMContentLoaded', boot, { once: true });
})();
