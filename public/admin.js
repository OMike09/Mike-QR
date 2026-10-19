(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = {
    view: 'overview', categories: [], codePage: 1, codeTotal: 0, codeSearch: '', codeCategory: '', codeStatus: '', codeBeneficiaryId: '',
    beneficiaryPage: 1, beneficiaryTotal: 0, beneficiarySearch: '', beneficiaryType: '', beneficiaryStatus: '', pendingImageOptimizations: 0, imageUploadSession: 0, beneficiarySaveInProgress: false,
    activityPage: 1, activityTotal: 0, activityType: '', scanPeriod: 'all', publicBaseUrl: '', defaultPublicTextSize: 'normal', currentBeneficiaryPhotos: [],
    managers: [], managersLoaded: false, managerCodeFilter: '', managerActivityPage: 1, managerActivityTotal: 0, managerActivityFilters: {}, managerActivityAlerts: {}, managerActivitySearchTimer: null,
    financePage: 1, financeOrderTotal: 0, financePlans: [], financeFilters: {}, financeLoading: false, currentFinanceOrder: null, cashReportPage: 1, cashPaymentTotal: 0, cashReportFilters: {}, cashReportById: new Map(),
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
  const xof = (value) => `${number(value)} XOF`;
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
    state.imageUploadSession += 1;
    state.pendingImageOptimizations = 0;
    state.beneficiarySaveInProgress = false;
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
    $('#statPendingCodes').textContent = number(data.stats.pendingCodes);
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
  const FINANCE_CUSTOMER_LABELS = { any: 'Tous les types', individual: 'Particulier', business: 'Entreprise', custom: 'Personnalisé' };
  const FINANCE_PURPOSE_LABELS = { any: 'Tous les usages', ...PURPOSE_LABELS };
  const FINANCE_DESTINATION_LABELS = { any: 'Toutes destinations', page: 'Page QRia', redirect: 'Redirection' };
  const FINANCE_STATUS_LABELS = { unpaid: 'Non payé', pending: 'En attente PDG', partial: 'Partiellement payé', paid: 'Payé', cancelled: 'Annulé', refunded: 'Remboursé', not_applicable: 'Gratuit / non applicable' };
  const FINANCE_METHOD_LABELS = { cash: 'Espèces', mobile_money: 'Mobile Money', bank_transfer: 'Virement', card: 'Carte', other: 'Autre', electronic: 'Électronique' };

  function financeQuery(filters = state.financeFilters) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters || {})) if (value) params.set(key, value);
    return params;
  }
  function readFinanceFilters() {
    return {
      from: $('#financeFrom').value, to: $('#financeTo').value, managerId: $('#financeManagerFilter').value,
      customerType: $('#financeCustomerTypeFilter').value, client: $('#financeClientFilter').value.trim(),
      company: $('#financeCompanyFilter').value.trim(), qr: $('#financeQrFilter').value.trim(),
      method: $('#financeMethodFilter').value, status: $('#financeStatusFilter').value,
    };
  }
  function fillFinanceManagerFilter() {
    const select = $('#financeManagerFilter'); if (!select) return;
    const selected = state.financeFilters.managerId || select.value;
    select.innerHTML = '<option value="">Tous les gestionnaires</option>' + state.managers.map((manager) => `<option value="${esc(manager.id)}">${esc(manager.displayName)} (@${esc(manager.username)})${manager.deletedAt ? ' · supprimé' : ''}</option>`).join('');
    if ([...select.options].some((option) => option.value === selected)) select.value = selected;
  }
  function fillCashReportManagerFilter() {
    const select = $('#cashReportManager'); if (!select) return;
    const selected = state.cashReportFilters.managerId || select.value;
    select.innerHTML = '<option value="">Tous les gestionnaires</option>' + state.managers.map((manager) => `<option value="${esc(manager.id)}">${esc(manager.displayName)} (@${esc(manager.username)})${manager.deletedAt ? ' · supprimé' : ''}</option>`).join('');
    if ([...select.options].some((option) => option.value === selected)) select.value = selected;
  }
  function readCashReportFilters() {
    return { from: $('#cashReportFrom').value, to: $('#cashReportTo').value, managerId: $('#cashReportManager').value,
      beneficiary: $('#cashReportBeneficiary').value.trim(), status: $('#cashReportStatus').value, search: $('#cashReportSearch').value.trim() };
  }
  async function loadFinance() {
    if (!state.managersLoaded) await loadManagers();
    fillFinanceManagerFilter(); fillCashReportManagerFilter();
    const providerTask = api('/api/admin/finance/provider-status').then((result) => {
      const provider = result.electronic || {};
      $('#financeProviderStatus').textContent = provider.message || 'Aucun prestataire électronique connecté; aucun paiement électronique ne peut être confirmé.';
      const badge = $('.finance-pending-badge'); if (badge) badge.textContent = provider.configured ? 'Prestataire configuré' : 'Configuration en attente';
    }).catch((error) => { $('#financeProviderStatus').textContent = `État du prestataire indisponible : ${error.message}`; });
    await Promise.all([loadFinancePricing(), loadFinanceDashboard(), loadFinanceOrders(), loadCashReport(), providerTask]);
  }
  async function loadFinancePricing() {
    const result = await api('/api/admin/finance/pricing'); state.financePlans = result.data || [];
    const body = $('#financePricingRows');
    body.innerHTML = state.financePlans.length ? state.financePlans.map((plan) => {
      const options = (plan.options || []).filter((option) => option.active !== false);
      const condition = `${FINANCE_CUSTOMER_LABELS[plan.customerType] || plan.customerType} · ${FINANCE_PURPOSE_LABELS[plan.qrPurpose] || plan.qrPurpose} · ${FINANCE_DESTINATION_LABELS[plan.destinationType] || plan.destinationType}`;
      const optionText = options.length ? options.map((option) => `${esc(option.name)} (${xof(option.amountXof)})`).join('<br>') : 'Aucune option active';
      return `<tr class="finance-plan-row"><td><strong>${esc(plan.name)}</strong><small>${esc(condition)}</small></td><td>${esc(FINANCE_CUSTOMER_LABELS[plan.customerType] || plan.customerType)}<small>${esc(FINANCE_PURPOSE_LABELS[plan.qrPurpose] || plan.qrPurpose)} · ${esc(FINANCE_DESTINATION_LABELS[plan.destinationType] || plan.destinationType)}</small></td><td><strong>${xof(plan.amountXof)}</strong></td><td>${optionText}</td><td><span class="finance-status ${plan.active ? 'paid' : 'cancelled'}">${plan.active ? 'Actif' : 'Désactivé'}</span></td><td><div class="finance-row-actions"><button class="mini-button" type="button" data-finance-action="edit-plan" data-id="${esc(plan.id)}">Modifier</button><button class="mini-button" type="button" data-finance-action="toggle-plan" data-id="${esc(plan.id)}">${plan.active ? 'Désactiver' : 'Activer'}</button></div></td></tr>`;
    }).join('') : '<tr><td colspan="6">Aucun tarif configuré. Les gestionnaires ne peuvent pas créer de QR payant tant qu’une formule n’est pas ajoutée.</td></tr>';
    $('#financePricingEmpty').hidden = state.financePlans.length > 0;
  }
  async function loadFinanceDashboard() {
    const params = financeQuery();
    const result = await api(`/api/admin/finance/dashboard${params.size ? `?${params}` : ''}`);
    const summary = result.summary || {};
    $('#financeOrdersValue').textContent = xof(summary.ordersValueXof);
    $('#financeGrossReceived').textContent = xof(summary.grossReceivedXof);
    $('#financeRefunded').textContent = `Remboursements : ${xof(summary.refundedXof)}`;
    $('#financeNetReceived').textContent = xof(summary.netReceivedXof);
    $('#financePendingDeclared').textContent = xof(summary.pendingDeclaredXof);
    $('#financeOutstanding').textContent = xof(summary.outstandingXof);
    $('#financeOrderCounts').textContent = `QR vendus : ${number(summary.qrSold)} · impayés : ${number(summary.unpaidCount)} · partiels : ${number(summary.partialCount)}`;
    $('#financeCashReceived').textContent = `Espèces : ${xof(summary.cashReceivedXof)}`;
    $('#financeElectronicReceived').textContent = `Électronique : ${xof(summary.electronicReceivedXof)}`;
    const breakdown = $('#financeManagerBreakdown');
    breakdown.innerHTML = result.byManager?.length ? result.byManager.map((manager) => `<article class="finance-manager-chip"><strong>${esc(manager.managerName)}</strong><span>Commandé : ${xof(manager.ordersValueXof)} · ${number(manager.qrSold)} QR</span><span>Net encaissé : ${xof(manager.netReceivedXof)}</span><span>En attente : ${xof(manager.pendingDeclaredXof)} · Solde : ${xof(manager.outstandingXof)}</span></article>`).join('') : '<span class="muted">Aucune vente dans la période filtrée.</span>';
  }
  async function loadFinanceOrders() {
    const params = financeQuery(); params.set('page', String(state.financePage)); params.set('limit', '25');
    const result = await api(`/api/admin/finance/orders?${params}`); state.financeOrderTotal = result.total || 0;
    const body = $('#financeOrderRows');
    body.innerHTML = result.data?.length ? result.data.map((order) => `<tr><td><strong>${esc(order.reference)}</strong><small>${esc(fmtDate(order.createdAt, true))}</small></td><td>${esc(order.managerName || 'PDG')}<small>${order.managerId ? 'Gestionnaire' : 'Espace PDG'}</small></td><td><strong>${esc(order.clientName)}</strong><small>${esc(order.companyName || typeLabel(order.customerType))} · ${esc(order.qrName)}</small></td><td>${xof(order.totalAmountXof)}</td><td>${xof(order.netReceivedXof)}</td><td>${xof(order.pendingAmountXof)}</td><td>${xof(order.outstandingXof)}</td><td><span class="finance-status ${esc(order.paymentStatus)}">${esc(FINANCE_STATUS_LABELS[order.paymentStatus] || order.paymentStatus)}</span></td><td><div class="finance-row-actions"><button class="mini-button" type="button" data-finance-action="open-order" data-id="${esc(order.id)}">Détails</button></div></td></tr>`).join('') : '<tr><td colspan="9">Aucune commande ne correspond aux filtres.</td></tr>';
    $('#financeOrderCount').textContent = `${number(result.total)} commande(s)`;
    fillPagination('#financePrev', '#financeNext', '#financePageLabel', state.financePage, result.total || 0, 25);
  }
  async function loadCashReport() {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(state.cashReportFilters || {})) if (value) params.set(key, value);
    params.set('page', String(state.cashReportPage)); params.set('limit', '25');
    const result = await api(`/api/admin/finance/cash-report?${params}`);
    const summary = result.summary || {}; const metrics = $('#cashReportMetrics');
    metrics.innerHTML = [
      `<article class="finance-metric"><span>Total déclaré</span><strong>${xof(summary.submittedXof)}</strong><small>${number(summary.paymentCount)} déclarations, rejetées incluses</small></article>`,
      `<article class="finance-metric"><span>Vérifié par le PDG</span><strong>${xof(summary.verifiedXof)}</strong><small>confirmé et comptabilisé</small></article>`,
      `<article class="finance-metric pending"><span>À vérifier</span><strong>${xof(summary.pendingXof)}</strong><small>en attente PDG</small></article>`,
      `<article class="finance-metric"><span>Rejeté</span><strong>${xof(summary.rejectedXof)}</strong><small>exclu du montant encaissé</small></article>`,
      `<article class="finance-metric"><span>Bénéficiaires payés / partiels</span><strong>${number(summary.paidBeneficiaries)} / ${number(summary.partialBeneficiaries)}</strong><small>non payés : ${number(summary.unpaidBeneficiaries)} · non applicable : ${number(summary.notApplicableBeneficiaries)}</small></article>`,
      `<article class="finance-metric"><span>Solde restant</span><strong>${xof(summary.outstandingXof)}</strong><small>${number(summary.totalBeneficiaries)} bénéficiaire(s) dans le périmètre</small></article>`,
    ].join('');
    const breakdown = $('#cashManagerBreakdown');
    breakdown.innerHTML = result.byManager?.length ? result.byManager.map((manager) => `<article class="finance-manager-chip"><strong>${esc(manager.managerName)}</strong><span>Déclaré : ${xof(manager.submittedXof)} · ${number(manager.paymentCount)} déclaration(s)</span><span>Vérifié : ${xof(manager.verifiedXof)} · En attente : ${xof(manager.pendingXof)}</span><span>Rejeté : ${xof(manager.rejectedXof)}</span></article>`).join('') : '<span class="muted">Aucune déclaration d’espèces dans ce périmètre.</span>';
    state.cashPaymentTotal = result.total || 0; state.cashReportById = new Map();
    const statusLabel = { pending: 'En attente de vérification', confirmed: 'Vérifié par le PDG', rejected: 'Rejeté' };
    const body = $('#cashPaymentRows');
    body.innerHTML = result.data?.length ? result.data.map((payment) => {
      state.cashReportById.set(payment.id, payment);
      const declarant = payment.declaredByType === 'manager' ? payment.managerName : payment.declaredByType === 'admin' ? 'PDG' : payment.declaredByType || '—';
      const review = payment.reviewedAt ? `<span class="cash-payment-meta">Traité le ${esc(fmtDate(payment.reviewedAt, true))}${payment.reviewedByType ? ` · ${esc(payment.reviewedByType === 'admin' ? 'PDG' : payment.reviewedByType)}` : ''}</span>` : '';
      return `<tr><td><strong class="cash-payment-primary">${esc(fmtDate(payment.receivedAt, true))}</strong><span class="cash-payment-meta">QRia : ${esc(payment.paymentReference)}${payment.receiptReference ? `<br>Reçu : ${esc(payment.receiptReference)}` : ''}<br>Commande : ${esc(payment.orderReference)}</span></td><td><strong class="cash-payment-primary">${esc(payment.beneficiaryName)}</strong><span class="cash-payment-meta">${esc(payment.beneficiaryPhone || 'Téléphone non renseigné')}<br>${esc(payment.qrName)} · ${esc(payment.publicCode)}</span></td><td><strong class="cash-payment-primary">${esc(payment.managerName || 'PDG')}</strong><span class="cash-payment-meta">Déclaré par : ${esc(declarant)}${payment.declaredById ? ` · ${esc(payment.declaredById)}` : ''}</span></td><td><strong class="cash-payment-primary">${xof(payment.amountXof)}</strong><span class="cash-payment-meta">Payeur déclaré : ${esc(payment.clientName || '—')}</span></td><td><span class="finance-status ${esc(payment.status)}">${esc(statusLabel[payment.status] || payment.status)}</span>${review}${payment.observation ? `<span class="cash-payment-meta">Observation : ${esc(payment.observation)}</span>` : ''}${payment.rejectionReason ? `<span class="cash-payment-meta">Motif : ${esc(payment.rejectionReason)}</span>` : ''}</td><td><div class="cash-report-actions">${payment.status === 'pending' ? `<button class="mini-button" type="button" data-finance-action="review-cash-approve" data-id="${esc(payment.id)}">Valider</button><button class="mini-button danger" type="button" data-finance-action="review-cash-reject" data-id="${esc(payment.id)}">Rejeter</button>` : ''}<button class="mini-button" type="button" data-finance-action="correct-cash" data-id="${esc(payment.id)}">Corriger</button><button class="mini-button" type="button" data-finance-action="open-cash-order" data-id="${esc(payment.orderId)}">Détails</button></div></td></tr>`;
    }).join('') : '<tr><td colspan="6">Aucune déclaration ne correspond aux filtres.</td></tr>';
    $('#cashPaymentCount').textContent = `${number(result.total)} déclaration(s)`;
    fillPagination('#cashPaymentsPrev', '#cashPaymentsNext', '#cashPaymentsPageLabel', state.cashReportPage, result.total || 0, 25);
  }
  function openCashCorrection(paymentId) {
    const payment = state.cashReportById.get(paymentId);
    if (!payment) return showToast('Déclaration introuvable dans le registre actualisé.');
    const localValue = payment.receivedAt ? new Date(new Date(payment.receivedAt).getTime() - new Date(payment.receivedAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    showModal(`<article class="modal-card modal-small"><div class="modal-header"><div><span class="eyebrow">CORRECTION FINANCIÈRE AUDITÉE</span><h2>Corriger la déclaration ${esc(payment.paymentReference)}</h2><p>Les valeurs avant/après, le PDG et le motif restent dans le journal; cette action ne supprime aucune trace.</p></div><button class="modal-close" type="button" data-close-modal>×</button></div><form id="cashCorrectionForm" data-id="${esc(payment.id)}"><div class="modal-body"><div class="form-grid"><div class="form-field"><label for="cashCorrectionAmount">Montant reçu (XOF)</label><input id="cashCorrectionAmount" type="number" min="1" step="1" required value="${esc(payment.amountXof)}"></div><div class="form-field"><label for="cashCorrectionDate">Date et heure déclarées</label><input id="cashCorrectionDate" type="datetime-local" required value="${esc(localValue)}"></div><div class="form-field span-2"><label for="cashCorrectionPayer">Payeur déclaré</label><input id="cashCorrectionPayer" maxlength="140" required value="${esc(payment.clientName || '')}"></div><div class="form-field span-2"><label for="cashCorrectionReference">Référence de reçu</label><input id="cashCorrectionReference" maxlength="100" value="${esc(payment.receiptReference || '')}"></div><div class="form-field span-2"><label for="cashCorrectionObservation">Observation</label><textarea id="cashCorrectionObservation" maxlength="500">${esc(payment.observation || '')}</textarea></div><div class="form-field span-2"><label for="cashCorrectionReason">Motif obligatoire</label><textarea id="cashCorrectionReason" maxlength="500" required></textarea></div></div></div><p class="modal-error" id="modalError" role="alert" hidden></p><div class="modal-footer"><div class="modal-footer-actions"><button class="button button-secondary" type="button" data-close-modal>Annuler</button><button class="button button-primary" type="submit">Enregistrer et auditer</button></div></div></form></article>`);
  }
  async function submitCashCorrection(form) {
    const receivedAt = new Date($('#cashCorrectionDate', modalRoot).value);
    const body = { amountXof: Number($('#cashCorrectionAmount', modalRoot).value), receivedAt: receivedAt.toISOString(),
      clientName: $('#cashCorrectionPayer', modalRoot).value.trim(), receiptReference: $('#cashCorrectionReference', modalRoot).value.trim(),
      observation: $('#cashCorrectionObservation', modalRoot).value.trim(), reason: $('#cashCorrectionReason', modalRoot).value.trim() };
    const button = $('button[type="submit"]', form); button.disabled = true;
    try {
      await api(`/api/admin/finance/payments/${encodeURIComponent(form.dataset.id)}`, { method: 'PATCH', body: JSON.stringify(body) });
      closeModal(); showToast('Correction enregistrée avec son motif et sa trace d’audit.');
      await Promise.all([loadCashReport(), loadFinanceDashboard(), loadFinanceOrders()]);
    } catch (error) { modalError(error.message); }
    finally { if (button.isConnected) button.disabled = false; }
  }
  async function reviewCashReportPayment(paymentId, decision) {
    const payment = state.cashReportById.get(paymentId); if (!payment) return showToast('Déclaration introuvable; actualisez le registre.');
    let reason = '';
    if (decision === 'approve' && !window.confirm(`Confirmer l’encaissement réel de ${xof(payment.amountXof)} pour ${payment.beneficiaryName} ?`)) return;
    if (decision === 'reject') { reason = window.prompt('Motif obligatoire du rejet :', ''); if (reason === null) return; if (!reason.trim()) return showToast('Un motif est obligatoire pour rejeter.'); }
    try {
      await api(`/api/admin/finance/payments/${encodeURIComponent(paymentId)}/review`, { method: 'POST', body: JSON.stringify({ decision, reason, orderId: payment.orderId }) });
      showToast(decision === 'approve' ? 'Déclaration vérifiée et encaissée.' : 'Déclaration rejetée; motif conservé.');
      await Promise.all([loadCashReport(), loadFinanceDashboard(), loadFinanceOrders()]);
    } catch (error) { showToast(error.message); }
  }
  function exportCashReportCsv() {
    const params = new URLSearchParams(); for (const [key, value] of Object.entries(state.cashReportFilters || {})) if (value) params.set(key, value);
    window.location.href = `/api/admin/finance/cash-report.csv${params.size ? `?${params}` : ''}`;
  }
  function financeOptionMarkup(option = {}) {
    return `<div class="finance-plan-option" data-finance-option-row data-id="${esc(option.id || '')}"><div class="form-field"><label>Nom de l’option</label><input data-option-field="name" maxlength="100" value="${esc(option.name || '')}" required placeholder="Ex. Impression"></div><div class="form-field"><label>Prix (XOF)</label><input data-option-field="amountXof" type="number" min="0" step="1" value="${esc(option.amountXof ?? '')}" required></div><label class="finance-option-active"><input data-option-field="active" type="checkbox"${option.active !== false ? ' checked' : ''}> Active</label><button class="mini-button danger" type="button" data-remove-finance-option>Retirer</button></div>`;
  }
  function addFinanceOptionRow(option = {}) {
    const target = $('#financePlanOptions', modalRoot); if (target) target.insertAdjacentHTML('beforeend', financeOptionMarkup(option));
  }
  function openFinancePlanForm(id = '') {
    const plan = id ? state.financePlans.find((item) => item.id === id) : null;
    if (id && !plan) return showToast('Formule tarifaire introuvable.');
    showModal(`<article class="modal-card modal-small"><div class="modal-header"><div><span class="eyebrow">CATALOGUE DE TARIFS</span><h2>${plan ? 'Modifier la formule' : 'Nouvelle formule'}</h2><p>Le prix est calculé par le serveur et figé à la création de la commande. Aucun tarif réel n’est prédéfini.</p></div><button class="modal-close" type="button" data-close-modal aria-label="Fermer">×</button></div><form id="financePricingForm" data-id="${esc(plan?.id || '')}"><div class="modal-body"><div class="form-grid"><div class="form-field span-2"><label for="financePlanName">Nom de la formule *</label><input id="financePlanName" maxlength="100" required value="${esc(plan?.name || '')}" placeholder="Ex. QR — gamme standard"></div><div class="form-field"><label for="financePlanCustomer">Type de client *</label><select id="financePlanCustomer"><option value="any"${(plan?.customerType||'any')==='any'?' selected':''}>Tous les types</option><option value="individual"${plan?.customerType==='individual'?' selected':''}>Particulier</option><option value="business"${plan?.customerType==='business'?' selected':''}>Entreprise</option><option value="custom"${plan?.customerType==='custom'?' selected':''}>Personnalisé</option></select></div><div class="form-field"><label for="financePlanPurpose">Usage du QR *</label><select id="financePlanPurpose">${[['any','Tous les usages'],...Object.entries(PURPOSE_LABELS)].map(([value,label])=>`<option value="${esc(value)}"${(plan?.qrPurpose||'any')===value?' selected':''}>${esc(label)}</option>`).join('')}</select></div><div class="form-field"><label for="financePlanDestination">Destination *</label><select id="financePlanDestination"><option value="any"${(plan?.destinationType||'any')==='any'?' selected':''}>Toutes destinations</option><option value="page"${plan?.destinationType==='page'?' selected':''}>Page QRia</option><option value="redirect"${plan?.destinationType==='redirect'?' selected':''}>Redirection Internet</option></select></div><div class="form-field"><label for="financePlanAmount">Prix unitaire (XOF) *</label><input id="financePlanAmount" type="number" min="0" step="1" required value="${esc(plan?.amountXof ?? '')}"></div><div class="form-field span-2"><label><input id="financePlanActive" type="checkbox"${plan?.active !== false ? ' checked' : ''}> Formule active</label></div><div class="form-field span-2"><div class="finance-option-heading"><strong>Options supplémentaires</strong><button class="button button-secondary" type="button" data-add-finance-option>＋ Ajouter une option</button></div><div id="financePlanOptions" class="finance-plan-options"></div></div></div></div><p class="modal-error" id="modalError" role="alert" hidden></p><div class="modal-footer"><span class="modal-footer-note">Les anciennes commandes ne seront pas recalculées.</span><div class="modal-footer-actions"><button class="button button-secondary" type="button" data-close-modal>Annuler</button><button class="button button-primary" type="submit">Enregistrer le tarif</button></div></div></form></article>`);
    for (const option of plan?.options || []) addFinanceOptionRow(option);
  }
  async function submitFinancePlan(form) {
    const id = form.dataset.id || '';
    const options = $$('[data-finance-option-row]', modalRoot).map((row) => ({
      ...(row.dataset.id ? { id: row.dataset.id } : {}), name: $('[data-option-field="name"]', row).value.trim(),
      amountXof: Number($('[data-option-field="amountXof"]', row).value), active: $('[data-option-field="active"]', row).checked,
    }));
    const plan = { ...(id ? { id } : {}), name: $('#financePlanName', modalRoot).value.trim(), customerType: $('#financePlanCustomer', modalRoot).value,
      qrPurpose: $('#financePlanPurpose', modalRoot).value, destinationType: $('#financePlanDestination', modalRoot).value,
      amountXof: Number($('#financePlanAmount', modalRoot).value), active: $('#financePlanActive', modalRoot).checked, options };
    const plans = [...state.financePlans]; const existingIndex = plans.findIndex((item) => item.id === id);
    if (existingIndex >= 0) plans[existingIndex] = plan; else plans.push(plan);
    const button = $('button[type="submit"]', form); button.disabled = true;
    try {
      const result = await api('/api/admin/finance/pricing', { method: 'PUT', body: JSON.stringify({ plans }) });
      state.financePlans = result.data || []; closeModal(); showToast('Catalogue tarifaire enregistré. Les commandes existantes gardent leur prix.'); await loadFinancePricing();
    } catch (error) { modalError(error.message); }
    finally { if (button.isConnected) button.disabled = false; }
  }
  async function toggleFinancePlan(id) {
    const target = state.financePlans.find((item) => item.id === id); if (!target) return;
    const active = !target.active;
    if (!window.confirm(`${active ? 'Activer' : 'Désactiver'} la formule « ${target.name} » ? Les commandes déjà créées ne changeront pas.`)) return;
    const plans = state.financePlans.map((plan) => plan.id === id ? { ...plan, active } : plan);
    try { const result = await api('/api/admin/finance/pricing', { method: 'PUT', body: JSON.stringify({ plans }) }); state.financePlans = result.data || []; showToast(active ? 'Formule activée.' : 'Formule désactivée; historique conservé.'); await loadFinancePricing(); }
    catch (error) { showToast(error.message); }
  }
  function financePaymentStatus(payment) {
    if (payment.entryType === 'refund') return 'Remboursement confirmé';
    if (payment.status === 'confirmed') return 'Validé';
    if (payment.status === 'rejected') return `Rejeté${payment.rejectionReason ? ` — ${payment.rejectionReason}` : ''}`;
    return 'En attente de validation PDG';
  }
  async function openFinanceOrder(id) {
    const result = await api(`/api/admin/finance/orders/${encodeURIComponent(id)}`); const order = result.data; state.currentFinanceOrder = order;
    const payments = order.payments?.length ? order.payments.map((payment) => `<div class="finance-payment-row"><div><strong>${esc(payment.reference)} · ${xof(payment.amountXof)} · ${esc(FINANCE_METHOD_LABELS[payment.method] || payment.method)}</strong><small>${esc(payment.entryType === 'refund' ? 'Remboursement' : 'Déclaration')} · Payeur : ${esc(payment.clientName || order.clientName)} · reçu le ${esc(fmtDate(payment.receivedAt, true))}<br>Déclaré par : ${esc(payment.declaredByType === 'manager' ? order.managerName : payment.declaredByType || '—')} · ${esc(financePaymentStatus(payment))}${payment.reviewedAt ? ` · traité le ${esc(fmtDate(payment.reviewedAt, true))}` : ''}</small></div><div class="finance-payment-actions">${payment.status === 'pending' && payment.entryType === 'receipt' ? `<button class="mini-button" type="button" data-finance-action="approve-payment" data-id="${esc(payment.id)}" data-order-id="${esc(order.id)}">Valider</button><button class="mini-button danger" type="button" data-finance-action="reject-payment" data-id="${esc(payment.id)}" data-order-id="${esc(order.id)}">Rejeter</button>` : ''}</div></div>`).join('') : '<p class="muted">Aucun paiement ni déclaration pour cette commande.</p>';
    const history = order.history?.length ? order.history.map((event) => `<div class="finance-history-row"><strong>${esc(event.summary)}</strong><br>${esc(event.actorLabel || event.actorType || 'Système')} · ${esc(fmtDate(event.createdAt, true))}${event.reason ? `<br>Motif : ${esc(event.reason)}` : ''}${event.beforeData || event.afterData ? `<details><summary>Afficher les changements</summary><pre>${esc(JSON.stringify({ before: event.beforeData, after: event.afterData }, null, 2))}</pre></details>` : ''}</div>`).join('') : '<p class="muted">Aucun événement dans l’historique.</p>';
    showModal(`<article class="modal-card"><div class="modal-header"><div><span class="eyebrow">COMMANDE ${esc(order.reference)}</span><h2>${esc(order.clientName)}</h2><p>${esc(order.companyName || 'Client particulier')} · ${esc(order.qrName)} · ${esc(order.managerName || 'PDG')}</p></div><button class="modal-close" type="button" data-close-modal aria-label="Fermer">×</button></div><div class="modal-body"><div class="finance-detail-grid"><div class="finance-detail-item"><strong>CLIENT / ENTREPRISE</strong><span>${esc(order.clientName)}${order.companyName ? ` · ${esc(order.companyName)}` : ''} · ${esc(FINANCE_CUSTOMER_LABELS[order.customerType] || order.customerType)}</span></div><div class="finance-detail-item"><strong>QR / FORMULE</strong><span>${esc(order.qrName)} · ${esc(order.pricingPlanName)}<br>${esc(FINANCE_PURPOSE_LABELS[order.qrPurpose] || order.qrPurpose)} · ${esc(FINANCE_DESTINATION_LABELS[order.destinationType] || order.destinationType)}</span></div><div class="finance-detail-item"><strong>PRIX HISTORIQUE DE LA VENTE</strong><span>Unitaire : ${xof(order.unitAmountXof)}${(order.selectedOptions||[]).map((option)=>`<br>${esc(option.name)} : ${xof(option.amountXof)}`).join('')}<br>Total initial : ${xof(order.originalTotalAmountXof ?? order.totalAmountXof)}<br>Total après corrections : ${xof(order.totalAmountXof)}</span></div><div class="finance-detail-item"><strong>PAIEMENTS / SOLDE</strong><span>Mode initial : ${esc(FINANCE_METHOD_LABELS[order.paymentMethod] || order.paymentMethod)}<br>Encaissé net : ${xof(order.netReceivedXof)} · En attente : ${xof(order.pendingAmountXof)}<br>Solde : ${xof(order.outstandingXof)} · ${esc(FINANCE_STATUS_LABELS[order.paymentStatus] || order.paymentStatus)}</span></div><div class="finance-detail-item"><strong>CRÉÉE LE</strong><span>${esc(fmtDate(order.createdAt, true))}</span></div><div class="finance-detail-item"><strong>GESTIONNAIRE</strong><span>${esc(order.managerName || 'PDG')} · ${esc(order.createdByType || 'admin')}</span></div></div><section class="order-modal-section"><h3>Encaissements, déclarations et remboursements</h3>${payments}</section><section class="order-modal-section"><h3>Journal d’audit et corrections conservées</h3><div class="finance-history">${history}</div></section></div><div class="modal-footer"><span class="modal-footer-note">Toute correction financière est journalisée. Les déclarations en attente ne sont pas des encaissements.</span><div class="modal-footer-actions"><button class="button button-secondary" type="button" data-finance-action="correct-order" data-id="${esc(order.id)}">Corriger</button>${order.netReceivedXof>0?`<button class="button button-secondary" type="button" data-finance-action="refund-order" data-id="${esc(order.id)}">Rembourser</button>`:''}${order.orderState!=='cancelled'?`<button class="button button-danger" type="button" data-finance-action="cancel-order" data-id="${esc(order.id)}">Annuler</button>`:''}<button class="button button-secondary" type="button" data-close-modal>Fermer</button></div></div></article>`);
  }
  function openFinanceCorrection(id) {
    const order = state.currentFinanceOrder;
    if (!order || order.id !== id) return openFinanceOrder(id).then(() => openFinanceCorrection(id));
    showModal(`<article class="modal-card modal-small"><div class="modal-header"><div><span class="eyebrow">CORRECTION AUDITÉE</span><h2>Corriger la commande</h2><p>Le prix d’origine et chaque correction restent dans l’historique.</p></div><button class="modal-close" type="button" data-close-modal>×</button></div><form id="financeCorrectionForm" data-id="${esc(id)}"><div class="modal-body"><div class="form-grid"><div class="form-field span-2"><label for="financeEditClient">Client *</label><input id="financeEditClient" maxlength="140" required value="${esc(order.clientName)}"></div><div class="form-field span-2"><label for="financeEditCompany">Entreprise</label><input id="financeEditCompany" maxlength="140" value="${esc(order.companyName)}"></div><div class="form-field"><label for="financeEditCustomerType">Type client</label><select id="financeEditCustomerType"><option value="individual"${order.customerType==='individual'?' selected':''}>Particulier</option><option value="business"${order.customerType==='business'?' selected':''}>Entreprise</option><option value="custom"${order.customerType==='custom'?' selected':''}>Personnalisé</option></select></div><div class="form-field"><label for="financeEditTotal">Nouveau total (XOF)</label><input id="financeEditTotal" type="number" min="0" step="1" required value="${esc(order.totalAmountXof)}"></div><div class="form-field span-2"><label for="financeEditReason">Motif obligatoire</label><textarea id="financeEditReason" maxlength="500" required></textarea></div></div></div><p class="modal-error" id="modalError" role="alert" hidden></p><div class="modal-footer"><div class="modal-footer-actions"><button class="button button-secondary" type="button" data-close-modal>Annuler</button><button class="button button-primary" type="submit">Enregistrer la correction</button></div></div></form></article>`);
  }
  function openFinanceCancel(id) {
    showModal(`<article class="modal-card modal-small"><div class="modal-header"><div><span class="eyebrow">ANNULATION CONSERVÉE</span><h2>Annuler la commande ?</h2><p>Les déclarations en attente seront rejetées. Une commande déjà encaissée doit d’abord être remboursée.</p></div><button class="modal-close" type="button" data-close-modal>×</button></div><form id="financeCancelForm" data-id="${esc(id)}"><div class="modal-body"><div class="form-field"><label for="financeCancelReason">Motif obligatoire</label><textarea id="financeCancelReason" maxlength="500" required></textarea></div></div><p class="modal-error" id="modalError" role="alert" hidden></p><div class="modal-footer"><div class="modal-footer-actions"><button class="button button-secondary" type="button" data-close-modal>Retour</button><button class="button button-danger" type="submit">Confirmer l’annulation</button></div></div></form></article>`);
  }
  function openFinanceRefund(id) {
    const order = state.currentFinanceOrder;
    if (!order || order.id !== id) return openFinanceOrder(id).then(() => openFinanceRefund(id));
    showModal(`<article class="modal-card modal-small"><div class="modal-header"><div><span class="eyebrow">REMBOURSEMENT AUDITÉ</span><h2>Enregistrer un remboursement</h2><p>Plafond net actuellement encaissé : ${xof(order.netReceivedXof)}.</p></div><button class="modal-close" type="button" data-close-modal>×</button></div><form id="financeRefundForm" data-id="${esc(id)}"><div class="modal-body"><div class="form-grid"><div class="form-field"><label for="financeRefundAmount">Montant (XOF)</label><input id="financeRefundAmount" type="number" min="1" max="${esc(order.netReceivedXof)}" step="1" required></div><div class="form-field"><label for="financeRefundMethod">Mode</label><select id="financeRefundMethod"><option value="cash">Espèces</option><option value="mobile_money">Mobile Money (remboursement manuel)</option><option value="bank_transfer">Virement</option><option value="card">Carte</option><option value="other">Autre</option></select></div><div class="form-field span-2"><label for="financeRefundReason">Motif obligatoire</label><textarea id="financeRefundReason" maxlength="500" required></textarea></div></div></div><p class="modal-error" id="modalError" role="alert" hidden></p><div class="modal-footer"><div class="modal-footer-actions"><button class="button button-secondary" type="button" data-close-modal>Annuler</button><button class="button button-primary" type="submit">Enregistrer le remboursement</button></div></div></form></article>`);
  }
  async function submitFinanceCorrection(form) {
    const body = { clientName: $('#financeEditClient', modalRoot).value.trim(), companyName: $('#financeEditCompany', modalRoot).value.trim(), customerType: $('#financeEditCustomerType', modalRoot).value, totalAmountXof: Number($('#financeEditTotal', modalRoot).value), reason: $('#financeEditReason', modalRoot).value.trim() };
    await submitFinanceMutation(form, `/api/admin/finance/orders/${encodeURIComponent(form.dataset.id)}`, 'PATCH', body, 'Correction enregistrée et auditée.');
  }
  async function submitFinanceCancel(form) {
    if (!window.confirm('Confirmer l’annulation ? Cette action sera ajoutée au journal; les mouvements financiers ne seront pas effacés.')) return;
    await submitFinanceMutation(form, `/api/admin/finance/orders/${encodeURIComponent(form.dataset.id)}/cancel`, 'POST', { reason: $('#financeCancelReason', modalRoot).value.trim() }, 'Commande annulée; historique conservé.');
  }
  async function submitFinanceRefund(form) {
    await submitFinanceMutation(form, `/api/admin/finance/orders/${encodeURIComponent(form.dataset.id)}/refunds`, 'POST', { amountXof: Number($('#financeRefundAmount', modalRoot).value), method: $('#financeRefundMethod', modalRoot).value, reason: $('#financeRefundReason', modalRoot).value.trim() }, 'Remboursement ajouté à l’audit.');
  }
  async function submitFinanceMutation(form, url, method, body, message) {
    const button = $('button[type="submit"]', form); button.disabled = true;
    try { const result = await api(url, { method, body: JSON.stringify(body) }); const id = form.dataset.id; state.currentFinanceOrder = result.data; closeModal(); showToast(message); await Promise.all([loadFinanceDashboard(), loadFinanceOrders()]); await openFinanceOrder(id); }
    catch (error) { modalError(error.message); }
    finally { if (button.isConnected) button.disabled = false; }
  }
  async function reviewFinancePayment(paymentId, decision, orderId) {
    let reason = '';
    if (decision === 'approve' && !window.confirm('Confirmer l’encaissement réel ? La commande ne sera créditée qu’après validation PDG.')) return;
    if (decision === 'reject') { reason = window.prompt('Motif obligatoire du rejet :', ''); if (reason === null) return; if (!reason.trim()) return showToast('Un motif est obligatoire pour rejeter.'); }
    try { const result = await api(`/api/admin/finance/payments/${encodeURIComponent(paymentId)}/review`, { method: 'POST', body: JSON.stringify({ decision, reason, orderId }) }); state.currentFinanceOrder = result.data; showToast(decision === 'approve' ? 'Paiement vérifié et encaissé.' : 'Déclaration rejetée; motif conservé.'); await Promise.all([loadFinanceDashboard(), loadFinanceOrders()]); await openFinanceOrder(orderId); }
    catch (error) { showToast(error.message); }
  }
  function exportFinanceCsv() {
    const params = financeQuery(); const query = params.toString();
    window.location.href = `/api/admin/finance/export.csv${query ? `?${query}` : ''}`;
  }
  async function handleFinanceAction(action, id, orderId = '') {
    if (action === 'edit-plan') return openFinancePlanForm(id);
    if (action === 'toggle-plan') return toggleFinancePlan(id);
    if (action === 'open-order') return openFinanceOrder(id);
    if (action === 'open-cash-order') return openFinanceOrder(id);
    if (action === 'correct-cash') return openCashCorrection(id);
    if (action === 'review-cash-approve') return reviewCashReportPayment(id, 'approve');
    if (action === 'review-cash-reject') return reviewCashReportPayment(id, 'reject');
    if (action === 'correct-order') return openFinanceCorrection(id);
    if (action === 'cancel-order') return openFinanceCancel(id);
    if (action === 'refund-order') return openFinanceRefund(id);
    if (action === 'approve-payment') return reviewFinancePayment(id, 'approve', orderId);
    if (action === 'reject-payment') return reviewFinancePayment(id, 'reject', orderId);
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
    if (!['overview', 'codes', 'beneficiaries', 'activity', 'settings', 'managers', 'manager-activity', 'finance'].includes(view)) view = 'overview';
    state.view = view;
    $$('.view-panel').forEach((panel) => { panel.hidden = panel.id !== `view-${view}`; });
    $$('.nav-item').forEach((button) => button.classList.toggle('is-active', button.dataset.view === view));
    const titles = { overview: 'Vue d’ensemble', codes: 'Codes QR', beneficiaries: 'Bénéficiaires', activity: 'Historique', settings: 'Réglages', managers: 'Gestionnaires', 'manager-activity': 'Activités des gestionnaires', finance: 'Finances et paiements' };
    $('#breadcrumbTitle').textContent = titles[view];
    $('#sidebar').classList.remove('is-open');
    if (load) {
      if (view === 'codes') { if (!state.managersLoaded) loadManagers().catch((error) => showToast(error.message)); loadCodes().catch((error) => showToast(error.message)); }
      if (view === 'beneficiaries') loadBeneficiaries().catch((error) => showToast(error.message));
      if (view === 'activity') loadActivity().catch((error) => showToast(error.message));
      if (view === 'settings') loadDisplaySettings().catch((error) => showToast(error.message));
      if (view === 'managers') loadManagers().catch((error) => showToast(error.message));
      if (view === 'manager-activity') loadManagerActivities().catch((error) => showToast(error.message));
      if (view === 'finance') loadFinance().catch((error) => showToast(error.message));
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
    if (state.managerCodeFilter) params.set('managerId', state.managerCodeFilter);
    const result = await api(`/api/admin/codes?${params}`);
    state.codeTotal = result.total;
    const body = $('#codesTableBody');
    body.innerHTML = result.data.map((row) => {
      const beneficiaryDeleted = Boolean(row.beneficiaryDeletedAt);
      const beneficiaryBlocked = row.beneficiaryStatus === 'blocked';
      const statusLabels = { draft: 'Brouillon', pending_validation: 'En attente de validation', active: 'Actif', suspended: 'Suspendu', inactive: 'Suspendu (ancien statut)', rejected: 'Refusé' };
      const statusLabel = beneficiaryDeleted && row.status === 'active' ? 'Bénéficiaire supprimé' : beneficiaryBlocked && row.status === 'active' ? 'Bénéficiaire bloqué' : (statusLabels[row.status] || row.status);
      const statusClass = row.status === 'active' && !beneficiaryBlocked && !beneficiaryDeleted ? 'status-active'
        : row.status === 'pending_validation' ? 'status-pending' : row.status === 'rejected' ? 'status-rejected' : row.status === 'draft' ? 'status-draft' : 'status-blocked';
      const status = `<span class="status-pill ${statusClass}">${esc(statusLabel)}</span>${row.statusReason ? `<small class="code-status-reason">Motif : ${esc(row.statusReason)}</small>` : ''}`;
      const statusActions = row.status === 'active'
        ? `<button class="mini-button danger" type="button" data-action="suspend" data-id="${esc(row.id)}">Suspendre</button>`
        : `${['pending_validation','draft'].includes(row.status) ? `<button class="mini-button" type="button" data-action="approve" data-id="${esc(row.id)}"${beneficiaryDeleted ? ' disabled title="Bénéficiaire supprimé"' : ''}>${row.status === 'pending_validation' ? 'Valider' : 'Activer'}</button><button class="mini-button danger" type="button" data-action="suspend" data-id="${esc(row.id)}">Suspendre</button><button class="mini-button danger" type="button" data-action="reject" data-id="${esc(row.id)}">Refuser</button>` : `<button class="mini-button" type="button" data-action="activate" data-id="${esc(row.id)}"${beneficiaryDeleted ? ' disabled title="Bénéficiaire supprimé"' : ''}>Réactiver</button>`}`;
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
          <button class="icon-action" type="button" title="Attribuer à un gestionnaire" aria-label="Attribuer à un gestionnaire" data-action="assign" data-id="${esc(row.id)}"><svg viewBox="0 0 20 20" fill="none"><circle cx="7" cy="6" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M1.8 17c.5-3.2 2.2-4.7 5.2-4.7 3.1 0 4.8 1.5 5.2 4.7M14.5 6.5v6m-3-3h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button>
          ${statusActions}
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
    return ({ create: 'Création', update: 'Modification', activate: 'Activation', deactivate: 'Désactivation', block: 'Blocage', unblock: 'Déblocage', delete: 'Suppression', archive: 'Archivage', request_validation: 'Soumission à validation', reject: 'Refus QR', manager_message: 'Message du PDG', suspend: 'Suspension' })[action] || action;
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
      state.imageUploadSession += 1;
      state.pendingImageOptimizations = 0;
      state.beneficiarySaveInProgress = false;
      state.currentBeneficiaryPhotos = Array.isArray(row.photos) ? row.photos.map((photo) => ({ ...photo })) : [];
      const isData = String(row.logo || '').startsWith('data:image/');
      const logoValue = isData ? row.logo : '';
      showModal(`<article class="modal-card"><div class="modal-header"><div><span class="eyebrow">RÉPERTOIRE</span><h2>${isEdit ? 'Modifier le bénéficiaire' : 'Nouveau bénéficiaire'}</h2><p>Les champs facultatifs ne seront affichés que sur les QR codes où vous les sélectionnez.</p></div><button class="modal-close" type="button" data-close-modal aria-label="Fermer">×</button></div><form id="beneficiaryForm" class="modal-form"><input id="beneEditId" type="hidden" value="${esc(row.id || '')}"><div class="modal-body"><div class="form-grid">
        <div class="form-section-title">Identité <span>Qui recevra les QR codes ?</span></div>
        <div class="form-field"><label for="beneType">Type de bénéficiaire *</label><select id="beneType" required><option value="individual"${row.type === 'individual' ? ' selected' : ''}>Particulier</option><option value="business"${row.type === 'business' ? ' selected' : ''}>Entreprise</option><option value="commerce"${row.type === 'commerce' ? ' selected' : ''}>Commerce</option><option value="organization"${row.type === 'organization' ? ' selected' : ''}>Organisation / établissement</option><option value="other"${row.type === 'other' ? ' selected' : ''}>Autre</option></select></div>
        <div class="form-field"><label for="beneName">Nom *</label><input id="beneName" type="text" maxlength="140" required placeholder="Nom du particulier ou de la structure" value="${esc(row.name || '')}"></div>
        <div class="form-field span-2"><label for="beneLogoUrl">Photo principale ou logo</label><div class="field-inline"><input id="beneLogoUrl" type="url" placeholder="https://… (facultatif)" value="${isData ? '' : esc(row.logo || '')}"><input id="beneLogoFile" type="file" accept="image/*"></div><input id="beneLogoData" type="hidden" value="${esc(logoValue)}"><span class="hint">La photo ou le logo sera optimisé automatiquement, même s’il est volumineux. Pour l’afficher sur une page déjà créée, cochez « Logo / photo » dans les réglages de ce QR.</span><span id="imageProcessingStatus" class="hint" role="status" aria-live="polite" hidden>Optimisation de l’image en cours… Attendez avant d’enregistrer.</span><div id="logoPreviewWrap" class="logo-preview-wrap"${row.logo ? '' : ' hidden'}><img id="logoPreview" src="${row.logo ? esc(row.logo) : ''}" alt="Aperçu du logo"><button type="button" class="text-button" id="removeLogoButton">Retirer le logo</button></div></div>
        <div class="form-field span-2"><label for="benePhotoFiles">Galerie de photos (jusqu’à 8)</label><input id="benePhotoFiles" type="file" accept="image/*" multiple><span class="hint">Tout format d’image lisible par votre appareil est accepté. Les fichiers volumineux sont automatiquement redimensionnés et compressés. Sélectionnez ensuite les photos à afficher pour chaque QR.</span><div id="beneficiaryPhotoEditor" class="photo-editor-grid"></div></div>
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
    if (!file) throw new Error('Aucun fichier image sélectionné.');

    let image = null;
    let releaseImage = () => {};
    if (typeof createImageBitmap === 'function') {
      try {
        image = await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch (_) {
        try { image = await createImageBitmap(file); } catch (_) { /* Fallback to an image element below. */ }
      }
      if (image) releaseImage = () => image.close?.();
    }
    if (!image) {
      const source = URL.createObjectURL(file);
      try {
        image = await new Promise((resolve, reject) => {
          const picture = new Image();
          picture.onload = () => resolve(picture);
          picture.onerror = () => reject(new Error('Le navigateur ne peut pas lire ce format d’image. Essayez de l’enregistrer en JPG ou PNG.'));
          picture.src = source;
        });
        releaseImage = () => URL.revokeObjectURL(source);
      } catch (error) {
        URL.revokeObjectURL(source);
        throw error;
      }
    }

    try {
      const sourceWidth = image.naturalWidth || image.width;
      const sourceHeight = image.naturalHeight || image.height;
      if (!sourceWidth || !sourceHeight) throw new Error('Cette image ne contient pas de dimensions lisibles.');
      const longestSide = Math.max(sourceWidth, sourceHeight);
      const dimensionLimit = Math.max(64, Number(maxDimension) || 1400);
      const characterLimit = Math.max(1024, Number(maxChars) || 350 * 1024);
      const minimumSide = Math.min(128, dimensionLimit);
      let scale = Math.min(1, dimensionLimit / longestSide);
      let quality = 0.84;

      const render = (renderScale, renderQuality) => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(sourceWidth * renderScale));
        canvas.height = Math.max(1, Math.round(sourceHeight * renderScale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Le navigateur ne peut pas optimiser cette image.');
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        let data = canvas.toDataURL('image/webp', renderQuality);
        if (!data.startsWith('data:image/webp')) {
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          data = canvas.toDataURL('image/jpeg', renderQuality);
        }
        if (!/^data:image\/(?:webp|jpeg|png);base64,/.test(data)) throw new Error('Le navigateur n’a pas pu convertir cette image.');
        return data;
      };

      let data = '';
      for (let attempt = 0; attempt < 20; attempt += 1) {
        data = render(scale, quality);
        if (data.length <= characterLimit) return data;
        const renderedSide = longestSide * scale;
        if (renderedSide <= minimumSide) break;
        const compressionRatio = Math.sqrt(characterLimit / data.length);
        const shrinkFactor = Math.min(0.88, Math.max(0.42, compressionRatio * 0.86));
        scale = Math.max(minimumSide / longestSide, scale * shrinkFactor);
        quality = Math.max(0.36, quality - 0.07);
      }

      // Final fallback: even very large or unusually detailed photos are reduced to a small, database-safe image.
      data = render(Math.min(scale, minimumSide / longestSide), 0.36);
      if (data.length > characterLimit) data = render(Math.min(scale, 64 / longestSide), 0.32);
      if (data.length > characterLimit) throw new Error('Cette image ne peut pas être convertie par le navigateur. Essayez une copie JPG ou PNG.');
      return data;
    } finally {
      releaseImage();
    }
  }
  async function squareManagerAvatarFile(file) {
    if (!file) throw new Error('Aucun fichier image sélectionné.');
    let image = null; let release = () => {};
    if (typeof createImageBitmap === 'function') {
      try { image = await createImageBitmap(file, { imageOrientation: 'from-image' }); release = () => image.close?.(); } catch (_) {}
    }
    if (!image) {
      const source = URL.createObjectURL(file);
      try { image = await new Promise((resolve, reject) => { const picture = new Image(); picture.onload = () => resolve(picture); picture.onerror = () => reject(new Error('Cette image ne peut pas être lue.')); picture.src = source; }); release = () => URL.revokeObjectURL(source); }
      catch (error) { URL.revokeObjectURL(source); throw error; }
    }
    try {
      const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height, side = Math.min(width, height);
      if (!side) throw new Error('Dimensions de photo invalides.');
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
      const context = canvas.getContext('2d'); if (!context) throw new Error('Le navigateur ne peut pas recadrer cette photo.');
      context.fillStyle = '#fff'; context.fillRect(0, 0, 512, 512);
      context.drawImage(image, (width-side)/2, (height-side)/2, side, side, 0, 0, 512, 512);
      for (let quality = .9; quality >= .38; quality -= .08) { const data = canvas.toDataURL('image/jpeg', quality); if (data.length <= 480000) return data; }
      throw new Error('La photo reste trop volumineuse après recadrage.');
    } finally { release(); }
  }
  function updateImageProcessing() {
    const form = $('#beneficiaryForm', modalRoot);
    if (!form) return;
    const busy = state.pendingImageOptimizations > 0;
    const submit = $('button[type="submit"]', form);
    if (submit) submit.disabled = busy || state.beneficiarySaveInProgress;
    const note = $('#imageProcessingStatus', modalRoot);
    if (note) note.hidden = !busy;
  }
  function beginImageProcessing() {
    state.pendingImageOptimizations += 1;
    updateImageProcessing();
    return state.imageUploadSession;
  }
  function endImageProcessing(session) {
    if (session !== state.imageUploadSession) return;
    state.pendingImageOptimizations = Math.max(0, state.pendingImageOptimizations - 1);
    updateImageProcessing();
  }

  async function openQrForm(id = '') {
    const editData = id ? (await api(`/api/admin/codes/${encodeURIComponent(id)}`)).data : null;
    const isEdit = Boolean(editData);
    const categories = state.categories;
    const initialPurpose = editData?.purpose || 'contact';
    const initialType = editData?.destinationType || 'page';
    const initialFields = new Set(editData?.selectedFields || ['logo', 'phone', 'whatsapp', 'email', 'address', 'website', 'socials', 'bio', 'offers', 'documents']);
    const initialPhotoIds = new Set(editData?.selectedPhotoIds || []);
    const style = { foreground: '#111111', background: '#FFFFFF', correction: 'M', textSize: 'default', ...(editData?.style || {}) };
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
        <div class="form-field span-2"><span class="form-label">Photos de la galerie à afficher</span><div id="qrPhotoOptions" class="qr-photo-options"><span class="hint">Choisissez un bénéficiaire pour voir ses photos.</span></div><span class="hint">Sur un nouveau QR, toutes les photos sont présélectionnées. Sur un QR existant, cochez celles à afficher : sans case cochée, aucune photo de galerie ne sortira au scan. Chaque QR garde sa propre sélection.</span></div>
      </div>
      <div class="form-section-title">Apparence <span>Optimisée pour l’impression et le scan.</span></div>
      <div class="form-field"><label for="qrForeground">Couleur du QR</label><input id="qrForeground" type="color" value="${esc(style.foreground || '#111111')}"></div>
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
      loadQrPhotoOptions(beneSelect.value, null).catch((error) => showToast(error.message));
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
    if (!photos.length) { target.innerHTML = '<span class="hint">Aucune photo de galerie. Le logo principal se coche séparément dans « Informations du bénéficiaire ».</span>'; return; }
    const selectAllByDefault = selectedIds === null;
    const selected = selectedIds || new Set();
    const tools = `<div class="qr-photo-tools"><span>${selectAllByDefault ? 'Photos présélectionnées pour ce nouveau QR' : 'Choisissez les photos visibles'}</span><button type="button" data-action="select-all-qr-photos">Tout afficher</button><button type="button" data-action="clear-qr-photos">Tout masquer</button></div>`;
    target.innerHTML = tools + photos.map((photo) => `<label class="qr-photo-option"><input type="checkbox" name="selectedPhotoIds" value="${esc(photo.id)}"${selectAllByDefault || selected.has(photo.id) ? ' checked' : ''}><img src="${esc(photo.src)}" alt=""><span>${esc(photo.alt || 'Photo')}</span></label>`).join('');
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
    if (state.pendingImageOptimizations > 0) { modalError('Attendez la fin de l’optimisation des photos avant d’enregistrer.'); return; }
    const id = $('#beneEditId', modalRoot)?.value || '';
    const submit = $('button[type="submit"]', form);
    state.beneficiarySaveInProgress = true;
    updateImageProcessing();
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
    finally {
      state.beneficiarySaveInProgress = false;
      if (submit.isConnected) submit.disabled = state.pendingImageOptimizations > 0;
    }
  }
  async function openQrFormForBeneficiary(id, name) {
    await openQrForm();
    if ($('#qrBeneficiaryId', modalRoot)) {
      await refreshBeneficiaryOptions(id, name, '');
      $('#qrBeneficiaryId', modalRoot).value = id;
      $('#qrBeneSearch', modalRoot).value = name;
      $('#qrCategoryId', modalRoot).value = CATEGORY_BY_TYPE[state.modalBeneficiaries?.find((row) => row.id === id)?.type] || 'cat-other';
      await loadQrPhotoOptions(id, null).catch((error) => showToast(error.message));
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
    const fg = code.style?.foreground || '#111111';
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
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="${code.style?.background || '#FFFFFF'}"/><path d="${paths.join('')}" fill="${code.style?.foreground || '#111111'}"/></svg>`;
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
      if (action === 'assign') { await openCodeAssignment(id); }
      else if (action === 'preview') { const result = await api(`/api/admin/codes/${encodeURIComponent(id)}`); openCodePreview(result.data); }
      else if (action === 'edit') await openQrForm(id);
      else if (action === 'png' || action === 'svg' || action === 'print' || action === 'copy') {
        const result = await api(`/api/admin/codes/${encodeURIComponent(id)}`);
        if (action === 'png' || action === 'svg') downloadCode(result.data, action);
        if (action === 'print') printCode(result.data);
        if (action === 'copy') copyCodeLink(result.data);
      } else if (action === 'history') await openHistory(id);
      else if (['activate','approve','suspend','reject','deactivate'].includes(action)) {
        const status = ['approve','activate'].includes(action) ? 'active' : ['suspend','deactivate'].includes(action) ? 'suspended' : 'rejected';
        let reason = '';
        if (status === 'rejected' || status === 'suspended') {
          reason = window.prompt(status === 'rejected' ? 'Motif obligatoire du refus :' : 'Motif obligatoire de la suspension :', '');
          if (reason === null) return;
          if (!reason.trim()) return showToast('Un motif explicatif est obligatoire.');
        } else if (!window.confirm(status === 'active' ? 'Valider/activer ce QR ? Il deviendra accessible au public.' : 'Confirmer cette action ?')) return;
        await api(`/api/admin/codes/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status, reason: reason.trim() }) });
        showToast(status === 'active' ? 'QR validé et activé.' : status === 'suspended' ? 'QR suspendu; motif journalisé et transmis.' : 'QR refusé; motif journalisé et transmis.');
        await Promise.all([loadCodes(), loadDashboard(), loadManagerActivities()]);
      } else if (action === 'delete') {
        if (!window.confirm('Supprimer ce QR code ? Le lien public sera désactivé, mais son historique sera conservé.')) return;
        await api(`/api/admin/codes/${encodeURIComponent(id)}`, { method: 'DELETE' });
        showToast('QR code supprimé.'); await Promise.all([loadCodes(), loadDashboard(), loadBeneficiaries()]);
      }
    } catch (error) { showToast(error.message); }
  }

  function managerStatusLabel(manager) {
    if (manager.deletedAt) return ['Supprimé', 'deleted'];
    if (manager.status === 'suspended') return ['Suspendu', 'suspended'];
    if (manager.status === 'blocked') return ['Bloqué', 'blocked'];
    return ['Actif', ''];
  }
  async function loadManagers() {
    const result = await api('/api/admin/managers');
    state.managers = result.data || []; state.managersLoaded = true;
    const active = state.managers.filter((m) => !m.deletedAt && m.status === 'active').length;
    $('#navManagerCount').textContent = number(active);
    const body = $('#managerTableBody');
    if (!state.managers.length) {
      body.innerHTML = '<tr><td colspan="5">Aucun gestionnaire. Créez un premier compte pour déléguer l’accès.</td></tr>';
    } else {
      body.innerHTML = state.managers.map((manager) => {
        const [label, statusClass] = managerStatusLabel(manager);
        const deleted = Boolean(manager.deletedAt);
        const statusActions = deleted ? '' : manager.status === 'active'
          ? `<button class="button button-quiet" type="button" data-action="manager-suspend" data-id="${esc(manager.id)}">Suspendre</button><button class="button button-danger" type="button" data-action="manager-block" data-id="${esc(manager.id)}">Bloquer</button>`
          : `<button class="button button-secondary" type="button" data-action="manager-activate" data-id="${esc(manager.id)}">Réactiver</button><button class="button button-danger" type="button" data-action="${manager.status === 'suspended' ? 'manager-block' : 'manager-suspend'}" data-id="${esc(manager.id)}">${manager.status === 'suspended' ? 'Bloquer' : 'Suspendre'}</button>`;
        return `<tr>
          <td><div class="manager-person">${manager.hasAvatar&&manager.avatarUrl&&!deleted?`<img src="${esc(manager.avatarUrl)}" alt="">`:`<span class="manager-person-fallback">${esc(String(manager.displayName||'G').trim().slice(0,1).toLocaleUpperCase('fr'))}</span>`}<span><strong>${esc(manager.displayName)}</strong><small>@${esc(manager.username)}${manager.phone ? ` · ${esc(manager.phone)}` : ''}${manager.email ? ` · ${esc(manager.email)}` : ''}${manager.customDomain ? ` · ${esc(manager.customDomain)}` : ''}</small></span></div>${manager.statusReason ? `<span class="manager-status-note">Motif : ${esc(manager.statusReason)}</span>` : ''}</td>
          <td><span class="manager-table-status ${statusClass}">${label}</span>${manager.mustChangePassword&&!deleted?`<small class="manager-status-note">Nouveau mot de passe requis${manager.passwordResetExpiresAt?` · expire ${esc(fmtDate(manager.passwordResetExpiresAt,true))}`:''}</small>`:''}</td>
          <td>${number(manager.qrCount)} QR<br><small>${manager.qrLimit ? `${number(Math.max(0, manager.qrLimit - manager.qrCount))} restant(s) / limite ${number(manager.qrLimit)}` : 'Limite illimitée'}</small><small>${manager.canCreateCodes === false ? 'Création désactivée' : 'Création et activation immédiates'}</small></td>
          <td>${esc(fmtDate(manager.lastLoginAt, true))}<small>Dernier événement : ${esc(fmtDate(manager.lastSecurityEventAt, true))}</small></td>
          <td><div class="manager-account-actions"><button class="button button-secondary" type="button" data-action="manager-view-codes" data-id="${esc(manager.id)}">QR</button><button class="button button-secondary" type="button" data-action="manager-view-activities" data-id="${esc(manager.id)}">Activités</button>${deleted ? '<span class="hint">Accès fermé</span>' : `<button class="button button-secondary" type="button" data-action="manager-message" data-id="${esc(manager.id)}">Message</button><button class="button button-secondary" type="button" data-action="manager-edit" data-id="${esc(manager.id)}">Modifier</button><button class="button button-quiet" type="button" data-action="manager-reset" data-id="${esc(manager.id)}">Réinitialiser</button><button class="button button-quiet" type="button" data-action="manager-revoke-sessions" data-id="${esc(manager.id)}">Déconnecter partout</button>${statusActions}<button class="button button-danger" type="button" data-action="manager-delete" data-id="${esc(manager.id)}">Supprimer</button>`}</div></td>
        </tr>`;
      }).join('');
    }
    $('#managerCount').textContent = `${number(state.managers.filter((m) => !m.deletedAt).length)} compte(s) non supprimé(s) · ${number(state.managers.filter((m) => m.deletedAt).length)} supprimé(s)`;
    populateManagerActivityFilter();
    const codeFilter = $('#managerCodeFilter');
    if (codeFilter) { const selected = state.managerCodeFilter || codeFilter.value; codeFilter.innerHTML = '<option value="">Tous les QR / espace PDG</option>' + state.managers.map((m) => `<option value="${esc(m.id)}">${esc(m.displayName)} (@${esc(m.username)})${m.deletedAt ? ' · supprimé' : ''}</option>`).join(''); if ([...codeFilter.options].some((o) => o.value === selected)) codeFilter.value = selected; }
  }
  function openManagerForm(id = '') {
    const render = (manager = {}) => {
      showModal(`<article class="modal-card modal-small"><div class="modal-header"><div><span class="eyebrow">ACCÈS DÉLÉGUÉ</span><h2>${id ? 'Modifier un gestionnaire' : 'Créer un gestionnaire'}</h2><p>${id ? 'La modification des identifiants révoque les sessions en cours.' : 'Aucun compte ne peut être créé publiquement.'}</p></div><button class="modal-close" type="button" data-close-modal aria-label="Fermer">×</button></div><form id="managerForm" data-id="${esc(id)}" data-original-domain="${esc(manager.customDomain || '')}" data-avatar-edited="false"><div class="modal-body"><div class="form-grid">
        <div class="form-field span-2"><label>Logo / photo personnalisé</label><div class="manager-avatar-edit"><div class="manager-avatar-thumb"><img id="managerAvatarPreview" alt="Photo du gestionnaire"${manager.hasAvatar&&manager.avatarUrl?` src="${esc(manager.avatarUrl)}"`:''}${manager.hasAvatar&&manager.avatarUrl?'':' hidden'}><img id="managerAvatarFallback" class="avatar-empty" src="/manager-icon.svg" alt="Logo QRia par défaut"${manager.hasAvatar&&manager.avatarUrl?' hidden':''}></div><div class="avatar-actions"><label class="button button-secondary" for="managerAvatarFile">Choisir une photo</label><input id="managerAvatarFile" type="file" accept="image/jpeg,image/png,image/webp" hidden><button class="button button-quiet" type="button" id="removeManagerAvatar">Logo QRia par défaut</button><span class="hint">Photo recadrée au carré. Cette image n’est visible que pour ce compte; la mise à jour de l’icône installée dépend du navigateur.</span></div><input type="hidden" id="managerAvatarData" value=""></div></div>
        <div class="form-field span-2"><label for="managerDisplayName">Nom affiché *</label><input id="managerDisplayName" maxlength="120" required value="${esc(manager.displayName || '')}" placeholder="Ex. Aïcha Koné"></div>
        <div class="form-field"><label for="managerAccountUsername">Identifiant *</label><input id="managerAccountUsername" maxlength="80" minlength="3" pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,79}" required value="${esc(manager.username || '')}" placeholder="ex. aicha.kone"></div>
        <div class="form-field"><label for="managerPhone">Téléphone (facultatif)</label><input id="managerPhone" type="tel" maxlength="32" value="${esc(manager.phone || '')}" placeholder="+225 07 00 00 00 00"></div>
        <div class="form-field"><label for="managerEmail">E-mail (facultatif)</label><input id="managerEmail" type="email" maxlength="254" value="${esc(manager.email || '')}" placeholder="nom@exemple.ci"></div>
        <div class="form-field span-2"><label for="managerCustomDomain">Sous-domaine personnalisé (facultatif)</label><input id="managerCustomDomain" type="text" maxlength="253" inputmode="url" value="${esc(manager.customDomain || '')}" placeholder="qr-rakesh.oymiketech.com"><span class="hint">Les domaines enregistrés sont conservés. Temporairement, tous les comptes utilisent le lien principal de connexion; ce domaine ne redirige ni ne limite l’accès.</span></div>
        <div class="form-section-title span-2">Permissions et limites QR</div>
        <div class="form-field span-2 manager-permissions"><label><input id="managerCanCreateCodes" type="checkbox"${manager.canCreateCodes === false ? '' : ' checked'}> Autoriser la création de QR</label><label><input id="managerCanEditCodes" type="checkbox"${manager.canEditCodes === false ? '' : ' checked'}> Autoriser la modification et suppression de ses QR</label><span class="hint">Un gestionnaire autorisé peut activer immédiatement un QR neuf, sans paiement ni accord préalable du PDG. Le PDG conserve ses contrôles de suspension, refus et réactivation.</span></div>
        <div class="form-field span-2"><label for="managerQrLimit">Limite de QR attribués (0 = illimitée)</label><input id="managerQrLimit" type="number" min="0" max="100000" step="1" value="${esc(manager.qrLimit || 0)}"><span class="hint">La limite est appliquée côté serveur au moment de la création; réduire la limite ne supprime aucun QR existant.</span></div>
        ${id ? `<div class="form-field span-2" id="managerDomainStepUp" hidden><span class="hint">Changer ou désactiver ce rattachement demande une nouvelle vérification du PDG.</span><div class="form-field"><label for="managerDomainConfirmUsername">Saisissez l’identifiant <strong>${esc(manager.username || '')}</strong></label><input id="managerDomainConfirmUsername" type="text" autocomplete="off"></div><div class="form-field"><label for="managerDomainAdminPassword">Mot de passe actuel du PDG</label><input id="managerDomainAdminPassword" type="password" autocomplete="current-password"></div></div>` : ''}
        ${id ? '' : '<div class="form-field span-2"><label for="managerInitialPassword">Mot de passe initial *</label><input id="managerInitialPassword" type="password" minlength="12" maxlength="128" autocomplete="new-password" required><span class="hint">12 caractères minimum. Le mot de passe n’est ni affiché de nouveau, ni journalisé.</span></div>'}
      </div></div><p class="modal-error" id="modalError" role="alert" hidden></p><div class="modal-footer"><span class="modal-footer-note">Transmission du mot de passe sous la responsabilité du PDG.</span><div class="modal-footer-actions"><button class="button button-secondary" type="button" data-close-modal>Annuler</button><button class="button button-primary" type="submit">${id ? 'Enregistrer' : 'Créer le compte'}</button></div></div></form></article>`);
    };
    if (id) {
      const manager = state.managers.find((item) => item.id === id);
      if (!manager) return showToast('Gestionnaire introuvable.');
      render(manager);
    } else render();
  }
  async function submitManagerForm(form) {
    const id = form.dataset.id || '';
    const payload = { displayName: $('#managerDisplayName', modalRoot).value.trim(), username: $('#managerAccountUsername', modalRoot).value.trim(), phone: $('#managerPhone', modalRoot).value.trim(), email: $('#managerEmail', modalRoot).value.trim(), customDomain: $('#managerCustomDomain', modalRoot).value.trim(),
      canCreateCodes: $('#managerCanCreateCodes', modalRoot).checked, canEditCodes: $('#managerCanEditCodes', modalRoot).checked, qrLimit: Number($('#managerQrLimit', modalRoot).value) };
    const domainChanged = Boolean(id && payload.customDomain.toLowerCase() !== String(form.dataset.originalDomain || '').trim().toLowerCase());
    if (domainChanged) {
      const manager = state.managers.find((item) => item.id === id);
      const confirmUsername = $('#managerDomainConfirmUsername', modalRoot)?.value.trim() || '';
      if (!manager || confirmUsername.toLowerCase() !== manager.username.toLowerCase()) { const adminPassword = $('#managerDomainAdminPassword', modalRoot); if (adminPassword) adminPassword.value = ''; return modalError('Confirmez exactement l’identifiant du compte avant de modifier son sous-domaine.'); }
      payload.confirmUsername = confirmUsername;
      payload.adminPassword = $('#managerDomainAdminPassword', modalRoot)?.value || '';
    }
    if (!id) payload.password = $('#managerInitialPassword', modalRoot).value;
    if (form.dataset.avatarEdited === 'true') payload.avatarData = $('#managerAvatarData', modalRoot).value || '';
    const submit = $('button[type="submit"]', form); submit.disabled = true;
    try {
      await api(id ? `/api/admin/managers/${encodeURIComponent(id)}` : '/api/admin/managers', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      closeModal(); showToast(id ? 'Compte gestionnaire modifié; anciennes sessions révoquées.' : 'Compte gestionnaire créé. Communiquez les identifiants de façon sécurisée.');
      await Promise.all([loadManagers(), loadManagerActivities()]);
    } catch (error) { const adminPassword = $('#managerDomainAdminPassword', modalRoot); if (adminPassword) adminPassword.value = ''; modalError(error.message); }
    finally { if (submit.isConnected) submit.disabled = false; }
  }
  function openManagerMessage(id) {
    const manager = state.managers.find((item) => item.id === id);
    if (!manager || manager.deletedAt) return showToast('Gestionnaire introuvable ou supprimé.');
    showModal(`<article class="modal-card modal-small"><div class="modal-header"><div><span class="eyebrow">MESSAGE PRIVÉ</span><h2>Écrire au gestionnaire</h2><p>${esc(manager.displayName)} (@${esc(manager.username)}) · Le message sera visible dans sa boîte de réception QRia.</p></div><button class="modal-close" type="button" data-close-modal aria-label="Fermer">×</button></div><form id="managerMessageForm" data-id="${esc(id)}"><div class="modal-body"><div class="form-field"><label for="managerMessageTitle">Objet</label><input id="managerMessageTitle" maxlength="160" required placeholder="Ex. Décision concernant votre QR"></div><div class="form-field"><label for="managerMessageBody">Message</label><textarea id="managerMessageBody" maxlength="2000" rows="6" required placeholder="Votre message…"></textarea><span class="hint">Maximum 2000 caractères. Le contenu est enregistré dans la boîte de réception du gestionnaire; le journal d’audit ne contient pas le texte.</span></div></div><p class="modal-error" id="modalError" role="alert" hidden></p><div class="modal-footer"><div class="modal-footer-actions"><button class="button button-secondary" type="button" data-close-modal>Annuler</button><button class="button button-primary" type="submit">Envoyer le message</button></div></div></form></article>`);
  }
  async function submitManagerMessage(form) {
    const button = $('button[type="submit"]', form); button.disabled = true;
    try {
      const result = await api(`/api/admin/managers/${encodeURIComponent(form.dataset.id)}/messages`, { method: 'POST', body: JSON.stringify({
        title: $('#managerMessageTitle', modalRoot).value.trim(), body: $('#managerMessageBody', modalRoot).value.trim(),
      }) });
      closeModal(); showToast('Message envoyé dans la boîte de réception du gestionnaire.'); await loadManagerActivities();
    } catch (error) { modalError(error.message); }
    finally { if (button.isConnected) button.disabled = false; }
  }

  function openManagerPasswordReset(id) {
    const manager = state.managers.find((item) => item.id === id);
    if (!manager) return showToast('Gestionnaire introuvable.');
    showModal(`<article class="modal-card modal-small"><div class="modal-header"><div><span class="eyebrow">SÉCURITÉ DU COMPTE</span><h2>Réinitialiser le mot de passe</h2><p>${esc(manager.displayName)} · Toutes les sessions seront révoquées.</p></div><button class="modal-close" type="button" data-close-modal aria-label="Fermer">×</button></div><form id="managerResetForm" data-id="${esc(id)}"><div class="modal-body"><div class="form-field"><label for="managerResetMethod">Méthode de réinitialisation</label><select id="managerResetMethod"><option value="temporary">Mot de passe temporaire — valable 24 h</option><option value="link">Lien sécurisé — valable 30 min</option></select><span class="hint">Le gestionnaire devra choisir son propre mot de passe. QRia n’envoie pas d’e-mail/SMS : transmettez le secret affiché par un canal sûr.</span></div><div class="form-field"><label for="managerResetConfirmUsername">Pour confirmer, saisissez l’identifiant <strong>${esc(manager.username)}</strong></label><input id="managerResetConfirmUsername" type="text" autocomplete="off" required></div><div class="form-field"><label for="managerResetAdminPassword">Mot de passe actuel du PDG (vérification d’identité)</label><input id="managerResetAdminPassword" type="password" autocomplete="current-password" required></div></div><p class="modal-error" id="modalError" role="alert" hidden></p><div class="modal-footer"><div class="modal-footer-actions"><button class="button button-secondary" type="button" data-close-modal>Annuler</button><button class="button button-primary" type="submit">Confirmer la réinitialisation</button></div></div></form></article>`);
  }
  function showManagerTemporaryPassword(result) {
    showModal(`<article class="modal-card modal-small"><div class="modal-header"><div><span class="eyebrow">À COMMUNIQUER UNE SEULE FOIS</span><h2>Mot de passe temporaire</h2><p>Il expire le ${esc(fmtDate(result.expiresAt, true))} et oblige le gestionnaire à en choisir un nouveau.</p></div><button class="modal-close" type="button" data-close-modal aria-label="Fermer">×</button></div><div class="modal-body"><p class="hint">Copiez-le maintenant et transmettez-le directement au gestionnaire. QRia ne le conservera pas en clair et ne pourra pas le réafficher.</p><div class="manager-secret-row"><code id="managerTemporaryPassword">${esc(result.temporaryPassword)}</code><button class="button button-secondary" type="button" data-copy-manager-secret="temporary">Copier</button></div></div><div class="modal-footer"><div class="modal-footer-actions"><button class="button button-primary" type="button" data-close-modal>Terminé</button></div></div></article>`);
  }
  function showManagerResetLink(result) {
    const link = `${window.location.origin}${result.resetPath}`;
    showModal(`<article class="modal-card modal-small"><div class="modal-header"><div><span class="eyebrow">LIEN À USAGE UNIQUE</span><h2>Lien de réinitialisation</h2><p>Expiration : ${esc(fmtDate(result.expiresAt, true))}. Lien utilisable une seule fois.</p></div><button class="modal-close" type="button" data-close-modal aria-label="Fermer">×</button></div><div class="modal-body"><p class="hint">Aucun e-mail/SMS n’est configuré. Copiez ce lien et transmettez-le au gestionnaire par un canal sûr. Le jeton n’est affiché qu’une seule fois.</p><div class="manager-secret-row"><input id="managerResetLinkValue" type="text" readonly value="${esc(link)}"><button class="button button-secondary" type="button" data-copy-manager-secret="link">Copier</button></div></div><div class="modal-footer"><div class="modal-footer-actions"><button class="button button-primary" type="button" data-close-modal>Terminé</button></div></div></article>`);
  }
  async function submitManagerPasswordReset(form) {
    const manager = state.managers.find((item) => item.id === form.dataset.id);
    if (!manager) return modalError('Gestionnaire introuvable.');
    const confirmUsername = $('#managerResetConfirmUsername', modalRoot).value.trim();
    if (confirmUsername.toLowerCase() !== manager.username.toLowerCase()) return modalError('L’identifiant saisi ne correspond pas au gestionnaire ciblé.');
    if (!window.confirm(`Confirmer la réinitialisation de ${manager.displayName} ? Toutes ses sessions seront fermées.`)) return;
    const method = $('#managerResetMethod', modalRoot).value;
    const adminPasswordInput = $('#managerResetAdminPassword', modalRoot);
    const adminPassword = adminPasswordInput.value;
    const button = $('button[type="submit"]', form); button.disabled = true;
    try {
      const result = await api(`/api/admin/managers/${encodeURIComponent(form.dataset.id)}/reset-password`, { method: 'POST', body: JSON.stringify({ method, adminPassword, confirmUsername }) });
      closeModal();
      await Promise.all([loadManagers(), loadManagerActivities()]);
      if (result.method === 'temporary') showManagerTemporaryPassword(result);
      else showManagerResetLink(result);
    } catch (error) { adminPasswordInput.value = ''; modalError(error.message); }
    finally { if (button.isConnected) button.disabled = false; }
  }
  function openManagerSessionRevocation(id) {
    const manager = state.managers.find((item) => item.id === id);
    if (!manager) return showToast('Gestionnaire introuvable.');
    showModal(`<article class="modal-card modal-small"><div class="modal-header"><div><span class="eyebrow">CONTRÔLE DES SESSIONS</span><h2>Déconnecter tous les appareils</h2><p>${esc(manager.displayName)} · L’accès sera révoqué dès la validation.</p></div><button class="modal-close" type="button" data-close-modal aria-label="Fermer">×</button></div><form id="managerRevokeSessionsForm" data-id="${esc(id)}"><div class="modal-body"><div class="form-field"><label for="managerRevokeConfirmUsername">Saisissez l’identifiant <strong>${esc(manager.username)}</strong> pour confirmer</label><input id="managerRevokeConfirmUsername" type="text" autocomplete="off" required></div><div class="form-field"><label for="managerRevokeAdminPassword">Mot de passe actuel du PDG</label><input id="managerRevokeAdminPassword" type="password" autocomplete="current-password" required></div></div><p class="modal-error" id="modalError" role="alert" hidden></p><div class="modal-footer"><div class="modal-footer-actions"><button class="button button-secondary" type="button" data-close-modal>Annuler</button><button class="button button-primary" type="submit">Révoquer les sessions</button></div></div></form></article>`);
  }
  async function submitManagerSessionRevocation(form) {
    const manager = state.managers.find((item) => item.id === form.dataset.id);
    if (!manager) return modalError('Gestionnaire introuvable.');
    const confirmUsername = $('#managerRevokeConfirmUsername', modalRoot).value.trim();
    if (confirmUsername.toLowerCase() !== manager.username.toLowerCase()) return modalError('L’identifiant saisi ne correspond pas au gestionnaire ciblé.');
    if (!window.confirm(`Déconnecter immédiatement ${manager.displayName} de tous ses appareils ?`)) return;
    const adminPasswordInput = $('#managerRevokeAdminPassword', modalRoot);
    const adminPassword = adminPasswordInput.value;
    const button = $('button[type="submit"]', form); button.disabled = true;
    try {
      await api(`/api/admin/managers/${encodeURIComponent(form.dataset.id)}/revoke-sessions`, { method: 'POST', body: JSON.stringify({ adminPassword, confirmUsername }) });
      closeModal(); showToast('Toutes les sessions du gestionnaire ont été révoquées.'); await Promise.all([loadManagers(), loadManagerActivities()]);
    } catch (error) { adminPasswordInput.value = ''; modalError(error.message); }
    finally { if (button.isConnected) button.disabled = false; }
  }
  function changeManagerStatus(id, status) {
    const manager = state.managers.find((item) => item.id === id); if (!manager) return;
    const action = status === 'active' ? 'Réactiver' : status === 'suspended' ? 'Suspendre' : 'Bloquer';
    const reasonField = status === 'active' ? '' : `<div class="form-field"><label for="managerStatusReason">Motif (facultatif)</label><input id="managerStatusReason" type="text" maxlength="500" value="${esc(manager.statusReason || '')}"></div>`;
    showModal(`<article class="modal-card modal-small"><div class="modal-header"><div><span class="eyebrow">SÉCURITÉ DU COMPTE</span><h2>${action} le compte</h2><p>${esc(manager.displayName)} · Les sessions en cours seront révoquées. Les QR et journaux resteront conservés.</p></div><button class="modal-close" type="button" data-close-modal aria-label="Fermer">×</button></div><form id="managerStatusChangeForm" data-id="${esc(id)}" data-status="${esc(status)}"><div class="modal-body">${reasonField}<div class="form-field"><label for="managerStatusConfirmUsername">Saisissez l’identifiant <strong>${esc(manager.username)}</strong> pour confirmer</label><input id="managerStatusConfirmUsername" type="text" autocomplete="off" required></div><div class="form-field"><label for="managerStatusAdminPassword">Mot de passe actuel du PDG</label><input id="managerStatusAdminPassword" type="password" autocomplete="current-password" required></div></div><p class="modal-error" id="modalError" role="alert" hidden></p><div class="modal-footer"><div class="modal-footer-actions"><button class="button button-secondary" type="button" data-close-modal>Annuler</button><button class="button ${status === 'blocked' ? 'button-danger' : 'button-primary'}" type="submit">${action}</button></div></div></form></article>`);
  }
  async function submitManagerStatusChange(form) {
    const manager = state.managers.find((item) => item.id === form.dataset.id);
    if (!manager) return modalError('Gestionnaire introuvable.');
    const confirmUsername = $('#managerStatusConfirmUsername', modalRoot).value.trim();
    if (confirmUsername.toLowerCase() !== manager.username.toLowerCase()) return modalError('L’identifiant saisi ne correspond pas au gestionnaire ciblé.');
    const adminPasswordInput = $('#managerStatusAdminPassword', modalRoot);
    const button = $('button[type="submit"]', form); button.disabled = true;
    try {
      const status = form.dataset.status;
      const reason = $('#managerStatusReason', modalRoot)?.value.trim() || '';
      await api(`/api/admin/managers/${encodeURIComponent(form.dataset.id)}/status`, { method: 'PATCH', body: JSON.stringify({ status, reason, adminPassword: adminPasswordInput.value, confirmUsername }) });
      closeModal(); showToast(status === 'active' ? 'Compte réactivé.' : status === 'suspended' ? 'Compte suspendu.' : 'Compte bloqué.');
      await Promise.all([loadManagers(), loadManagerActivities(), loadManagerAlerts()]);
    } catch (error) { adminPasswordInput.value = ''; modalError(error.message); }
    finally { if (button.isConnected) button.disabled = false; }
  }
  function deleteManagerAccount(id) {
    const manager = state.managers.find((item) => item.id === id); if (!manager) return;
    showModal(`<article class="modal-card modal-small"><div class="modal-header"><div><span class="eyebrow">SUPPRESSION LOGIQUE</span><h2>Supprimer ce compte ?</h2><p>L’accès sera fermé immédiatement. QR, clients, transactions et journal seront conservés.</p></div><button class="modal-close" type="button" data-close-modal aria-label="Fermer">×</button></div><form id="managerDeleteForm" data-id="${esc(id)}"><div class="modal-body"><div class="form-field"><label for="managerDeleteConfirmUsername">Saisissez l’identifiant <strong>${esc(manager.username)}</strong> pour confirmer la suppression</label><input id="managerDeleteConfirmUsername" type="text" autocomplete="off" required></div><div class="form-field"><label for="managerDeleteAdminPassword">Mot de passe actuel du PDG</label><input id="managerDeleteAdminPassword" type="password" autocomplete="current-password" required></div></div><p class="modal-error" id="modalError" role="alert" hidden></p><div class="modal-footer"><div class="modal-footer-actions"><button class="button button-secondary" type="button" data-close-modal>Annuler</button><button class="button button-danger" type="submit">Supprimer logiquement</button></div></div></form></article>`);
  }
  async function submitManagerDelete(form) {
    const manager = state.managers.find((item) => item.id === form.dataset.id);
    if (!manager) return modalError('Gestionnaire introuvable.');
    const confirmUsername = $('#managerDeleteConfirmUsername', modalRoot).value.trim();
    if (confirmUsername.toLowerCase() !== manager.username.toLowerCase()) return modalError('L’identifiant saisi ne correspond pas au compte à supprimer.');
    const adminPasswordInput = $('#managerDeleteAdminPassword', modalRoot);
    const button = $('button[type="submit"]', form); button.disabled = true;
    try {
      await api(`/api/admin/managers/${encodeURIComponent(form.dataset.id)}`, { method: 'DELETE', body: JSON.stringify({ adminPassword: adminPasswordInput.value, confirmUsername }) });
      closeModal(); showToast('Compte supprimé logiquement; QR et journal conservés.');
      await Promise.all([loadManagers(), loadManagerActivities(), loadManagerAlerts()]);
    } catch (error) { adminPasswordInput.value = ''; modalError(error.message); }
    finally { if (button.isConnected) button.disabled = false; }
  }
  async function openCodeAssignment(id) {
    try {
      const [codeResult, managerResult] = await Promise.all([api(`/api/admin/codes/${encodeURIComponent(id)}`), api('/api/admin/managers')]);
      state.managers = managerResult.data || [];
      const code = codeResult.data;
      const options = state.managers.filter((m) => !m.deletedAt && m.status === 'active').map((m) => `<option value="${esc(m.id)}"${code.managerId === m.id ? ' selected' : ''}>${esc(m.displayName)} (@${esc(m.username)})</option>`).join('');
      showModal(`<article class="modal-card modal-small"><div class="modal-header"><div><span class="eyebrow">ATTRIBUTION D’ACCÈS</span><h2>Réattribuer un QR</h2><p>${esc(code.name)} · ${esc(code.beneficiaryName)}</p></div><button class="modal-close" type="button" data-close-modal aria-label="Fermer">×</button></div><form id="codeAssignmentForm" data-id="${esc(id)}"><div class="modal-body"><div class="form-field"><label for="assignmentManager">Gestionnaire actif</label><select id="assignmentManager"><option value="">Aucun gestionnaire — espace PDG uniquement</option>${options}</select><span class="hint">Un QR est attribué à un seul compte gestionnaire à la fois. Le PDG conserve toujours l’accès.</span></div></div><p class="modal-error" id="modalError" role="alert" hidden></p><div class="modal-footer"><div class="modal-footer-actions"><button class="button button-secondary" type="button" data-close-modal>Annuler</button><button class="button button-primary" type="submit">Enregistrer l’attribution</button></div></div></form></article>`);
    } catch (error) { showToast(error.message); }
  }
  async function submitCodeAssignment(form) {
    const managerId = $('#assignmentManager', modalRoot).value;
    if (!window.confirm(managerId ? 'Confirmer l’attribution du QR à ce gestionnaire ?' : 'Retirer l’attribution gestionnaire ? Le QR restera accessible au PDG.')) return;
    const button = $('button[type="submit"]', form); button.disabled = true;
    try {
      await api(`/api/admin/codes/${encodeURIComponent(form.dataset.id)}/assignment`, { method: 'PATCH', body: JSON.stringify({ managerId }) });
      closeModal(); showToast('Attribution du QR mise à jour.'); await Promise.all([loadCodes(), loadManagerActivities(), loadManagerAlerts()]);
    } catch (error) { modalError(error.message); }
    finally { if (button.isConnected) button.disabled = false; }
  }
  function populateManagerActivityFilter() {
    const select = $('#managerActivityManagerFilter'); if (!select) return;
    const selected = select.value;
    select.innerHTML = '<option value="">Tous les gestionnaires</option>' + state.managers.map((m) => `<option value="${esc(m.id)}">${esc(m.displayName)} (@${esc(m.username)})${m.deletedAt ? ' · supprimé' : ''}</option>`).join('');
    if ([...select.options].some((o) => o.value === selected)) select.value = selected;
  }
  function managerActivityParams() {
    const params = new URLSearchParams({ page: String(state.managerActivityPage), limit: '30' });
    const map = { managerId: '#managerActivityManagerFilter', action: '#managerActivityAction', result: '#managerActivityResult', entityType: '#managerActivityEntity', search: '#managerActivitySearch', since: '#managerActivitySince', until: '#managerActivityUntil' };
    for (const [key, selector] of Object.entries(map)) { const value = $(selector)?.value?.trim(); if (value) params.set(key, value); }
    return params;
  }
  function activityActionLabel(action) {
    return ({ login_success: 'Connexion réussie', login_failure: 'Échec de connexion', logout: 'Déconnexion', password_reset: 'Mot de passe réinitialisé', password_change: 'Nouveau mot de passe choisi', session_revoked: 'Sessions révoquées', create: 'Création', update: 'Modification', delete: 'Suppression', activate: 'Activation', deactivate: 'Désactivation', block: 'Blocage', unblock: 'Déblocage', suspend: 'Suspension', reactivate: 'Réactivation', status_change: 'Changement de statut', authorization_denied: 'Refus d’accès', action_failure: 'Échec d’opération', stats_view: 'Consultation des statistiques', view: 'Consultation', download_png: 'Téléchargement PNG', download_svg: 'Téléchargement SVG', share: 'Partage', print: 'Impression', assignment: 'Attribution / réattribution', custom_domain_change: 'Modification du sous-domaine', request_validation: 'Soumission à validation', reject: 'Refus QR', manager_message: 'Message du PDG' })[action] || action;
  }
  function renderManagerActivities(rows) {
    const target = $('#managerActivityList');
    if (!rows.length) { target.innerHTML = '<div class="manager-empty">Aucune activité ne correspond aux filtres sélectionnés.</div>'; return; }
    target.innerHTML = rows.map((row) => {
      const resultClass = row.result === 'denied' ? 'denied' : row.result === 'failure' ? 'failure' : '';
      const managerRecord = row.managerId ? state.managers.find((manager) => manager.id === row.managerId) : null;
      const managerLabel = managerRecord ? `${managerRecord.displayName} (@${managerRecord.username})` : String(row.managerId || '');
      const entityLabel = row.entityType === 'qr_code' ? 'QR code' : row.entityType === 'beneficiary' ? 'Bénéficiaire' : row.entityType === 'manager' ? 'Compte gestionnaire' : row.entityType === 'statistics' ? 'Statistiques' : row.entityType === 'authentication' ? 'Authentification' : row.entityType === 'admin_api' ? 'API PDG' : row.entityType;
      const link = ['qr_code', 'beneficiary'].includes(row.entityType) ? `<button type="button" data-action="manager-activity-entity" data-type="${esc(row.entityType)}" data-id="${esc(row.entityId)}">Ouvrir ${entityLabel.toLowerCase()} · ${esc(String(row.entityId).slice(0, 12))}</button>` : '';
      const diff = row.beforeData || row.afterData ? `<details class="manager-activity-diff"><summary>Voir le diff non secret</summary><pre>Avant\n${esc(row.beforeData ? JSON.stringify(row.beforeData, null, 2) : '—')}\n\nAprès\n${esc(row.afterData ? JSON.stringify(row.afterData, null, 2) : '—')}</pre></details>` : '';
      return `<article class="manager-activity-row"><span class="manager-activity-mark ${resultClass}">${row.result === 'denied' || row.result === 'failure' ? '!' : '•'}</span><div class="manager-activity-copy"><strong>${esc(activityActionLabel(row.action))} · ${esc(row.summary)}</strong><p>${esc(row.actor || 'Gestionnaire')} · ${esc(entityLabel)} · résultat : ${esc(row.result || 'success')}${row.managerId ? ` · gestionnaire ${esc(managerLabel)}` : ''}</p>${link}${diff}</div><time>${esc(fmtDate(row.createdAt, true))}</time></article>`;
    }).join('');
  }
  async function loadManagerActivities() {
    if (!state.managers.length) { try { const managers = await api('/api/admin/managers'); state.managers = managers.data || []; populateManagerActivityFilter(); } catch (_) {} }
    const result = await api(`/api/admin/manager-activities?${managerActivityParams()}`);
    state.managerActivityTotal = result.total; renderManagerActivities(result.data || []);
    $('#managerActivityCount').textContent = `${number(result.total)} événement${Number(result.total) === 1 ? '' : 's'}`;
    fillPagination('#managerActivityPrev', '#managerActivityNext', '#managerActivityPageLabel', state.managerActivityPage, result.total, 30);
    await loadManagerAlerts().catch((error) => showToast(error.message));
  }
  async function loadManagerAlerts() {
    const [settings, alerts] = await Promise.all([api('/api/admin/manager-activity-settings'), api('/api/admin/manager-alerts')]);
    state.managerActivityAlerts = settings.data || {};
    $$('input[name="managerAlert"]', document).forEach((input) => { input.checked = Boolean(state.managerActivityAlerts[input.value]); });
    const target = $('#managerAlertList');
    if (!alerts.data?.length) target.innerHTML = '<div class="manager-empty">Aucun événement correspondant aux alertes activées.</div>';
    else target.innerHTML = alerts.data.slice(0, 8).map((row) => {
      const manager = row.managerId ? state.managers.find((item) => item.id === row.managerId) : null;
      const affected = manager ? ` · gestionnaire concerné : ${manager.displayName} (@${manager.username})` : '';
      return `<div class="manager-alert-row"><span class="manager-alert-dot"></span><span><strong>${esc(activityActionLabel(row.action))}</strong> · ${esc(row.summary)}<br><small>${esc(row.actor || 'Gestionnaire')}${esc(affected)} · ${esc(fmtDate(row.createdAt, true))}</small></span></div>`;
    }).join('');
  }
  async function saveManagerAlerts() {
    const payload = {};
    $$('input[name="managerAlert"]', document).forEach((input) => { payload[input.value] = input.checked; });
    try { await api('/api/admin/manager-activity-settings', { method: 'PUT', body: JSON.stringify(payload) }); showToast('Configuration des alertes enregistrée.'); await loadManagerAlerts(); }
    catch (error) { showToast(error.message); }
  }
  function exportManagerActivities() {
    const params = managerActivityParams(); params.delete('page'); params.delete('limit');
    window.location.href = `/api/admin/manager-activities/export.csv?${params}`;
  }
  async function openManagerActivityEntity(type, id) {
    if (type === 'qr_code') return handleCodeAction('preview', id);
    if (type === 'beneficiary') return openBeneficiaryForm(id);
  }
  function handleManagerTableAction(action, id) {
    if (action === 'manager-view-codes') { state.managerCodeFilter = id; if ($('#managerCodeFilter')) $('#managerCodeFilter').value = id; setView('codes'); return; }
    if (action === 'manager-view-activities') { loadManagers().then(() => { if ($('#managerActivityManagerFilter')) $('#managerActivityManagerFilter').value = id; state.managerActivityPage = 1; setView('manager-activity'); }).catch((error) => showToast(error.message)); return; }
    if (action === 'manager-edit') return openManagerForm(id);
    if (action === 'manager-message') return openManagerMessage(id);
    if (action === 'manager-reset') return openManagerPasswordReset(id);
    if (action === 'manager-revoke-sessions') return openManagerSessionRevocation(id);
    if (action === 'manager-suspend') return changeManagerStatus(id, 'suspended');
    if (action === 'manager-block') return changeManagerStatus(id, 'blocked');
    if (action === 'manager-activate') return changeManagerStatus(id, 'active');
    if (action === 'manager-delete') return deleteManagerAccount(id);
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
      if (auth.authenticated && auth.role === 'manager') { window.location.replace('/manager'); return; }
      if (auth.authenticated && auth.role === 'admin') showApp(); else showLogin();
    } catch (_) { showLogin(); }
  }

  // Login and session controls.
  $('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('button[type="submit"]', event.currentTarget);
    const error = $('#loginError');
    error.hidden = true; button.disabled = true;
    try {
      const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: $('#adminUsername').value.trim(), password: $('#adminPassword').value }) });
      $('#adminPassword').value = '';
      if (result.role === 'manager') { window.location.replace('/manager'); return; }
      if (result.role !== 'admin') throw new Error('Type de compte non reconnu.');
      showApp();
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
    if (button.dataset.view === 'codes') { state.codeBeneficiaryId = ''; state.managerCodeFilter = ''; if ($('#managerCodeFilter')) $('#managerCodeFilter').value = ''; $('#codeSearch').value = ''; state.codeSearch = ''; }
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
  $('#reviewPendingCodes').addEventListener('click', () => { state.codeStatus = 'pending_validation'; state.codePage = 1; state.codeSearch = ''; state.codeCategory = ''; state.managerCodeFilter = ''; state.codeBeneficiaryId = ''; $('#codeSearch').value = ''; $('#categoryFilter').value = ''; $('#managerCodeFilter').value = ''; $('#statusFilter').value = 'pending_validation'; setView('codes'); });
  $('#overviewBeneficiaryButton').addEventListener('click', () => openBeneficiaryForm());
  $('#createBeneficiaryButton').addEventListener('click', () => openBeneficiaryForm());
  $('#quickCreateBeneficiary').addEventListener('click', () => openBeneficiaryForm());
  $('#quickCreateCode').addEventListener('click', () => $('#topCreateButton').click());
  $('#categoryManagerButton').addEventListener('click', () => openCategoryManager().catch((error) => showToast(error.message)));

  // Server-side search, filters, and pagination.
  $('#codeSearch').addEventListener('input', () => { state.codeBeneficiaryId = ''; clearTimeout(codeSearchTimer); codeSearchTimer = setTimeout(() => { state.codeSearch = $('#codeSearch').value.trim(); state.codePage = 1; loadCodes().catch((error) => showToast(error.message)); }, 240); });
  $('#categoryFilter').addEventListener('change', () => { state.codeBeneficiaryId = ''; state.codeCategory = $('#categoryFilter').value; state.codePage = 1; loadCodes().catch((error) => showToast(error.message)); });
  $('#statusFilter').addEventListener('change', () => { state.codeBeneficiaryId = ''; state.codeStatus = $('#statusFilter').value; state.codePage = 1; loadCodes().catch((error) => showToast(error.message)); });
  $('#managerCodeFilter').addEventListener('change', () => { state.codeBeneficiaryId = ''; state.managerCodeFilter = $('#managerCodeFilter').value; state.codePage = 1; loadCodes().catch((error) => showToast(error.message)); });
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
  $('#createManagerButton').addEventListener('click', () => openManagerForm());
  $('#managerTableBody').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]'); if (button) handleManagerTableAction(button.dataset.action, button.dataset.id);
  });
  $('#managerActivityList').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="manager-activity-entity"]');
    if (button) openManagerActivityEntity(button.dataset.type, button.dataset.id).catch((error) => showToast(error.message));
  });
  $('#managerActivitySearch').addEventListener('input', () => {
    clearTimeout(state.managerActivitySearchTimer);
    state.managerActivitySearchTimer = setTimeout(() => { state.managerActivityPage = 1; loadManagerActivities().catch((error) => showToast(error.message)); }, 250);
  });
  ['managerActivityManagerFilter','managerActivityAction','managerActivityResult','managerActivityEntity','managerActivitySince','managerActivityUntil'].forEach((id) => {
    $(`#${id}`).addEventListener('change', () => { state.managerActivityPage = 1; loadManagerActivities().catch((error) => showToast(error.message)); });
  });
  $('#managerActivityPrev').addEventListener('click', () => { if (state.managerActivityPage > 1) { state.managerActivityPage -= 1; loadManagerActivities().catch((error) => showToast(error.message)); } });
  $('#managerActivityNext').addEventListener('click', () => { if (state.managerActivityPage < pageCount(state.managerActivityTotal, 30)) { state.managerActivityPage += 1; loadManagerActivities().catch((error) => showToast(error.message)); } });
  $('#saveManagerAlerts').addEventListener('click', saveManagerAlerts);
  $('#exportManagerActivity').addEventListener('click', exportManagerActivities);
  $('#addFinancePlan').addEventListener('click', () => openFinancePlanForm());
  $('#financePricingRows').addEventListener('click', (event) => { const button = event.target.closest('[data-finance-action]'); if (button) Promise.resolve(handleFinanceAction(button.dataset.financeAction, button.dataset.id)).catch((error) => showToast(error.message)); });
  $('#financeOrderRows').addEventListener('click', (event) => { const button = event.target.closest('[data-finance-action]'); if (button) Promise.resolve(handleFinanceAction(button.dataset.financeAction, button.dataset.id)).catch((error) => showToast(error.message)); });
  $('#financeApplyFilters').addEventListener('click', () => { state.financeFilters = readFinanceFilters(); state.financePage = 1; Promise.all([loadFinanceDashboard(), loadFinanceOrders()]).catch((error) => showToast(error.message)); });
  $('#financeRefresh').addEventListener('click', () => loadFinance().catch((error) => showToast(error.message)));
  $('#financeExport').addEventListener('click', exportFinanceCsv);
  $('#cashReportApply').addEventListener('click',()=>{state.cashReportFilters=readCashReportFilters();state.cashReportPage=1;loadCashReport().catch((error)=>showToast(error.message));});
  $('#cashReportExport').addEventListener('click',exportCashReportCsv);
  $('#cashPaymentRows').addEventListener('click',(event)=>{const button=event.target.closest('[data-finance-action]');if(button)Promise.resolve(handleFinanceAction(button.dataset.financeAction,button.dataset.id,button.dataset.orderId)).catch((error)=>showToast(error.message));});
  $('#cashPaymentsPrev').addEventListener('click',()=>{if(state.cashReportPage>1){state.cashReportPage-=1;loadCashReport().catch((error)=>showToast(error.message));}});
  $('#cashPaymentsNext').addEventListener('click',()=>{if(state.cashReportPage<pageCount(state.cashPaymentTotal,25)){state.cashReportPage+=1;loadCashReport().catch((error)=>showToast(error.message));}});
  $('#financePrev').addEventListener('click', () => { if (state.financePage > 1) { state.financePage -= 1; loadFinanceOrders().catch((error) => showToast(error.message)); } });
  $('#financeNext').addEventListener('click', () => { if (state.financePage < pageCount(state.financeOrderTotal, 25)) { state.financePage += 1; loadFinanceOrders().catch((error) => showToast(error.message)); } });

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
  modalRoot.addEventListener('click', async (event) => {
    if (event.target === modalRoot || event.target.closest('[data-close-modal]')) { closeModal(); return; }
    const copyManagerSecretButton = event.target.closest('[data-copy-manager-secret]');
    if (copyManagerSecretButton) {
      const value = copyManagerSecretButton.dataset.copyManagerSecret === 'temporary'
        ? $('#managerTemporaryPassword', modalRoot)?.textContent || '' : $('#managerResetLinkValue', modalRoot)?.value || '';
      try { await navigator.clipboard.writeText(value); showToast('Secret copié. Transmettez-le uniquement au gestionnaire concerné.'); }
      catch (_) { showToast('Copiez le secret affiché manuellement.'); }
      return;
    }
    if (event.target.closest('#removeManagerAvatar')) {
      const form = $('#managerForm', modalRoot); if (!form) return;
      $('#managerAvatarData', modalRoot).value = ''; form.dataset.avatarEdited = 'true';
      $('#managerAvatarPreview', modalRoot).removeAttribute('src'); $('#managerAvatarPreview', modalRoot).hidden = true;
      $('#managerAvatarFallback', modalRoot).hidden = false; return;
    }
    if (event.target.closest('[data-add-finance-option]')) { addFinanceOptionRow(); return; }
    if (event.target.closest('[data-remove-finance-option]')) { event.target.closest('[data-finance-option-row]')?.remove(); return; }
    const financeButton = event.target.closest('[data-finance-action]');
    if (financeButton) { Promise.resolve(handleFinanceAction(financeButton.dataset.financeAction, financeButton.dataset.id, financeButton.dataset.orderId)).catch((error) => showToast(error.message)); return; }
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const code = state.previewCode;
    switch (button.dataset.action) {
      case 'copy-modal': if (code) copyCodeLink(code); break;
      case 'png-modal': if (code) downloadCode(code, 'png'); break;
      case 'svg-modal': if (code) downloadCode(code, 'svg'); break;
      case 'print-modal': if (code) printCode(code); break;
      case 'edit-modal': if (code) openQrForm(code.id); break;
      case 'select-all-qr-photos': $$('#qrPhotoOptions input[name="selectedPhotoIds"]', modalRoot).forEach((input) => { input.checked = true; }); break;
      case 'clear-qr-photos': $$('#qrPhotoOptions input[name="selectedPhotoIds"]', modalRoot).forEach((input) => { input.checked = false; }); break;
    }
  });
  modalRoot.addEventListener('submit', (event) => {
    event.preventDefault();
    if (event.target.id === 'beneficiaryForm') submitBeneficiary(event.target);
    if (event.target.id === 'qrForm') submitQr(event.target);
    if (event.target.id === 'categoryForm') submitCategory(event.target);
    if (event.target.id === 'managerForm') submitManagerForm(event.target);
    if (event.target.id === 'managerMessageForm') submitManagerMessage(event.target);
    if (event.target.id === 'managerResetForm') submitManagerPasswordReset(event.target);
    if (event.target.id === 'managerRevokeSessionsForm') submitManagerSessionRevocation(event.target);
    if (event.target.id === 'managerStatusChangeForm') submitManagerStatusChange(event.target);
    if (event.target.id === 'managerDeleteForm') submitManagerDelete(event.target);
    if (event.target.id === 'codeAssignmentForm') submitCodeAssignment(event.target);
    if (event.target.id === 'financePricingForm') submitFinancePlan(event.target);
    if (event.target.id === 'financeCorrectionForm') submitFinanceCorrection(event.target);
    if (event.target.id === 'financeCancelForm') submitFinanceCancel(event.target);
    if (event.target.id === 'financeRefundForm') submitFinanceRefund(event.target);
    if (event.target.id === 'cashCorrectionForm') submitCashCorrection(event.target);
  });
  modalRoot.addEventListener('change', async (event) => {
    if (event.target.id === 'managerAvatarFile') {
      const file = event.target.files?.[0]; const form = $('#managerForm', modalRoot); if (!file || !form) return;
      const submit = $('button[type="submit"]', form); if (submit) submit.disabled = true;
      try {
        const data = await squareManagerAvatarFile(file);
        $('#managerAvatarData', modalRoot).value = data; form.dataset.avatarEdited = 'true';
        $('#managerAvatarPreview', modalRoot).src = data; $('#managerAvatarPreview', modalRoot).hidden = false; $('#managerAvatarFallback', modalRoot).hidden = true;
        showToast('Photo recadrée au carré. Enregistrez le compte pour appliquer la modification.');
      } catch (error) { modalError(error.message); }
      finally { event.target.value = ''; if (submit?.isConnected) submit.disabled = false; }
    }
    if (event.target.id === 'beneLogoFile') {
      const file = event.target.files?.[0];
      if (!file) return;
      const session = beginImageProcessing();
      try {
        const data = await fileToDataUrl(file);
        if (session !== state.imageUploadSession) return;
        $('#beneLogoData', modalRoot).value = data;
        $('#beneLogoUrl', modalRoot).value = '';
        $('#logoPreview', modalRoot).src = data;
        $('#logoPreviewWrap', modalRoot).hidden = false;
        showToast('Photo principale optimisée et prête à être enregistrée.');
      } catch (error) {
        if (session === state.imageUploadSession) modalError(error.message);
      } finally {
        event.target.value = '';
        endImageProcessing(session);
      }
    }
    if (event.target.id === 'benePhotoFiles') {
      const files = [...(event.target.files || [])];
      if (!files.length) return;
      if ((state.currentBeneficiaryPhotos || []).length + files.length > 8) { modalError('Vous pouvez enregistrer au maximum 8 photos.'); event.target.value = ''; return; }
      const session = beginImageProcessing();
      try {
        const optimized = [];
        for (const file of files) optimized.push({ id: newPhotoId(), src: await optimizePhotoFile(file), alt: file.name.replace(/\.[^.]+$/, '') });
        if (session !== state.imageUploadSession) return;
        state.currentBeneficiaryPhotos = [...(state.currentBeneficiaryPhotos || []), ...optimized];
        renderBeneficiaryPhotoEditor();
        showToast('Photos ajoutées et optimisées. Enregistrez le bénéficiaire pour les conserver.');
      } catch (error) {
        if (session === state.imageUploadSession) modalError(error.message);
      } finally {
        event.target.value = '';
        endImageProcessing(session);
      }
    }
  });
  modalRoot.addEventListener('input', (event) => {
    if (event.target.id === 'managerCustomDomain') {
      const form = $('#managerForm', modalRoot);
      const stepUp = $('#managerDomainStepUp', modalRoot);
      if (form && stepUp) {
        const changed = event.target.value.trim().toLowerCase() !== String(form.dataset.originalDomain || '').trim().toLowerCase();
        stepUp.hidden = !changed;
        $('#managerDomainConfirmUsername', stepUp).required = changed;
        $('#managerDomainAdminPassword', stepUp).required = changed;
      }
    }
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
