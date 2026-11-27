'use strict';

// ============================================================================================
// MISSION 13 — Accueil marchand « maquette client ».
//
// Cette page est la première chose que voit le marchand. Elle reprend la disposition demandée :
//   en-tête (logo/photo, nom, secteur, choix du thème) · trois actions (Commandes, Scanner,
//   Vue d'ensemble) · « Activité en cours » · scanner intégré · tables et espaces · Mon équipe /
//   Mes comptes créés · Thèmes personnalisables · rappel de service.
//
// Règles suivies ici :
//   · AUCUNE donnée inventée : tout vient des API existantes (/api/overview, /api/merchant/store,
//     /api/merchant/table-management, /api/merchant/member-accounts, /api/merchant/appearance) ;
//   · aucun doublon de logique : les boutons « Vue d'ensemble », « Ajouter une table »,
//     « Créer un compte » ouvrent les écrans déjà validés (missions 11 et 12) ;
//   · aucun écran vide : si une API ne répond pas, la carte affiche la raison et un bouton
//     « Réessayer » — jamais un bloc muet ;
//   · l'accueil n'est affiché QUE sur l'accueil : ouvrir une autre rubrique le masque (le retour
//     le réaffiche), ce qui évite le mélange « deux pages l'une sous l'autre ».
// ============================================================================================
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const num = (value) => new Intl.NumberFormat('fr-FR').format(Number(value) || 0);

  const ICONS = {
    cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2l2.2 10.2A2 2 0 0 0 9.2 16h8.4a2 2 0 0 0 2-1.6L21 7H6"/><circle cx="10" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3.2 2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.4l2.6 2.6L16 9.5"/></svg>',
    table: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h18M6 8v12M18 8v12M6 13h12"/></svg>',
  };

  const SECTOR_LABELS = {
    general: 'Commerce général', restaurant: 'Restaurant', maquis: 'Maquis · Bar · Restaurant',
    hardware: 'Quincaillerie', clothing: 'Vêtements', outdoor: 'Espace plein air',
  };
  const ROLE_LABELS = { general_manager: 'Gérant général', waitress: 'Serveuse', waitress_server: 'Serveuse / serveur', manager: 'Gérant' };
  const THEME_LABELS = { green: 'Vert - Blanc', 'black-gold': 'Noir - Or', 'blue-white': 'Blanc - Bleu' };
  const THEME_SWATCHES = {
    green: { bar: '#0d725c', bg: '#ffffff', soft: '#e9f5ef', ink: '#162622' },
    'black-gold': { bar: '#d4af37', bg: '#1a1c1f', soft: '#2a2a24', ink: '#f6f1e6' },
    'blue-white': { bar: '#1f5fd0', bg: '#ffffff', soft: '#e8f0fe', ink: '#12203a' },
  };
  const STATUS_META = {
    active: { label: 'Actif', cls: 'is-active' },
    pending: { label: 'En attente', cls: 'is-pending' },
    suspended: { label: 'Suspendu', cls: 'is-off' },
    blocked: { label: 'Bloqué', cls: 'is-off' },
    archived: { label: 'Archivé', cls: 'is-off' },
  };

  const state = {
    shell: null, loaded: false, loading: false,
    store: null, overview: null, tables: null, team: null,
    banner: null, heroPhotoTried: false, selectedTheme: '', savedTheme: '', themeBusy: false,
    errors: {},
  };

  function api(url, options = {}) {
    return fetch(url, { credentials: 'same-origin', ...options, headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `Erreur ${response.status}`);
        return payload.data ?? payload;
      });
  }

  function notify(message, tone = '') {
    if (typeof window.merchantToast === 'function') { window.merchantToast(message); return; }
    const node = $('#toast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('visible');
    if (tone === 'error') node.classList.add('is-error');
    setTimeout(() => { node.classList.remove('visible'); node.classList.remove('is-error'); }, 3600);
  }

  // ------------------------------------------------------------------ visibilité
  // L'accueil et les autres panneaux ne se superposent jamais : une seule vue à l'écran.
  function shell() { return state.shell || (state.shell = document.getElementById('merchantHomeShell')); }

  function showHome(visible) {
    const node = shell();
    if (!node) return;
    node.hidden = !visible;
    // La barre permanente est masquée sur l'accueil (les trois grandes cartes la remplacent) et
    // réaffichée ailleurs : c'est le seul état partagé avec la feuille de style.
    document.body.dataset.mhHome = visible ? 'true' : 'false';
    if (!visible) closeCamera();
  }

  // ------------------------------------------------------------------ 1. en-tête
  function renderHero() {
    const store = state.store || {};
    const name = store.name || '';
    $('#mhStoreName').textContent = name || 'Ma boutique';
    const sector = SECTOR_LABELS[String(store.sector || '').toLowerCase()] || 'Établissement';
    $('#mhStoreSector').textContent = sector;
    document.title = name ? `${name} — Espace marchand Oymike Tech` : 'Oymike Tech — Espace marchand';

    // La photo de la boutique si elle existe, sinon le monogramme : jamais de bloc vide.
    const logo = $('#mhHeroLogo');
    if (logo) {
      const photo = storePhoto(store) || (logo.querySelector('img')?.getAttribute('src') || '');
      if (photo) {
        logo.innerHTML = `<img src="${esc(photo)}" alt="Photo de ${esc(name || 'la boutique')}" loading="lazy" decoding="async">`;
      } else if (store.logo) {
        logo.innerHTML = `<img src="${esc(store.logo)}" alt="Photo de ${esc(name || 'la boutique')}" loading="lazy" decoding="async">`;
      } else {
        const initials = (name || 'Oymike').trim().split(/\s+/).map((word) => word[0] || '').join('').slice(0, 3).toUpperCase();
        logo.innerHTML = `<span>${esc(initials || 'OY')}</span>`;
      }
    }
  }

  function renderThemePicker() {
    const active = state.savedTheme || window.WorkspaceShell?.localTheme?.() || 'green';
    state.savedTheme = active;
    if (!state.selectedTheme) state.selectedTheme = active;
    $$('[data-mh-theme]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.mhTheme === active));
    });
  }

  async function pickTheme(theme, { announce = true } = {}) {
    // Un seul geste : le thème est appliqué ET enregistré sur le serveur (même route que la
    // rubrique « Apparence de mon interface »). En cas d'échec, on revient au thème enregistré.
    if (state.themeBusy) return;
    state.themeBusy = true;
    const previous = state.savedTheme;
    window.WorkspaceShell?.applyTheme?.(theme, { remember: false });
    try {
      const data = await api('/api/merchant/appearance', { method: 'PUT', body: JSON.stringify({ theme }) });
      state.savedTheme = data?.theme || theme;
      window.WorkspaceShell?.applyTheme?.(state.savedTheme);
      renderThemePicker(); renderThemeOptions();
      if (announce) notify(`Thème « ${THEME_LABELS[state.savedTheme] || state.savedTheme} » appliqué.`);
      document.dispatchEvent(new CustomEvent('workspace:theme', { detail: { theme: state.savedTheme } }));
    } catch (error) {
      window.WorkspaceShell?.applyTheme?.(previous);
      renderThemePicker();
      if (announce) notify(`Thème non enregistré : ${error.message}`, 'error');
      throw error;
    } finally {
      state.themeBusy = false;
    }
  }

  // ------------------------------------------------------------------ 2. activité en cours
  function renderActivity() {
    const host = $('#mhActivity');
    if (!host) return;
    const data = state.overview;
    if (state.errors.overview || !data) {
      host.innerHTML = `<div class="mh-activity-cell" style="grid-column:1/-1">
        <strong style="font-size:15px">Chiffres indisponibles</strong>
        <small>${esc(state.errors.overview || 'Chargement…')}</small>
        <button type="button" class="mh-btn-outline" data-mh-retry="overview" style="margin-top:8px">Réessayer</button></div>`;
      return;
    }
    const cards = Array.isArray(data.cards) ? data.cards : [];
    const pick = (id) => cards.find((card) => card.id === id) || { value: 0 };
    const tables = pick('tables');
    const cells = [
      { id: 'new', icon: ICONS.cart, label: 'Nouvelles commandes', value: pick('new').value, go: 'orders', view: 'new' },
      { id: 'active', icon: ICONS.clock, label: 'Commandes en cours', value: pick('active').value, go: 'orders', view: 'active' },
      { id: 'done', icon: ICONS.check, label: 'Commandes terminées', value: pick('done').value, go: 'orders', view: 'done' },
      { id: 'tables', icon: ICONS.table, label: 'Tables occupées', value: tables.value, hint: tables.hint || '', go: 'tables' },
    ];
    host.innerHTML = cells.map((cell) => `<button type="button" class="mh-activity-cell is-clickable" data-mh-go="${cell.id}" data-mh-view="${cell.view || ''}">
      <span class="mh-activity-ico" aria-hidden="true">${cell.icon}</span>
      <strong>${num(cell.value)}</strong>
      <small>${esc(cell.label)}${cell.go === 'tables' && cell.value === 0 && !cards.some((row) => row.id === 'tables') ? ' · aucune table' : ''}</small>
    </button>`).join('');
  }

  // ------------------------------------------------------------------ 3. tables
  function renderTables() {
    const host = $('#mhTableList');
    if (!host) return;
    if (state.errors.tables) {
      host.innerHTML = `<li class="mh-table-empty">${esc(state.errors.tables)}<br><button type="button" class="mh-btn-outline" data-mh-retry="tables" style="margin-top:8px">Réessayer</button></li>`;
      return;
    }
    const data = state.tables;
    if (!data) { host.innerHTML = '<li class="mh-table-empty">Chargement de vos tables…</li>'; return; }
    const points = (Array.isArray(data.points) ? data.points : []).filter((point) => point.status === 'active');
    if (!points.length) {
      host.innerHTML = `<li class="mh-table-empty">Aucune table pour le moment.<br>Créez la première avec « ＋ Ajouter une table » : son QR sera généré aussitôt.</li>`;
      return;
    }
    // Tri naturel : tables numérotées d'abord, puis salons et espaces.
    const rank = (point) => (point.type === 'table' ? 0 : point.type === 'salon' ? 1 : 2);
    const sorted = [...points].sort((a, b) => rank(a) - rank(b) || String(a.number || a.name).localeCompare(String(b.number || b.name), 'fr', { numeric: true }));
    host.innerHTML = sorted.slice(0, 6).map((point) => {
      const label = point.type === 'table' ? `Table ${point.number || point.name}` : point.name;
      const busy = Boolean(point.occupied);
      return `<li class="mh-table-row${busy ? ' is-busy' : ''}">
        <strong>${esc(label)}</strong>
        <span class="mh-table-state">${busy ? 'Occupée' : 'Disponible'}</span>
        <button type="button" class="mh-table-edit" data-mh-edit-table="${esc(point.id)}" aria-label="Modifier ${esc(label)}" title="Modifier le numéro ou le nom">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>
        </button>
      </li>`;
    }).join('');
  }

  // ------------------------------------------------------------------ 4. équipe
  function renderTeam() {
    const list = $('#mhTeamList');
    const counters = $('#mhTeamCounters');
    if (!list) return;
    if (state.errors.team) {
      counters.innerHTML = '';
      list.innerHTML = `<li class="mh-table-empty">${esc(state.errors.team)}<br><button type="button" class="mh-btn-outline" data-mh-retry="team" style="margin-top:8px">Réessayer</button></li>`;
      return;
    }
    const data = state.team;
    if (!data) { list.innerHTML = '<li class="mh-table-empty">Chargement de vos comptes…</li>'; return; }
    const accounts = (Array.isArray(data.accounts) ? data.accounts : []).filter((account) => account.status !== 'archived');

    if (counters) {
      const gms = accounts.filter((account) => account.role === 'general_manager');
      const staff = accounts.filter((account) => account.role !== 'general_manager');
      counters.innerHTML = `
        <span class="mh-team-counter"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0"/></svg>Gérants <strong>(${gms.length})</strong></span>
        <span class="mh-team-counter"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2M17 11a3 3 0 1 0 0-6M22 20v-2a4 4 0 0 0-3-3.8"/></svg>Serveuses/Serveurs <strong>(${staff.length})</strong></span>`;
    }

    if (!accounts.length) {
      list.innerHTML = `<li class="mh-table-empty">Aucun compte créé pour le moment.<br>Créez un gérant ou une serveuse avec « ＋ Créer un compte ».</li>`;
      return;
    }
    list.innerHTML = accounts.slice(0, 6).map((account) => {
      const initials = String(account.fullName || '?').trim().split(/\s+/).map((word) => word[0] || '').join('').slice(0, 2).toUpperCase();
      const meta = STATUS_META[account.status] || { label: account.statusLabel || account.status, cls: '' };
      const role = ROLE_LABELS[account.role] || account.roleLabel || account.role || '';
      const pointCount = Array.isArray(account.points) ? account.points.length : 0;
      const place = pointCount === 1
        ? (account.points[0].number ? `Table ${account.points[0].number}` : account.points[0].name)
        : pointCount > 1 ? `${pointCount} tables` : 'Aucune table';
      return `<li class="mh-team-row" data-mh-member="${esc(account.id)}">
        <span class="mh-team-avatar" aria-hidden="true">${esc(initials)}</span>
        <span class="mh-team-id"><strong>${esc(account.fullName)}</strong><small>${esc(role)} · ${esc(place)}</small></span>
        <span class="mh-status ${meta.cls}">${esc(meta.label)}</span>
        <span class="mh-team-actions">
          <button type="button" class="mh-icon-btn is-edit" data-mh-member="edit:${esc(account.id)}" aria-label="Ouvrir la fiche de ${esc(account.fullName)}" title="Ouvrir la fiche">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>
          </button>
          <button type="button" class="mh-icon-btn is-delete" data-mh-member="suspend:${esc(account.id)}" aria-label="${account.status === 'active' ? 'Suspendre' : 'Réactiver'} ${esc(account.fullName)}" title="${account.status === 'active' ? 'Suspendre l’accès' : 'Réactiver l’accès'}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/></svg>
          </button>
        </span>
      </li>`;
    }).join('') + (accounts.length > 6 ? `<li><button type="button" class="mh-link mh-team-more" data-mh-go="team">Voir les ${accounts.length} comptes <span aria-hidden="true">→</span></button></li>` : '');
  }

  // ------------------------------------------------------------------ 5. thèmes
  function renderThemeOptions() {
    const host = $('#mhThemeList');
    if (!host) return;
    const active = state.savedTheme || 'green';
    const selected = state.selectedTheme || active;
    host.innerHTML = Object.entries(THEME_LABELS).map(([id, label]) => {
      const swatch = THEME_SWATCHES[id];
      return `<button type="button" class="mh-theme-option" role="radio" aria-checked="${selected === id}" data-mh-theme-option="${id}">
        <span class="mh-theme-preview" aria-hidden="true" style="background:${swatch.bg}">
          <i style="background:${swatch.soft}"></i>
          <span class="mh-tp-body">
            <span class="mh-tp-bar" style="background:${swatch.bar};width:80%"></span>
            <span class="mh-tp-bar" style="background:${swatch.ink};opacity:.35;width:60%"></span>
            <span class="mh-tp-bar" style="background:${swatch.bar};width:45%"></span>
          </span>
        </span>
        <span>${esc(label)}</span>
        <span class="mh-theme-check" aria-hidden="true">✓</span>
      </button>`;
    }).join('');
    const apply = $('#mhApplyTheme');
    if (apply) apply.disabled = state.themeBusy || selected === active;
    const note = $('#mhThemeState');
    if (note) {
      note.classList.remove('is-error');
      note.textContent = selected === active ? '' : `Aperçu « ${THEME_LABELS[selected]} » : cliquez sur Appliquer pour conserver ce thème.`;
    }
  }

  async function applySelectedTheme() {
    const theme = state.selectedTheme;
    if (!theme || theme === state.savedTheme) return;
    const note = $('#mhThemeState');
    const apply = $('#mhApplyTheme');
    if (apply) apply.disabled = true;
    try {
      if (note) { note.classList.remove('is-error'); note.textContent = 'Application…'; }
      // Aperçu immédiat, puis enregistrement serveur : le thème survit à la reconnexion.
      window.WorkspaceShell?.applyTheme?.(theme, { remember: false });
      const data = await api('/api/merchant/appearance', { method: 'PUT', body: JSON.stringify({ theme }) });
      state.savedTheme = data?.theme || theme;
      state.selectedTheme = state.savedTheme;
      window.WorkspaceShell?.applyTheme?.(state.savedTheme);
      renderThemePicker(); renderThemeOptions();
      if (note) note.textContent = `Thème « ${THEME_LABELS[state.savedTheme] || state.savedTheme} » appliqué et enregistré.`;
      notify(`Thème « ${THEME_LABELS[state.savedTheme] || state.savedTheme} » appliqué.`);
    } catch (error) {
      window.WorkspaceShell?.applyTheme?.(state.savedTheme);
      renderThemePicker(); renderThemeOptions();
      if (note) { note.classList.add('is-error'); note.textContent = `Non enregistré : ${error.message}`; }
    }
  }

  // ------------------------------------------------------------------ 6. scanner intégré
  // Même moteur que la rubrique Scanner (window.QrCamera) : caméra arrière, lecture automatique,
  // aucune photo ni vidéo. En cas de refus, la saisie manuelle reste disponible.
  let cameraOpen = false;
  function scanMessage(message, isError = false) {
    const node = $('#mhScanMessage');
    if (!node) return;
    node.hidden = !message;
    node.textContent = message || '';
    node.classList.toggle('is-error', Boolean(isError));
  }
  function setScanState(label) { const node = $('#mhScanState'); if (node) node.textContent = label; }

  function closeCamera() {
    if (!cameraOpen) return;
    cameraOpen = false;
    try { window.QrCamera?.close?.(); } catch (_) {}
    const stage = $('#mhScanStage');
    if (stage) { stage.classList.remove('is-live'); stage.querySelector('video')?.remove(); }
    const open = $('#mhScanOpen'); if (open) open.hidden = false;
    const stop = $('#mhScanStop'); if (stop) stop.hidden = true;
    const choose = $('#mhScanChoose'); if (choose) choose.hidden = true;
    setScanState('Prêt');
  }

  async function openCamera() {
    const stage = $('#mhScanStage');
    if (!stage) return;
    if (!window.QrCamera) { scanMessage('Le scanner n’a pas pu être chargé. Actualisez la page, ou saisissez le code à la main.', true); return; }
    setScanState('Ouverture…');
    scanMessage('Ouverture de la caméra…');
    try {
      await window.QrCamera.open({
        title: 'Scanner un QR de table ou de boutique',
        hint: 'Placez le QR dans le cadre : la lecture est automatique.',
        inline: stage,
        onClose: () => { const stop = $('#mhScanStop'); if (stop) stop.hidden = true; },
        onRead: async (value, via) => {
          scanMessage('QR lu : vérification auprès du serveur…');
          await Promise.resolve(window.__wsScanRead?.(value, via || 'camera')).catch(() => {});
          const outcome = window.__wsLastScan || {};
          closeCamera();
          if (!outcome.ok) {
            // QR d'une autre boutique, désactivé ou inconnu : on le dit, et la saisie manuelle
            // reste à portée de main. Aucune redirection trompeuse.
            setScanState('QR non reconnu');
            scanMessage(outcome.message || 'Ce QR n’est pas reconnu pour votre boutique.', true);
            return;
          }
          setScanState('QR reconnu');
          scanMessage(`QR reconnu${outcome.point?.name ? ` : ${outcome.point.name}` : ''}. La commande assistée s’ouvre, table déjà renseignée.`);
          // Même enchaînement que la rubrique Scanner : la commande assistée s'ouvre sur la table lue.
          setTimeout(() => { try { window.WorkspaceUI?.openTab?.('assisted', true, { label: 'Prendre une commande' }); } catch (_) {} }, 450);
        },
        onError: (message) => { scanMessage(message, true); setScanState('Caméra refusée'); },
        onChooseTable: () => window.WorkspaceUI?.openTab?.('assisted', true, { label: 'Choisir la table' }),
      });
      cameraOpen = true;
      stage.classList.add('is-live');
      const open = $('#mhScanOpen'); if (open) open.hidden = true;
      const stop = $('#mhScanStop'); if (stop) stop.hidden = false;
      const choose = $('#mhScanChoose'); if (choose) choose.hidden = false;
      setScanState('Caméra ouverte');
      scanMessage('Placez le QR dans le cadre : la lecture est automatique.');
    } catch (error) {
      cameraOpen = false;
      stage.classList.remove('is-live');
      setScanState('Caméra indisponible');
      scanMessage(error.message || 'Caméra indisponible sur cet appareil.', true);
    }
  }

  // ------------------------------------------------------------------ 7. navigation
  // Chaque bouton ouvre l'écran EXISTANT (aucune seconde implémentation).
  function go(target) {
    const ui = window.WorkspaceUI;
    switch (target) {
      case 'home': ui?.openTab?.('home', true); break;
      case 'orders': ui?.openTab?.('orders', true, { label: 'Commandes' }); break;
      case 'scan': ui?.openTab?.('scan', true, { label: 'Scanner' }); break;
      case 'overview': {
        // « Vue d'ensemble » : mêmes données, écran détaillé (dernières commandes, produits
        // populaires, courbe 7 jours). Aucun chiffre n'est recalculé ici.
        ui?.openTab?.('overview', true, { label: 'Vue d’ensemble' });
        break;
      }
      case 'tables': {
        document.querySelector('button[data-rubric="tables"]')?.click();
        break;
      }
      case 'tables-add': {
        // Ouvre la gestion des tables PUIS le formulaire, dans le même geste.
        document.querySelector('button[data-rubric="tables"]')?.click();
        setTimeout(() => {
          document.getElementById('tablesAddTable')?.click();
          const form = document.getElementById('tablesFormHost');
          form?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          form?.querySelector('input')?.focus?.();
        }, 260);
        break;
      }
      case 'team': {
        openTeamScreen();
        break;
      }
      case 'team-create': {
        openTeamScreen({ create: true });
        break;
      }
      case 'appearance': {
        document.querySelector('button[data-rubric="settings"]')?.click();
        setTimeout(() => { window.WorkspaceUI?.openTab?.('appearance', true, { label: 'Apparence de mon interface' }); }, 180);
        break;
      }
      default: ui?.openTab?.(target, true);
    }
  }

  // Attend qu'un élément apparaisse (les écrans se remplissent après un appel réseau) sans jamais
  // bloquer : au bout de 3 s on rend la main et on prévient l'utilisateur.
  function waitFor(selector, { tries = 24, delay = 130 } = {}) {
    return new Promise((resolve) => {
      let count = 0;
      const tick = () => {
        const node = document.querySelector(selector);
        if (node) { resolve(node); return; }
        if (++count >= tries) { resolve(null); return; }
        setTimeout(tick, delay);
      };
      tick();
    });
  }

  function openTeamScreen({ create = false } = {}) {
    const rubric = document.querySelector('button[data-rubric="team"]');
    rubric?.click();
    // La rubrique Équipe est une liste d'outils : on ouvre « Mon équipe » (le premier outil), puis
    // le formulaire de création s'il est demandé. Aucun nouvel écran n'est créé ici.
    setTimeout(async () => {
      const hubButton = document.querySelector('#panel-hub-team [data-hub-tab="team"]');
      if (hubButton) hubButton.click();
      const card = await waitFor('#teamCreateButton');
      if (!card) { notify('« Mon équipe » n’a pas pu s’ouvrir. Réessayez depuis le menu Équipe.'); return; }
      if (create) {
        card.click();
        (await waitFor('#teamCreatePanel'))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        document.getElementById('memberAccountsCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 180);
  }

  function openTeamMember(memberId) {
    // La fiche complète (téléphone, tables, permissions, suspension, mot de passe, historique)
    // est celle de « Mes comptes créés » : on l'ouvre au bon endroit, sans la dupliquer.
    document.querySelector('button[data-rubric="team"]')?.click();
    setTimeout(() => document.querySelector('#panel-hub-team [data-hub-tab="team"]')?.click(), 150);
    setTimeout(async () => {
      try {
        await window.MemberAccounts?.load?.();
        await window.MemberAccounts?.open?.(memberId);
        const view = document.querySelector('.member-account-view') || document.getElementById('memberAccountsCard');
        view?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (_) {
        document.getElementById('memberAccountsCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 480);
  }

  async function suspendMember(memberId) {
    const account = (state.team?.accounts || []).find((row) => row.id === memberId);
    if (!account) return;
    const suspending = account.status === 'active';
    const question = suspending
      ? `Suspendre le compte de ${account.fullName} ?\nSon accès est coupé immédiatement, sessions ouvertes comprises. Ses tables et son historique sont conservés.`
      : `Réactiver le compte de ${account.fullName} ?\nLe membre pourra se reconnecter avec son code.`;
    if (!window.confirm(question)) return;
    try {
      await api(`/api/merchant/member-accounts/${encodeURIComponent(memberId)}/status`, {
        method: 'POST', body: JSON.stringify({ status: suspending ? 'suspended' : 'active', reason: `Décision du marchand (${suspending ? 'suspension' : 'réactivation'}) depuis l’accueil` }),
      });
      notify(suspending ? 'Compte suspendu : accès coupé immédiatement.' : 'Compte réactivé.');
      await loadTeam();
    } catch (error) { notify(error.message, 'error'); }
  }

  // ------------------------------------------------------------------ chargement
  // Photo d'illustration : celle de la boutique (couverture ou logo) si elle existe. Aucune image
  // n'est inventée ni fabriquée à partir de données de démonstration.
  // Les images de la boutique sont servies par la route privée du marchand : on traduit l'adresse
  // stockée (« /media/merchant/<id> ») pour que l'image s'affiche réellement, sans fetch anonyme.
  function mediaUrl(url) {
    const match = /^\/media\/merchant\/([0-9a-f-]{36})$/i.exec(String(url || ''));
    return match ? `/api/merchant/media/${match[1]}` : String(url || '');
  }
  function storePhoto(store) {
    if (!store) return '';
    const cover = mediaUrl(String(store.coverImageUrl || '').trim());
    const logo = mediaUrl(String(store.logo || '').trim());
    const isPhoto = (value) => value && !/^data:image\/svg/i.test(value) && value.length > 60;
    if (isPhoto(cover)) return cover;
    if (isPhoto(logo)) return logo;
    return '';
  }
  function heroPhoto() { return storePhoto(state.store); }

  async function loadStore() {
    try {
      state.store = await api('/api/merchant/store');
      renderHero();
      applyStoreLogoToHeader(state.store);
    } catch (error) { state.errors.store = error.message; }
    // La couverture est parfois absente de /api/merchant/store (fiche publique) : on tente la
    // fiche publique de la boutique une seule fois, sans jamais bloquer l'accueil.
    if (!heroPhoto() && !state.heroPhotoTried) {
      state.heroPhotoTried = true;
      const slug = state.store?.slug || '';
      if (slug) {
        try {
          const shop = await api(`/api/public/shops/${encodeURIComponent(slug)}`);
          state.banner = shop;
          if (shop?.coverImageUrl || shop?.cover || shop?.logo) {
            state.store = { ...state.store, coverImageUrl: shop.coverImageUrl || shop.cover || '', logo: state.store?.logo || shop.logo || '' };
            renderHero();
          }
        } catch (_) { /* la boutique n'est pas publiée : l'en-tête garde le monogramme */ }
      }
    }
    paintIllustrations();
  }

  function paintIllustrations() {
    const photo = heroPhoto();
    if (!photo) return;
    document.querySelectorAll('[data-mh-illustration]').forEach((host) => {
      if (host.dataset.filled === 'true') return;
      host.dataset.filled = 'true';
      host.innerHTML = `<img src="${esc(photo)}" alt="" loading="lazy" decoding="async">`;
    });
  }
  function applyStoreLogoToHeader(store) {
    // L'en-tête haut reste celui de l'application : on y met simplement la photo de la boutique
    // quand elle existe, pour que le marchand se reconnaisse d'un coup d'œil.
    const mark = document.querySelector('.app-header .brand-mark img');
    if (mark && store?.logo) { mark.src = store.logo; mark.removeAttribute('srcset'); }
  }

  async function loadOverview() {
    try { state.overview = await api('/api/overview'); delete state.errors.overview; }
    catch (error) { state.errors.overview = error.message; }
    renderActivity();
  }
  async function loadTables() {
    try { state.tables = await api('/api/merchant/table-management'); delete state.errors.tables; }
    catch (error) { state.errors.tables = error.message; }
    renderTables();
  }
  async function loadTeam() {
    try { state.team = await api('/api/merchant/member-accounts'); delete state.errors.team; }
    catch (error) { state.errors.team = error.message; }
    renderTeam();
  }
  async function loadAppearance() {
    try {
      const data = await api('/api/merchant/appearance');
      state.savedTheme = data?.theme || data?.merchantChoice || 'green';
      state.selectedTheme = state.savedTheme;
    } catch (_) {
      state.savedTheme = window.WorkspaceShell?.localTheme?.() || 'green';
      state.selectedTheme = state.savedTheme;
    }
    renderThemePicker(); renderThemeOptions();
  }

  async function loadAll({ force = false } = {}) {
    if (state.loading) return;
    if (state.loaded && !force) return;
    state.loading = true;
    try {
      await Promise.all([loadStore(), loadOverview(), loadTables(), loadTeam(), loadAppearance()]);
      state.loaded = true;
      // La vue d'ensemble historique n'est plus affichée (la maquette la remplace), mais elle reste
      // la source « officielle » des mêmes chiffres : on la laisse se remplir une fois, en arrière-plan.
      try { window.OverviewView?.open?.(); } catch (_) {}
    } finally { state.loading = false; }
  }

  // ------------------------------------------------------------------ branchements
  // `bound` évite un double branchement : le script est relu au chargement puis sur DOMContentLoaded,
  // et deux écouteurs sur le même bouton ouvriraient deux fois la caméra (ou toggleraient deux fois).
  let bound = false;
  function bind() {
    const node = shell();
    if (!node || bound) return;
    bound = true;

    node.addEventListener('click', (event) => {
      const theme = event.target.closest?.('[data-mh-theme]');
      if (theme) { pickTheme(theme.dataset.mhTheme).catch(() => {}); return; }

      const gear = event.target.closest?.('[data-mh-goto]');
      if (gear) {
        // Un lien d'ancrage ne doit pas recharger la page.
        if (gear.tagName === 'A') event.preventDefault();
        go(gear.dataset.mhGoto);
        return;
      }

      const activity = event.target.closest?.('[data-mh-go]');
      if (activity) {
        const view = activity.dataset.mhView;
        if (view) window.WorkspaceUI?.openTab?.('orders', true, { label: 'Commandes', overviewView: view });
        else go(activity.dataset.mhGo);
        return;
      }

      const retry = event.target.closest?.('[data-mh-retry]');
      if (retry) {
        const which = retry.dataset.mhRetry;
        if (which === 'overview') loadOverview();
        if (which === 'tables') loadTables();
        if (which === 'team') loadTeam();
        return;
      }

      const option = event.target.closest?.('[data-mh-theme-option]');
      if (option) {
        // Aperçu immédiat : le marchand voit le résultat avant d'appliquer.
        state.selectedTheme = option.dataset.mhThemeOption;
        window.WorkspaceShell?.applyTheme?.(state.selectedTheme, { remember: false });
        renderThemeOptions();
        return;
      }

      const edit = event.target.closest?.('[data-mh-edit-table]');
      if (edit) {
        const pointId = edit.dataset.mhEditTable;
        go('tables');
        // La liste des tables arrive du serveur : on attend la carte précise avant d'ouvrir
        // l'édition, sinon le clic tombe dans le vide (cause du « bouton qui ne fait rien »).
        waitFor(`[data-point="${pointId}"] [data-toggle-edit]`, { tries: 30, delay: 150 }).then((button) => {
          if (!button) { notify('Table non trouvée : ouvrez « Gestion des tables » pour la modifier.'); return; }
          button.click();
          waitFor('.table-card-edit:not([hidden])').then((form) => form?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        });
        return;
      }

      const member = event.target.closest?.('[data-mh-member]');
      if (member) {
        const [action, id] = String(member.dataset.mhMember).split(':');
        if (action === 'edit') openTeamMember(id);
        else if (action === 'suspend') suspendMember(id);
        return;
      }
    });

    // Déconnexion depuis le bas de l'accueil : même confirmation que l'en-tête et le menu
    // (WorkspaceShell), qui coupe réellement la session côté serveur.
    $('#mhLogout')?.addEventListener('click', () => {
      const handler = window.__wsLogout;
      if (typeof handler === 'function') { handler(); return; }
      // Mission 14 : le bouton vit maintenant dans le menu latéral, en dehors de ce module. Il ne
      // doit JAMAIS rester sans effet : on appelle directement le gestionnaire de l'espace
      // (installé par merchant.js) plutôt que d'afficher un message d'aide.
      const shell = window.WorkspaceShell;
      const button = document.getElementById('logoutButton');
      if (shell?.confirmLogout && button) { shell.confirmLogout(() => button.click()); return; }
      button?.click();
    });
    $('#mhApplyTheme')?.addEventListener('click', applySelectedTheme);
    $('#mhScanOpen')?.addEventListener('click', openCamera);
    $('#mhScanStop')?.addEventListener('click', closeCamera);
    $('#mhScanChoose')?.addEventListener('click', () => window.WorkspaceUI?.openTab?.('assisted', true, { label: 'Choisir la table' }));
    $('#mhScanManualToggle')?.addEventListener('click', () => {
      const form = $('#mhScanManualForm');
      if (!form) return;
      form.hidden = !form.hidden;
      if (!form.hidden) $('#mhScanManualInput')?.focus();
    });
    $('#mhScanManualForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = $('#mhScanManualInput')?.value.trim();
      if (!value) { scanMessage('Saisissez le code ou collez le lien du QR.', true); return; }
      scanMessage('Vérification auprès du serveur…');
      Promise.resolve(window.__wsScanRead?.(value, 'manual')).then(() => {
        const outcome = window.__wsLastScan || {};
        if (!outcome.ok) { setScanState('QR non reconnu'); scanMessage(outcome.message || 'Code non reconnu.', true); return; }
        setScanState('QR reconnu');
        scanMessage('Code reconnu. La commande assistée s’ouvre.');
        const input = $('#mhScanManualInput'); if (input) input.value = '';
        setTimeout(() => window.WorkspaceUI?.openTab?.('assisted', true, { label: 'Prendre une commande' }), 350);
      }).catch((error) => scanMessage(error.message || 'Code non reconnu.', true));
    });
  }

  // ------------------------------------------------------------------ API publique
  window.MerchantHome = {
    load: loadAll,
    refresh: () => loadAll({ force: true }),
    show: showHome,
    go,
    get data() { return { store: state.store, overview: state.overview, tables: state.tables, team: state.team }; },
  };

  const boot = () => {
    if (!shell()) return;
    bind();
    // La page d'accueil est visible dès que l'espace marchand l'est : les données arrivent ensuite,
    // sans écran blanc (les cartes affichent « Chargement… »).
    if (document.getElementById('appView') && !document.getElementById('appView').hidden) loadAll();
    // Ouverture de la rubrique « Accueil » : on réactualise les chiffres (commandes, tables,
    // occupations) car ils changent pendant la journée.
    document.addEventListener('workspace:tab', (event) => {
      if (event.detail?.tab === 'home') { showHome(true); loadAll({ force: state.loaded }); }
      else showHome(false);
    });
    // Premier affichage après connexion : /auth/me débloque l'espace, on charge à ce moment-là.
    const app = document.getElementById('appView');
    if (app) {
      const observer = new MutationObserver(() => { if (!app.hidden) { showHome(true); loadAll(); observer.disconnect(); } });
      observer.observe(app, { attributes: true, attributeFilter: ['hidden'] });
    }
  };

  if (document.body) boot();
  document.addEventListener('DOMContentLoaded', boot, { once: true });
})();
