(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { manager: null, publicBaseUrl: '', view: 'overview', categories: [], beneficiaryPage: 1, beneficiaryTotal: 0, beneficiarySearch: '', beneficiaryStatus: '', codePage: 1, codeTotal: 0, codeSearch: '', codeStatus: '', codeBeneficiaryId: '', statsPeriod: 'all', photos: [], logo: '', previewCode: null, installToken: '', profileAvatarData: '', resetToken: '', pricingPlans: [], pricingLoading: false, pricingRequestId: 0, orderPage: 1, orderTotal: 0, orderSearch: '', orderStatus: '' };
  const loginView = $('#loginView');
  const passwordGateView = $('#managerPasswordGate');
  const appView = $('#managerApp');
  const modal = $('#managerModal');
  const toast = $('#managerToast');
  const typeLabels = { individual: 'Particulier', business: 'Entreprise', commerce: 'Commerce', organization: 'Organisation', other: 'Autre' };
  const categoryByType = { individual: 'cat-individuals', business: 'cat-businesses', commerce: 'cat-shops', organization: 'cat-organizations', other: 'cat-other' };
  const fields = [['logo','Logo / photo'],['phone','Téléphone'],['whatsapp','WhatsApp'],['email','E-mail'],['address','Adresse'],['locationUrl','Localisation'],['website','Site Internet'],['socials','Réseaux sociaux'],['bio','Présentation'],['offers','Produits / services'],['documents','Documents']];
  let toastTimer, searchTimer;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = (v) => new Intl.NumberFormat('fr-FR').format(Number(v) || 0);
  const xof = (v) => `${number(v)} XOF`;
  const date = (v, time = false) => { if (!v) return '—'; const d = new Date(v); return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('fr-FR', time ? {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'} : {day:'2-digit',month:'short',year:'numeric'}).format(d); };
  const pageCount = (total, limit) => Math.max(1, Math.ceil((Number(total) || 0) / limit));
  const api = async (url, options = {}) => {
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && !url.includes('/api/manager/auth/login') && !url.includes('/api/auth/login')) {
      showLogin();
      throw new Error(data.error || 'Votre session est expirée. Reconnectez-vous.');
    }
    if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
    return data;
  };
  function showToast(message) { toast.textContent = message; toast.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('visible'), 2800); }
  function setLoginPasswordVisible(visible) {
    const input = $('#managerPassword'); const button = $('#toggleManagerPassword');
    if (!input || !button) return;
    input.type = visible ? 'text' : 'password';
    button.textContent = visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe';
    button.setAttribute('aria-pressed', String(Boolean(visible)));
  }
  function showLogin(message = '') {
    appView.hidden = true; passwordGateView.hidden = true; loginView.hidden = false; state.resetToken = '';
    $('#managerPassword').value = ''; setLoginPasswordVisible(false); $('#managerNewPassword').value = ''; $('#managerConfirmNewPassword').value = '';
    const error = $('#managerLoginError'); error.textContent = message; error.hidden = !message;
    setTimeout(() => $('#managerUsername').focus(), 0);
  }
  function showPasswordGate(manager = null, resetToken = '') {
    state.manager = manager || state.manager; state.resetToken = resetToken;
    loginView.hidden = true; appView.hidden = true; passwordGateView.hidden = false;
    const resetLinkMode = Boolean(resetToken);
    $('#managerPasswordGateTitle').textContent = resetLinkMode ? 'Définir un nouveau mot de passe' : 'Choisissez un nouveau mot de passe';
    $('#managerPasswordGateMessage').textContent = resetLinkMode
      ? 'Ce lien sécurisé vous permet de définir votre mot de passe personnel. Il ne peut être utilisé qu’une seule fois.'
      : 'Le mot de passe temporaire vous donne uniquement accès à cette étape. Remplacez-le avant de continuer.';
    $('#managerPasswordGateLogout').hidden = resetLinkMode;
    $('#managerNewPassword').value = ''; $('#managerConfirmNewPassword').value = '';
    const error = $('#managerPasswordGateError'); error.textContent = ''; error.hidden = true;
    setTimeout(() => $('#managerNewPassword').focus(), 0);
  }
  async function showApp(manager) {
    state.manager = manager || state.manager;
    loginView.hidden = true; passwordGateView.hidden = true; appView.hidden = false;
    $('#managerName').textContent = state.manager?.displayName || 'Gestionnaire';
    $('#managerUsernameLabel').textContent = `@${state.manager?.username || ''}`;
    setAvatar(state.manager?.avatarData || '');
    try {
      const [categories, profile] = await Promise.all([api('/api/manager/categories'), api('/api/manager/profile')]);
      state.categories = categories.data || []; state.manager = profile.data || state.manager;
      setAvatar(state.manager?.avatarData || '');
      $('#profileDisplayName').textContent = state.manager?.displayName || 'Gestionnaire';
      applyManagerPermissions(); applyDisplayPreferences();
      state.installToken = String(state.manager?.installPath || '').split('/').pop() || state.installToken;
      updateInstallBranding(state.manager?.installPath || '');
      setView('overview', false);
      await Promise.all([loadDashboard(), loadBeneficiaries(), loadCodes(), loadNotifications(), loadManagerSecurityActivity()]);
    } catch (error) { showToast(error.message); }
  }
  function setAvatar(dataUrl) {
    const image = $('#managerAvatarImage'); const initial = $('#managerAvatarInitial');
    if (dataUrl && image) { image.src = dataUrl; image.hidden = false; initial.hidden = true; }
    else if (image && initial) { const token=String(state.manager?.installPath||'').split('/').pop();image.src=token?`/api/manager/install/${encodeURIComponent(token)}/icon`:'/icons/qria-192.png';image.hidden=false;initial.hidden=true; }
  }
  function setView(view, load = true) {
    if (!['overview','beneficiaries','codes','statistics','orders','notifications','profile'].includes(view)) view = 'overview';
    state.view = view;
    $$('.view').forEach((el) => { el.hidden = el.id !== `view-${view}`; });
    $$('.nav-link').forEach((el) => el.classList.toggle('active', el.dataset.view === view));
    const titles = { overview:'Vue d’ensemble', beneficiaries:'Bénéficiaires', codes:'Codes QR', statistics:'Statistiques', orders:'Commandes et paiements', notifications:'Notifications et messages', profile:'Mon profil et paramètres' };
    $('#managerPageTitle').textContent = titles[view]; $('#managerSidebar').classList.remove('open');
    if (!load) return;
    if (view === 'overview') loadDashboard().catch((e) => showToast(e.message));
    if (view === 'beneficiaries') loadBeneficiaries().catch((e) => showToast(e.message));
    if (view === 'codes') loadCodes().catch((e) => showToast(e.message));
    if (view === 'statistics') loadStats().catch((e) => showToast(e.message));
    if (view === 'orders') loadOrders().catch((e) => showToast(e.message));
    if (view === 'notifications') loadNotifications().catch((e) => showToast(e.message));
    if (view === 'profile') loadProfile().catch((e) => showToast(e.message));
  }
  function fillPage(prev, next, label, page, total, limit) {
    const max = pageCount(total, limit); $(label).textContent = `Page ${page} / ${max}`; $(prev).disabled = page <= 1; $(next).disabled = page >= max;
  }
  async function loadDashboard() {
    const data = await api('/api/manager/dashboard');
    $('#statBeneficiaries').textContent = number(data.stats.beneficiaries);
    $('#statActiveCodes').textContent = number(data.stats.activeCodes);
    $('#statTotalCodes').textContent = number(data.stats.totalCodes);
    $('#statDraftCodes').textContent = number(data.stats.draftCodes);
    $('#statPendingCodes').textContent = number(data.stats.pendingCodes);
    $('#statSuspendedCodes').textContent = number(data.stats.suspendedCodes);
    $('#statRejectedCodes').textContent = number(data.stats.rejectedCodes);
    $('#statScans').textContent = number(data.stats.scans);
    $('#statScansWeek').textContent = number(data.stats.scansLast7);
    const recent = $('#recentCodes');
    recent.innerHTML = data.recentCodes?.length ? data.recentCodes.map((row) => `<button type="button" class="recent-row" data-action="preview" data-id="${esc(row.id)}"><span class="recent-icon">▦</span><span class="recent-copy"><strong>${esc(row.name)}</strong><small>${esc(row.beneficiaryName)} · ${qrStatusLabel(row.status)} · ${number(row.scanCount)} scans</small></span></button>`).join('') : '<p class="muted">Aucun QR ne vous est encore attribué.</p>';
    state.notificationUnread = Number(data.unreadNotifications) || 0; updateNotificationBadge();
    renderNotificationList(data.notifications || [], $('#dashboardNotifications'), true);
    renderRecentActivity(data.recentActivity || [], $('#dashboardActivity'));
  }
  async function loadBeneficiaries() {
    const params = new URLSearchParams({ page:String(state.beneficiaryPage), limit:'12' });
    if (state.beneficiarySearch) params.set('search', state.beneficiarySearch);
    if (state.beneficiaryStatus) params.set('status', state.beneficiaryStatus);
    const result = await api(`/api/manager/beneficiaries?${params}`); state.beneficiaryTotal = result.total;
    const list = $('#beneficiaryList');
    list.innerHTML = result.data.length ? result.data.map((row) => {
      const blocked = row.status === 'blocked';
      return `<article class="bene-card"><div class="bene-top"><span class="bene-avatar">${row.logo ? `<img src="${esc(row.logo)}" alt="">` : esc(String(row.name || '?').trim().slice(0,1).toLocaleUpperCase('fr'))}</span><span class="bene-info"><strong>${esc(row.name)}</strong><small>${esc(typeLabels[row.type] || 'Autre')}${row.email ? ` · ${esc(row.email)}` : ''}</small></span><span class="pill ${blocked ? 'blocked' : ''}">${blocked ? 'Bloqué' : 'Actif'}</span></div><div class="bene-details"><span>${number(row.qrCount)} QR attribué${Number(row.qrCount) === 1 ? '' : 's'}</span><span>Modifié ${esc(date(row.updatedAt))}</span></div><div class="bene-actions"><button type="button" class="mini-button" data-action="edit-beneficiary" data-id="${esc(row.id)}">Modifier</button><button type="button" class="mini-button" data-action="bene-codes" data-id="${esc(row.id)}">Voir ses QR</button><button type="button" class="mini-button ${blocked ? '' : 'danger'}" data-action="${blocked ? 'unblock-beneficiary' : 'block-beneficiary'}" data-id="${esc(row.id)}" data-name="${esc(row.name)}">${blocked ? 'Réactiver' : 'Bloquer'}</button><button type="button" class="mini-button danger" data-action="delete-beneficiary" data-id="${esc(row.id)}" data-name="${esc(row.name)}">Supprimer</button></div></article>`;
    }).join('') : '<article class="panel"><p class="muted">Aucun bénéficiaire trouvé dans votre espace.</p></article>';
    fillPage('#beneficiariesPrev','#beneficiariesNext','#beneficiariesPage',state.beneficiaryPage,result.total,12);
  }
  async function loadCodes() {
    const params = new URLSearchParams({ page:String(state.codePage), limit:'20' });
    if (state.codeSearch) params.set('search', state.codeSearch);
    if (state.codeStatus) params.set('status', state.codeStatus);
    if (state.codeBeneficiaryId) params.set('beneficiaryId', state.codeBeneficiaryId);
    const result = await api(`/api/manager/codes?${params}`); state.codeTotal = result.total;
    const tbody = $('#codeRows');
    tbody.innerHTML = result.data.length ? result.data.map((row) => {
      const active = row.status === 'active' && row.beneficiaryStatus === 'active' && !row.beneficiaryDeletedAt;
      const status = row.beneficiaryDeletedAt ? 'Bénéficiaire supprimé' : row.beneficiaryStatus === 'blocked' && row.status === 'active' ? 'Bénéficiaire bloqué' : qrStatusLabel(row.status);
      const canEdit = state.manager?.canEditCodes !== false;
      const canActivate = state.manager?.canSelfActivateCodes === true && ['draft', 'pending_validation'].includes(row.status) && !row.beneficiaryDeletedAt && row.beneficiaryStatus === 'active';
      const statusAction = row.status === 'active' ? `<button class="mini-button danger" title="Suspendre ce QR" data-action="toggle-code" data-status="active" data-id="${esc(row.id)}">Suspendre</button>`
        : canActivate ? `<button class="mini-button" title="Activer ce QR selon votre permission" data-action="toggle-code" data-status="${esc(row.status)}" data-id="${esc(row.id)}">Activer</button>` : '';
      return `<tr><td><strong>${esc(row.name)}</strong><small>ID ${esc(row.publicCode)}</small>${row.statusReason ? `<small class="status-reason">Motif : ${esc(row.statusReason)}</small>` : ''}</td><td>${esc(row.beneficiaryName)}<small>${esc(typeLabels[row.beneficiaryType] || 'Autre')}</small></td><td><span class="status-dot ${active ? '' : 'inactive'}">${esc(status)}</span></td><td>${number(row.scanCount)}</td><td><div class="row-actions"><button class="mini-button" title="Aperçu" data-action="preview" data-id="${esc(row.id)}">Voir</button>${canEdit ? `<button class="mini-button" title="Modifier" data-action="edit" data-id="${esc(row.id)}">Modifier</button>` : ''}<button class="mini-button" title="Télécharger PNG" data-action="png" data-id="${esc(row.id)}">PNG</button><button class="mini-button" title="Télécharger SVG" data-action="svg" data-id="${esc(row.id)}">SVG</button><button class="mini-button" title="Copier le lien" data-action="copy" data-id="${esc(row.id)}">Lien</button><button class="mini-button" title="Imprimer" data-action="print" data-id="${esc(row.id)}">Imprimer</button>${statusAction}${canEdit ? `<button class="mini-button danger" title="Supprimer" data-action="delete-code" data-id="${esc(row.id)}">Supprimer</button>` : ''}</div></td></tr>`;
    }).join('') : '<tr><td colspan="5">Aucun QR ne vous est attribué pour cette recherche.</td></tr>';
    fillPage('#codesPrev','#codesNext','#codesPage',state.codePage,result.total,20);
  }
  async function loadStats() {
    const result = await api(`/api/manager/scan-stats?period=${encodeURIComponent(state.statsPeriod)}`);
    $('#statsTotal').textContent = `${number(result.total)} scan${Number(result.total) === 1 ? '' : 's'}`;
    const render = (rows, type) => `<table class="stats-table"><tbody>${rows.length ? rows.map((row) => `<tr><td>${esc(row.name)}${type === 'code' ? `<small>${esc(row.beneficiaryName)}</small>` : ''}</td><td>${number(row.scanCount)}</td></tr>`).join('') : '<tr><td>Aucune donnée pour cette période.</td></tr>'}</tbody></table>`;
    $('#statsBeneficiaries').innerHTML = render(result.byBeneficiary || [], 'beneficiary');
    $('#statsCodes').innerHTML = render(result.byCode || [], 'code');
  }
  function orderStatusLabel(status) { return ({ unpaid:'Non payé', pending:'En attente PDG', partial:'Partiel', paid:'Payé', cancelled:'Annulé', refunded:'Remboursé' })[status] || status; }
  async function loadProfile() {
    const result = await api('/api/manager/profile'); state.manager = result.data || state.manager;
    const avatar = state.manager?.avatarData || '';
    state.profileAvatarData = avatar;
    $('#profileDisplayName').textContent = state.manager?.displayName || 'Gestionnaire';
    $('#profileNameInput').value = state.manager?.displayName || '';
    $('#profileEmailInput').value = state.manager?.email || '';
    $('#profilePhoneInput').value = state.manager?.phone || '';
    $('#profileCurrentPassword').value = '';
    const prefs = state.manager?.notificationPreferences || {};
    $('#prefCodeUpdates').checked = prefs.codeUpdates !== false;
    $('#prefValidationResults').checked = prefs.validationResults !== false;
    $('#prefSuspensions').checked = prefs.suspensions !== false;
    $('#prefPdgMessages').checked = prefs.pdgMessages !== false;
    $('#prefSecurityAlerts').checked = prefs.securityAlerts !== false;
    $('#profileAvatarPreview').hidden = !avatar; $('#profileAvatarFallback').hidden = Boolean(avatar);
    if (avatar) $('#profileAvatarPreview').src = avatar; else $('#profileAvatarPreview').removeAttribute('src');
    $('#saveProfileAvatar').disabled = true;
    $('#managerInstallLink').value = `${window.location.origin}${state.manager?.installPath || '/manager'}`;
    const token=String(state.manager?.installPath||'').split('/').pop();$('#profileAvatarFallback').src=token?`/api/manager/install/${encodeURIComponent(token)}/icon`:'/icons/qria-192.png';
    updateInstallBranding(state.manager?.installPath || '');
  }
  function qrStatusLabel(status) {
    return ({ draft: 'Brouillon', pending_validation: 'En attente de validation', active: 'Actif', suspended: 'Suspendu', inactive: 'Suspendu', rejected: 'Refusé' })[status] || 'Inconnu';
  }
  function updateNotificationBadge() {
    const badge = $('#managerNotificationCount');
    badge.textContent = number(state.notificationUnread || 0);
    badge.hidden = !(Number(state.notificationUnread) > 0);
  }
  function applyManagerPermissions() {
    const canCreate = state.manager?.canCreateCodes !== false;
    $$('[data-action="new-code"]').forEach((button) => { button.hidden = !canCreate; button.disabled = !canCreate; });
    $('#createCodeButton')?.toggleAttribute('hidden', !canCreate);
  }
  function applyDisplayPreferences() {
    const id = state.manager?.id || 'anonymous';
    try { state.displayPreferences = JSON.parse(localStorage.getItem(`qria:manager-display:v1:${id}`) || '{}'); } catch (_) { state.displayPreferences = {}; }
    document.body.classList.toggle('manager-compact', state.displayPreferences.compact === true);
    const compact = $('#compactDisplay'); if (compact) compact.checked = state.displayPreferences.compact === true;
  }
  function renderRecentActivity(rows, target) {
    if (!target) return;
    target.innerHTML = rows.length ? rows.slice(0, 8).map((row) => `<article class="manager-recent-row"><span class="manager-recent-mark">◷</span><div><strong>${esc(row.summary || 'Activité QRia')}</strong><small>${esc(row.action)} · ${esc(date(row.createdAt, true))}</small></div></article>`).join('') : '<p class="muted">Aucune activité récente.</p>';
  }
  function notificationVisibleInOverview(row) {
    const prefs = state.manager?.notificationPreferences || {};
    if (row.type === 'pdg_message') return prefs.pdgMessages !== false;
    if (['code_approved', 'code_rejected'].includes(row.type)) return prefs.validationResults !== false;
    if (row.type === 'code_suspended') return prefs.suspensions !== false;
    if (row.type === 'code_update') return prefs.codeUpdates !== false;
    if (row.type === 'security_alert' || row.type === 'account_status') return prefs.securityAlerts !== false;
    return true;
  }
  function renderNotificationList(rows, target, overview = false) {
    if (!target) return;
    const visibleRows = overview ? rows.filter(notificationVisibleInOverview).slice(0, 5) : rows;
    if (!visibleRows.length) { target.innerHTML = '<p class="muted">Aucun message ou événement à afficher.</p>'; return; }
    target.innerHTML = visibleRows.map((row) => `<article class="notification-row ${row.readAt ? '' : 'unread'}"><span class="notification-mark">${row.type === 'pdg_message' ? '✉' : row.type?.startsWith('code_') ? '▦' : '•'}</span><div class="notification-copy"><div class="notification-title"><strong>${esc(row.title)}</strong><small>${esc(date(row.createdAt, true))}</small></div><p>${esc(row.body || '')}</p>${row.entityType === 'qr_code' && row.entityId ? `<button type="button" class="text-button" data-action="notification-code" data-id="${esc(row.entityId)}">Ouvrir le QR →</button>` : ''}</div><button class="mini-button" type="button" data-action="notification-read" data-id="${esc(row.id)}" ${row.readAt ? 'disabled' : ''}>${row.readAt ? 'Lu' : 'Marquer comme lu'}</button></article>`).join('');
  }
  async function loadNotifications() {
    const params = new URLSearchParams({ page: String(state.notificationPage), limit: '20' });
    const result = await api(`/api/manager/notifications?${params}`);
    state.notifications = result.data || []; state.notificationTotal = result.total || 0; state.notificationUnread = result.unread || 0;
    updateNotificationBadge(); renderNotificationList(state.notifications, $('#managerNotificationList'));
    const max = pageCount(state.notificationTotal, 20);
    $('#notificationsPage').textContent = `Page ${state.notificationPage} / ${max}`;
    $('#notificationsPrev').disabled = state.notificationPage <= 1;
    $('#notificationsNext').disabled = state.notificationPage >= max;
  }
  async function markNotificationRead(id) {
    try { await api(`/api/manager/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' }); await Promise.all([loadNotifications(), loadDashboard()]); }
    catch (error) { showToast(error.message); }
  }
  async function loadManagerSecurityActivity() {
    const result = await api('/api/manager/activity?limit=10');
    renderRecentActivity(result.data || [], $('#managerSecurityActivity'));
  }
  async function saveManagerProfile(event) {
    event.preventDefault(); const button = $('button[type="submit"]', event.currentTarget); button.disabled = true;
    try {
      const body = { displayName: $('#profileNameInput').value.trim(), email: $('#profileEmailInput').value.trim(), phone: $('#profilePhoneInput').value.trim(), currentPassword: $('#profileCurrentPassword').value };
      const result = await api('/api/manager/profile', { method: 'PUT', body: JSON.stringify(body) });
      state.manager = result.data; $('#profileCurrentPassword').value = ''; setAvatar(state.manager.avatarData || '');
      await loadProfile(); showToast('Profil enregistré.');
    } catch (error) { showToast(error.message); } finally { if (button.isConnected) button.disabled = false; }
  }
  async function saveManagerPreferences(event) {
    event.preventDefault(); const button = $('button[type="submit"]', event.currentTarget); button.disabled = true;
    try {
      const notificationPreferences = { codeUpdates: $('#prefCodeUpdates').checked, validationResults: $('#prefValidationResults').checked,
        suspensions: $('#prefSuspensions').checked, pdgMessages: $('#prefPdgMessages').checked, securityAlerts: $('#prefSecurityAlerts').checked };
      const result = await api('/api/manager/profile', { method: 'PUT', body: JSON.stringify({ notificationPreferences }) });
      state.manager = result.data;
      state.displayPreferences = { compact: $('#compactDisplay').checked };
      localStorage.setItem(`qria:manager-display:v1:${state.manager.id}`, JSON.stringify(state.displayPreferences));
      applyDisplayPreferences(); await loadDashboard(); showToast('Préférences enregistrées.');
    } catch (error) { showToast(error.message); } finally { if (button.isConnected) button.disabled = false; }
  }
  async function changeAccountPassword(event) {
    event.preventDefault(); const form = event.currentTarget; const button = $('button[type="submit"]', form); button.disabled = true;
    try {
      const result = await api('/api/manager/auth/update-password', { method: 'POST', body: JSON.stringify({ currentPassword: $('#currentPassword').value,
        newPassword: $('#newAccountPassword').value, confirmPassword: $('#confirmAccountPassword').value }) });
      state.manager = result.manager; form.reset(); showToast('Mot de passe modifié; vos autres sessions ont été révoquées.'); await Promise.all([loadManagerSecurityActivity(), loadNotifications()]);
    } catch (error) { showToast(error.message); $('#currentPassword').value = ''; } finally { if (button.isConnected) button.disabled = false; }
  }
  async function revokeAllSessions() {
    if (!window.confirm('Déconnecter immédiatement toutes les sessions QRia ouvertes sur vos appareils ?')) return;
    try { await api('/api/manager/auth/logout', { method: 'POST' }); } catch (_) {}
    showToast('Toutes les sessions ont été révoquées.'); window.location.replace('/manager');
  }
  function openManagerHelp(kind = 'help') {
    const content = {
      help: ['Aide et sécurité', 'Pour un accès bloqué, une limite atteinte ou un QR en attente, contactez le PDG. Le PDG peut réinitialiser votre accès avec un lien à usage unique de 30 minutes ou un mot de passe temporaire de 24 heures. Ne partagez jamais votre mot de passe.'],
      terms: ['Conditions d’utilisation — résumé QRia', 'Utilisez QRia uniquement pour gérer les bénéficiaires et QR qui vous sont attribués. Vérifiez le contenu avant publication; un QR actif peut être consulté par toute personne qui possède son lien. Respectez les droits des personnes concernées et les règles de votre organisation. Pour les conditions officielles, demandez la version publiée au PDG.'],
      privacy: ['Confidentialité — résumé QRia', 'QRia traite les informations de compte, les bénéficiaires, le contenu des QR, les statistiques de scans et un journal de sécurité des opérations. Les permissions limitent votre accès à votre espace. Les durées de conservation, le responsable du traitement et la politique officielle doivent être fournis par votre organisation; contactez le PDG pour les consulter.'],
      forgot: ['Réinitialiser mon mot de passe', 'La réinitialisation est initiée par le PDG après vérification de votre identité. Il peut créer un lien unique valable 30 minutes ou un mot de passe temporaire valable 24 heures. QRia ne peut pas envoyer de courriel automatique dans la configuration actuelle. Ne transmettez jamais votre ancien mot de passe.'],
    }[kind] || ['Aide QRia', 'Contactez le PDG pour obtenir de l’aide.'];
    showModal(`<article class="modal-card small"><header class="modal-head"><div><span class="eyebrow">ESPACE GESTIONNAIRE</span><h2>${esc(content[0])}</h2></div><button class="modal-close" type="button" data-close>×</button></header><div class="modal-body"><p class="muted">${esc(content[1])}</p></div><footer class="modal-foot"><button class="button secondary" type="button" data-close>Fermer</button></footer></article>`);
  }
  function updateInstallBranding(installPath) {
    const token = String(installPath || '').split('/').pop() || state.installToken;
    if (!token || token.length < 24) return;
    state.installToken = token;
    const manifest = $('#managerManifest'); const touch = $('#managerTouchIcon'); const favicon = $('#managerFavicon');
    const manifestPath = `/api/manager/install/${encodeURIComponent(token)}/manifest.webmanifest`;
    if (manifest) manifest.href = manifestPath;
    if (touch) touch.href = '/icons/qria-180.png';
    if (favicon) { favicon.type = 'image/png'; favicon.href = '/icons/qria-favicon.png'; }
    const loginLogo=$('#managerLoginLogo');if(loginLogo){loginLogo.src='/icons/qria-192.png';loginLogo.hidden=false;$('#managerLoginMark').hidden=true;}
  }
  async function squareAvatarFile(file) {
    let image; let release = () => {};
    if (typeof createImageBitmap === 'function') { try { image = await createImageBitmap(file, { imageOrientation:'from-image' }); release = () => image.close?.(); } catch (_) {} }
    if (!image) { const url = URL.createObjectURL(file); image = await new Promise((resolve,reject)=>{ const img=new Image(); img.onload=()=>resolve(img); img.onerror=()=>reject(new Error('Cette image ne peut pas être lue.')); img.src=url; }); release=()=>URL.revokeObjectURL(url); }
    try {
      const width=image.naturalWidth||image.width, height=image.naturalHeight||image.height, side=Math.min(width,height);
      if (!side) throw new Error('Dimensions de photo invalides.');
      const canvas=document.createElement('canvas'); canvas.width=512; canvas.height=512;
      const ctx=canvas.getContext('2d'); if(!ctx) throw new Error('Le navigateur ne peut pas recadrer cette photo.');
      ctx.drawImage(image,(width-side)/2,(height-side)/2,side,side,0,0,512,512);
      for(let quality=.88;quality>=.4;quality-=.08){const data=canvas.toDataURL('image/jpeg',quality);if(data.length<=480000)return data;}
      throw new Error('La photo reste trop volumineuse après recadrage.');
    } finally { release(); }
  }
  async function saveProfileAvatar() {
    const button=$('#saveProfileAvatar'); button.disabled=true;
    try { const result=await api('/api/manager/profile',{method:'PUT',body:JSON.stringify({avatarData:state.profileAvatarData||''})});state.manager=result.data;setAvatar(state.manager.avatarData||'');await loadProfile();showToast('Photo de profil enregistrée.'); }
    catch(error){showToast(error.message);button.disabled=false;}
  }
  async function loadOrders() {
    const params=new URLSearchParams({page:String(state.orderPage),limit:'12'});
    if(state.orderSearch)params.set('search',state.orderSearch);if(state.orderStatus)params.set('status',state.orderStatus);
    const result=await api(`/api/manager/finance/orders?${params}`);state.orderTotal=result.total;
    $('#managerOrderRows').innerHTML=result.data.length?result.data.map((row)=>`<tr><td><strong>${esc(row.reference)}</strong><small>${esc(date(row.createdAt,true))} · ${esc(row.clientName)}</small></td><td>${esc(row.qrName)}<small>${esc(row.pricingPlanName)}</small></td><td>${xof(row.totalAmountXof)}</td><td>${xof(row.netReceivedXof)}</td><td>${xof(row.pendingAmountXof)}</td><td>${xof(row.outstandingXof)}</td><td><span class="order-status ${esc(row.paymentStatus)}">${esc(orderStatusLabel(row.paymentStatus))}</span></td><td><button class="mini-button" type="button" data-action="order-detail" data-id="${esc(row.id)}">Détails</button></td></tr>`).join(''):'<tr><td colspan="8">Aucune commande dans votre espace.</td></tr>';
    fillPage('#managerOrdersPrev','#managerOrdersNext','#managerOrdersPage',state.orderPage,result.total,12);
  }
  async function openOrderDetail(id) {
    const result=await api(`/api/manager/finance/orders/${encodeURIComponent(id)}`);const order=result.data;
    const available=Math.max(0,Number(order.outstandingXof||0)-Number(order.pendingAmountXof||0));
    const payments=order.payments?.length?order.payments.map((p)=>`<div class="order-payment-item"><strong>${esc(p.reference)} · ${xof(p.amountXof)} · ${esc(p.method==='cash'?'Espèces':p.method)}</strong><span> · ${esc(p.entryType==='refund'?'Remboursement':'Paiement')} · Payeur : ${esc(p.clientName||order.clientName)} · ${esc(p.status==='pending'?'En attente PDG':p.status==='confirmed'?'Validé':'Rejeté')} · ${esc(date(p.receivedAt,true))}</span>${p.rejectionReason?`<small>Motif : ${esc(p.rejectionReason)}</small>`:''}</div>`).join(''):'<p class="muted">Aucun paiement déclaré.</p>';
    const history=order.history?.length?order.history.map((e)=>`<div class="order-history-note"><strong>${esc(e.summary)}</strong><br>${esc(date(e.createdAt,true))}</div>`).join(''):'<p class="muted">Aucun événement supplémentaire.</p>';
    showModal(`<article class="modal-card"><header class="modal-head"><div><span class="eyebrow">COMMANDE ${esc(order.reference)}</span><h2>${esc(order.clientName)}</h2><p>${esc(order.companyName||'Client particulier')} · ${esc(order.qrName)} · ${esc(order.pricingPlanName)}</p></div><button class="modal-close" type="button" data-close>×</button></header><div class="modal-body"><div class="form-grid"><div class="price-preview-card"><div class="price-line"><span>Prix unitaire</span><strong>${xof(order.unitAmountXof)}</strong></div>${(order.selectedOptions||[]).map((o)=>`<div class="price-line"><span>${esc(o.name)}</span><strong>${xof(o.amountXof)}</strong></div>`).join('')}<div class="price-line total"><span>Total à payer</span><strong>${xof(order.totalAmountXof)}</strong></div><div class="price-line"><span>Encaissé net validé</span><strong>${xof(order.netReceivedXof)}</strong></div><div class="price-line"><span>Déclaré en attente de validation</span><strong>${xof(order.pendingAmountXof)}</strong></div><div class="price-line"><span>Solde restant</span><strong>${xof(order.outstandingXof)}</strong></div><div class="price-line"><span>Mode initial</span><strong>${order.paymentMethod==='cash'?'Espèces':'Électronique (non configuré)'}</strong></div><div class="price-line"><span>Statut</span><strong>${esc(orderStatusLabel(order.paymentStatus))}</strong></div></div><div class="order-modal-section"><h3>Paiements et déclarations</h3>${payments}</div><div class="order-modal-section"><h3>Historique conservé</h3>${history}</div></div></div><footer class="modal-foot"><div class="order-actions">${available>0&&order.orderState!=='cancelled'?`<button class="button primary" type="button" data-finance-action="cash" data-id="${esc(order.id)}" data-amount="${available}" data-client="${esc(order.clientName)}">Déclarer un paiement en espèces</button>`:''}<button class="button secondary" type="button" data-finance-action="view-qr" data-id="${esc(order.qrCodeId||'')}">Voir le QR</button><button class="button secondary" type="button" data-close>Fermer</button></div></footer></article>`);
  }
  function openCashDeclaration(orderId, amount='', payerName='') {
    const defaultDate=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
    showModal(`<article class="modal-card small"><header class="modal-head"><div><span class="eyebrow">DÉCLARATION D’ESPÈCES</span><h2>Enregistrer l’argent reçu</h2><p>La déclaration sera transmise au PDG; elle ne sera pas considérée comme encaissée avant validation.</p></div><button class="modal-close" type="button" data-close>×</button></header><form id="cashDeclarationForm" data-order-id="${esc(orderId)}"><div class="modal-body"><div class="field"><label for="cashAmount">Montant reçu (XOF)</label><input id="cashAmount" type="number" min="1" step="1" required value="${esc(amount)}"></div><div class="field"><label for="cashPayerName">Identité réelle du payeur</label><input id="cashPayerName" type="text" maxlength="140" required value="${esc(payerName||'')}"></div><div class="field"><label for="cashReceivedAt">Date et heure de réception</label><input id="cashReceivedAt" type="datetime-local" required value="${defaultDate}"></div><p class="scan-auto-note">Saisissez la personne qui a effectivement remis l’argent. La déclaration reste en attente jusqu’à vérification par le PDG.</p></div><p id="managerModalError" class="modal-error" hidden></p><footer class="modal-foot"><button class="button secondary" type="button" data-close>Annuler</button><button class="button primary" type="submit">Envoyer au PDG</button></footer></form></article>`);
  }
  async function submitCashDeclaration(form) {
    const button=$('button[type="submit"]',form);button.disabled=true;
    try { const receivedAt=new Date($('#cashReceivedAt',modal).value);const result=await api(`/api/manager/finance/orders/${encodeURIComponent(form.dataset.orderId)}/cash-payments`,{method:'POST',body:JSON.stringify({amountXof:Number($('#cashAmount',modal).value),receivedAt:receivedAt.toISOString(),payerName:$('#cashPayerName',modal).value.trim()})});closeModal();showToast(`Déclaration ${result.data.payments?.[0]?.reference||''} envoyée au PDG pour vérification.`);state.orderPage=1;await loadOrders();await openOrderDetail(result.data.id); }
    catch(error){modalError(error.message);}finally{if(button.isConnected)button.disabled=false;}
  }
  function showModal(html) { modal.innerHTML = html; modal.hidden = false; const first = $('input:not([type="hidden"]),select,textarea,button',modal); if (first) setTimeout(() => first.focus(),30); }
  function closeModal() { modal.hidden = true; modal.innerHTML = ''; state.photos = []; state.logo = ''; }
  function modalError(message) { const target = $('#managerModalError',modal); if (target) { target.textContent = message; target.hidden = false; } else showToast(message); }
  function lines(text, count) { return String(text || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => { const parts = line.split('|').map((v) => v.trim()); while (parts.length < count) parts.push(''); return parts; }); }
  function rowsText(rows, keys) { return (Array.isArray(rows) ? rows : []).map((row) => keys.map((key) => row?.[key] || '').join(' | ')).join('\n'); }
  function renderPhotos() {
    const target = $('#managerPhotoEditor',modal); if (!target) return;
    target.innerHTML = state.photos.length ? state.photos.map((photo) => `<div class="photo-option"><img src="${esc(photo.src)}" alt=""><span>${esc(photo.alt || 'Photo')}</span><button type="button" class="mini-button danger" data-remove-photo="${esc(photo.id)}">Retirer</button></div>`).join('') : '<p class="muted">Aucune photo de galerie enregistrée.</p>';
  }
  async function imageToDataUrl(file, maxDimension = 1200, maxBytes = 340 * 1024) {
    let image;
    let release = () => {};
    if (typeof createImageBitmap === 'function') {
      try { image = await createImageBitmap(file, { imageOrientation:'from-image' }); release = () => image.close?.(); } catch (_) {}
    }
    if (!image) {
      const url = URL.createObjectURL(file);
      image = await new Promise((resolve,reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('Le navigateur ne peut pas lire cette image. Essayez un fichier JPG ou PNG.')); img.src = url; });
      release = () => URL.revokeObjectURL(url);
    }
    try {
      const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
      if (!width || !height) throw new Error('Image illisible.');
      let scale = Math.min(1, maxDimension / Math.max(width,height)); let quality = .84; let blob;
      for (let i=0;i<10;i+=1) {
        const canvas = document.createElement('canvas'); canvas.width = Math.max(1,Math.round(width*scale)); canvas.height = Math.max(1,Math.round(height*scale));
        canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
        blob = await new Promise((resolve) => canvas.toBlob(resolve,'image/jpeg',quality));
        if (blob && blob.size <= maxBytes) break;
        if (quality > .5) quality -= .09; else scale *= .8;
      }
      if (!blob || blob.size > maxBytes) throw new Error('Cette image reste trop volumineuse après optimisation.');
      return await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Lecture de l’image impossible.')); reader.readAsDataURL(blob); });
    } finally { release(); }
  }
  function openBeneficiaryForm(id = '') {
    const render = (row = {}) => {
      state.photos = Array.isArray(row.photos) ? row.photos.map((p) => ({...p})) : [];
      state.logo = row.logo || '';
      const logoUrl = state.logo.startsWith('data:image/') ? '' : state.logo;
      showModal(`<article class="modal-card"><header class="modal-head"><div><span class="eyebrow">BÉNÉFICIAIRE</span><h2>${id ? 'Modifier un bénéficiaire' : 'Ajouter un bénéficiaire'}</h2><p>Les informations modifiées sont enregistrées dans le journal d’activité.</p></div><button class="modal-close" type="button" data-close>×</button></header><form id="beneficiaryForm"><div class="modal-body"><div class="form-grid">
        <div class="field"><label for="beneType">Type *</label><select id="beneType" required>${[['individual','Particulier'],['business','Entreprise'],['commerce','Commerce'],['organization','Organisation'],['other','Autre']].map(([v,l])=>`<option value="${v}"${row.type===v?' selected':''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label for="beneName">Nom *</label><input id="beneName" required maxlength="140" value="${esc(row.name || '')}"></div>
        <div class="field full"><label for="beneLogoUrl">Logo / photo principale</label><input id="beneLogoUrl" type="url" placeholder="https://…" value="${esc(logoUrl)}"><input id="beneLogoFile" type="file" accept="image/*"><button type="button" class="mini-button danger" id="removeManagerLogo">Retirer le logo</button><span class="muted">Les images sont redimensionnées et compressées avant l’enregistrement.</span></div>
        <div class="field"><label for="benePhone">Téléphone</label><input id="benePhone" maxlength="50" value="${esc(row.phone || '')}"></div><div class="field"><label for="beneWhatsapp">WhatsApp</label><input id="beneWhatsapp" maxlength="50" value="${esc(row.whatsapp || '')}"></div>
        <div class="field"><label for="beneEmail">E-mail</label><input id="beneEmail" type="email" maxlength="254" value="${esc(row.email || '')}"></div><div class="field"><label for="beneWebsite">Site Internet</label><input id="beneWebsite" type="url" value="${esc(row.website || '')}"></div>
        <div class="field full"><label for="beneAddress">Adresse</label><input id="beneAddress" maxlength="300" value="${esc(row.address || '')}"></div><div class="field full"><label for="beneLocation">Lien de localisation</label><input id="beneLocation" type="url" value="${esc(row.locationUrl || '')}"></div>
        <div class="field full"><label for="beneBio">Présentation</label><textarea id="beneBio" maxlength="3000">${esc(row.bio || '')}</textarea></div>
        <div class="field full"><label for="beneSocials">Réseaux sociaux — une ligne « nom | URL »</label><textarea id="beneSocials">${esc(rowsText(row.socials,['label','url']))}</textarea></div>
        <div class="field full"><label for="beneOffers">Produits / services — une ligne « nom | description | tarif | URL »</label><textarea id="beneOffers">${esc(rowsText(row.offers,['name','description','price','url']))}</textarea></div>
        <div class="field full"><label for="beneDocuments">Documents — une ligne « nom | URL »</label><textarea id="beneDocuments">${esc(rowsText(row.documents,['name','url']))}</textarea></div>
        <div class="field full"><label for="benePhotos">Galerie de photos (jusqu’à 8)</label><input id="benePhotos" type="file" accept="image/*" multiple><div id="managerPhotoEditor" class="photo-grid"></div></div>
      </div></div><p id="managerModalError" class="modal-error" hidden></p><footer class="modal-foot"><button class="button secondary" type="button" data-close>Annuler</button><button class="button primary" type="submit">${id ? 'Enregistrer' : 'Créer le bénéficiaire'}</button></footer></form></article>`);
      renderPhotos();
      $('#beneLogoUrl',modal).addEventListener('input', (e) => { state.logo = e.target.value.trim(); });
    };
    if (id) api(`/api/manager/beneficiaries/${encodeURIComponent(id)}`).then((r) => render(r.data)).catch((e) => showToast(e.message)); else render();
  }
  function beneficiaryValues() {
    return {
      type:$('#beneType',modal).value,name:$('#beneName',modal).value,logo:state.logo,photos:state.photos,
      phone:$('#benePhone',modal).value,whatsapp:$('#beneWhatsapp',modal).value,email:$('#beneEmail',modal).value,
      website:$('#beneWebsite',modal).value,address:$('#beneAddress',modal).value,locationUrl:$('#beneLocation',modal).value,
      bio:$('#beneBio',modal).value,
      socials:lines($('#beneSocials',modal).value,2).map(([label,url])=>({label,url})).filter((x)=>x.label&&x.url),
      offers:lines($('#beneOffers',modal).value,4).map(([name,description,price,url])=>({name,description,price,url})).filter((x)=>x.name||x.description),
      documents:lines($('#beneDocuments',modal).value,2).map(([name,url])=>({name,url})).filter((x)=>x.name&&x.url),
    };
  }
  async function submitBeneficiary(form) {
    const id = form.dataset.id || '';
    const button = $('button[type="submit"]',form); button.disabled = true;
    try {
      const result = await api(id ? `/api/manager/beneficiaries/${encodeURIComponent(id)}` : '/api/manager/beneficiaries', { method:id?'PUT':'POST', body:JSON.stringify(beneficiaryValues()) });
      closeModal(); showToast(id ? 'Bénéficiaire mis à jour.' : 'Bénéficiaire créé.');
      await Promise.all([loadBeneficiaries(),loadDashboard()]);
      if (!id && result.data?.id) openQrForm('', result.data.id);
    } catch (error) { modalError(error.message); } finally { if (button.isConnected) button.disabled = false; }
  }
  async function loadBeneficiaryOptions(selectedId = '', search = '') {
    const result = await api(`/api/manager/beneficiaries?limit=100&status=active&search=${encodeURIComponent(search)}`);
    let rows = result.data || [];
    if (selectedId && !rows.some((r)=>r.id===selectedId)) {
      try { const one = await api(`/api/manager/beneficiaries/${encodeURIComponent(selectedId)}`); rows = [one.data,...rows]; } catch (_) {}
    }
    const select = $('#qrBeneficiaryId',modal); if (!select) return;
    const selected = selectedId || select.value;
    select.innerHTML = '<option value="">Sélectionner un bénéficiaire…</option>' + rows.map((r)=>`<option value="${esc(r.id)}">${esc(r.name)}${r.status==='blocked'?' · Bloqué':''}</option>`).join('');
    if (selected) select.value = selected;
    state.qrBeneficiaries = rows;
  }
  async function loadPhotoOptions(beneficiaryId, selectedIds) {
    const target = $('#qrPhotoOptions',modal); if (!target) return;
    if (!beneficiaryId) { target.innerHTML = '<p class="muted">Choisissez un bénéficiaire pour sélectionner ses photos.</p>'; return; }
    const result = await api(`/api/manager/beneficiaries/${encodeURIComponent(beneficiaryId)}`);
    const photos = result.data.photos || [];
    target.innerHTML = photos.length ? photos.map((photo)=>`<label class="photo-option"><input type="checkbox" name="selectedPhotoIds" value="${esc(photo.id)}"${selectedIds === null || selectedIds?.has(photo.id) ? ' checked' : ''}><img src="${esc(photo.src)}" alt=""><span>${esc(photo.alt || 'Photo')}</span></label>`).join('') : '<p class="muted">Aucune photo de galerie enregistrée.</p>';
  }
  async function openQrForm(id = '', beneficiaryId = '') {
    if (!id && state.manager?.canCreateCodes === false) return showToast('Le PDG a désactivé la création de QR pour votre compte.');
    if (id && state.manager?.canEditCodes === false) return showToast('Le PDG a désactivé la modification de vos QR.');
    let code = null;
    if (id) { try { code = (await api(`/api/manager/codes/${encodeURIComponent(id)}`)).data; } catch (e) { return showToast(e.message); } }
    const initialFields = new Set(code?.selectedFields || fields.map(([v])=>v));
    const initialPhotoIds = code ? new Set(code.selectedPhotoIds || []) : null;
    const style = {foreground:'#111111',background:'#FFFFFF',correction:'M',textSize:'default',...(code?.style || {})};
    const requiresPdgResubmission = ['suspended', 'inactive', 'rejected'].includes(code?.status);
    const publishOptionLabel = requiresPdgResubmission ? 'Soumettre à une nouvelle validation du PDG'
      : state.manager?.canSelfActivateCodes ? 'Activer directement (permission PDG)' : 'Soumettre à la validation du PDG';
    const categoryOptions = state.categories.map((c)=>`<option value="${esc(c.id)}"${(code?.categoryId || '')===c.id?' selected':''}>${esc(c.name)}</option>`).join('');
    showModal(`<article class="modal-card"><header class="modal-head"><div><span class="eyebrow">CODE QR</span><h2>${id ? 'Modifier un QR code' : 'Créer un QR code'}</h2><p>Le lien imprimé reste stable si vous modifiez la page hébergée.</p></div><button class="modal-close" type="button" data-close>×</button></header><form id="qrForm" data-id="${esc(id)}"><div class="modal-body"><div class="form-grid">
      <div class="field full"><label for="qrName">Nom du QR *</label><input id="qrName" required maxlength="120" value="${esc(code?.name || '')}" placeholder="Ex. Carte de visite, menu, catalogue"></div>
      <div class="field full"><label for="qrSaveMode">État après enregistrement</label><select id="qrSaveMode"><option value="publish"${code?.status === 'draft' ? '' : ' selected'}>${publishOptionLabel}</option><option value="draft"${code?.status === 'draft' ? ' selected' : ''}>Enregistrer comme brouillon</option></select><span class="field-hint">Les QR suspendus ou refusés doivent être réexaminés par le PDG avant de redevenir publics.</span></div>
      <div class="field full"><label for="qrBeneficiarySearch">Rechercher un bénéficiaire</label><input id="qrBeneficiarySearch" type="search" placeholder="Tapez un nom…"><select id="qrBeneficiaryId" required><option value="">Chargement…</option></select></div>
      <div class="field"><label for="qrCategory">Catégorie</label><select id="qrCategory"><option value="">Sans catégorie</option>${categoryOptions}</select></div>
      <div class="field"><label for="qrPurpose">Usage</label><select id="qrPurpose">${[['contact','Coordonnées'],['catalog','Catalogue'],['prices','Tarifs'],['menu','Menu'],['website','Site Internet'],['social','Réseaux sociaux'],['services','Services'],['order','Commande'],['other','Autre']].map(([v,l])=>`<option value="${v}"${(code?.purpose||'contact')===v?' selected':''}>${l}</option>`).join('')}</select></div>
      ${id ? '<div class="field full"><div class="price-unconfigured">Le prix de la commande est figé au moment de sa création et ne peut pas être recalculé en modifiant le QR.</div></div>' : `<div class="field"><label for="qrCustomerType">Type de client *</label><select id="qrCustomerType"><option value="individual">Particulier</option><option value="business">Entreprise</option><option value="custom">Formule personnalisée</option></select></div><div class="field"><label for="qrPricingPlan">Tarif applicable *</label><select id="qrPricingPlan" required><option value="">Chargement des tarifs…</option></select></div><div class="field full"><div id="qrPricingOptions" class="price-options"></div></div><div class="field full"><div id="qrPricePreview" class="price-preview-card"><p class="muted">Sélectionnez un client et un tarif actif.</p></div></div><div class="field full"><span class="field-label">Mode de paiement *</span><div class="check-grid"><label class="check-option"><input type="radio" name="paymentMethod" value="cash" checked> Espèces — déclaration vérifiée par le PDG</label><label class="check-option muted"><input type="radio" name="paymentMethod" value="electronic" disabled> Paiement électronique — en attente de configuration</label></div></div>`}
      <div class="field full"><span class="field-label">Destination</span><div class="check-grid"><label class="check-option"><input type="radio" name="destinationType" value="page"${!code||code.destinationType==='page'?' checked':''}> Page QRia modifiable</label><label class="check-option"><input type="radio" name="destinationType" value="redirect"${code?.destinationType==='redirect'?' checked':''}> Redirection Internet</label></div></div>
      <div class="field full" id="qrTargetWrap"><label for="qrTarget">URL de destination (redirection seulement)</label><input id="qrTarget" type="url" placeholder="https://exemple.ci" value="${esc(code?.targetUrl || '')}"></div>
      <div class="field full"><label for="qrTitle">Titre</label><input id="qrTitle" maxlength="140" value="${esc(code?.title || '')}"></div>
      <div class="field full"><label for="qrDescription">Description</label><textarea id="qrDescription" maxlength="800">${esc(code?.description || '')}</textarea></div>
      <div class="field full"><label for="qrContentText">Message complémentaire</label><textarea id="qrContentText" maxlength="5000">${esc(code?.contentText || '')}</textarea></div>
      <div class="field full"><label for="qrLinks">Liens complémentaires — une ligne « nom | URL »</label><textarea id="qrLinks">${esc(rowsText(code?.extraLinks,['label','url']))}</textarea></div>
      <div class="field full"><span class="field-label">Informations visibles</span><div class="check-grid">${fields.map(([value,label])=>`<label class="check-option"><input type="checkbox" name="selectedFields" value="${value}"${initialFields.has(value)?' checked':''}>${esc(label)}</label>`).join('')}</div></div>
      <div class="field full"><span class="field-label">Photos à afficher</span><div id="qrPhotoOptions" class="photo-grid"><p class="muted">Sélectionnez un bénéficiaire.</p></div></div>
      <div class="field"><label for="qrForeground">Couleur du QR</label><input id="qrForeground" type="color" value="${esc(style.foreground)}"></div><div class="field"><label for="qrBackground">Couleur du fond</label><input id="qrBackground" type="color" value="${esc(style.background)}"></div>
      <div class="field"><label for="qrCorrection">Correction d’erreur</label><select id="qrCorrection">${['M','L','Q','H'].map((v)=>`<option value="${v}"${style.correction===v?' selected':''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label for="qrTextSize">Taille du texte</label><select id="qrTextSize">${[['default','Réglage général'],['small','Petite'],['normal','Normale'],['large','Grande'],['xlarge','Très grande']].map(([v,l])=>`<option value="${v}"${style.textSize===v?' selected':''}>${l}</option>`).join('')}</select></div>
    </div></div><p id="managerModalError" class="modal-error" hidden></p><footer class="modal-foot"><button class="button secondary" type="button" data-close>Annuler</button><button class="button primary" type="submit">${id?'Enregistrer':'Créer le QR code'}</button></footer></form></article>`);
    const selectedBene = code?.beneficiaryId || beneficiaryId;
    await loadBeneficiaryOptions(selectedBene, '');
    if (selectedBene) await loadPhotoOptions(selectedBene, initialPhotoIds);
    const chosenBeneficiary = state.qrBeneficiaries?.find((r)=>r.id===$('#qrBeneficiaryId',modal).value);
    if (!id && chosenBeneficiary) $('#qrCustomerType',modal).value = ['business','commerce','organization'].includes(chosenBeneficiary.type) ? 'business' : chosenBeneficiary.type === 'individual' ? 'individual' : 'custom';
    $('#qrBeneficiaryId',modal).addEventListener('change', async () => {
      const bene = state.qrBeneficiaries?.find((r)=>r.id===$('#qrBeneficiaryId',modal).value);
      if (bene && !code?.categoryId) $('#qrCategory',modal).value = categoryByType[bene.type] || 'cat-other';
      if (!id && bene) $('#qrCustomerType',modal).value = ['business','commerce','organization'].includes(bene.type) ? 'business' : bene.type === 'individual' ? 'individual' : 'custom';
      await loadPhotoOptions($('#qrBeneficiaryId',modal).value, null).catch((e)=>showToast(e.message));
      if (!id) await refreshPricingOptions();
    });
    $('#qrBeneficiarySearch',modal).addEventListener('input', () => {
      clearTimeout(searchTimer); searchTimer = setTimeout(() => loadBeneficiaryOptions(selectedBene,$('#qrBeneficiarySearch',modal).value.trim()).catch((e)=>showToast(e.message)),220);
    });
    $$('input[name="destinationType"]',modal).forEach((radio)=>radio.addEventListener('change', async()=>{updateDestinationFields();if(!id)await refreshPricingOptions();})); updateDestinationFields();
    if(!id){$('#qrPurpose',modal).addEventListener('change',refreshPricingOptions);$('#qrCustomerType',modal).addEventListener('change',refreshPricingOptions);$('#qrPricingPlan',modal).addEventListener('change',renderPricingOptions);await refreshPricingOptions();}
  }
  function updateDestinationFields() { const redirect = $('input[name="destinationType"]:checked',modal)?.value === 'redirect'; const target = $('#qrTarget',modal); if (target) target.required = redirect; }
  async function refreshPricingOptions() {
    const select=$('#qrPricingPlan',modal);if(!select)return;
    const requestId=++state.pricingRequestId;
    const beneId=$('#qrBeneficiaryId',modal).value;
    if(!beneId){select.disabled=true;select.innerHTML='<option value="">Sélectionnez un bénéficiaire</option>';state.pricingPlans=[];renderPricingOptions();return;}
    const previous=select.value;
    const customerType=$('#qrCustomerType',modal).value;const qrPurpose=$('#qrPurpose',modal).value;const destinationType=$('input[name="destinationType"]:checked',modal)?.value||'page';
    select.disabled=true;select.innerHTML='<option value="">Chargement…</option>';
    try{
      const params=new URLSearchParams({customerType,qrPurpose,destinationType});const result=await api(`/api/manager/finance/pricing?${params}`);if(requestId!==state.pricingRequestId||!modal.contains(select))return;state.pricingPlans=result.data||[];
      select.innerHTML='<option value="">Choisir une formule…</option>'+state.pricingPlans.map((plan)=>`<option value="${esc(plan.id)}">${esc(plan.name)} — ${xof(plan.amountXof)}</option>`).join('');
      if(previous&&state.pricingPlans.some((plan)=>plan.id===previous))select.value=previous;else if(state.pricingPlans.length===1)select.value=state.pricingPlans[0].id;
      select.disabled=!state.pricingPlans.length;renderPricingOptions();
    }catch(error){if(requestId!==state.pricingRequestId||!modal.contains(select))return;state.pricingPlans=[];select.innerHTML='<option value="">Tarifs indisponibles</option>';select.disabled=true;$('#qrPricePreview',modal).innerHTML=`<div class="price-unconfigured">${esc(error.message)}</div>`;const button=$('button[type="submit"]',modal);if(button)button.disabled=true;}
  }
  function renderPricingOptions() {
    const plan=state.pricingPlans.find((item)=>item.id===$('#qrPricingPlan',modal)?.value);
    const target=$('#qrPricingOptions',modal);const preview=$('#qrPricePreview',modal);if(!target||!preview)return;
    if(!plan){target.innerHTML='';preview.innerHTML='<div class="price-unconfigured">Aucun tarif actif ne correspond à ce client, à l’usage et à la destination du QR. Le PDG doit configurer une formule avant la création.</div>';const button=$('button[type="submit"]',modal);if(button)button.disabled=true;return;}
    target.innerHTML=(plan.options||[]).filter((item)=>item.active!==false).map((option)=>`<label class="price-option"><span><input type="checkbox" name="qrOptionIds" value="${esc(option.id)}"> ${esc(option.name)}</span><strong>${xof(option.amountXof)}</strong></label>`).join('');
    const beneficiary=state.qrBeneficiaries?.find((item)=>item.id===$('#qrBeneficiaryId',modal).value);const client=beneficiary?.name||'—';const customerType=$('#qrCustomerType',modal).value;const destinationType=$('input[name="destinationType"]:checked',modal)?.value||'page';
    const update=()=>{
      const selected=[...$$('input[name="qrOptionIds"]:checked',modal)].map((input)=>input.value);const chosen=(plan.options||[]).filter((option)=>selected.includes(option.id));const optionTotal=chosen.reduce((sum,item)=>sum+Number(item.amountXof||0),0);const total=Number(plan.amountXof||0)+optionTotal;
      preview.innerHTML=`<h3>Création d’un code QR</h3><div class="price-line"><span>Client / entreprise</span><strong>${esc(client)}</strong></div><div class="price-line"><span>Type de client</span><strong>${customerType==='business'?'Entreprise':customerType==='individual'?'Particulier':'Formule personnalisée'}</strong></div><div class="price-line"><span>Type de code QR</span><strong>${esc(plan.name)} · ${$('#qrPurpose',modal).selectedOptions[0]?.textContent||''} · ${destinationType==='page'?'Page QRia':'Redirection Internet'}</strong></div><div class="price-line"><span>Prix unitaire</span><strong>${xof(plan.amountXof)}</strong></div><div class="price-line"><span>Options supplémentaires</span><strong>${xof(optionTotal)}${chosen.length?` (${chosen.map((o)=>esc(o.name)).join(', ')})`:''}</strong></div><div class="price-line total"><span>Total à payer</span><strong>${xof(total)}</strong></div><div class="price-line"><span>Mode de paiement</span><strong>Espèces</strong></div><div class="price-line"><span>Statut initial</span><strong>En attente de paiement</strong></div>`;
      const button=$('button[type="submit"]',modal);if(button)button.disabled=false;
    };
    target.querySelectorAll('input[name="qrOptionIds"]').forEach((input)=>input.addEventListener('change',update));update();
  }
  function qrValues() {
    const destinationType = $('input[name="destinationType"]:checked',modal)?.value || 'page';
    const values = {
      name:$('#qrName',modal).value, beneficiaryId:$('#qrBeneficiaryId',modal).value, categoryId:$('#qrCategory',modal).value,
      saveMode:$('#qrSaveMode',modal).value,
      purpose:$('#qrPurpose',modal).value,destinationType,targetUrl:$('#qrTarget',modal).value,
      title:$('#qrTitle',modal).value,description:$('#qrDescription',modal).value,contentText:$('#qrContentText',modal).value,
      extraLinks:lines($('#qrLinks',modal).value,2).map(([label,url])=>({label,url})).filter((v)=>v.label&&v.url),
      selectedFields:$$('input[name="selectedFields"]:checked',modal).map((input)=>input.value),
      selectedPhotoIds:$$('input[name="selectedPhotoIds"]:checked',modal).map((input)=>input.value),
      style:{foreground:$('#qrForeground',modal).value,background:$('#qrBackground',modal).value,correction:$('#qrCorrection',modal).value,textSize:$('#qrTextSize',modal).value},
    };
    if (!$('#qrForm',modal).dataset.id) {
      const beneficiary=state.qrBeneficiaries?.find((item)=>item.id===values.beneficiaryId);
      values.customerType=$('#qrCustomerType',modal).value;
      values.pricingPlanId=$('#qrPricingPlan',modal).value;
      values.optionIds=$$('input[name="qrOptionIds"]:checked',modal).map((input)=>input.value);
      values.paymentMethod='cash';
      values.clientName=beneficiary?.name||'';
      values.companyName=values.customerType==='business'?(beneficiary?.name||''):'';
    }
    return values;
  }
  async function submitQr(form) {
    const id = form.dataset.id || ''; const button = $('button[type="submit"]',form); button.disabled = true;
    try {
      const result = await api(id?`/api/manager/codes/${encodeURIComponent(id)}`:'/api/manager/codes',{method:id?'PUT':'POST',body:JSON.stringify(qrValues())});
      closeModal();
      if (id) { showToast(result.data.status === 'pending_validation' ? 'QR modifié et soumis au PDG; il reste indisponible au public.' : 'QR mis à jour. Le tarif de la commande initiale reste inchangé.'); await Promise.all([loadCodes(),loadDashboard()]); openPreview(result.data); }
      else { const statusText = result.data.status === 'active' ? 'QR activé' : result.data.status === 'draft' ? 'Brouillon enregistré' : 'QR soumis au PDG pour validation'; showToast(`${statusText}. Commande ${result.order?.reference||''} créée pour ${xof(result.order?.totalAmountXof||0)}; paiement en attente.`); await Promise.all([loadCodes(),loadDashboard(),loadOrders()]); if(result.order?.id) await openOrderDetail(result.order.id); else openPreview(result.data); }
    } catch (error) { modalError(error.message); } finally { if(button.isConnected) button.disabled = !id && !$('#qrPricingPlan',modal)?.value; }
  }
  function publicUrl(code) { return `${state.publicBaseUrl || window.location.origin}/r/${encodeURIComponent(code.publicCode)}`; }
  function drawQr(canvas, code, size=400) {
    const qr = qrcode(0,code.style?.correction || 'M'); qr.addData(publicUrl(code)); qr.make(); const n=qr.getModuleCount(), margin=4, total=n+8;
    canvas.width=size; canvas.height=size; const ctx=canvas.getContext('2d',{alpha:false}); ctx.imageSmoothingEnabled=false; ctx.fillStyle=code.style?.background||'#fff'; ctx.fillRect(0,0,size,size); ctx.fillStyle=code.style?.foreground||'#111111';
    for(let r=0;r<n;r+=1)for(let c=0;c<n;c+=1)if(qr.isDark(r,c)){const x0=Math.round((c+margin)/total*size),x1=Math.round((c+margin+1)/total*size),y0=Math.round((r+margin)/total*size),y1=Math.round((r+margin+1)/total*size);ctx.fillRect(x0,y0,x1-x0,y1-y0);}
  }
  function qrSvg(code,size=1024) { const qr=qrcode(0,code.style?.correction||'M'); qr.addData(publicUrl(code)); qr.make(); const n=qr.getModuleCount(),margin=4,total=n+8,paths=[]; for(let r=0;r<n;r+=1)for(let c=0;c<n;c+=1)if(qr.isDark(r,c))paths.push(`M${c+margin} ${r+margin}h1v1h-1z`); return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="${code.style?.background||'#FFFFFF'}"/><path d="${paths.join('')}" fill="${code.style?.foreground||'#111111'}"/></svg>`; }
  function saveBlob(blob,name) { const url=URL.createObjectURL(blob),a=document.createElement('a'); a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500); }
  const slug = (v) => String(v||'qria').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,45)||'qria';
  async function track(action,codeId) { await api('/api/manager/activity',{method:'POST',body:JSON.stringify({action,codeId})}); }
  async function handleCodeAction(action,id,status='') {
    try {
      if (action==='preview'||action==='edit'||['png','svg','copy','print'].includes(action)) {
        const code=(await api(`/api/manager/codes/${encodeURIComponent(id)}`)).data;
        if(action==='preview') return openPreview(code);
        if(action==='edit') return state.manager?.canEditCodes === false ? showToast('Le PDG a désactivé la modification de vos QR.') : openQrForm(id);
        if(action==='png') { await track('download_png',id); const canvas=document.createElement('canvas');drawQr(canvas,code,1024);canvas.toBlob((blob)=>blob&&saveBlob(blob,`qria-${slug(code.name)}-${code.publicCode}.png`),'image/png');showToast('PNG téléchargé.'); }
        if(action==='svg') { await track('download_svg',id);saveBlob(new Blob([qrSvg(code)],{type:'image/svg+xml;charset=utf-8'}),`qria-${slug(code.name)}-${code.publicCode}.svg`);showToast('SVG téléchargé.'); }
        if(action==='copy') { await track('share',id); const url=publicUrl(code);if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(url);else{const t=document.createElement('textarea');t.value=url;t.style.position='fixed';t.style.left='-10000px';document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();}showToast('Lien public copié.'); }
        if(action==='print') { await track('print',id);const win=window.open(`/print.html?id=${encodeURIComponent(id)}&role=manager`,'_blank','noopener');if(!win)showToast('Autorisez les fenêtres surgissantes pour imprimer.'); }
      } else if(action==='toggle-code') {
        const next=status==='active'?'suspended':'active';
        if(next==='suspended'&&!window.confirm('Suspendre temporairement ce QR ? Son historique sera conservé.'))return;
        await api(`/api/manager/codes/${encodeURIComponent(id)}/status`,{method:'PATCH',body:JSON.stringify({status:next,reason:next==='suspended'?'Suspendu par le gestionnaire.':''})});showToast(next==='active'?'QR activé.':'QR suspendu.');await Promise.all([loadCodes(),loadDashboard()]);
      } else if(action==='delete-code') {
        if(state.manager?.canEditCodes===false)return showToast('Le PDG a désactivé la modification de vos QR.');
        if(!window.confirm('Supprimer ce QR ? Le lien sera désactivé, mais ses scans et son historique seront conservés.'))return;
        await api(`/api/manager/codes/${encodeURIComponent(id)}`,{method:'DELETE'});showToast('QR supprimé logiquement.');await Promise.all([loadCodes(),loadDashboard()]);
      }
    } catch(error) { showToast(error.message); }
  }
  function openPreview(code) {
    state.previewCode=code;
    showModal(`<article class="modal-card small"><header class="modal-head"><div><span class="eyebrow">APERÇU QR</span><h2>${esc(code.name)}</h2><p>${esc(code.beneficiaryName)} · ${number(code.scanCount)} scans</p></div><button type="button" class="modal-close" data-close>×</button></header><div class="modal-body preview-grid"><div><canvas id="previewCanvas" width="400" height="400"></canvas><p class="preview-url">${esc(publicUrl(code))}</p></div><div class="preview-actions"><strong>Identifiant ${esc(code.publicCode)}</strong><button class="button secondary" type="button" data-modal-action="copy">Copier le lien</button><button class="button secondary" type="button" data-modal-action="png">Télécharger PNG</button><button class="button secondary" type="button" data-modal-action="svg">Télécharger SVG</button><button class="button secondary" type="button" data-modal-action="print">Imprimer</button><button class="button primary" type="button" data-modal-action="edit">Modifier le QR</button></div></div><footer class="modal-foot"><button class="button secondary" type="button" data-close>Fermer</button></footer></article>`);
    drawQr($('#previewCanvas',modal),code,400);
  }
  async function handleBeneficiaryAction(action,id,name='') {
    try {
      if(action==='edit-beneficiary')return openBeneficiaryForm(id);
      if(action==='bene-codes') { state.codeSearch='';state.codeBeneficiaryId=id;state.codePage=1;$('#codeSearch').value='';setView('codes',false);await loadCodes(); }
      if(action==='block-beneficiary'||action==='unblock-beneficiary') {
        const status=action==='block-beneficiary'?'blocked':'active';if(status==='blocked'&&!window.confirm(`Bloquer ${name||'ce bénéficiaire'} ? Les pages QR associées ne seront plus accessibles au public.`))return;
        await api(`/api/manager/beneficiaries/${encodeURIComponent(id)}/status`,{method:'PATCH',body:JSON.stringify({status})});showToast(status==='blocked'?'Bénéficiaire bloqué.':'Bénéficiaire réactivé.');await Promise.all([loadBeneficiaries(),loadCodes(),loadDashboard()]);
      }
      if(action==='delete-beneficiary') {if(!window.confirm(`Supprimer ${name||'ce bénéficiaire'} ? Les scans et l’historique seront conservés.`))return;await api(`/api/manager/beneficiaries/${encodeURIComponent(id)}`,{method:'DELETE'});showToast('Bénéficiaire supprimé logiquement.');await Promise.all([loadBeneficiaries(),loadCodes(),loadDashboard()]);}
    } catch(error) { showToast(error.message); }
  }
  function renderCodesForResult(result) {
    const tbody=$('#codeRows');state.codeTotal=result.total;state.codePage=1;
    tbody.innerHTML=result.data.length?result.data.map((row)=>`<tr><td><strong>${esc(row.name)}</strong><small>ID ${esc(row.publicCode)}</small>${row.statusReason?`<small class="status-reason">Motif : ${esc(row.statusReason)}</small>`:''}</td><td>${esc(row.beneficiaryName)}</td><td><span class="status-dot ${row.status==='active'?'':'inactive'}">${esc(qrStatusLabel(row.status))}</span></td><td>${number(row.scanCount)}</td><td><div class="row-actions"><button class="mini-button" data-action="preview" data-id="${esc(row.id)}">Voir</button>${state.manager?.canEditCodes!==false?`<button class="mini-button" data-action="edit" data-id="${esc(row.id)}">Modifier</button>`:''}<button class="mini-button" data-action="png" data-id="${esc(row.id)}">PNG</button><button class="mini-button" data-action="print" data-id="${esc(row.id)}">Imprimer</button></div></td></tr>`).join(''):'<tr><td colspan="5">Aucun QR pour ce bénéficiaire.</td></tr>';fillPage('#codesPrev','#codesNext','#codesPage',1,result.total,20);
  }

  // Authentication and forced password replacement after a temporary credential/reset link.
  $('#managerPasswordChangeForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button=$('button[type="submit"]',event.currentTarget); const error=$('#managerPasswordGateError');
    const password=$('#managerNewPassword').value; const confirmation=$('#managerConfirmNewPassword').value;
    error.hidden=true;
    if(password!==confirmation){error.textContent='Les deux mots de passe ne correspondent pas.';error.hidden=false;return;}
    button.disabled=true;
    try {
      let result;
      if(state.resetToken){
        result=await api('/api/manager/auth/reset-password',{method:'POST',body:JSON.stringify({token:state.resetToken,password})});
        state.resetToken='';window.history.replaceState(null,'','/manager');
        if(result.authenticated)await showApp(result.manager);else showLogin('Mot de passe modifié. Contactez le PDG pour réactiver votre compte avant de vous connecter.');
      } else {
        result=await api('/api/manager/auth/change-password',{method:'POST',body:JSON.stringify({password})});
        await showApp(result.manager);
      }
      $('#managerNewPassword').value='';$('#managerConfirmNewPassword').value='';
    } catch(failure){error.textContent=failure.message;error.hidden=false;}finally{button.disabled=false;}
  });
  $('#toggleManagerPassword').addEventListener('click', () => setLoginPasswordVisible($('#managerPassword').type === 'password'));
  $('#managerLoginForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const button=$('button[type="submit"]',event.currentTarget); const error=$('#managerLoginError');button.disabled=true;error.hidden=true;
    try {
      const result=await api('/api/auth/login',{method:'POST',body:JSON.stringify({username:$('#managerUsername').value.trim(),password:$('#managerPassword').value})});
      $('#managerPassword').value='';setLoginPasswordVisible(false);
      if(result.role==='admin'){window.location.replace('/admin');return;}
      if(result.role!=='manager')throw new Error('Type de compte non reconnu.');
      const auth=await api('/api/manager/auth/me');
      if(auth.manager?.mustChangePassword)showPasswordGate(auth.manager);else await showApp(auth.manager);
    }
    catch(failure){error.textContent=failure.message;error.hidden=false;}finally{button.disabled=false;}
  });
  $('#managerPasswordGateLogout').addEventListener('click', async()=>{try{await api('/api/manager/auth/logout',{method:'POST'});}catch(_){}window.location.replace('/');});
  $('#managerLogout').addEventListener('click', async()=>{try{await api('/api/manager/auth/logout',{method:'POST'});}catch(_){}window.location.replace('/');});
  $('#managerMenuButton').addEventListener('click',()=>$('#managerSidebar').classList.toggle('open'));
  $$('.nav-link').forEach((button)=>button.addEventListener('click',()=>{if(button.dataset.view==='codes'){state.codeBeneficiaryId='';state.codeSearch='';$('#codeSearch').value='';}setView(button.dataset.view);}));
  $$('[data-view-link]').forEach((button)=>button.addEventListener('click',()=>setView(button.dataset.viewLink)));
  $('#managerForgotPassword').addEventListener('click',()=>openManagerHelp('forgot'));
  $('#forgotPasswordHelp').addEventListener('click',()=>openManagerHelp('forgot'));
  $('#managerProfileForm').addEventListener('submit',saveManagerProfile);
  $('#managerPreferencesForm').addEventListener('submit',saveManagerPreferences);
  $('#managerChangePasswordForm').addEventListener('submit',changeAccountPassword);
  $('#revokeOtherSessions').addEventListener('click',revokeAllSessions);
  $('#markAllNotificationsRead').addEventListener('click',async()=>{try{await api('/api/manager/notifications/read-all',{method:'PATCH'});state.notificationPage=1;await Promise.all([loadNotifications(),loadDashboard()]);showToast('Toutes les notifications ont été marquées comme lues.');}catch(error){showToast(error.message);}});
  $('#notificationsPrev').addEventListener('click',()=>{if(state.notificationPage>1){state.notificationPage--;loadNotifications().catch((e)=>showToast(e.message));}});
  $('#notificationsNext').addEventListener('click',()=>{if(state.notificationPage<pageCount(state.notificationTotal,20)){state.notificationPage++;loadNotifications().catch((e)=>showToast(e.message));}});
  ['#managerNotificationList','#dashboardNotifications'].forEach((selector)=>$(selector).addEventListener('click',async(event)=>{
    const button=event.target.closest('[data-action]');if(!button)return;
    if(button.dataset.action==='notification-read')return markNotificationRead(button.dataset.id);
    if(button.dataset.action==='notification-code'){try{const result=await api(`/api/manager/codes/${encodeURIComponent(button.dataset.id)}`);openPreview(result.data);}catch(error){showToast(error.message);}}
  }));
  $$('[data-manager-doc]').forEach((button)=>button.addEventListener('click',()=>openManagerHelp(button.dataset.managerDoc)));
  $$('[data-action="new-code"]').forEach((button)=>button.addEventListener('click',()=>openQrForm().catch((e)=>showToast(e.message))));
  $$('[data-action="new-beneficiary"]').forEach((button)=>button.addEventListener('click',()=>openBeneficiaryForm()));
  $('#beneficiarySearch').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.beneficiarySearch=$('#beneficiarySearch').value.trim();state.beneficiaryPage=1;loadBeneficiaries().catch((e)=>showToast(e.message));},220);});
  $('#beneficiaryStatus').addEventListener('change',()=>{state.beneficiaryStatus=$('#beneficiaryStatus').value;state.beneficiaryPage=1;loadBeneficiaries().catch((e)=>showToast(e.message));});
  $('#codeSearch').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.codeSearch=$('#codeSearch').value.trim();state.codePage=1;loadCodes().catch((e)=>showToast(e.message));},220);});
  $('#codeStatus').addEventListener('change',()=>{state.codeStatus=$('#codeStatus').value;state.codePage=1;loadCodes().catch((e)=>showToast(e.message));});
  $('#statsPeriod').addEventListener('change',()=>{state.statsPeriod=$('#statsPeriod').value;loadStats().catch((e)=>showToast(e.message));});
  $('#managerOrderRows').addEventListener('click',(event)=>{const button=event.target.closest('[data-action="order-detail"]');if(button)openOrderDetail(button.dataset.id).catch((e)=>showToast(e.message));});
  $('#managerOrderSearch').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.orderSearch=$('#managerOrderSearch').value.trim();state.orderPage=1;loadOrders().catch((e)=>showToast(e.message));},220);});
  $('#managerOrderStatus').addEventListener('change',()=>{state.orderStatus=$('#managerOrderStatus').value;state.orderPage=1;loadOrders().catch((e)=>showToast(e.message));});
  $('#managerRefreshOrders').addEventListener('click',()=>loadOrders().catch((e)=>showToast(e.message)));
  $('#managerOrdersPrev').addEventListener('click',()=>{if(state.orderPage>1){state.orderPage--;loadOrders().catch((e)=>showToast(e.message));}});
  $('#managerOrdersNext').addEventListener('click',()=>{if(state.orderPage<pageCount(state.orderTotal,12)){state.orderPage++;loadOrders().catch((e)=>showToast(e.message));}});
  $('#profileAvatarFile').addEventListener('change',async(event)=>{const file=event.target.files?.[0];if(!file)return;try{state.profileAvatarData=await squareAvatarFile(file);$('#profileAvatarPreview').src=state.profileAvatarData;$('#profileAvatarPreview').hidden=false;$('#profileAvatarFallback').hidden=true;$('#saveProfileAvatar').disabled=false;showToast('Photo recadrée au carré. Enregistrez pour appliquer.');}catch(error){showToast(error.message);}finally{event.target.value='';}});
  $('#saveProfileAvatar').addEventListener('click',saveProfileAvatar);
  $('#removeProfileAvatar').addEventListener('click',()=>{state.profileAvatarData='';$('#profileAvatarPreview').removeAttribute('src');$('#profileAvatarPreview').hidden=true;$('#profileAvatarFallback').hidden=false;$('#saveProfileAvatar').disabled=false;});
  $('#copyInstallLink').addEventListener('click',async()=>{try{const link=$('#managerInstallLink').value;if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(link);else{const input=$('#managerInstallLink');input.select();document.execCommand('copy');}showToast('Lien personnel copié.');}catch(_){showToast('Copiez le lien affiché manuellement.');}});
  $('#beneficiariesPrev').addEventListener('click',()=>{if(state.beneficiaryPage>1){state.beneficiaryPage--;loadBeneficiaries().catch((e)=>showToast(e.message));}});
  $('#beneficiariesNext').addEventListener('click',()=>{if(state.beneficiaryPage<pageCount(state.beneficiaryTotal,12)){state.beneficiaryPage++;loadBeneficiaries().catch((e)=>showToast(e.message));}});
  $('#codesPrev').addEventListener('click',()=>{if(state.codePage>1){state.codePage--;loadCodes().catch((e)=>showToast(e.message));}});
  $('#codesNext').addEventListener('click',()=>{if(state.codePage<pageCount(state.codeTotal,20)){state.codePage++;loadCodes().catch((e)=>showToast(e.message));}});
  $('#beneficiaryList').addEventListener('click',(event)=>{const button=event.target.closest('[data-action]');if(button)handleBeneficiaryAction(button.dataset.action,button.dataset.id,button.dataset.name);});
  $('#codeRows').addEventListener('click',(event)=>{const button=event.target.closest('[data-action]');if(button)handleCodeAction(button.dataset.action,button.dataset.id,button.dataset.status);});
  $('#recentCodes').addEventListener('click',(event)=>{const button=event.target.closest('[data-action="preview"]');if(button)handleCodeAction('preview',button.dataset.id);});
  modal.addEventListener('click', async(event)=>{
    if(event.target===modal||event.target.closest('[data-close]')){closeModal();return;}
    const remove=event.target.closest('[data-remove-photo]');if(remove){state.photos=state.photos.filter((p)=>p.id!==remove.dataset.removePhoto);renderPhotos();return;}
    if(event.target.closest('#removeManagerLogo')){state.logo='';$('#beneLogoUrl',modal).value='';$('#beneLogoFile',modal).value='';}
    const financeAction=event.target.closest('[data-finance-action]');
    if(financeAction){const action=financeAction.dataset.financeAction;if(action==='cash'){const id=financeAction.dataset.id,amount=financeAction.dataset.amount,client=financeAction.dataset.client;closeModal();openCashDeclaration(id,amount,client);return;}if(action==='view-qr'&&financeAction.dataset.id){const code=await api(`/api/manager/codes/${encodeURIComponent(financeAction.dataset.id)}`);openPreview(code.data);return;}}
    const action=event.target.closest('[data-modal-action]')?.dataset.modalAction;if(!action||!state.previewCode)return;
    const code=state.previewCode;const map={copy:'share',png:'download_png',svg:'download_svg',print:'print'};
    if(action==='edit'){const id=code.id;closeModal();await openQrForm(id);return;}
    try {
      if(action==='copy'){await track(map.copy,code.id);if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(publicUrl(code));else{const t=document.createElement('textarea');t.value=publicUrl(code);document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();}showToast('Lien public copié.');}
      if(action==='png'){await track(map.png,code.id);const canvas=document.createElement('canvas');drawQr(canvas,code,1024);canvas.toBlob((blob)=>blob&&saveBlob(blob,`qria-${slug(code.name)}-${code.publicCode}.png`),'image/png');showToast('PNG téléchargé.');}
      if(action==='svg'){await track(map.svg,code.id);saveBlob(new Blob([qrSvg(code)],{type:'image/svg+xml;charset=utf-8'}),`qria-${slug(code.name)}-${code.publicCode}.svg`);showToast('SVG téléchargé.');}
      if(action==='print'){await track(map.print,code.id);const win=window.open(`/print.html?id=${encodeURIComponent(code.id)}&role=manager`,'_blank','noopener');if(!win)showToast('Autorisez les fenêtres surgissantes pour imprimer.');}
    }catch(error){showToast(error.message);}
  });
  modal.addEventListener('submit',(event)=>{event.preventDefault();if(event.target.id==='beneficiaryForm')submitBeneficiary(event.target);if(event.target.id==='qrForm')submitQr(event.target);if(event.target.id==='cashDeclarationForm')submitCashDeclaration(event.target);});
  modal.addEventListener('change',async(event)=>{
    if(event.target.id==='beneLogoFile'){
      const file=event.target.files?.[0];if(!file)return;const button=$('button[type="submit"]',modal);if(button)button.disabled=true;
      try{state.logo=await imageToDataUrl(file);$('#beneLogoUrl',modal).value='';showToast('Logo optimisé.');}catch(error){modalError(error.message);}finally{event.target.value='';if(button?.isConnected)button.disabled=false;}
    }
    if(event.target.id==='benePhotos'){
      const files=[...(event.target.files||[])];if(!files.length)return;
      if(state.photos.length+files.length>8){modalError('Vous pouvez enregistrer au maximum 8 photos.');event.target.value='';return;}
      const button=$('button[type="submit"]',modal);if(button)button.disabled=true;
      try{for(const file of files)state.photos.push({id:crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`,src:await imageToDataUrl(file),alt:file.name.replace(/\.[^.]+$/,'')});renderPhotos();showToast('Photos optimisées. Enregistrez pour les conserver.');}catch(error){modalError(error.message);}finally{event.target.value='';if(button?.isConnected)button.disabled=false;}
    }
  });
  document.addEventListener('keydown',(event)=>{if(event.key==='Escape'&&!modal.hidden)closeModal();});
  async function initialize(){
    if('serviceWorker'in navigator)navigator.serviceWorker.register('/manager/sw.js',{scope:'/manager/'}).catch(()=>{});
    const installMatch=window.location.pathname.match(/\/manager\/install\/([A-Za-z0-9_-]{32,64})/);
    if(installMatch){state.installToken=installMatch[1];updateInstallBranding(`/manager/install/${state.installToken}`);}
    if(window.location.pathname==='/manager/reset-password'){
      const resetToken=new URLSearchParams(window.location.hash.replace(/^#/,'')).get('token')||'';
      if(resetToken){showPasswordGate(null,resetToken);window.history.replaceState(null,'','/manager/reset-password');}
      else showLogin('Ce lien de réinitialisation est incomplet ou a déjà été utilisé.');
      return;
    }
    try{
      const health=await fetch('/api/health').then((r)=>r.json());state.publicBaseUrl=health.publicBaseUrl||window.location.origin;
      const auth=await api('/api/manager/auth/me');
      if(auth.authenticated){if(auth.manager?.mustChangePassword)showPasswordGate(auth.manager);else await showApp(auth.manager);}
      else showLogin();
    }catch(_){showLogin();}
  }
  initialize();
})();
