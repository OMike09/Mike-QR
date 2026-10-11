(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = {
    view: 'overview', categories: [], codePage: 1, codeTotal: 0, codeSearch: '', codeCategory: '', codeStatus: '', codeBeneficiaryId: '',
    beneficiaryPage: 1, beneficiaryTotal: 0, beneficiarySearch: '', beneficiaryType: '', beneficiaryStatus: '',
    activityPage: 1, activityTotal: 0, activityType: '', scanPeriod: 'all', publicBaseUrl: '', defaultPublicTextSize: 'normal', currentBeneficiaryPhotos: [],
  };
  let toastTimer;
  let dashboardRefreshTimer;
  let codeSearchTimer;
  let beneficiarySearchTimer;
  let beneSelectTimer;
  let logoReader = null;
  const loginScreen = $('#loginScreen');
  const appShell = $('#appShell');
  const modalRoot = $('#modalRoot');
  const toast = $('#toast');
  const TYPE_LABELS = { individual: 'Particulier', business: 'Entreprise', commerce: 'Commerce', organization: 'Organisation', other: 'Autre' };
  const PURPOSE_LABELS = { contact: 'Coordonnées', catalog: 'Catalogue', prices: 'Tarifs', menu: 'Menu', website: 'Site Internet', social: 'Réseaux sociaux', services: 'Services', order: 'Commande', other: 'Autre' };
  const CATEGORY_BY_TYPE = { individual: 'cat-individuals', business: 'cat-businesses', commerce: 'cat-shops', organization: 'cat-organizations', other: 'cat-other' };
  const FIELD_LABELS = [
    ['logo', 'Logo / photo'], ['phone', 'Téléphone'], ['whatsapp', 'WhatsApp'], ['email', 'Adresse e-mail'],
    ['address', 'Adresse physique'], ['locationUrl', 'Lien de localisation'], ['website', 'Site Internet'],
    ['socials', 'Réseaux sociaux'], ['bio', 'Présentation'], ['offers', 'Produits et services'], ['documents', 'Documents'],
  ];
  const ICONS = {
    qr: '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="2.5" y="2.5" width="6" height="6" rx="1.4" stroke="currentColor" stroke-width="1.5"/><rect x="11.5" y="2.5" width="6" height="6" rx="1.4" stroke="currentColor" stroke-width="1.5"/><rect x="2.5" y="11.5" width="6" height="6" rx="1.4" stroke="currentColor" stroke-width="1.5"/><path d="M12 12h2v2h-2zm4 0h1.5v1.5H16zm-4 4h2v2h-2zm4-.5h1.5V17H16z" fill="currentColor"/></svg>',
    eye: '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M2 10s2.8-5 8-5 8 5 8 5-2.8 5-8 5-8-5-8-5Z" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="10" r="2" stroke="currentColor" stroke-width="1.4"/></svg>',
    edit: '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m12.7 4.2 3.1 3.1M3.5 16.5l3.2-.7L16 6.5a1.5 1.5 0 0 0-2.1-2.1l-9.3 9.3-.7 2.8Z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    download: '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 2.8v9.5m0 0 3.6-3.6M10 12.3 6.4 8.7M3.5 13v2.3c0 .8.6 1.4 1.4 1.4h10.2c.8 0 1.4-.6 1.4-1.4V13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    link: '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m8 12 4-4m-6 6-1.1 1.1a3 3 0 0 1-4.2-4.2l3-3a3 3 0 0 1 4.2 0m2.2-2.2 1.1-1.1a3 3 0 0 1 4.2 4.2l-3 3a3 3 0 0 1-4.2 0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    print: '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5.5 7V3.2h9V7m-9 7H4a1.5 1.5 0 0 1-1.5-1.5V8.5A1.5 1.5 0 0 1 4 7h12a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 16 14h-1.5" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/><path d="M5.5 11.5h9v5.3h-9z" stroke="currentColor" stroke-width="1.35"/><path d="M14.2 9.5h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    pause: '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M7 5v10m6-10v10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    play: '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m7 4.5 8 5.5-8 5.5v-11Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    lock: '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="4" y="8.5" width="12" height="9" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 8.5V6a3.5 3.5 0 0 1 7 0v2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    unlock: '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="4" y="8.5" width="12" height="9" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 8.5V6a3.5 3.5 0 0 1 6.1-2.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    trash: '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4.5 6h11m-9.5 0 .6 10.3h7.8L15 6M8 6V4.2h4V6m-3 2.5v5m2-5v5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    file: '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 2.8h6l4 4v10.4H5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M11 3v4h4M7.5 10h5m-5 3h5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    clock: '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7.3" stroke="currentColor" stroke-width="1.45"/><path d="M10 5.8v4.5l3 1.7" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/></svg>',
  };

  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const number = (value) => new Intl.NumberFormat('fr-FR').format(Number(value) || 0);
  const safeSlug = (value) => String(value || 'qria').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 45) || 'qria';
  const getPublicUrl = (code) => `${state.publicBaseUrl || window.location.origin}/r/${encodeURIComponent(code.publicCode)}`;

  async function api(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && !url.includes('/api/auth/login')) {
      showLogin();
      throw new Error('Votre session a expiré. Reconnectez-vous.');
    }
    if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
    return data;
  }

  function showLogin() {
    clearInterval(dashboardRefreshTimer);
    loginScreen.hidden = false;
    appShell.hidden = true;
    $('#adminPassword').value = '';
    $('#adminUsername').focus();
  }
  function showApp() {
    loginScreen.hidden = true;
    appShell.hidden = false;
    setView('overview', false);
    refreshAll().catch((error) => showToast(error.message));
    clearInterval(dashboardRefreshTimer);
    dashboardRefreshTimer = setInterval(() => {
      if (!document.hidden && !appShell.hidden) Promise.all([loadDashboard(), loadScanAnalytics()]).catch((error) => showToast(error.message));
    }, 30000);
  }
  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2800);
  }
  function showModal(markup) {
    modalRoot.innerHTML = markup;
    modalRoot.hidden = false;
    const first = $('input:not([type="hidden"]),select,button', modalRoot);
    if (first) setTimeout(() => first.focus(), 40);
  }
  function closeModal() {
    modalRoot.hidden = true;
    modalRoot.innerHTML = '';
  }
  function modalError(message) {
    const target = $('#modalError', modalRoot);
    if (target) { target.textContent = message; target.hidden = false; }
    else showToast(message);
  }
  function typeLabel(type) { return TYPE_LABELS[type] || 'Autre'; }
  function fmtDate(value, time = false) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('fr-FR', time ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
  }
  function categoryName(id) { return state.categories.find((item) => item.id === id)?.name || 'Sans catégorie'; }
  function initials(name) { return String(name || '?').trim().slice(0, 1).toLocaleUpperCase('fr'); }
  function beneAvatar(row, large = false) {
    const cls = large ? 'bene-card-avatar' : 'bene-avatar';
    return row.logo ? `<span class="${cls}"><img src="${esc(row.logo)}" alt=""></span>` : `<span class="${cls}">${esc(initials(row.name))}</span>`;
  }

  async function refreshAll() {
    const categories = await api('/api/admin/categories');
    state.categories = categories.data || [];
    fillCategoryFilter();
    await Promise.all([loadDashboard(), loadCodes(), loadBeneficiaries(), loadScanAnalytics(), loadDisplaySettings()]);
    if (state.view === 'activity') await loadActivity();
  }
  async function loadDashboard() {
    const data = await api('/api/admin/dashboard');
    $('#statBeneficiaries').textContent = number(data.stats.beneficiaries);
    $('#statActiveCodes').textContent = number(data.stats.activeCodes);
    $('#statTotalCodes').textContent = number(data.stats.totalCodes);
    $('#statScans').textContent = number(data.stats.scans);
    $('#statScansWeek').textContent = number(data.stats.scansLast7);
    $('#navCodeCount').textContent = number(data.stats.activeCodes);
    renderRecent(data.recentCodes || []);
  }
  async function loadScanAnalytics() {
    const result = await api(`/api/admin/scan-stats?period=${encodeURIComponent(state.scanPeriod)}`);
    $('#scanPeriodTotal').textContent = number(result.total);
    const beneficiaries = $('#scanBeneficiaryRows');
    const byBeneficiary = result.byBeneficiary || [];
    beneficiaries.innerHTML = byBeneficiary.length ? byBeneficiary.map((row) => `<tr><td>${esc(row.name)}<small>${esc(typeLabel(row.type))}</small></td><td>${number(row.scanCount)}</td></tr>`).join('') : '<tr><td colspan="2">Aucun bénéficiaire enregistré.</td></tr>';
    const codes = $('#scanCodeRows');
    const byCode = result.byCode || [];
    codes.innerHTML = byCode.length ? byCode.map((row) => `<tr><td>${esc(row.name)}<small>${esc(row.beneficiaryName)}</small></td><td>${number(row.scanCount)}</td></tr>`).join('') : '<tr><td colspan="2">Aucun code QR enregistré.</td></tr>';
  }
  async function loadDisplaySettings() {
    const result = await api('/api/admin/settings');
    state.defaultPublicTextSize = result.data.defaultPublicTextSize || 'normal';
    const select = $('#defaultPublicTextSize');
    if (select) select.value = state.defaultPublicTextSize;
    const base = $('#publicDomainStatus');
    if (base) {
      base.textContent = state.publicBaseUrl
        ? `Domaine public configuré : ${state.publicBaseUrl}`
        : 'Aucun domaine personnalisé configuré : les nouveaux QR utilisent actuellement l’adresse Render.';
    }
  }
  async function saveDisplaySettings() {
    const select = $('#defaultPublicTextSize');
    if (!select) return;
    try {
      const result = await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ defaultPublicTextSize: select.value }) });
      state.defaultPublicTextSize = result.data.defaultPublicTextSize;
      showToast('Taille générale enregistrée. Les QR en mode « Par défaut » sont mis à jour.');
    } catch (error) { showToast(error.message); }
  }
  function renderRecent(rows) {
    const target = $('#overviewRecent');
    if (!rows.length) {
      target.innerHTML = '<div class="recent-empty">Vos QR codes récents apparaîtront ici.</div>';
      return;
    }
    target.innerHTML = rows.map((row) => `<button class="recent-row" type="button" data-action="preview" data-id="${esc(row.id)}"><span class="qr-mini">${ICONS.qr}</span><span class="recent-row-text"><strong>${esc(row.name)}</strong><span>${esc(row.beneficiaryName)} · ${esc(row.categoryName)}</span></span><span class="recent-row-end"><span>${number(row.scanCount)} scan${Number(row.scanCount) === 1 ? '' : 's'}</span><small>${esc(fmtDate(row.updatedAt))}</small></span></button>`).join('');
  }

  function setView(view, load = true) {
    if (!['overview', 'codes', 'beneficiaries', 'activity', 'settings'].includes(view)) view = 'overview';
    state.view = view;
    $$('.view-panel').forEach((panel) => { panel.hidden = panel.id !== `view-${view}`; });
    $$('.nav-item').forEach((button) => button.classList.toggle('is-active', button.dataset.view === view));
    const titles = { overview: 'Vue d’ensemble', codes: 'Codes QR', beneficiaries: 'Bénéficiaires', activity: 'Historique', settings: 'Réglages' };
    $('#breadcrumbTitle').textContent = titles[view];
    $('#sidebar').classList.remove('is-open');
    if (load) {
      if (view === 'codes') loadCodes().catch((error) => showToast(error.message));
      if (view === 'beneficiaries') loadBeneficiaries().catch((error) => showToast(error.message));
      if (view === 'activity') loadActivity().catch((error) => showToast(error.message));
      if (view === 'settings') loadDisplaySettings().catch((error) => showToast(error.message));
      if (view === 'overview') Promise.all([loadDashboard(), loadScanAnalytics()]).catch((error) => showToast(error.message));
    }
  }

  function fillCategoryFilter() {
    const filter = $('#categoryFilter');
    const selected = state.codeCategory || filter.value;
    filter.innerHTML = '<option value="">Toutes les catégories</option>' + state.categories.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
    if ([...filter.options].some((item) => item.value === selected)) filter.value = selected;
  }
  function pageCount(total, limit) { return Math.max(1, Math.ceil((Number(total) || 0) / limit)); }
  function fillPagination(prevId, nextId, labelId, page, total, limit) {
    const max = pageCount(total, limit);
    $(labelId).textContent = `${page} / ${max}`;
    $(prevId).disabled = page <= 1;
    $(nextId).disabled = page >= max;
  }

  async function loadCodes() {
    fillCategoryFilter();
    const params = new URLSearchParams({ page: String(state.codePage), limit: '25' });
    if (state.codeSearch) params.set('search', state.codeSearch);
    if (state.codeCategory) params.set('categoryId', state.codeCategory);
    if (state.codeStatus) params.set('status', state.codeStatus);
    if (state.codeBeneficiaryId) params.set('beneficiaryId', state.codeBeneficiaryId);
    const result = await api(`/api/admin/codes?${params}`);
    state.codeTotal = result.total;
    const body = $('#codesTableBody');
    body.innerHTML = result.data.map((row) => {
      const beneficiaryDeleted = Boolean(row.beneficiaryDeletedAt);
      const beneficiaryBlocked = row.beneficiaryStatus === 'blocked';
      const codeBlocked = row.status !== 'active';
      const statusLabel = beneficiaryDeleted ? 'Bénéficiaire supprimé'
        : beneficiaryBlocked && codeBlocked ? 'QR et bénéficiaire bloqués'
          : beneficiaryBlocked ? 'Bénéficiaire bloqué' : codeBlocked ? 'QR bloqué' : 'Actif';
      const statusClass = !beneficiaryBlocked && !codeBlocked && !beneficiaryDeleted ? 'status-active' : 'status-blocked';
      const status = `<span class="status-pill ${statusClass}">${statusLabel}</span>`;
      const next = row.status === 'active' ? 'deactivate' : 'activate';
      const nextTitle = row.status === 'active' ? 'Bloquer ce QR' : 'Débloquer ce QR';
      const nextIcon = row.status === 'active' ? ICONS.lock : ICONS.unlock;
      return `<tr>
        <td><div class="code-cell"><span class="code-thumbnail">${ICONS.qr}</span><span><button class="table-link" type="button" data-action="preview" data-id="${esc(row.id)}">${esc(row.name)}</button><small>ID ${esc(row.publicCode)}</small></span></div></td>
        <td><div class="bene-cell">${beneAvatar({ logo: '', name: row.beneficiaryName })}<span><strong>${esc(row.beneficiaryName)}</strong><small>${esc(typeLabel(row.beneficiaryType))}</small></span></div></td>
        <td><span class="category-pill">${esc(row.categoryName)}</span></td><td>${status}</td><td><span class="scan-count">${number(row.scanCount)}</span></td>
        <td><div class="row-actions">
          <button class="icon-action" type="button" title="Aperçu" aria-label="Aperçu" data-action="preview" data-id="${esc(row.id)}">${ICONS.eye}</button>
          <button class="icon-action" type="button" title="Modifier" aria-label="Modifier" data-action="edit" data-id="${esc(row.id)}">${ICONS.edit}</button>
          <button class="icon-action" type="button" title="Télécharger PNG" aria-label="Télécharger PNG" data-action="png" data-id="${esc(row.id)}">${ICONS.download}</button>
          <button class="icon-action" type="button" title="Télécharger SVG" aria-label="Télécharger SVG" data-action="svg" data-id="${esc(row.id)}">${ICONS.file}</button>
          <button class="icon-action" type="button" title="Copier le lien" aria-label="Copier le lien" data-action="copy" data-id="${esc(row.id)}">${ICONS.link}</button>
          <button class="icon-action" type="button" title="Imprimer" aria-label="Imprimer" data-action="print" data-id="${esc(row.id)}">${ICONS.print}</button>
          <button class="icon-action" type="button" title="Historique" aria-label="Historique" data-action="history" data-id="${esc(row.id)}">${ICONS.clock}</button>
          <button class="icon-action" type="button" title="${beneficiaryDeleted ? 'Bénéficiaire supprimé — statut verrouillé' : nextTitle}" aria-label="${beneficiaryDeleted ? 'Statut verrouillé car le bénéficiaire est supprimé' : nextTitle}" data-action="${next}" data-id="${esc(row.id)}"${beneficiaryDeleted ? ' disabled' : ''}>${nextIcon}</button>
          <button class="icon-action is-danger" type="button" title="Supprimer" aria-label="Supprimer" data-action="delete" data-id="${esc(row.id)}">${ICONS.trash}</button>
        </div></td>
      </tr>`;
    }).join('');
    const empty = $('#codesEmpty');
    empty.hidden = result.data.length > 0;
    if (!result.total) {
      $('strong', empty).textContent = 'Aucun code QR pour le moment';
      $('span:not(.empty-illustration)', empty).textContent = 'Créez un bénéficiaire, puis associez-lui son premier QR code.';
      $('#emptyCreateCode').hidden = false;
    } else {
      $('strong', empty).textContent = 'Aucun résultat trouvé';
      $('span:not(.empty-illustration)', empty).textContent = 'Essayez un autre nom, une autre catégorie ou un autre statut.';
      $('#emptyCreateCode').hidden = true;
    }
    $('#codesResultCount').textContent = `${number(result.total)} résultat${result.total === 1 ? '' : 's'}`;
    fillPagination('#codesPrev', '#codesNext', '#codesPageLabel', state.codePage, result.total, 25);
  }

  async function loadBeneficiaries() {
    const params = new URLSearchParams({ page: String(state.beneficiaryPage), limit: '12' });
    if (state.beneficiarySearch) params.set('search', state.beneficiarySearch);
    if (state.beneficiaryType) params.set('type', state.beneficiaryType);
    if (state.beneficiaryStatus) params.set('status', state.beneficiaryStatus);
    const result = await api(`/api/admin/beneficiaries?${params}`);
    state.beneficiaryTotal = result.total;
    const grid = $('#beneficiaryGrid');
    grid.innerHTML = result.data.map((row) => {
      const blocked = row.status === 'blocked';
      const toggleAction = blocked ? 'unblock-beneficiary' : 'block-beneficiary';
      const toggleLabel = blocked ? 'Débloquer' : 'Bloquer';
      const toggleIcon = blocked ? ICONS.unlock : ICONS.lock;
      return `<article class="beneficiary-card">
        <div class="bene-card-top">${beneAvatar(row, true)}<div><strong>${esc(row.name)}</strong><small>${esc(typeLabel(row.type))}${row.email ? ` · ${esc(row.email)}` : ''}</small></div><button class="icon-action" type="button" title="Modifier" aria-label="Modifier ${esc(row.name)}" data-action="edit-beneficiary" data-id="${esc(row.id)}">${ICONS.edit}</button></div>
        <div class="bene-card-details"><span><strong>${number(row.qrCount)}</strong> code${Number(row.qrCount) === 1 ? '' : 's'} QR</span><span class="status-pill ${blocked ? 'status-blocked' : 'status-active'}">${blocked ? 'Bloqué' : 'Actif'}</span><span>${esc(fmtDate(row.updatedAt))}</span></div>
        <div class="bene-card-actions"><button class="button button-secondary" type="button" data-action="bene-codes" data-id="${esc(row.id)}">Voir ses codes</button><button class="button button-quiet" type="button" data-action="edit-beneficiary" data-id="${esc(row.id)}">Modifier</button><button class="button ${blocked ? 'button-secondary' : 'button-danger'}" type="button" title="${toggleLabel} ${esc(row.name)}" data-action="${toggleAction}" data-id="${esc(row.id)}" data-name="${esc(row.name)}">${toggleIcon}${toggleLabel}</button><button class="icon-action" type="button" title="Historique" aria-label="Historique de ${esc(row.name)}" data-action="bene-history" data-id="${esc(row.id)}">${ICONS.clock}</button><button class="icon-action is-danger" type="button" title="Supprimer" aria-label="Supprimer ${esc(row.name)}" data-action="delete-beneficiary" data-id="${esc(row.id)}" data-name="${esc(row.name)}">${ICONS.trash}</button></div>
      </article>`;
    }).join('');
    $('#beneficiariesEmpty').hidden = result.data.length > 0;
    grid.hidden = result.data.length === 0;
    $('#beneficiaryResultCount').textContent = `${number(result.total)} bénéficiaire${result.total === 1 ? '' : 's'}`;
    fillPagination('#beneficiariesPrev', '#beneficiariesNext', '#beneficiariesPageLabel', state.beneficiaryPage, result.total, 12);
  }

  function actionLabel(action) {
    return ({ create: 'Création', update: 'Modification', activate: 'Déblocage', deactivate: 'Blocage', block: 'Blocage', unblock: 'Déblocage', delete: 'Suppression', archive: 'Archivage' })[action] || action;
  }
  async function loadActivity() {
    const params = new URLSearchParams({ page: String(state.activityPage) });
    if (state.activityType) params.set('entityType', state.activityType);
    const result = await api(`/api/admin/activity?${params}`);
    state.activityTotal = result.total;
    const list = $('#activityList');
    if (!result.data.length) {
      list.innerHTML = '<div class="activity-empty">Les modifications apparaîtront ici.</div>';
    } else {
      list.innerHTML = result.data.map((item) => `<article class="activity-row"><span class="activity-mark${item.action === 'delete' || item.action === 'archive' ? ' is-delete' : ''}">${item.action === 'delete' || item.action === 'archive' ? ICONS.trash : item.entityType === 'qr_code' ? ICONS.qr : ICONS.edit}</span><div class="activity-text"><strong>${esc(actionLabel(item.action))} · ${esc(item.summary)}</strong><p>${esc(item.actor || 'Administrateur')} · ${esc(item.entityType === 'qr_code' ? 'Code QR' : item.entityType === 'beneficiary' ? 'Bénéficiaire' : item.entityType === 'settings' ? 'Réglages' : 'Catégorie')} · ID ${esc(String(item.entityId).slice(0, 12))}</p></div><time>${esc(fmtDate(item.createdAt, true))}</time></article>`).join('');
    }
    $('#activityCount').textContent = `${number(result.total)} événement${result.total === 1 ? '' : 's'}`;
    fillPagination('#activityPrev', '#activityNext', '#activityPageLabel', state.activityPage, result.total, 30);
  }

  function pipeLines(text, count) {
    return String(text || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const parts = line.split('|').map((part) => part.trim());
      while (parts.length < count) parts.push('');
      return parts;
    });
  }
  function formatPipeRows(rows, keys) {
    return (Array.isArray(rows) ? rows : []).map((row) => keys.map((key) => row[key] || '').join(' | ')).join('\n');
  }
  function optionsHtml(items, selected, firstLabel) {
    return `<option value="">${esc(firstLabel)}</option>` + items.map((item) => `<option value="${esc(item.id)}"${item.id === selected ? ' selected' : ''}>${esc(item.name)}</option>`).join('');
  }
  function newPhotoId() { return window.crypto?.randomUUID ? window.crypto.randomUUID() : `photo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }
  function renderBeneficiaryPhotoEditor() {
    const target = $('#beneficiaryPhotoEditor', modalRoot);
    if (!target) return;
    const photos = state.currentBeneficiaryPhotos || [];
    target.innerHTML = photos.length ? photos.map((photo) => `<article class="photo-editor-card"><img src="${esc(photo.src)}" alt="${esc(photo.alt || 'Photo du bénéficiaire')}"><div><input type="text" maxlength="140" value="${esc(photo.alt || '')}" placeholder="Description facultative" aria-label="Description de la photo" data-photo-alt="${esc(photo.id)}"><button type="button" class="text-button" data-remove-beneficiary-photo="${esc(photo.id)}">Supprimer</button></div></article>`).join('') : '<span class="hint">Aucune photo supplémentaire enregistrée.</span>';
  }
  function openBeneficiaryForm(id = '') {
    const render = (row = {}) => {
      const isEdit = Boolean(id);
      state.currentBeneficiaryPhotos = Array.isArray(row.photos) ? row.photos.map((photo) => ({ ...photo })) : [];
      const isData = String(row.logo || '').startsWith('data:image/');
      const logoValue = isData ? row.logo : '';
      showModal(`<article class="modal-card"><div class="modal-header"><div><span class="eyebrow">RÉPERTOIRE</span><h2>${isEdit ? 'Modifier le bénéficiaire' : 'Nouveau bénéficiaire'}</h2><p>Les champs facultatifs ne seront affichés que sur les QR codes où vous les sélectionnez.</p></div><button class="modal-close" type="button" data-close-modal aria-label="Fermer">×</button></div><form id="beneficiaryForm" class="modal-form"><input id="beneEditId" type="hidden" value="${esc(row.id || '')}"><div class="modal-body"><div class="form-grid">
        <div class="form-section-title">Identité <span>Qui recevra les QR codes ?</span></div>
        <div class="form-field"><label for="beneType">Type de bénéficiaire *</label><select id="beneType" required><option value="individual"${row.type === 'individual' ? ' selected' : ''}>Particulier</option><option value="business"${row.type === 'business' ? ' selected' : ''}>Entreprise</option><option value="commerce"${row.type === 'commerce' ? ' selected' : ''}>Commerce</option><option value="organization"${row.type === 'organization' ? ' selected' : ''}>Organisation / établissement</option><option value="other"${row.type === 'other' ? ' selected' : ''}>Autre</option></select></div>
        <div class="form-field"><label for="beneName">Nom *</label><input id="beneName" type="text" maxlength="140" required placeholder="Nom du particulier ou de la structure" value="${esc(row.name || '')}"></div>
        <div class="form-field span-2"><label for="beneLogoUrl">Photo principale ou logo</label><div class="field-inline"><input id="beneLogoUrl" type="url" placeholder="https://… (facultatif)" value="${isData ? '' : esc(row.logo || '')}"><input id="beneLogoFile" type="file" accept="image/png,image/jpeg,image/webp"></div><input id="beneLogoData" type="hidden" value="${esc(logoValue)}"><span class="hint">Photo de profil ou logo qui peut servir d’image principale sur la page QRia.</span><div id="logoPreviewWrap" class="logo-preview-wrap"${row.logo ? '' : ' hidden'}><img id="logoPreview" src="${row.logo ? esc(row.logo) : ''}" alt="Aperçu du logo"><button type="button" class="text-button" id="removeLogoButton">Retirer le logo</button></div></div>
        <div class="form-field span-2"><label for="benePhotoFiles">Galerie de photos (jusqu’à 8)</label><input id="benePhotoFiles" type="file" accept="image/png,image/jpeg,image/webp" multiple><span class="hint">Les photos sont automatiquement réduites et optimisées. Sélectionnez ensuite celles qui apparaîtront pour chaque QR.</span><div id="beneficiaryPhotoEditor" class="photo-editor-grid"></div></div>
        <div class="form-section-title">Coordonnées <span>Ajoutez uniquement les informations utiles.</span></div>
        <div class="form-field"><label for="benePhone">Téléphone</label><input id="benePhone" type="text" maxlength="50" placeholder="+225 …" value="${esc(row.phone || '')}"></div>
        <div class="form-field"><label for="beneWhatsapp">WhatsApp</label><input id="beneWhatsapp" type="text" maxlength="50" placeholder="+225 …" value="${esc(row.whatsapp || '')}"></div>
        <div class="form-field"><label for="beneEmail">Adresse e-mail</label><input id="beneEmail" type="email" maxlength="254" placeholder="contact@exemple.ci" value="${esc(row.email || '')}"></div>
        <div class="form-field"><label for="beneWebsite">Site Internet</label><input id="beneWebsite" type="url" placeholder="https://…" value="${esc(row.website || '')}"></div>
        <div class="form-field span-2"><label for="beneAddress">Adresse physique</label><input id="beneAddress" type="text" maxlength="300" placeholder="Commune, rue, repère…" value="${esc(row.address || '')}"></div>
        <div class="form-field span-2"><label for="beneLocationUrl">Lien de localisation</label><input id="beneLocationUrl" type="url" placeholder="Lien Google Maps ou autre carte" value="${esc(row.locationUrl || '')}"></div>
        <div class="form-field span-2"><label for="beneBio">Présentation</label><textarea id="beneBio" maxlength="3000" placeholder="Quelques lignes sur la personne, l’entreprise ou l’établissement…">${esc(row.bio || '')}</textarea></div>
        <div class="form-section-title">Contenus réutilisables <span>Ces éléments pourront être sélectionnés dans chaque QR.</span></div>
        <div class="form-field span-2"><label for="beneSocials">Réseaux sociaux</label><textarea id="beneSocials" placeholder="Instagram | https://instagram.com/…&#10;Facebook | https://facebook.com/…">${esc(formatPipeRows(row.socials, ['label', 'url']))}</textarea><span class="hint">Une ligne par lien, au format « Nom | URL ».</span></div>
        <div class="form-field span-2"><label for="beneOffers">Produits, services et tarifs</label><textarea id="beneOffers" placeholder="Nom | Description | Tarif | Lien facultatif&#10;Tresse | Coiffure protectrice | 15 000 FCFA | https://…">${esc(formatPipeRows(row.offers, ['name', 'description', 'price', 'url']))}</textarea><span class="hint">Une ligne par offre, au format « Nom | Description | Tarif | URL ».</span></div>
        <div class="form-field span-2"><label for="beneDocuments">Documents et catalogues</label><textarea id="beneDocuments" placeholder="Catalogue 2026 | https://…&#10;Formulaire de commande | https://…">${esc(formatPipeRows(row.documents, ['name', 'url']))}</textarea><span class="hint">Une ligne par document, au format « Nom | URL ».</span></div>
      </div></div><div class="modal-error" id="modalError" role="alert" hidden></div><div class="modal-footer"><span class="modal-footer-note">Les bénéficiaires ne se connectent pas à l’administration.</span><div class="modal-footer-actions"><button class="button button-secondary" type="button" data-close-modal>Annuler</button><button class="button button-primary" type="submit">${isEdit ? 'Enregistrer les changements' : 'Créer le bénéficiaire'}</button></div></div></form></article>`);
      renderBeneficiaryPhotoEditor();
      const preview = $('#logoPreview', modalRoot);
      $('#beneLogoUrl', modalRoot).addEventListener('input', () => {
        const url = $('#beneLogoUrl', modalRoot).value.trim();
        $('#beneLogoData', modalRoot).value = '';
        if (/^https:\/\//i.test(url)) { preview.src = url; $('#logoPreviewWrap', modalRoot).hidden = false; }
        else $('#logoPreviewWrap', modalRoot).hidden = true;
      });
    };
    if (id) api(`/api/admin/beneficiaries/${encodeURIComponent(id)}`).then((result) => render(result.data)).catch((error) => showToast(error.message));
    else render();
  }

  async function fileToDataUrl(file) {
    if (!file) return '';
    return optimizePhotoFile(file, { maxDimension: 900, maxChars: 350 * 1024 });
  }
  async function optimizePhotoFile(file, { maxDimension = 1400, maxChars = 350 * 1024 } = {}) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choisissez une image PNG, JPEG ou WebP.');
    if (file.size > 20 * 1024 * 1024) throw new Error('Choisissez une image de moins de 20 Mo.');
    const source = URL.createObjectURL(file);
    const image = await new Promise((resolve, reject) => {
      const picture = new Image();
      picture.onload = () => { URL.revokeObjectURL(source); resolve(picture); };
      picture.onerror = () => { URL.revokeObjectURL(source); reject(new Error('Impossible d’ouvrir cette photo.')); };
      picture.src = source;
    });
    let scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    let quality = 0.82;
    let data = '';
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      data = canvas.toDataURL('image/webp', quality);
      if (!data.startsWith('data:image/webp')) {
        context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        data = canvas.toDataURL('image/jpeg', quality);
      }
      if (data.length <= maxChars) return data;
      scale *= 0.82; quality = Math.max(0.48, quality - 0.06);
    }
    if (data.length > maxChars + 20 * 1024) throw new Error('Cette image reste trop volumineuse après optimisation. Choisissez une autre image.');
    return data;
  }

  async function openQrForm(id = '') {
    const editData = id ? (await api(`/api/admin/codes/${encodeURIComponent(id)}`)).data : null;
    const isEdit = Boolean(editData);
    const categories = state.categories;
    const initialPurpose = editData?.purpose || 'contact';
    const initialType = editData?.destinationType || 'page';
    const initialFields = new Set(editData?.selectedFields || ['logo', 'phone', 'whatsapp', 'email', 'address', 'website', 'socials', 'bio', 'offers', 'documents']);
    const initialPhotoIds = new Set(editData?.selectedPhotoIds || []);
    const style = { foreground: '#173B32', background: '#FFFFFF', correction: 'M', textSize: 'default', ...(editData?.style || {}) };
    showModal(`<article class="modal-card"><div class="modal-header"><div><span class="eyebrow">CRÉATION CENTRALISÉE</span><h2>${isEdit ? 'Modifier un code QR' : 'Créer un code QR'}</h2><p>Chaque bénéficiaire peut recevoir plusieurs codes QR indépendants.</p></div><button class="modal-close" type="button" data-close-modal aria-label="Fermer">×</button></div><form id="qrForm" class="modal-form"><input id="qrEditId" type="hidden" value="${esc(editData?.id || '')}"><div class="modal-body"><div class="form-grid">
      <div class="form-section-title">Identification <span>Nom, bénéficiaire et organisation.</span></div>
      <div class="form-field span-2"><label for="qrName">Nom du code QR *</label><input id="qrName" type="text" maxlength="120" required placeholder="Ex. Carte de visite, menu, tarifs…" value="${esc(editData?.name || '')}"></div>
      <div class="form-field span-2"><label for="qrBeneSearch">Rechercher un bénéficiaire *</label><input id="qrBeneSearch" type="search" placeholder="Tapez un nom pour le retrouver…" autocomplete="off" value="${esc(editData?.beneficiaryName || '')}"><select id="qrBeneficiaryId" required><option value="">Chargement des bénéficiaires…</option></select><span class="hint">Le même bénéficiaire peut être associé à autant de QR codes que nécessaire.</span></div>
      <div class="form-field"><label for="qrCategoryId">Catégorie</label><select id="qrCategoryId">${optionsHtml(categories, editData?.categoryId || '', 'Choisir une catégorie')}</select></div>
      <div class="form-field"><label for="qrPurpose">Usage du QR code</label><select id="qrPurpose"><option value="contact"${initialPurpose === 'contact' ? ' selected' : ''}>Coordonnées</option><option value="catalog"${initialPurpose === 'catalog' ? ' selected' : ''}>Catalogue</option><option value="prices"${initialPurpose === 'prices' ? ' selected' : ''}>Tarifs</option><option value="menu"${initialPurpose === 'menu' ? ' selected' : ''}>Menu</option><option value="website"${initialPurpose === 'website' ? ' selected' : ''}>Site Internet</option><option value="social"${initialPurpose === 'social' ? ' selected' : ''}>Réseaux sociaux</option><option value="services"${initialPurpose === 'services' ? ' selected' : ''}>Services</option><option value="order"${initialPurpose === 'order' ? ' selected' : ''}>Commande / formulaire</option><option value="other"${initialPurpose === 'other' ? ' selected' : ''}>Autre</option></select></div>
      <div class="form-section-title">Destination <span>Le lien du QR reste stable si la page hébergée change.</span></div>
      <div class="form-field span-2"><div class="radio-cards"><label class="radio-card"><input type="radio" name="destinationType" value="page"${initialType === 'page' ? ' checked' : ''}><span><strong>Page QRia modifiable</strong><small>Une page mobile avec les informations choisies, éditable sans changer le QR.</small></span></label><label class="radio-card"><input type="radio" name="destinationType" value="redirect"${initialType === 'redirect' ? ' checked' : ''}><span><strong>Redirection Internet</strong><small>Envoie directement vers un site, un catalogue ou un formulaire.</small></span></label></div></div>
      <div class="form-field span-2" id="redirectOptions"${initialType === 'redirect' ? '' : ' hidden'}><label for="qrTargetUrl">Adresse de destination *</label><input id="qrTargetUrl" type="url" placeholder="https://exemple.ci/catalogue" value="${esc(editData?.targetUrl || '')}"></div>
      <div id="pageOptions" class="form-grid span-2"${initialType === 'page' ? '' : ' hidden'}>
        <div class="form-field span-2"><label for="qrTitle">Titre de la page</label><input id="qrTitle" type="text" maxlength="140" placeholder="Par défaut, le nom du bénéficiaire" value="${esc(editData?.title || '')}"></div>
        <div class="form-field span-2"><label for="qrDescription">Courte description</label><textarea id="qrDescription" maxlength="800" placeholder="Une phrase d’accueil ou de contexte…">${esc(editData?.description || '')}</textarea></div>
        <div class="form-field span-2"><label for="qrContentText">Message ou présentation propre à ce QR</label><textarea id="qrContentText" maxlength="5000" placeholder="Contenu spécifique, consignes, informations utiles…">${esc(editData?.contentText || '')}</textarea></div>
        <div class="form-field span-2"><label for="qrExtraLinks">Liens complémentaires</label><textarea id="qrExtraLinks" placeholder="Formulaire de commande | https://…&#10;Catalogue PDF | https://…">${esc(formatPipeRows(editData?.extraLinks, ['label', 'url']))}</textarea><span class="hint">Une ligne par lien, au format « Libellé | URL ».</span></div>
        <div class="form-field span-2"><span class="form-label">Informations du bénéficiaire à afficher</span><div class="check-grid">${FIELD_LABELS.map(([value, label]) => `<label class="check-option"><input type="checkbox" name="selectedFields" value="${value}"${initialFields.has(value) ? ' checked' : ''}><span>${esc(label)}</span></label>`).join('')}</div><span class="hint">Le nom du bénéficiaire reste toujours visible. Les autres informations sont facultatives.</span></div>
        <div class="form-field span-2"><span class="form-label">Photos de la galerie à afficher</span><div id="qrPhotoOptions" class="qr-photo-options"><span class="hint">Choisissez un bénéficiaire pour voir ses photos.</span></div><span class="hint">Vous pouvez choisir des photos différentes pour chaque QR.</span></div>
      </div>
      <div class="form-section-title">Apparence <span>Optimisée pour l’impression et le scan.</span></div>
      <div class="form-field"><label for="qrForeground">Couleur du QR</label><input id="qrForeground" type="color" value="${esc(style.foreground || '#173B32')}"></div>
      <div class="form-field"><label for="qrBackground">Couleur du fond</label><input id="qrBackground" type="color" value="${esc(style.background || '#FFFFFF')}"></div>
      <div class="form-field span-2"><label for="qrTextSize">Taille du texte sur cette page</label><select id="qrTextSize"><option value="default"${style.textSize === 'default' ? ' selected' : ''}>Réglage général du tableau de bord</option><option value="small"${style.textSize === 'small' ? ' selected' : ''}>Petite</option><option value="normal"${style.textSize === 'normal' ? ' selected' : ''}>Normale</option><option value="large"${style.textSize === 'large' ? ' selected' : ''}>Grande</option><option value="xlarge"${style.textSize === 'xlarge' ? ' selected' : ''}>Très grande</option></select><span class="hint">Le choix individuel remplace la taille générale pour ce QR uniquement.</span></div>
      <div class="form-field"><label for="qrCorrection">Correction d’erreur</label><select id="qrCorrection"><option value="M"${style.correction === 'M' ? ' selected' : ''}>Moyenne — recommandée</option><option value="L"${style.correction === 'L' ? ' selected' : ''}>Faible</option><option value="Q"${style.correction === 'Q' ? ' selected' : ''}>Élevée</option><option value="H"${style.correction === 'H' ? ' selected' : ''}>Maximale</option></select></div>
      <div class="form-field"><span class="form-label">Identifiant</span><div class="modal-callout"><svg viewBox="0 0 16 16" fill="none"><path d="M8 1.6 13 3.4v3.7c0 3.2-2.1 5.8-5 7.3-2.9-1.5-5-4.1-5-7.3V3.4l5-1.8Z" stroke="currentColor" stroke-width="1.2"/><path d="m5.8 7.9 1.4 1.4 3-3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${isEdit ? `Identifiant stable : ${esc(editData.publicCode)}. Les modifications ne changent pas le code imprimé.` : 'Un identifiant public unique sera créé automatiquement à l’enregistrement.'}</span></div></div>
    </div></div><div class="modal-error" id="modalError" role="alert" hidden></div><div class="modal-footer"><span class="modal-footer-note">La page hébergée reste modifiable après le scan.</span><div class="modal-footer-actions"><button class="button button-secondary" type="button" data-close-modal>Annuler</button><button class="button button-primary" type="submit">${isEdit ? 'Enregistrer les changements' : 'Créer le QR code'}</button></div></div></form></article>`);
    await refreshBeneficiaryOptions(editData?.beneficiaryId || '', editData?.beneficiaryName || '', '');
    const categorySelect = $('#qrCategoryId', modalRoot);
    const beneSelect = $('#qrBeneficiaryId', modalRoot);
    await loadQrPhotoOptions(beneSelect.value, initialPhotoIds).catch((error) => showToast(error.message));
    let categoryTouched = Boolean(editData?.categoryId);
    categorySelect.addEventListener('change', () => { categoryTouched = true; });
    beneSelect.addEventListener('change', async () => {
      if (!categoryTouched) {
        const bene = state.modalBeneficiaries?.find((item) => item.id === beneSelect.value);
        if (bene) categorySelect.value = CATEGORY_BY_TYPE[bene.type] || 'cat-other';
      }
      loadQrPhotoOptions(beneSelect.value, new Set()).catch((error) => showToast(error.message));
    });
    $('#qrBeneSearch', modalRoot).addEventListener('input', () => {
      clearTimeout(beneSelectTimer);
      beneSelectTimer = setTimeout(() => refreshBeneficiaryOptions('', '', $('#qrBeneSearch', modalRoot).value.trim()).catch((error) => showToast(error.message)), 230);
    });
    $$('input[name="destinationType"]', modalRoot).forEach((radio) => radio.addEventListener('change', updateDestinationFields));
  }

  async function refreshBeneficiaryOptions(selectedId = '', selectedName = '', search = '') {
    const select = $('#qrBeneficiaryId', modalRoot);
    if (!select) return;
    const result = await api(`/api/admin/beneficiaries?limit=100&status=active&search=${encodeURIComponent(search)}`);
    let rows = result.data || [];
    if (selectedId && !rows.some((row) => row.id === selectedId)) {
      try { const one = await api(`/api/admin/beneficiaries/${encodeURIComponent(selectedId)}`); rows = [one.data, ...rows]; } catch (_) { /* Beneficiary may have been deleted. */ }
    }
    state.modalBeneficiaries = rows;
    const selected = selectedId || select.value;
    select.innerHTML = '<option value="">Sélectionner un bénéficiaire…</option>' + rows.map((row) => `<option value="${esc(row.id)}">${esc(row.name)} — ${esc(typeLabel(row.type))}${row.status === 'blocked' ? ' · Bloqué (QR indisponible)' : ''}</option>`).join('');
    if (selected && rows.some((row) => row.id === selected)) select.value = selected;
    if (selectedName && !$('#qrBeneSearch', modalRoot).value) $('#qrBeneSearch', modalRoot).value = selectedName;
  }
  async function loadQrPhotoOptions(beneficiaryId, selectedIds = new Set()) {
    const target = $('#qrPhotoOptions', modalRoot);
    if (!target) return;
    if (!beneficiaryId) { target.innerHTML = '<span class="hint">Sélectionnez un bénéficiaire pour voir ses photos.</span>'; return; }
    target.innerHTML = '<span class="hint">Chargement des photos…</span>';
    const result = await api(`/api/admin/beneficiaries/${encodeURIComponent(beneficiaryId)}`);
    const photos = result.data.photos || [];
    if (!photos.length) { target.innerHTML = '<span class="hint">Ce bénéficiaire n’a pas encore de photo de galerie.</span>'; return; }
    target.innerHTML = photos.map((photo) => `<label class="qr-photo-option"><input type="checkbox" name="selectedPhotoIds" value="${esc(photo.id)}"${selectedIds.has(photo.id) ? ' checked' : ''}><img src="${esc(photo.src)}" alt=""><span>${esc(photo.alt || 'Photo')}</span></label>`).join('');
  }

  function updateDestinationFields() {
    const redirect = $('input[name="destinationType"]:checked', modalRoot)?.value === 'redirect';
    const redirectOptions = $('#redirectOptions', modalRoot);
    const pageOptions = $('#pageOptions', modalRoot);
    if (redirectOptions) redirectOptions.hidden = !redirect;
    if (pageOptions) pageOptions.hidden = redirect;
    const url = $('#qrTargetUrl', modalRoot);
    if (url) url.required = redirect;
  }

  function valuesFromBeneficiaryForm() {
    const socials = pipeLines($('#beneSocials', modalRoot).value, 2).map(([label, url]) => ({ label, url })).filter((row) => row.label && row.url);
    const offers = pipeLines($('#beneOffers', modalRoot).value, 4).map(([name, description, price, url]) => ({ name, description, price, url })).filter((row) => row.name || row.description);
    const documents = pipeLines($('#beneDocuments', modalRoot).value, 2).map(([name, url]) => ({ name, url })).filter((row) => row.name && row.url);
    return {
      type: $('#beneType', modalRoot).value, name: $('#beneName', modalRoot).value,
      logo: $('#beneLogoData', modalRoot).value || $('#beneLogoUrl', modalRoot).value,
      photos: state.currentBeneficiaryPhotos || [],
      phone: $('#benePhone', modalRoot).value, whatsapp: $('#beneWhatsapp', modalRoot).value,
      email: $('#beneEmail', modalRoot).value, address: $('#beneAddress', modalRoot).value,
      locationUrl: $('#beneLocationUrl', modalRoot).value, website: $('#beneWebsite', modalRoot).value,
      bio: $('#beneBio', modalRoot).value, socials, offers, documents,
    };
  }
  function valuesFromQrForm() {
    const destinationType = $('input[name="destinationType"]:checked', modalRoot)?.value || 'page';
    const selectedFields = $$('input[name="selectedFields"]:checked', modalRoot).map((input) => input.value);
    const selectedPhotoIds = $$('input[name="selectedPhotoIds"]:checked', modalRoot).map((input) => input.value);
    const extraLinks = pipeLines($('#qrExtraLinks', modalRoot)?.value || '', 2).map(([label, url]) => ({ label, url })).filter((row) => row.label && row.url);
    return {
      name: $('#qrName', modalRoot).value, beneficiaryId: $('#qrBeneficiaryId', modalRoot).value,
      categoryId: $('#qrCategoryId', modalRoot).value, purpose: $('#qrPurpose', modalRoot).value,
      destinationType, targetUrl: $('#qrTargetUrl', modalRoot)?.value || '',
      title: $('#qrTitle', modalRoot)?.value || '', description: $('#qrDescription', modalRoot)?.value || '',
      contentText: $('#qrContentText', modalRoot)?.value || '', extraLinks, selectedFields, selectedPhotoIds,
      style: { foreground: $('#qrForeground', modalRoot).value, background: $('#qrBackground', modalRoot).value, correction: $('#qrCorrection', modalRoot).value, textSize: $('#qrTextSize', modalRoot).value },
    };
  }

  async function submitBeneficiary(form) {
    const id = $('#beneEditId', modalRoot)?.value || '';
    const submit = $('button[type="submit"]', form);
    submit.disabled = true;
    try {
      const data = valuesFromBeneficiaryForm();
      const result = await api(id ? `/api/admin/beneficiaries/${encodeURIComponent(id)}` : '/api/admin/beneficiaries', {
        method: id ? 'PUT' : 'POST', body: JSON.stringify(data),
      });
      closeModal();
      showToast(id ? 'Bénéficiaire modifié.' : 'Bénéficiaire créé.');
      await Promise.all([loadDashboard(), loadBeneficiaries()]);
      if (!id) openQrFormForBeneficiary(result.data.id, result.data.name);
    } catch (error) { modalError(error.message); }
    finally { if (submit.isConnected) submit.disabled = false; }
  }
  async function openQrFormForBeneficiary(id, name) {
    await openQrForm();
    if ($('#qrBeneficiaryId', modalRoot)) {
      await refreshBeneficiaryOptions(id, name, '');
      $('#qrBeneficiaryId', modalRoot).value = id;
      $('#qrBeneSearch', modalRoot).value = name;
      $('#qrCategoryId', modalRoot).value = CATEGORY_BY_TYPE[state.modalBeneficiaries?.find((row) => row.id === id)?.type] || 'cat-other';
      await loadQrPhotoOptions(id, new Set()).catch((error) => showToast(error.message));
    }
  }
  async function submitQr(form) {
    const id = $('#qrEditId', modalRoot).value;
    const submit = $('button[type="submit"]', form);
    submit.disabled = true;
    try {
      const result = await api(id ? `/api/admin/codes/${encodeURIComponent(id)}` : '/api/admin/codes', {
        method: id ? 'PUT' : 'POST', body: JSON.stringify(valuesFromQrForm()),
      });
      closeModal();
      showToast(id ? 'QR code mis à jour. Son identifiant public reste inchangé.' : 'QR code créé et enregistré.');
      state.codePage = 1;
      await Promise.all([loadDashboard(), loadCodes(), loadBeneficiaries()]);
      openCodePreview(result.data);
    } catch (error) { modalError(error.message); }
    finally { if (submit.isConnected) submit.disabled = false; }
  }

  function drawQr(canvas, code, size = 480) {
    const qr = qrcode(0, code.style?.correction || 'M');
    qr.addData(getPublicUrl(code));
    qr.make();
    const count = qr.getModuleCount();
    const margin = 4;
    const total = count + margin * 2;
    const fg = code.style?.foreground || '#173B32';
    const bg = code.style?.background || '#FFFFFF';
    canvas.width = size; canvas.height = size;
    const context = canvas.getContext('2d', { alpha: false });
    context.imageSmoothingEnabled = false;
    context.fillStyle = bg; context.fillRect(0, 0, size, size);
    context.fillStyle = fg;
    for (let row = 0; row < count; row += 1) for (let col = 0; col < count; col += 1) {
      if (!qr.isDark(row, col)) continue;
      const x0 = Math.round(((col + margin) / total) * size);
      const x1 = Math.round(((col + margin + 1) / total) * size);
      const y0 = Math.round(((row + margin) / total) * size);
      const y1 = Math.round(((row + margin + 1) / total) * size);
      context.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    return qr;
  }
  function qrSvg(code, size = 1024) {
    const qr = qrcode(0, code.style?.correction || 'M');
    qr.addData(getPublicUrl(code)); qr.make();
    const count = qr.getModuleCount(), margin = 4, total = count + 8;
    const paths = [];
    for (let row = 0; row < count; row += 1) for (let col = 0; col < count; col += 1) if (qr.isDark(row, col)) paths.push(`M${col + margin} ${row + margin}h1v1h-1z`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="${code.style?.background || '#FFFFFF'}"/><path d="${paths.join('')}" fill="${code.style?.foreground || '#173B32'}"/></svg>`;
  }
  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = filename;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function downloadCode(code, format) {
    if (!code) return;
    const filename = `qria-${safeSlug(code.name)}-${code.publicCode}`;
    if (format === 'svg') {
      saveBlob(new Blob([qrSvg(code)], { type: 'image/svg+xml;charset=utf-8' }), `${filename}.svg`);
      showToast('Fichier SVG téléchargé.');
      return;
    }
    const canvas = document.createElement('canvas');
    drawQr(canvas, code, 1024);
    canvas.toBlob((blob) => {
      if (!blob) return showToast('Impossible de créer le PNG. Réessayez.');
      saveBlob(blob, `${filename}.png`); showToast('PNG haute résolution téléchargé.');
    }, 'image/png');
  }
  async function copyCodeLink(code) {
    const url = getPublicUrl(code);
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(url);
      else { const temp = document.createElement('textarea'); temp.value = url; temp.className = 'clipboard-temp'; document.body.appendChild(temp); temp.select(); document.execCommand('copy'); temp.remove(); }
      showToast('Lien public copié.');
    } catch (_) { showToast('Copie indisponible dans ce navigateur.'); }
  }
  function printCode(code) {
    const popup = window.open(`/print.html?id=${encodeURIComponent(code.id)}`, '_blank', 'noopener');
    if (!popup) showToast('Autorisez les fenêtres surgissantes pour imprimer ce code.');
  }

  function openCodePreview(code) {
    const url = getPublicUrl(code);
    showModal(`<article class="modal-card modal-small"><div class="modal-header"><div><span class="eyebrow">APERÇU DU CODE</span><h2>${esc(code.name)}</h2><p>${esc(code.beneficiaryName)} · ${esc(code.categoryName || categoryName(code.categoryId))}</p></div><button class="modal-close" type="button" data-close-modal aria-label="Fermer">×</button></div><div class="modal-body"><div class="qr-preview-side"><canvas id="detailQrCanvas" width="480" height="480" aria-label="Aperçu du code QR"></canvas><p class="public-url" id="detailPublicUrl">${esc(url)}</p><button class="button button-secondary" type="button" data-action="copy-modal">${ICONS.link}Copier le lien</button><button class="button button-secondary" type="button" data-action="png-modal">${ICONS.download}Télécharger PNG</button><button class="button button-secondary" type="button" data-action="svg-modal">${ICONS.file}Télécharger SVG</button><button class="button button-secondary" type="button" data-action="print-modal">${ICONS.print}Imprimer le code</button></div><div class="preview-card-side preview-detail-info"><strong>Identifiant unique</strong><span>${esc(code.publicCode)} · ${number(code.scanCount)} scan${Number(code.scanCount) === 1 ? '' : 's'} enregistré${Number(code.scanCount) === 1 ? '' : 's'}</span><strong>Destination</strong><span>${code.destinationType === 'redirect' ? `Redirection vers ${esc(code.targetUrl)}` : 'Page QRia modifiable'}</span><strong>Mise à jour</strong><span>${esc(fmtDate(code.updatedAt, true))}</span></div></div><div class="modal-footer"><span class="modal-footer-note">L’identifiant reste stable lorsque la page change.</span><div class="modal-footer-actions"><button class="button button-secondary" type="button" data-close-modal>Fermer</button><button class="button button-primary" type="button" data-action="edit-modal">${ICONS.edit}Modifier</button></div></div></article>`);
    // Avoid inline style dependency in the strict CSP.
    const side = $('.preview-card-side', modalRoot);
    if (side) side.classList.add('preview-detail-info');
    drawQr($('#detailQrCanvas', modalRoot), code, 480);
    state.previewCode = code;
  }

  async function openHistory(id, entityType = 'qr_code') {
    try {
      const resource = entityType === 'beneficiary' ? 'beneficiaries' : 'codes';
      const label = entityType === 'beneficiary' ? 'bénéficiaire' : 'QR code';
      const result = await api(`/api/admin/${resource}/${encodeURIComponent(id)}/history`);
      const rows = result.data || [];
      showModal(`<article class="modal-card modal-small"><div class="modal-header"><div><span class="eyebrow">TRAÇABILITÉ</span><h2>Historique du ${label}</h2><p>Modifications réalisées par l’administrateur.</p></div><button class="modal-close" type="button" data-close-modal aria-label="Fermer">×</button></div><div class="modal-body">${rows.length ? rows.map((row) => {
        const details = row.beforeData || row.afterData ? `<details class="history-details"><summary>Voir les données avant / après</summary><div class="history-diff"><div><strong>Avant</strong><pre>${esc(row.beforeData ? JSON.stringify(row.beforeData, null, 2) : '—')}</pre></div><div><strong>Après</strong><pre>${esc(row.afterData ? JSON.stringify(row.afterData, null, 2) : '—')}</pre></div></div></details>` : '';
        return `<article class="activity-row"><span class="activity-mark">${ICONS.clock}</span><div class="activity-text"><strong>${esc(row.summary)}</strong><p>${esc(actionLabel(row.action))} · ${esc(row.actor || 'Administrateur')}</p>${details}</div><time>${esc(fmtDate(row.createdAt, true))}</time></article>`;
      }).join('') : '<div class="activity-empty">Aucune modification enregistrée.</div>'}</div><div class="modal-footer"><span class="modal-footer-note">Journal append-only.</span><div class="modal-footer-actions"><button class="button button-secondary" type="button" data-close-modal>Fermer</button></div></div></article>`);
    } catch (error) { showToast(error.message); }
  }

  async function handleCodeAction(action, id) {
    try {
      if (action === 'preview') { const result = await api(`/api/admin/codes/${encodeURIComponent(id)}`); openCodePreview(result.data); }
      else if (action === 'edit') await openQrForm(id);
      else if (action === 'png' || action === 'svg' || action === 'print' || action === 'copy') {
        const result = await api(`/api/admin/codes/${encodeURIComponent(id)}`);
        if (action === 'png' || action === 'svg') downloadCode(result.data, action);
        if (action === 'print') printCode(result.data);
        if (action === 'copy') copyCodeLink(result.data);
      } else if (action === 'history') await openHistory(id);
      else if (action === 'activate' || action === 'deactivate') {
        const status = action === 'activate' ? 'active' : 'inactive';
        await api(`/api/admin/codes/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
        showToast(status === 'active' ? 'QR code débloqué.' : 'QR code bloqué.');
        await Promise.all([loadCodes(), loadDashboard()]);
      } else if (action === 'delete') {
        if (!window.confirm('Supprimer ce QR code ? Le lien public sera désactivé, mais son historique sera conservé.')) return;
        await api(`/api/admin/codes/${encodeURIComponent(id)}`, { method: 'DELETE' });
        showToast('QR code supprimé.'); await Promise.all([loadCodes(), loadDashboard(), loadBeneficiaries()]);
      }
    } catch (error) { showToast(error.message); }
  }

  async function openCategoryManager() {
    const result = await api('/api/admin/categories');
    state.categories = result.data;
    showModal(`<article class="modal-card modal-small"><div class="modal-header"><div><span class="eyebrow">ORGANISATION</span><h2>Catégories</h2><p>Classez vos codes QR par type de bénéficiaire ou par activité.</p></div><button class="modal-close" type="button" data-close-modal aria-label="Fermer">×</button></div><div class="modal-body"><div class="category-list">${state.categories.map((item) => `<div class="category-row"><span class="category-dot"></span><strong>${esc(item.name)}</strong>${item.isSystem ? '<small>Par défaut</small>' : '<small>Personnalisée</small>'}</div>`).join('')}</div><form id="categoryForm" class="category-form"><label for="categoryName">Nouvelle catégorie</label><div><input id="categoryName" type="text" maxlength="60" placeholder="Ex. Événements" required><button class="button button-primary" type="submit">Ajouter</button></div><p id="categoryError" class="form-error" hidden></p></form></div><div class="modal-footer"><span class="modal-footer-note">Les catégories par défaut ne peuvent pas être supprimées.</span><div class="modal-footer-actions"><button class="button button-secondary" type="button" data-close-modal>Fermer</button></div></div></article>`);
  }

  async function loadCategoriesIntoManager() {
    const result = await api('/api/admin/categories');
    state.categories = result.data;
    const list = $('.category-list', modalRoot);
    if (list) list.innerHTML = state.categories.map((item) => `<div class="category-row"><span class="category-dot"></span><strong>${esc(item.name)}</strong>${item.isSystem ? '<small>Par défaut</small>' : '<small>Personnalisée</small>'}</div>`).join('');
    fillCategoryFilter();
  }

  function openLoginDemoNote(isDemo) {
    if (!isDemo || $('#loginDemoNote')) return;
    const note = document.createElement('div'); note.id = 'loginDemoNote'; note.className = 'login-demo-note';
    note.textContent = 'Démo locale uniquement — identifiant : admin · mot de passe : admin1234';
    const footer = $('.login-footer'); if (footer) footer.before(note);
  }

  async function initialize() {
    try {
      const health = await fetch('/api/health').then((response) => response.json());
      state.publicBaseUrl = health.publicBaseUrl || window.location.origin;
      openLoginDemoNote(Boolean(health.demoMode));
      const auth = await api('/api/auth/me');
      if (auth.authenticated) showApp(); else showLogin();
    } catch (_) { showLogin(); }
  }

  // Login and session controls.
  $('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('button[type="submit"]', event.currentTarget);
    const error = $('#loginError');
    error.hidden = true; button.disabled = true;
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: $('#adminUsername').value.trim(), password: $('#adminPassword').value }) });
      $('#adminPassword').value = ''; showApp();
    } catch (failure) { error.textContent = failure.message; error.hidden = false; }
    finally { button.disabled = false; }
  });
  $('#toggleAdminPassword').addEventListener('click', () => {
    const input = $('#adminPassword'); const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    $('#toggleAdminPassword').setAttribute('aria-label', reveal ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
    input.focus();
  });
  $('#logoutButton').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) { /* Clear the local UI even if the session expired. */ }
    showLogin();
  });

  // Navigation and top-level actions.
  $$('.nav-item').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.view === 'codes') { state.codeBeneficiaryId = ''; $('#codeSearch').value = ''; state.codeSearch = ''; }
    setView(button.dataset.view);
  }));
  $$('[data-go-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.goView)));
  $('#mobileMenuButton').addEventListener('click', () => $('#sidebar').classList.toggle('is-open'));
  $('#topCreateButton').addEventListener('click', async () => {
    try { const result = await api('/api/admin/beneficiaries?limit=1&status=active'); if (!result.total) { setView('beneficiaries'); showToast('Ajoutez ou débloquez d’abord un bénéficiaire, puis créez son QR code.'); return; } await openQrForm(); }
    catch (error) { showToast(error.message); }
  });
  $('#createCodeButton').addEventListener('click', async () => {
    try { const result = await api('/api/admin/beneficiaries?limit=1&status=active'); if (!result.total) { setView('beneficiaries'); showToast('Ajoutez ou débloquez d’abord un bénéficiaire, puis créez son QR code.'); return; } await openQrForm(); }
    catch (error) { showToast(error.message); }
  });
  $('#emptyCreateCode').addEventListener('click', async () => {
    try { const result = await api('/api/admin/beneficiaries?limit=1&status=active'); if (!result.total) { setView('beneficiaries'); showToast('Ajoutez ou débloquez d’abord un bénéficiaire.'); return; } await openQrForm(); } catch (error) { showToast(error.message); }
  });
  $('#overviewBeneficiaryButton').addEventListener('click', () => openBeneficiaryForm());
  $('#createBeneficiaryButton').addEventListener('click', () => openBeneficiaryForm());
  $('#quickCreateBeneficiary').addEventListener('click', () => openBeneficiaryForm());
  $('#quickCreateCode').addEventListener('click', () => $('#topCreateButton').click());
  $('#categoryManagerButton').addEventListener('click', () => openCategoryManager().catch((error) => showToast(error.message)));

  // Server-side search, filters, and pagination.
  $('#codeSearch').addEventListener('input', () => { state.codeBeneficiaryId = ''; clearTimeout(codeSearchTimer); codeSearchTimer = setTimeout(() => { state.codeSearch = $('#codeSearch').value.trim(); state.codePage = 1; loadCodes().catch((error) => showToast(error.message)); }, 240); });
  $('#categoryFilter').addEventListener('change', () => { state.codeBeneficiaryId = ''; state.codeCategory = $('#categoryFilter').value; state.codePage = 1; loadCodes().catch((error) => showToast(error.message)); });
  $('#statusFilter').addEventListener('change', () => { state.codeBeneficiaryId = ''; state.codeStatus = $('#statusFilter').value; state.codePage = 1; loadCodes().catch((error) => showToast(error.message)); });
  $('#codesPrev').addEventListener('click', () => { if (state.codePage > 1) { state.codePage -= 1; loadCodes().catch((error) => showToast(error.message)); } });
  $('#codesNext').addEventListener('click', () => { if (state.codePage < pageCount(state.codeTotal, 25)) { state.codePage += 1; loadCodes().catch((error) => showToast(error.message)); } });
  $('#beneficiarySearch').addEventListener('input', () => { clearTimeout(beneficiarySearchTimer); beneficiarySearchTimer = setTimeout(() => { state.beneficiarySearch = $('#beneficiarySearch').value.trim(); state.beneficiaryPage = 1; loadBeneficiaries().catch((error) => showToast(error.message)); }, 240); });
  $('#beneficiaryTypeFilter').addEventListener('change', () => { state.beneficiaryType = $('#beneficiaryTypeFilter').value; state.beneficiaryPage = 1; loadBeneficiaries().catch((error) => showToast(error.message)); });
  $('#beneficiaryStatusFilter').addEventListener('change', () => { state.beneficiaryStatus = $('#beneficiaryStatusFilter').value; state.beneficiaryPage = 1; loadBeneficiaries().catch((error) => showToast(error.message)); });
  $('#beneficiariesPrev').addEventListener('click', () => { if (state.beneficiaryPage > 1) { state.beneficiaryPage -= 1; loadBeneficiaries().catch((error) => showToast(error.message)); } });
  $('#beneficiariesNext').addEventListener('click', () => { if (state.beneficiaryPage < pageCount(state.beneficiaryTotal, 12)) { state.beneficiaryPage += 1; loadBeneficiaries().catch((error) => showToast(error.message)); } });
  $('#activityFilter').addEventListener('change', () => { state.activityType = $('#activityFilter').value; state.activityPage = 1; loadActivity().catch((error) => showToast(error.message)); });
  $('#scanPeriodFilter').addEventListener('change', () => { state.scanPeriod = $('#scanPeriodFilter').value; loadScanAnalytics().catch((error) => showToast(error.message)); });
  $('#defaultPublicTextSize').addEventListener('change', saveDisplaySettings);
  $('#activityPrev').addEventListener('click', () => { if (state.activityPage > 1) { state.activityPage -= 1; loadActivity().catch((error) => showToast(error.message)); } });
  $('#activityNext').addEventListener('click', () => { if (state.activityPage < pageCount(state.activityTotal, 30)) { state.activityPage += 1; loadActivity().catch((error) => showToast(error.message)); } });

  $('#codesTableBody').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]'); if (button) handleCodeAction(button.dataset.action, button.dataset.id);
  });
  $('#overviewRecent').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="preview"]'); if (button) handleCodeAction('preview', button.dataset.id);
  });
  $('#beneficiaryGrid').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    const { action, id } = button.dataset;
    try {
      if (action === 'edit-beneficiary') openBeneficiaryForm(id);
      if (action === 'bene-history') await openHistory(id, 'beneficiary');
      if (action === 'bene-codes') { state.codeSearch = ''; state.codeCategory = ''; state.codeStatus = ''; state.codePage = 1; state.codeBeneficiaryId = id; $('#codeSearch').value = ''; setView('codes', false); await loadCodesForBeneficiary(id); }
      if (action === 'block-beneficiary' || action === 'unblock-beneficiary') {
        const status = action === 'block-beneficiary' ? 'blocked' : 'active';
        const name = button.dataset.name || 'ce bénéficiaire';
        if (status === 'blocked' && !window.confirm(`Bloquer ${name} ? Ses QR deviendront temporairement indisponibles pour le public. Vous pourrez le débloquer à tout moment.`)) return;
        await api(`/api/admin/beneficiaries/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
        showToast(status === 'blocked' ? 'Bénéficiaire bloqué; ses QR sont indisponibles.' : 'Bénéficiaire débloqué; ses QR actifs sont de nouveau accessibles.');
        await Promise.all([loadBeneficiaries(), loadCodes(), loadDashboard(), loadActivity()]);
      }
      if (action === 'delete-beneficiary' || action === 'archive-beneficiary') {
        const name = button.dataset.name || 'ce bénéficiaire';
        if (!window.confirm(`Supprimer ${name} ? Ses QR seront désactivés. Les scans et l’historique seront conservés; la suppression est logique.`)) return;
        await api(`/api/admin/beneficiaries/${encodeURIComponent(id)}`, { method: 'DELETE' });
        showToast('Bénéficiaire supprimé logiquement; ses QR sont désactivés et l’historique conservé.');
        await Promise.all([loadBeneficiaries(), loadCodes(), loadDashboard(), loadScanAnalytics(), loadActivity()]);
      }
    } catch (error) { showToast(error.message); }
  });
  async function loadCodesForBeneficiary(id) {
    const result = await api(`/api/admin/beneficiaries/${encodeURIComponent(id)}`);
    $('#codeSearch').value = result.data.name;
    state.codeSearch = '';
    await loadCodes();
  }

  // Modal close / form submission / event delegation.
  modalRoot.addEventListener('click', (event) => {
    if (event.target === modalRoot || event.target.closest('[data-close-modal]')) { closeModal(); return; }
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const code = state.previewCode;
    switch (button.dataset.action) {
      case 'copy-modal': if (code) copyCodeLink(code); break;
      case 'png-modal': if (code) downloadCode(code, 'png'); break;
      case 'svg-modal': if (code) downloadCode(code, 'svg'); break;
      case 'print-modal': if (code) printCode(code); break;
      case 'edit-modal': if (code) openQrForm(code.id); break;
    }
  });
  modalRoot.addEventListener('submit', (event) => {
    event.preventDefault();
    if (event.target.id === 'beneficiaryForm') submitBeneficiary(event.target);
    if (event.target.id === 'qrForm') submitQr(event.target);
    if (event.target.id === 'categoryForm') submitCategory(event.target);
  });
  modalRoot.addEventListener('change', async (event) => {
    if (event.target.id === 'beneLogoFile') {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const data = await fileToDataUrl(file);
        $('#beneLogoData', modalRoot).value = data;
        $('#beneLogoUrl', modalRoot).value = '';
        $('#logoPreview', modalRoot).src = data;
        $('#logoPreviewWrap', modalRoot).hidden = false;
      } catch (error) { modalError(error.message); event.target.value = ''; }
    }
    if (event.target.id === 'benePhotoFiles') {
      const files = [...(event.target.files || [])];
      if (!files.length) return;
      if ((state.currentBeneficiaryPhotos || []).length + files.length > 8) { modalError('Vous pouvez enregistrer au maximum 8 photos.'); event.target.value = ''; return; }
      try {
        const optimized = [];
        for (const file of files) optimized.push({ id: newPhotoId(), src: await optimizePhotoFile(file), alt: file.name.replace(/\\.[^.]+$/, '') });
        state.currentBeneficiaryPhotos = [...(state.currentBeneficiaryPhotos || []), ...optimized];
        renderBeneficiaryPhotoEditor();
        event.target.value = '';
        showToast('Photos ajoutées et optimisées. Enregistrez le bénéficiaire pour les conserver.');
      } catch (error) { modalError(error.message); event.target.value = ''; }
    }
  });
  modalRoot.addEventListener('input', (event) => {
    const photoId = event.target.dataset.photoAlt;
    if (!photoId) return;
    const photo = (state.currentBeneficiaryPhotos || []).find((item) => item.id === photoId);
    if (photo) photo.alt = event.target.value;
  });
  modalRoot.addEventListener('click', (event) => {
    const removePhoto = event.target.closest('[data-remove-beneficiary-photo]');
    if (removePhoto) {
      state.currentBeneficiaryPhotos = (state.currentBeneficiaryPhotos || []).filter((item) => item.id !== removePhoto.dataset.removeBeneficiaryPhoto);
      renderBeneficiaryPhotoEditor();
      return;
    }
    if (event.target.closest('#removeLogoButton')) {
      $('#beneLogoData', modalRoot).value = ''; $('#beneLogoUrl', modalRoot).value = '';
      $('#beneLogoFile', modalRoot).value = ''; $('#logoPreviewWrap', modalRoot).hidden = true;
    }
  });
  async function submitCategory(form) {
    const input = $('#categoryName', modalRoot); const error = $('#categoryError', modalRoot); error.hidden = true;
    const button = $('button[type="submit"]', form); button.disabled = true;
    try {
      await api('/api/admin/categories', { method: 'POST', body: JSON.stringify({ name: input.value.trim() }) });
      await loadCategoriesIntoManager();
      showToast('Catégorie ajoutée.');
      input.value = ''; input.focus();
    } catch (failure) { error.textContent = failure.message; error.hidden = false; }
    finally { button.disabled = false; }
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modalRoot.hidden) closeModal();
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault(); setView('codes'); $('#codeSearch').focus();
    }
  });

  initialize();
})();
