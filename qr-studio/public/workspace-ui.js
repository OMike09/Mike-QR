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
    logout: 'M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3M10 8l-4 4 4 4M6 12h9',
  };

  const svg = (name) => `<span class="ws-menu-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[name] || ICONS.list}"/></svg></span>`;

  // Une rubrique = un titre court + la liste des panneaux historiques qu'elle contient.
  // `extra` ajoute une entrée vers un onglet qui ne vit pas dans un panneau (ex. écran Scanner).
  // Une rubrique = un titre court + les outils qu'elle contient. Mission 11 : la gestion de
  // l'établissement est découpée en entrées cliquables (produits, catégories, tables, QR codes,
  // personnalisation) au lieu d'une seule page à faire défiler. Aucun outil n'est retiré :
  // chaque entrée ouvre un panneau déjà existant, ou une sous-section ciblée de celui-ci.
  const RUBRICS = [
    { id: 'home', label: 'Accueil', icon: 'home', items: [
      { tab: 'home', label: 'Vue d’ensemble', hint: 'Nouvelles commandes, en cours, terminées, tables', icon: 'chart' },
      { tab: 'orders', label: 'Commandes', hint: 'Recevoir et traiter, filtrer par étape', icon: 'orders' },
      { tab: 'scan', label: 'Scanner', hint: 'Caméra arrière, lecture automatique', icon: 'scan' },
      { tab: 'history', label: 'Voir les historiques', hint: 'Filtres par période et recherche', icon: 'clock' },
    ] },
    { id: 'ops', label: 'Commandes', icon: 'orders', items: [
      { tab: 'orders', label: 'Commandes reçues', hint: 'Cartes, filtres, actions rapides', icon: 'orders' },
      { tab: 'assisted', label: 'Prendre une commande', hint: 'Saisie assistée pour un client', icon: 'plus' },
      { tab: 'ops', label: 'Opérations', hint: 'Points, traçabilité, tables', icon: 'chart' },
      { tab: 'ops-messages', label: 'Messagerie', hint: 'Échanges avec l’équipe', icon: 'message' },
      { tab: 'notifications', label: 'Notifications', hint: 'Activité de la boutique', icon: 'bell' },
      { tab: 'scans', label: 'Scans & activation', hint: 'Statistiques de scans, étapes d’activation', icon: 'scan' },
    ] },
    { id: 'scan', label: 'Scanner', icon: 'scan', items: [
      { tab: 'scan', label: 'Scanner un QR', hint: 'Caméra arrière, action immédiate', icon: 'scan', scan: true },
      { tab: 'scans', label: 'Scans & activation', hint: 'Compteurs, historique, activation', icon: 'chart' },
    ] },
    // Rubrique dédiée : « Voir les historiques » est un écran à part entière (filtres + recherche),
    // et non un bloc déversé sur l'accueil.
    { id: 'history', label: 'Historiques', icon: 'clock', items: [
      { tab: 'history', label: 'Voir les historiques', hint: 'Commandes, scans, connexions, opérations, consignations', icon: 'clock' },
    ] },
    { id: 'catalog', label: 'Établissement', icon: 'shop', items: [
      // « Produits » ne déroule que le catalogue ; le formulaire s'ouvre à la demande.
      { tab: 'products', label: 'Produits', hint: 'Liste, prix, stock, photos', icon: 'box' },
      { tab: 'products', anchor: 'productCategoriesBlock', label: 'Catégories', hint: 'Ranger les produits par famille', icon: 'list' },
      { tab: 'ops', opsTab: 'tables', label: 'Tables et salons', hint: 'Emplacements et QR de table', icon: 'table' },
      { tab: 'store', anchor: 'storeQrSection', label: 'QR codes', hint: 'QR de boutique, téléchargement', icon: 'scan' },
      { tab: 'customize', label: 'Personnalisation', hint: 'Couleurs, police, sections du catalogue', icon: 'paint' },
      { tab: 'catalog', label: 'Catalogue général', hint: 'Modèles proposés à ajouter', icon: 'cart' },
    ] },
    { id: 'team', label: 'Équipe', icon: 'team', items: [
      { tab: 'team', label: 'Mon équipe', hint: 'Gérants, serveuses, demandes', icon: 'team' },
      { tab: 'ops', opsTab: 'points', label: 'Points et classement', hint: 'Activité des serveuses', icon: 'chart' },
    ] },
    { id: 'finance', label: 'Finances', icon: 'money', items: [
      { tab: 'consignment', label: 'Consignation', hint: 'Bouteilles et monnaie', icon: 'money' },
      { tab: 'advanced', label: 'Marketing & QR', hint: 'QR de table, offres, bons cadeaux', icon: 'ticket' },
    ] },
    { id: 'settings', label: 'Réglages', icon: 'gear', items: [
      // Mission 11 : « Apparence de mon interface » est la première entrée des réglages.
      { tab: 'appearance', label: 'Apparence de mon interface', hint: 'Trois thèmes, aperçu avant application', icon: 'paint' },
      { tab: 'account', label: 'Mon compte', hint: 'Sécurité et code personnel', icon: 'user' },
      { tab: 'store', anchor: 'storeProfileSection', label: 'Ma boutique', hint: 'Informations publiques', icon: 'shop' },
      { tab: 'notifications', label: 'Notifications', hint: 'Alertes et appareils', icon: 'bell' },
      { tab: 'history', label: 'Voir les historiques', hint: 'Toutes vos activités, filtrables', icon: 'clock' },
    ] },
  ];

  // Libellés courts pour les panneaux ouverts depuis un hub.
  const PANEL_TITLES = {
    'panel-orders': 'Commandes reçues', 'panel-assisted': 'Prendre une commande', 'panel-ops': 'Opérations',
    'panel-ops-messages': 'Messagerie', 'panel-notifications': 'Notifications', 'panel-scans': 'Scans & activation',
    'panel-store': 'Ma boutique', 'panel-products': 'Mes produits', 'panel-catalog': 'Catalogue',
    'panel-customize': 'Personnaliser', 'panel-team': 'Mon équipe', 'panel-consignment': 'Consignation',
    'panel-advanced': 'Marketing & QR', 'panel-account': 'Mon compte', 'panel-home': 'Vue d’ensemble',
    'panel-scan': 'Scanner un QR', 'panel-appearance': 'Apparence de mon interface', 'panel-history': 'Voir les historiques',
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
    // Une rubrique portant le même identifiant que l'écran gagne : « history » appartient à la
    // rubrique Historiques, pas à l'accueil (où elle est aussi proposée comme raccourci).
    const own = RUBRICS.find((rubric) => rubric.id === tabName);
    if (own && own.items.some((item) => item.tab === tabName)) return own;
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
    // « Se déconnecter » est toujours la dernière entrée du menu, après toutes les rubriques.
    // Il ne fait que déclencher le même appel serveur que le bouton de l'en-tête.
    menu.insertAdjacentHTML('beforeend', `<button type="button" class="ws-logout-entry" data-ws-logout-entry title="Se déconnecter">${svg('logout')}<span>Se déconnecter</span></button>`);
    $$('button[data-rubric]', menu).forEach((button) => button.addEventListener('click', () => open(button.dataset.rubric)));
    $('button[data-ws-logout-entry]', menu)?.addEventListener('click', () => window.__wsLogout?.());
  }

  // ------------------------------------------------------------------ affichage des panneaux
  // `railVisible` : la barre d'actions permanentes accompagne toutes les vues. Elle ne masque
  // jamais le contenu (elle est en flux, sous l'en-tête) et ne remplace aucune tuile.
  function homeTiles() { return document.getElementById('homeTiles'); }
  function historyPanel() { return document.getElementById('panel-history'); }

  function setPanels(name) {
    $$('.panel').forEach((node) => {
      // Les panneaux « hub » sont pilotés par leur rubrique, pas par cette fonction.
      if (node.classList.contains('ws-hub')) { node.hidden = true; return; }
      node.hidden = node.id !== `panel-${name}`;
    });
    // Un seul panneau visible : si un ancien code a laissé deux panneaux ouverts, on le corrige.
    const visible = $$('.panel:not(.ws-hub)').filter((node) => !node.hidden);
    if (visible.length > 1) visible.slice(1).forEach((node) => { node.hidden = true; });
  }

  // La barre d'accueil (Commandes / Scanner / Vue d'ensemble) ne disparaît plus jamais :
  // elle est un élément de navigation permanent, pas le contenu de la page d'accueil.
  function renderRail() {
    const rail = document.getElementById('wsPermanentRail');
    if (!rail) return;
    $$('[data-rail]', rail).forEach((button) => {
      const target = button.dataset.rail;
      const current = target === 'home' ? state.active === 'home' : state.active === target;
      button.setAttribute('aria-current', current ? 'page' : 'false');
    });
  }

  // `toggleTiles` reste exporté pour les appels historiques : il ne fait plus rien de visible.
  // Les tuiles d'accueil restent à leur place à chaque changement de vue (exigence du sous-prompt 3).
  function toggleTiles() { /* les raccourcis permanents ne sont plus masqués */ }

  function renderHomeTiles() {
    const root = homeTiles();
    if (!root) return;
    // Les trois tuiles sont toujours présentes, dans cet ordre, quel que soit l'endroit où l'on
    // se trouve. Les compteurs restent alimentés par les appels serveur existants.
    if (!root.querySelector('[data-home-action="overview"]')) {
      root.insertAdjacentHTML('afterbegin', `<button class="ws-tile" type="button" data-home-action="overview">
        <div class="ws-tile-top"><span class="ws-tile-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 8h6V4h-6z"/></svg></span>
        <span class="ws-tile-text"><span class="ws-tile-label">Vue d’ensemble</span><span class="ws-tile-hint">Nouvelles commandes, en cours, tables</span></span></div></button>`);
    }
    root.hidden = false;
  }

  function renderHub(rubric) {
    const panel = $(`#panel-hub-${rubric.id}`); if (!panel) return;
    const items = rubric.items.filter((item, index, rows) => rows.findIndex((row) => row.tab === item.tab && row.anchor === item.anchor && row.opsTab === item.opsTab) === index);
    panel.innerHTML = `
      <div class="ws-hub-head"><span class="eyebrow">${esc(rubric.label.toUpperCase())}</span><h2>${esc(rubric.label)}</h2>
        <p>Choisissez une rubrique. Rien n’a été supprimé : chaque outil reste à sa place.</p></div>
      <div class="ws-hub-grid">${items.map((item) => `
        <div class="ws-hub-card${state.pins.has(rubric.id) ? ' is-highlighted' : ''}">
          <button class="ws-hub-open" type="button" data-hub-tab="${esc(item.tab)}"${item.anchor ? ` data-hub-anchor="${esc(item.anchor)}"` : ''}${item.opsTab ? ` data-hub-ops="${esc(item.opsTab)}"` : ''} data-hub-label="${esc(item.label)}"${item.scan ? ' data-hub-scan="true"' : ''}${item.tab === 'history' ? ' data-history-entry="true"' : ''}>
            <span class="ws-tile-icon" aria-hidden="true">${svg(item.icon)}</span>
            <span><strong>${esc(item.label)}</strong><small>${esc(item.hint)}</small></span>
          </button>
          <button class="ws-pin" type="button" data-pin-rubric="${esc(rubric.id)}" aria-pressed="${state.pins.has(rubric.id)}"
            aria-label="${state.pins.has(rubric.id) ? 'Retirer la mise en exergue' : 'Mettre cette rubrique en exergue'}" title="Mettre en exergue">★</button>
        </div>`).join('')}</div>
      <p class="ws-hub-note">★ met la rubrique en tête du menu. L’accueil, les commandes, le scanner et les historiques restent toujours accessibles.</p>
      <button type="button" class="ws-hub-history" data-history-entry="true">${svg('clock')}<span>Voir les historiques</span></button>`;
  }

  // Vue active mémorisée localement : au rechargement, on retrouve l'écran quitté (et non une
  // page blanche ou l'accueil par défaut). Ce n'est qu'un confort d'affichage : aucune permission
  // n'est lue ici, le serveur reste seul juge de ce qui est autorisé.
  const VIEW_KEY = 'oymike:workspace-view:v1';
  const KNOWN_VIEWS = () => new Set([...RUBRICS.map((row) => row.id), ...RUBRICS.flatMap((row) => row.items.map((item) => item.tab)), 'home']);

  function rememberView() {
    try {
      const view = state.active && state.active !== 'home' ? state.active : 'home';
      localStorage.setItem(VIEW_KEY, JSON.stringify({ view, at: Date.now() }));
    } catch (_) {}
  }
  function rememberedView() {
    try {
      const raw = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
      if (!raw) return '';
      if (Date.now() - Number(raw.at || 0) > 12 * 60 * 60 * 1000) return '';
      if (!KNOWN_VIEWS().has(raw.view)) return '';
      // Une rubrique sans aucun outil autorisé ne doit pas rouvrir une page vide.
      const rubric = RUBRICS.find((row) => row.id === raw.view);
      if (rubric) {
        const panel = document.getElementById(`panel-hub-${rubric.id}`);
        if (!panel) return '';
      }
      return raw.view;
    } catch (_) { return ''; }
  }

  function openRubric(id, { fromBack = false } = {}) {
    const rubric = RUBRICS.find((row) => row.id === id); if (!rubric) return;
    state.active = id;
    renderMenu();
    state.navFromBack = fromBack;
    // La vue affichée devient la rubrique : le bouton Retour ne doit plus la proposer.
    state.backView = `rubric:${id}`;
    rememberView();
    // Les fonctions de terrain sont des écrans directs : aucune page intermédiaire.
    if (rubric.id === 'home') { openTab('home'); return; }
    if (rubric.id === 'scan') { openTab('scan'); return; }
    if (rubric.id === 'orders') { openTab('orders', true, { label: 'Commandes' }); return; }
    if (rubric.id === 'history') { openTab('history'); return; }
    renderHub(rubric);
    setPanels(`hub-${id}`);
    // `setPanels` masque tous les panneaux « hub » ; ici c'est bien le hub de la rubrique qu'on
    // veut afficher, et lui seul.
    const hubPanel = document.getElementById(`panel-hub-${id}`);
    if (hubPanel) hubPanel.hidden = false;
    renderRail();
    showBackBar(true, rubric.label);
    // L'historique n'est empilé que si l'appel vient d'un clic (pas d'un retour).
    // L'historique est empilé par open()/openItem() : ici on ne fait qu'afficher la vue.
    state.navFromBack = false;
    window.scrollTo?.({ top: 0, behavior: 'auto' });
  }

  function highlightTab(tabName) {
    $$('.tab').forEach((node) => node.classList.toggle('active', node.dataset.tab === tabName));
  }

  // Barre de retour : visible dès qu'on quitte l'accueil. Elle ramène à la vue précédente
  // (historique interne), sans rechargement et sans perdre une saisie en cours.
  function backBar() {
    let bar = $('#wsBackBar');
    if (bar) return bar;
    const host = $('.app-wrap') || $('.staff-app') || document.body;
    bar = document.createElement('div');
    bar.id = 'wsBackBar';
    bar.className = 'ws-backbar';
    bar.hidden = true;
    bar.innerHTML = `<button type="button" class="ws-back-button" data-ws-back-home="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg><span>Retour</span></button><span class="ws-crumb" id="wsCrumb"></span>`;
    // Placée AVANT la barre permanente : elle ne la recouvre jamais et ne la remplace jamais.
    const rail = document.getElementById('wsPermanentRail');
    if (rail && rail.parentNode === host) host.insertBefore(bar, rail);
    else host.insertBefore(bar, host.firstElementChild?.nextElementSibling || host.firstElementChild || null);
    // Le clic est branché par WorkspaceShell (installation unique) : pas de double retour.
    return bar;
  }
  function showBackBar(visible, label = '') {
    const bar = backBar();
    // La barre peut être créée après le chargement du script : on rebranche son bouton ici.
    window.WorkspaceShell?.installBackButtons();
    bar.hidden = !visible;
    const crumb = $('#wsCrumb', bar);
    if (crumb) crumb.textContent = visible ? label : '';
  }

  // `notify = false` quand c'est merchant.js qui pilote déjà l'onglet : évite tout aller-retour.
  function openTab(tabName, notify = true, options = {}) {
    const rubric = rubricForTab(tabName);
    // Les écrans de terrain (vue d'ensemble, commandes, scanner, historiques) sont leur propre
    // identité : c'est ce qui permet à la barre permanente de montrer l'endroit exact où l'on est.
    if (['home', 'orders', 'scan', 'history'].includes(tabName)) state.active = tabName;
    else if (rubric) state.active = rubric.id;
    if (rubric) renderMenu();
    // Ouvrir un outil masque son hub : le retour se fait par le bouton Retour ou le menu.
    const hub = $(`#panel-hub-${rubric?.id}`);
    if (hub) hub.hidden = true;
    setPanels(tabName === 'scan' ? 'scan' : tabName);
    // La barre permanente reste affichée et ne recouvre pas le contenu : aucune tuile n'est
    // retirée de l'accueil quand on ouvre une page secondaire.
    renderRail();
    highlightTab(tabName);
    state.backView = tabName;
    rememberView();
    window.scrollTo?.({ top: 0, behavior: 'auto' });
    showBackBar(tabName !== 'home', options.label || PANEL_TITLES[`panel-${tabName}`] || '');
    if (tabName === 'history') window.HistoryView?.open();
    if (tabName === 'home') window.OverviewView?.open();
    // Une carte de la vue d'ensemble ouvre la liste de commandes déjà filtrée : le filtre du
    // tableau de bord marchand est appliqué ici, sans rechargement de page.
    if (tabName === 'orders' && options.overviewView) {
      const label = { new: 'Nouvelles', active: 'En cours', done: 'Terminées' }[options.overviewView] || 'Nouvelles';
      const apply = (tries = 0) => {
        const button = $$('[data-board-filter]').find((node) => (node.textContent || '').toLowerCase().includes(label.toLowerCase()));
        if (button) { button.click(); return; }
        if (tries < 6) setTimeout(() => apply(tries + 1), 180);
      };
      apply();
    }
    if (options.opsTab) {
      // Ouvre directement la bonne section d'Opérations (tables, points…) au lieu de la page entière.
      const button = $(`[data-ops-tab="${options.opsTab}"]`);
      button?.click();
    }
    if (options.anchor) {
      // Amène l'utilisateur sur la zone demandée, sans lui faire parcourir toute la page.
      requestAnimationFrame(() => {
        const target = document.getElementById(options.anchor);
        if (!target) return;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target.classList.add('ws-anchor-flash');
        setTimeout(() => target.classList.remove('ws-anchor-flash'), 1400);
      });
    }
    if (notify) document.dispatchEvent(new CustomEvent('workspace:tab', { detail: { tab: tabName, ...options } }));
  }

  // Ouvre l'entrée choisie dans une rubrique (onglet + section ciblée).
  // Une entrée de rubrique : on empile la vue dans l'historique, puis on l'ouvre réellement.
  function openItem(item) {
    if (!item) return;
    // Rubrique « Scanner » : la caméra s'ouvre immédiatement, sans étape intermédiaire.
    if (item.scan) { document.getElementById('wsPermanentRail')?.querySelector('[data-rail="scan"]')?.click(); return; }
    const target = { tab: item.tab, anchor: item.anchor, opsTab: item.opsTab, label: item.label };
    // On mémorise le hub d'où l'on part : « Retour » remonte à la liste des rubriques.
    rememberHere();
    openTab(item.tab, true, target);
  }

  // Historique : la pile contient les vues déjà visitées ; la vue affichée reste en dehors.
  // `rememberHere()` est appelée juste avant de changer d'écran.
  function rememberHere() {
    // On empile l'écran quitté (rubrique ou onglet), jamais l'écran où l'on arrive.
    const view = state.backView || (state.active ? `rubric:${state.active}` : 'home');
    window.WorkspaceShell?.pushView(view);
  }

  function open(id) {
    // Une seule voie d'affichage : openRubric décide ensuite si la rubrique est un écran direct
    // (accueil, commandes, scanner, historiques) ou une liste d'outils. Cela évite les états
    // incohérents du type « l'accueil reste affiché après un clic sur Commandes ».
    // Un second clic sur une rubrique déjà ouverte ne recharge rien : il ramène simplement à son
    // point d'entrée, sans perdre une saisie en cours.
    const sameRubric = state.active === id;
    if (!sameRubric) rememberHere();
    if (id === 'orders') { openTab('orders', true, { label: 'Commandes' }); return; }
    if (id === 'home') { openTab('home', true); return; }
    if (id === 'scan') { openTab('scan', true, { label: 'Scanner' }); return; }
    openRubric(id, { fromBack: sameRubric });
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

  // La prise de commande assistée doit exister pour y rediriger le scan (sinon on reste sur le scan).
  function hasAssistedPanel() { return Boolean(document.getElementById('panel-assisted')); }

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

    // Barre permanente : Commandes / Scanner / Vue d'ensemble, accessibles depuis toutes les vues.
    const rail = document.getElementById('wsPermanentRail');
    if (rail) {
      $$('[data-rail]', rail).forEach((button) => button.addEventListener('click', () => open(button.dataset.rail)));
    }
    renderRail();
    // Tuiles d'accueil : toujours présentes, jamais masquées.
    renderHomeTiles();
    $$('[data-home-action]').forEach((button) => button.addEventListener('click', () => open(button.dataset.homeAction)));
    // Boutons « aller à l'onglet » déjà présents dans les panneaux.
    $$('[data-go-tab]').forEach((button) => button.addEventListener('click', () => openTab(button.dataset.goTab)));
    // Scanner : ouverture directe de la caméra, permission demandée à ce moment-là seulement.
    $('#wsScanButton')?.addEventListener('click', openCamera);
    // Après un scan réussi, on se place directement sur la prise de commande (redirection
    // immédiate vers la fonction correspondante), sans perdre la table reconnue.
    function openCamera() {
      scanMessage('');
      if (!window.QrCamera) { scanMessage('Le scanner n’a pas pu être chargé. Utilisez la saisie manuelle ci-dessous.', true); return; }
      // Aucune photo, aucune vidéo : seul le flux de l'aperçu est utilisé, puis coupé aussitôt.
      window.QrCamera.open({
        title: 'Scanner un QR de table ou de boutique',
        hint: 'Placez le QR dans le cadre : la lecture est automatique.',
        // Redirection immédiate vers la fonction correspondante : la commande assistée, table
        // déjà renseignée par le code lu. Aucune étape intermédiaire, aucune photo conservée.
        onRead: async (value, via) => {
          const step = hasAssistedPanel();
          if (step) openTab('assisted', true, { label: 'Prendre une commande' });
          scanMessage('QR lu : vérification auprès du serveur…');
          await Promise.resolve(window.__wsScanRead?.(value, via || 'scanner')).catch(() => {});
          if (!step) openTab('scan', false);
        },
        onError: (message) => scanMessage(message, true),
        // Repli sans caméra : on ouvre la prise de commande, table choisissable dans la liste.
        onChooseTable: () => openTab('assisted', true, { label: 'Choisir la table' }),
      }).catch((error) => scanMessage(error.message, true));
    }
    window.__wsOpenCamera = openCamera;

    $('#wsScanManualForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = $('#wsScanManualInput').value.trim();
      if (!value) { scanMessage('Saisissez le code ou collez le lien du QR.', true); return; }
      window.__wsScanRead?.(value, 'manual');
    });

    document.addEventListener('click', (event) => {
      if (event.target.closest?.('[data-history-entry]')) { openTab('history', true, { label: 'Voir les historiques' }); return; }
      const hubTab = event.target.closest?.('[data-hub-tab]');
      if (hubTab) {
        const { hubTab: tab, hubAnchor: anchor, hubOps: opsTab, hubLabel: label } = hubTab.dataset;
        rememberHere();
        openTab(tab, true, { anchor, opsTab, label });
        return;
      }
      const pin = event.target.closest?.('[data-pin-rubric]');
      if (pin) { togglePin(pin.dataset.pinRubric); }
    });

    // Écoute globale : passerelles vers les fonctions déjà existantes de merchant.js.
    document.addEventListener('workspace:tab', (event) => {
      window.__wsOnTab?.(event.detail.tab, event.detail);
    });
    // Bouton retour du téléphone : on revient à la vue précédente sans quitter l'espace.
    document.addEventListener('workspace:back', (event) => {
      const raw = (event.detail?.view || 'home');
      const view = raw.startsWith('rubric:') ? raw.slice(7) : raw;
      const rubric = RUBRICS.find((row) => row.id === view);
      if (rubric) { openRubric(view, { fromBack: true }); return; }
      // Vue inconnue (onglet ouvert directement) : on revient au hub de sa rubrique.
      const owner = rubricForTab(view);
      if (owner) { openRubric(owner.id, { fromBack: true }); return; }
      openTab('home', false);
      window.__wsOnTab?.('home', { fromBack: true });
    });
    // Un « go » (bouton Retour d'un autre écran) est traité comme un changement de vue.
    document.addEventListener('workspace:go', (event) => {
      const raw = event.detail?.view || 'home';
      const view = raw.startsWith('rubric:') ? raw.slice(7) : raw;
      if (RUBRICS.some((row) => row.id === view)) { openRubric(view, { fromBack: true }); return; }
      openTab(view, false);
    });
  }

  window.WorkspaceUI = {
    open, openTab, openRubric, openItem, renderMenu, renderHub, togglePin, setOrders, renderScanResult, applyTypography,
    loadAppearance, renderAppearance, applyAppearance, get appearance() { return { ...appearanceState }; },
    scanMessage, setGreeting, orderCard, showBackBar, renderRail, renderHomeTiles, restoreView, toggleTiles,
    get active() { return state.active; },
    get pins() { return new Set(state.pins); },
    RUBRICS, FILTERS,
  };

  // ------------------------------------------------------------------ apparence de l'interface
  // Trois thèmes, aperçu avant application, choix conservé en base. Le thème est posé sur <html>
  // par WorkspaceShell ; ici on ne gère que l'écran de choix.
  const APPEARANCE_FALLBACK = [
    { id: 'green', label: 'Vert et blanc', hint: 'Le thème actuel, nature et lisible.',
      colors: { bg: '#f3f7f4', surface: '#ffffff', ink: '#162622', muted: '#55655e', line: '#dbe6df', accent: '#0d725c', accentText: '#ffffff', soft: '#e9f5ef', highlightSoft: '#fdf5e4', highlight: '#a8761c', surfaceAlt: '#f7fbf8' } },
    { id: 'black-gold', label: 'Noir et or', hint: 'Élégant et haut de gamme.',
      colors: { bg: '#111214', surface: '#1a1c1f', ink: '#f6f1e6', muted: '#b8b1a1', line: '#33373d', accent: '#d4af37', accentText: '#141414', soft: '#2a2a24', highlightSoft: '#332d1c', highlight: '#f0cf6a', surfaceAlt: '#202327' } },
    { id: 'blue-white', label: 'Blanc et bleu', hint: 'Moderne, clair et professionnel.',
      colors: { bg: '#f4f7fc', surface: '#ffffff', ink: '#12203a', muted: '#55627a', line: '#d8e2f1', accent: '#1f5fd0', accentText: '#ffffff', soft: '#e8f0fe', highlightSoft: '#fdf3e2', highlight: '#a2620c', surfaceAlt: '#f7f9fd' } },
  ];
  const appearanceState = { saved: 'green', preview: 'green', mode: 'default', imposed: null, catalog: APPEARANCE_FALLBACK, loaded: false, busy: false };

  function setAppearanceStatus(message, error = false) {
    const node = $('#appearanceStatus'); if (!node) return;
    node.textContent = message; node.style.color = error ? 'var(--ui-danger, #b3261e)' : '';
  }
  function themeById(id) { return appearanceState.catalog.find((row) => row.id === id) || appearanceState.catalog[0]; }

  // L'aperçu applique réellement le thème : les couleurs montrées sont celles de l'écran final.
  function previewTheme(id) {
    appearanceState.preview = id;
    const preview = $('#appearancePreview');
    if (preview) preview.setAttribute('data-preview-theme', id);
    $$('[data-theme-option]').forEach((button) => button.setAttribute('aria-checked', String(button.dataset.themeOption === id)));
    const label = $('#appearancePreviewLabel');
    if (label) label.textContent = `Aperçu : ${themeById(id).label}`;
    // Le bouton « Annuler l'aperçu » n'apparaît que si l'aperçu diffère du thème enregistré.
    const cancel = $('#cancelAppearance');
    if (cancel) cancel.hidden = id === appearanceState.saved;
    const apply = $('#applyAppearance');
    if (apply) { apply.disabled = appearanceState.busy || Boolean(appearanceState.imposed) || id === appearanceState.saved; }
  }

  function renderAppearance(data) {
    const catalog = Array.isArray(data?.catalog) && data.catalog.length ? data.catalog : APPEARANCE_FALLBACK;
    appearanceState.catalog = catalog;
    appearanceState.saved = data?.merchantChoice || data?.theme || window.WorkspaceShell?.localTheme() || 'green';
    appearanceState.mode = data?.mode || 'default';
    // « Imposé » = le PDG a décidé pour tout le monde : le choix du marchand est désactivé.
    appearanceState.imposed = data?.mode === 'imposed' ? true : null;
    appearanceState.loaded = true;
    const grid = $('#appearanceThemeGrid');
    if (grid) {
      grid.innerHTML = catalog.map((theme) => {
        const c = theme.colors || themeById(theme.id).colors;
        return `<button type="button" class="ws-theme-option" role="radio" aria-checked="false" data-theme-option="${esc(theme.id)}">
          <span class="ws-theme-swatch" aria-hidden="true">
            <span style="background:${esc(c.bg)};color:${esc(c.ink)}">Aa</span>
            <span style="background:${esc(c.accent)};color:${esc(c.accentText)}">Bouton</span>
            <span style="background:${esc(c.surface)};color:${esc(c.muted)}">Carte</span>
          </span>
          <span class="ws-theme-option-head"><span><strong>${esc(theme.label)}</strong><small>${esc(theme.hint || '')}</small></span><span class="ws-theme-check" aria-hidden="true">✓</span></span>
        </button>`;
      }).join('');
      $$('[data-theme-option]', grid).forEach((button) => button.addEventListener('click', () => {
        if (appearanceState.imposed) { setAppearanceStatus('L’Administrateur général a imposé ce thème : le choix est désactivé.', true); return; }
        previewTheme(button.dataset.themeOption);
        setAppearanceStatus('Aperçu affiché. Cliquez sur « Appliquer » pour conserver ce thème.');
      }));
    }
    const notice = $('#appearanceImposedNotice');
    if (notice) {
      const imposed = appearanceState.imposed;
      notice.hidden = !imposed;
      if (imposed) notice.textContent = `L’Administrateur général a imposé le thème « ${themeById(appearanceState.saved).label} » à tous les établissements.`;
    }
    // Thème réellement appliqué maintenant (peut être imposé).
    window.WorkspaceShell?.applyTheme(data?.theme || appearanceState.saved);
    previewTheme(data?.theme || appearanceState.saved);
  }

  async function loadAppearance() {
    try {
      const response = await fetch('/api/merchant/appearance', { credentials: 'same-origin' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Erreur ${response.status}`);
      renderAppearance(payload.data);
      setAppearanceStatus('Apparence chargée.');
    } catch (error) {
      // Hors connexion, l'appareil garde le dernier thème connu : l'écran reste utilisable.
      renderAppearance({ catalog: APPEARANCE_FALLBACK, theme: window.WorkspaceShell?.localTheme() || 'green' });
      setAppearanceStatus(`Aperçu local : ${error.message}`, true);
    }
  }

  async function applyAppearance() {
    if (appearanceState.busy || appearanceState.imposed) return;
    const theme = appearanceState.preview;
    appearanceState.busy = true;
    const button = $('#applyAppearance'); if (button) button.disabled = true;
    setAppearanceStatus('Application…');
    try {
      const response = await fetch('/api/merchant/appearance', { method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Erreur ${response.status}`);
      appearanceState.saved = payload.data?.theme || theme;
      window.WorkspaceShell?.applyTheme(appearanceState.saved);
      setAppearanceStatus(`Thème « ${themeById(appearanceState.saved).label} » appliqué et enregistré.`);
      document.dispatchEvent(new CustomEvent('workspace:theme', { detail: { theme: appearanceState.saved } }));
    } catch (error) {
      // L'aperçu reste affiché, mais rien n'est enregistré : l'utilisateur le sait clairement.
      setAppearanceStatus(`Non enregistré : ${error.message}`, true);
    } finally {
      appearanceState.busy = false;
      previewTheme(appearanceState.preview);
    }
  }

  function bindAppearance() {
    $('#applyAppearance')?.addEventListener('click', applyAppearance);
    $('#cancelAppearance')?.addEventListener('click', () => {
      previewTheme(appearanceState.saved);
      window.WorkspaceShell?.applyTheme(appearanceState.saved);
      setAppearanceStatus('Aperçu annulé : le thème enregistré reste appliqué.');
    });
    // Ouvrir le panneau charge l'état réel (une seule fois, puis à chaque ouverture).
    document.addEventListener('workspace:tab', (event) => {
      if (event.detail?.tab === 'appearance') loadAppearance();
    });
  }

  // Le script est chargé en defer : le corps du document est déjà lu. On branche tout de suite,
  // et on réessaie sur DOMContentLoaded si le navigateur n'a pas encore terminé l'analyse.
  // Restauration de la vue : après actualisation, rechargement ou reconnexion, on revient sur
  // l'écran quitté. Une seule tentative par chargement, et seulement si l'espace est ouvert.
  let restored = false;
  function restoreView() {
    if (restored) return;
    const app = document.getElementById('appView');
    if (!app || app.hidden) return;
    restored = true;
    const target = rememberedView();
    if (!target || target === 'home') { openTab('home', false); window.__wsOnTab?.('home', { restored: true }); return; }
    const rubric = RUBRICS.find((row) => row.id === target);
    if (rubric) openRubric(target, { fromBack: true });
    else {
      const owner = rubricForTab(target);
      if (owner) state.active = owner.id;
      openTab(target, false);
      window.__wsOnTab?.(target, { restored: true });
    }
    renderMenu();
    renderRail();
  }
  window.__wsRestoreView = restoreView;

  function boot() {
    if (state.menu) { renderMenu(); renderRail(); return; }
    bind();
    bindAppearance();
    // L'espace marchand s'ouvre après la réponse /auth/me : on observe ce passage pour restaurer
    // la vue sans dépendre de l'ordre exact des scripts.
    const app = document.getElementById('appView');
    if (app) {
      const observer = new MutationObserver(() => { if (!app.hidden) { restoreView(); observer.disconnect(); } });
      observer.observe(app, { attributes: true, attributeFilter: ['hidden'] });
      if (!app.hidden) restoreView();
    }
  }
  window.__wsBoot = boot;
  if (document.body) boot();
  document.addEventListener('DOMContentLoaded', boot, { once: true });
})();
