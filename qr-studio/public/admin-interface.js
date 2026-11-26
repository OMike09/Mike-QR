// Mission 10 — Panneau PDG des tailles de texte des espaces de travail.
// Réglage de présentation uniquement : ce fichier n'envoie et ne lit aucune permission.
(() => {
  'use strict';

  const TEXT_KEYS = [
    ['title', 'Titres', 24], ['subtitle', 'Sous-titres', 17], ['text', 'Textes', 16],
    ['label', 'Menus et libellés', 14], ['button', 'Boutons', 15], ['productName', 'Noms de produits', 16],
    ['price', 'Prix et montants', 18], ['orderInfo', 'Informations de commande', 14],
  ];
  const CSS_VARS = { title: '--ws-title', subtitle: '--ws-subtitle', text: '--ws-text', label: '--ws-label', button: '--ws-button', productName: '--ws-product-name', price: '--ws-price', orderInfo: '--ws-order-info' };
  const MIN = 14; const MAX = 30;
  const DEFAULTS = Object.fromEntries(TEXT_KEYS.map(([key, , size]) => [key, size]));

  const $ = (selector, root = document) => root.querySelector(selector);
  const state = { settings: { global: { ...DEFAULTS }, stores: {} }, scope: 'global', storeId: '', loaded: false, saving: false };

  const clamp = (value, fallback) => { const size = Number(value); return Number.isFinite(size) ? Math.max(MIN, Math.min(MAX, Math.round(size))) : fallback; };
  function normalize(input, base = DEFAULTS) {
    const source = input && typeof input === 'object' ? input : {};
    return Object.fromEntries(TEXT_KEYS.map(([key]) => [key, clamp(source[key], base[key])]));
  }
  function currentSizes() {
    if (state.scope === 'store' && state.storeId && state.settings.stores[state.storeId]) return state.settings.stores[state.storeId];
    return state.settings.global;
  }

  function buildControls() {
    const root = $('#merchantInterfaceControls'); if (!root) return;
    const sizes = currentSizes();
    root.innerHTML = TEXT_KEYS.map(([key, label, fallback]) => `
      <div class="interface-size-row">
        <label for="mi-${key}">${label}</label>
        <input id="mi-${key}" type="range" min="${MIN}" max="${MAX}" step="1" value="${sizes[key] || fallback}" aria-describedby="mi-${key}-out">
        <output id="mi-${key}-out" for="mi-${key}">${sizes[key] || fallback} px</output>
      </div>`).join('');
    TEXT_KEYS.forEach(([key]) => {
      const input = $(`#mi-${key}`);
      input?.addEventListener('input', () => { $(`#mi-${key}-out`).textContent = `${input.value} px`; renderPreview(); });
    });
    $('#merchantInterfaceStore')?.setAttribute('hidden', '');
    $('#clearMerchantInterfaceStore')?.setAttribute('hidden', '');
    if (state.scope === 'store') {
      $('#merchantInterfaceStore')?.removeAttribute('hidden');
      $('#merchantInterfaceStoreLabel')?.removeAttribute('hidden');
      if (state.storeId && state.settings.stores[state.storeId]) $('#clearMerchantInterfaceStore')?.removeAttribute('hidden');
    }
    renderPreview();
  }

  // Aperçu en direct : une vraie carte de commande, aux tailles choisies.
  function renderPreview() {
    const node = $('#merchantInterfacePreview'); if (!node) return;
    node.hidden = false;
    const sizes = screenSizes();
    const style = Object.entries(CSS_VARS).map(([key, variable]) => `${variable}:${sizes[key]}px`).join(';');
    node.setAttribute('style', style);
    node.innerHTML = `
      <div class="mi-preview" style="font-size:var(--ws-text)">
        <h3 style="font-size:var(--ws-title);margin:0 0 4px">Mes commandes</h3>
        <p style="font-size:var(--ws-label);color:#64736e;margin:0 0 12px">Aperçu en direct · table 4 · 12:30</p>
        <div class="mi-order">
          <header><strong style="font-size:var(--ws-subtitle)">OY-1042</strong><span class="mi-pill" style="font-size:var(--ws-order-info)">À confirmer</span></header>
          <p style="font-size:var(--ws-order-info);margin:4px 0">Awa Koné · Table 4 · 12:30</p>
          <p style="font-size:var(--ws-product-name);margin:6px 0">Poulet braisé × 2</p>
          <p style="font-size:var(--ws-product-name);margin:0">Bissap 50 cl × 3</p>
          <footer>
            <strong style="font-size:var(--ws-price)">8 500 XOF</strong>
            <span class="mi-buttons"><button type="button" tabindex="-1" style="font-size:var(--ws-button)">Confirmer</button><button type="button" tabindex="-1" style="font-size:var(--ws-button)">Détail</button></span>
          </footer>
        </div>
      </div>`;
  }

  function screenSizes() {
    const base = currentSizes();
    const written = {};
    for (const [key, , fallback] of TEXT_KEYS) { const input = $(`#mi-${key}`); written[key] = clamp(input?.value, base[key] || fallback); }
    return written;
  }

  function setStatus(text, tone = '') {
    const node = $('#merchantInterfaceStatus'); if (!node) return;
    node.textContent = text; node.classList.toggle('is-error', tone === 'error'); node.classList.toggle('is-ok', tone === 'ok');
  }

  function applySettings(settings) {
    const source = settings || {};
    state.settings = { global: normalize(source.global || {}, DEFAULTS), stores: {} };
    for (const [storeId, value] of Object.entries(source.stores || {})) state.settings.stores[storeId] = normalize(value, state.settings.global);
    buildControls();
  }

  async function load() {
    try {
      // Le même GET que les autres réglages : la réponse contient merchantInterface normalisé.
      const response = await fetch('/api/admin/settings', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Erreur ${response.status}`);
      const data = await response.json();
      applySettings(data.data?.merchantInterface || {});
      state.loaded = true;
      setStatus('Tailles chargées depuis le serveur.');
    } catch (error) { setStatus(`Impossible de charger les tailles : ${error.message}`, 'error'); }
  }

  async function loadStores() {
    const select = $('#merchantInterfaceStore'); if (!select) return;
    try {
      const response = await fetch('/api/admin/merchants?limit=200', { credentials: 'same-origin' });
      const data = await response.json();
      const rows = (data.data || []).filter((row) => row.storeId || row.storeName);
      select.innerHTML = '<option value="">Choisir un établissement…</option>' + rows.map((row) => `<option value="${row.storeId || ''}">${(row.storeName || row.displayName || row.username || '').replace(/[<>&"]/g, '')}</option>`).join('');
    } catch (_) { select.innerHTML = '<option value="">Établissements indisponibles</option>'; }
  }

  async function persist(nextSettings, message) {
    if (state.saving) return;
    state.saving = true;
    setStatus('Enregistrement…');
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchantInterface: { ...nextSettings, updatedAt: new Date().toISOString() } }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
      applySettings(data.data?.merchantInterface || nextSettings);
      setStatus(message || 'Tailles enregistrées sur le serveur.', 'ok');
    } catch (error) { setStatus(`Échec de l’enregistrement : ${error.message}`, 'error'); }
    finally { state.saving = false; }
  }

  function bind() {
    if (!$('#merchantInterfaceCard') || state.loaded) return;
    state.loaded = true;
    load(); loadStores();
    $('#merchantInterfaceScope')?.addEventListener('change', (event) => {
      state.scope = event.target.value === 'store' ? 'store' : 'global';
      state.storeId = '';
      const select = $('#merchantInterfaceStore');
      if (select) select.value = '';
      buildControls();
      setStatus(state.scope === 'store' ? 'Choisissez un établissement pour régler son exception.' : 'Valeur globale : tous les établissements.');
    });
    $('#merchantInterfaceStore')?.addEventListener('change', (event) => {
      state.storeId = event.target.value;
      if (state.storeId && !state.settings.stores[state.storeId]) {
        // Une nouvelle exception part de la valeur globale : rien ne change tant qu'on n'enregistre pas.
        state.settings.stores[state.storeId] = { ...state.settings.global };
      }
      buildControls();
    });
    $('#saveMerchantInterface')?.addEventListener('click', () => {
      const sizes = screenSizes();
      const next = { global: { ...state.settings.global }, stores: { ...state.settings.stores } };
      if (state.scope === 'store' && state.storeId) { next.stores[state.storeId] = sizes; persist(next, 'Exception enregistrée pour cet établissement.'); }
      else { next.global = sizes; persist(next, 'Tailles enregistrées pour tous les établissements.'); }
    });
    $('#resetMerchantInterface')?.addEventListener('click', () => {
      const next = { global: { ...state.settings.global }, stores: { ...state.settings.stores } };
      if (state.scope === 'store' && state.storeId) delete next.stores[state.storeId];
      else next.global = { ...DEFAULTS };
      persist(next, 'Valeurs initiales rétablies.');
    });
    $('#clearMerchantInterfaceStore')?.addEventListener('click', () => {
      if (!state.storeId) return;
      const next = { global: { ...state.settings.global }, stores: { ...state.settings.stores } };
      delete next.stores[state.storeId];
      state.storeId = '';
      persist(next, 'Exception retirée : cet établissement reprend la valeur globale.');
    });
  }

  // ------------------------------------------------------------------ Mission 11 : apparence
  // Thème par défaut / imposé + consultation des thèmes réellement utilisés.
  // Aucune permission n'est lue ni écrite ici : uniquement deux valeurs d'apparence.
  const APPEARANCE_THEMES = [
    { id: 'green', label: 'Vert et blanc' },
    { id: 'black-gold', label: 'Noir et or' },
    { id: 'blue-white', label: 'Blanc et bleu' },
  ];
  const appearanceState = { appearance: { defaultTheme: 'green', mode: 'default' }, stores: [], loaded: false, saving: false };

  function setAppearanceStatus(message, tone = '') {
    const node = $('#adminAppearanceStatus'); if (!node) return;
    node.textContent = message;
    node.dataset.tone = tone;
  }
  function safeLabel(value) { return String(value == null ? '' : value).replace(/[<>&"]/g, ''); }
  function renderAppearance(data) {
    if (!data) return;
    appearanceState.appearance = data.appearance || appearanceState.appearance;
    appearanceState.stores = Array.isArray(data.stores) ? data.stores : [];
    const themeSelect = $('#adminAppearanceTheme'); const modeSelect = $('#adminAppearanceMode');
    if (themeSelect) themeSelect.value = appearanceState.appearance.defaultTheme || 'green';
    if (modeSelect) modeSelect.value = appearanceState.appearance.mode === 'imposed' ? 'imposed' : 'default';
    // Aperçu : la propre interface du PDG prend l'ambiance sélectionnée (aucun impact sur les données).
    document.documentElement.setAttribute('data-admin-appearance', themeSelect?.value || 'green');
    const usage = $('#adminAppearanceUsage');
    if (usage) {
      const rows = APPEARANCE_THEMES.map((theme) => {
        const item = (data.usage || []).find((row) => row.id === theme.id) || { count: 0, merchantCount: 0 };
        const contrast = data.contrast?.[theme.id];
        return `<div class="interface-usage-row"><span class="interface-usage-swatch" data-theme="${theme.id}" aria-hidden="true"></span>
          <strong>${safeLabel(theme.label)}</strong>
          <span>${item.count} établissement${item.count === 1 ? '' : 's'} · ${item.merchantCount} choix marchand${item.merchantCount === 1 ? '' : 's'}</span>
          <span class="interface-contrast${contrast?.ok ? '' : ' is-warning'}">${contrast ? `contraste ${String(contrast.ratio).replace('.', ',')}:1` : ''}</span></div>`;
      }).join('');
      usage.innerHTML = `<strong class="interface-usage-title">Thèmes réellement utilisés</strong>${rows}`;
    }
    const list = $('#adminAppearanceStores');
    if (list) {
      if (!appearanceState.stores.length) list.innerHTML = '<p class="hint">Aucun établissement enregistré pour le moment.</p>';
      else {
        list.innerHTML = `<div class="interface-store-head"><span>Établissement</span><span>Marchand</span><span>Choix du marchand</span><span>Appliqué</span></div>` +
          appearanceState.stores.map((row) => `<div class="interface-store-row">
            <span><strong>${safeLabel(row.storeName || '—')}</strong><small>${safeLabel(row.slug ? `/shop/${row.slug}` : '')}</small></span>
            <span>${safeLabel(row.merchantName || '—')}</span>
            <span>${safeLabel(row.merchantChoiceLabel || row.merchantChoice || '—')}</span>
            <span>${safeLabel((APPEARANCE_THEMES.find((theme) => theme.id === row.effective) || {}).label || row.effective || '—')}${row.effectiveSource === 'imposed' ? ' <em>(imposé)</em>' : ''}</span>
          </div>`).join('');
      }
    }
  }
  async function loadAppearance() {
    try {
      const response = await fetch('/api/admin/interface-appearance', { credentials: 'same-origin' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
      renderAppearance(data.data);
      appearanceState.loaded = true;
      setAppearanceStatus('Apparence chargée depuis le serveur.');
    } catch (error) { setAppearanceStatus(`Impossible de charger l’apparence : ${error.message}`, 'error'); }
  }
  async function saveAppearance(theme, mode) {
    if (appearanceState.saving) return;
    appearanceState.saving = true;
    setAppearanceStatus('Enregistrement…');
    try {
      // Le PDG enregistre dans le même réglage que les tailles : un seul PUT, une seule trace.
      const current = (await (await fetch('/api/admin/settings', { credentials: 'same-origin' })).json()).data?.merchantInterface || {};
      const body = { merchantInterface: { ...current, appearance: { defaultTheme: theme, mode, updatedAt: new Date().toISOString() } } };
      const response = await fetch('/api/admin/settings', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
      applySettings(data.data?.merchantInterface || current);
      await loadAppearance();
      setAppearanceStatus(mode === 'imposed' ? 'Thème imposé à tous les marchands.' : 'Thème par défaut enregistré.', 'ok');
    } catch (error) { setAppearanceStatus(`Échec de l’enregistrement : ${error.message}`, 'error'); }
    finally { appearanceState.saving = false; }
  }
  function bindAppearance() {
    if (!$('#adminAppearanceCard') || appearanceState.bound) return;
    appearanceState.bound = true;
    // Chargement après connexion (admin.js appelle loadAppearance dans showApp) :
    // avant la session, l'appel ne produirait qu'une erreur 401 inutile.
    $('#adminAppearanceTheme')?.addEventListener('change', (event) => {
      document.documentElement.setAttribute('data-admin-appearance', event.target.value);
    });
    $('#saveAdminAppearance')?.addEventListener('click', () => {
      saveAppearance($('#adminAppearanceTheme')?.value || 'green', $('#adminAppearanceMode')?.value === 'imposed' ? 'imposed' : 'default');
    });
    $('#resetAdminAppearance')?.addEventListener('click', () => {
      if ($('#adminAppearanceTheme')) $('#adminAppearanceTheme').value = 'green';
      if ($('#adminAppearanceMode')) $('#adminAppearanceMode').value = 'default';
      saveAppearance('green', 'default');
    });
  }

  window.AdminInterface = { load, applySettings, loadAppearance, renderAppearance, saveAppearance,
    get settings() { return state.settings; }, get appearance() { return appearanceState.appearance; }, TEXT_KEYS, DEFAULTS, APPEARANCE_THEMES };

  if (document.body) { bind(); bindAppearance(); }
  document.addEventListener('DOMContentLoaded', () => { bind(); bindAppearance(); }, { once: true });
})();
