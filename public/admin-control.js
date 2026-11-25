'use strict';
// ============================================================================================
// MISSION 8 — interface du PDG : « Contrôle des comptes » et « Inscriptions, codes et alertes ».
//
// Deux points de montage, appelés par public/admin.js (aucune modification du code existant
// n'est nécessaire au-delà de l'ajout des deux vues) :
//   QRIAAdminControl.mountAccounts({ root })   → tableau de bord, inscriptions, marchands,
//                                                gestionnaires, quotas d'équipe, codes terrain, audit
//   QRIAAdminNotifications.mount({ root })     → centre de notifications
//
// Toutes les actions appellent les routes /api/admin/control/* : rien n'est simulé en local.
// ============================================================================================

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function fmtDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function fmtDay(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('fr-FR');
  }
  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      ...options,
      body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = null; }
    if (!response.ok) {
      const error = new Error(payload?.error || `Erreur ${response.status}`);
      error.code = payload?.code;
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }
  const STATUS_LABELS = {
    pending: 'En attente', in_review: 'En examen', approved: 'Approuvé', rejected: 'Refusé',
    suspended: 'Suspendu', needs_info: 'Infos demandées', archived: 'Archivé',
    active: 'Actif', blocked: 'Bloqué',
    available: 'Disponible', used: 'Utilisé', expired: 'Expiré', revoked: 'Révoqué',
  };
  const STATUS_TONE = {
    pending: 'warn', in_review: 'info', needs_info: 'info', approved: 'ok', active: 'ok',
    rejected: 'danger', suspended: 'muted', blocked: 'danger', archived: 'muted',
    available: 'ok', used: 'muted', expired: 'warn', revoked: 'danger',
  };
  const badge = (status) => `<span class="ctl-badge ${STATUS_TONE[status] || 'muted'}">${esc(STATUS_LABELS[status] || status || '—')}</span>`;

  // ------------------------------------------------------------------ outils partagés
  function lightbox(url) {
    const overlay = document.createElement('div');
    overlay.className = 'ctl-lightbox';
    overlay.innerHTML = `<button type="button">Fermer</button><img alt="Photo de l’établissement">`;
    $('img', overlay).src = url;
    $('button', overlay).addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  const Accounts = (() => {
    const state = { tab: 'dashboard', filters: {}, selections: {}, cache: {} };
    let root = null;
    let notify = (message) => window.QRIAAdminNotify?.(message);

    const TABS = [
      ['dashboard', 'Tableau de bord'],
      ['registrations', 'Inscriptions'],
      ['merchants', 'Comptes marchands'],
      ['managers', 'Comptes gestionnaires'],
      ['codes', 'Codes terrain'],
      ['quotas', 'Limites des équipes'],
      ['resets', 'Réinitialisations d’accès'],
      ['audit', 'Journal d’audit'],
    ];

    function shell(content) {
      root.innerHTML = `<div class="ctl-shell">
        <div class="ctl-tabs" role="tablist">${TABS.map(([key, label]) =>
          `<button type="button" class="ctl-tab" role="tab" data-ctl-tab="${key}" aria-selected="${state.tab === key}">${label}<span class="ctl-count" data-ctl-count="${key}" hidden>0</span></button>`).join('')}</div>
        <div data-ctl-body>${content}</div>
      </div>`;
      $$('[data-ctl-tab]', root).forEach((button) => button.addEventListener('click', () => {
        state.tab = button.dataset.ctlTab;
        load();
      }));
    }

    function body(html) { const node = $('[data-ctl-body]', root); if (node) node.innerHTML = html; }
    function count(key, value) {
      const node = $(`[data-ctl-count="${key}"]`, root);
      if (!node) return;
      node.hidden = !(Number(value) > 0);
      node.textContent = String(value);
    }

    async function load() {
      shell('<div class="ctl-loading">Chargement…</div>');
      try {
        if (state.tab === 'dashboard') await renderDashboard();
        else if (state.tab === 'registrations') await renderRegistrations();
        else if (state.tab === 'merchants') await renderMerchants();
        else if (state.tab === 'managers') await renderManagers();
        else if (state.tab === 'codes') await renderCodes();
        else if (state.tab === 'quotas') await renderQuotas();
        else if (state.tab === 'resets') await renderResets();
        else if (state.tab === 'audit') await renderAudit();
      } catch (error) {
        body(`<div class="ctl-alert error">${esc(error.message)}</div>`);
      }
    }

    // ---------------------------------------------------------------- tableau de bord
    async function renderDashboard() {
      const filterQuery = new URLSearchParams();
      if (state.filters.from) filterQuery.set('from', state.filters.from);
      if (state.filters.to) filterQuery.set('to', state.filters.to);
      const { data } = await api(`/api/admin/control/overview?${filterQuery}`);
      const kpi = (label, value, hint, tone = '') => `<div class="ctl-kpi ${tone}"><div class="label">${label}</div><div class="value">${value}</div><div class="hint">${hint || ''}</div></div>`;
      body(`
        <div class="ctl-toolbar">
          <div class="ctl-field"><label for="ctlFrom">Du</label><input id="ctlFrom" type="date" value="${esc(state.filters.from || '')}"></div>
          <div class="ctl-field"><label for="ctlTo">Au</label><input id="ctlTo" type="date" value="${esc(state.filters.to || '')}"></div>
          <button class="button button-small" type="button" id="ctlApplyDates">Appliquer</button>
          <button class="button button-secondary button-small" type="button" id="ctlClearDates">Tout l’historique</button>
          <span class="spacer"></span>
          <span class="ctl-badge info">Alertes non lues : ${Number(data.notifications?.unread || 0)}</span>
        </div>
        <div class="ctl-kpis">
          ${kpi('Marchands', Number(data.merchants?.total || 0), 'comptes actifs au total')}
          ${kpi('Inscriptions en attente', Number(data.merchants?.pending || 0) + Number(data.merchants?.inReview || 0), 'à traiter par le PDG', Number(data.merchants?.pending || 0) > 0 ? 'warn' : '')}
          ${kpi('Infos demandées', Number(data.merchants?.needsInfo || 0), 'en attente du demandeur')}
          ${kpi('Validées', Number(data.merchants?.approved || 0), 'depuis le début', 'ok')}
          ${kpi('Refusées', Number(data.merchants?.rejected || 0), 'depuis le début')}
          ${kpi('Gestionnaires', Number(data.managers?.total || 0), `${Number(data.managers?.active || 0)} actifs · ${Number(data.managers?.suspended || 0)} suspendus`)}
          ${kpi('Inscriptions terrain', Number(data.field?.enrollments || 0), 'réalisées par code')}
          ${kpi('Codes disponibles', Number(data.field?.codesAvailable || 0), `${Number(data.field?.codesUsed || 0)} utilisés · ${Number(data.field?.codesExpired || 0)} expirés`)}
          ${kpi('Gérants généraux', Number(data.team?.generalManagers || 0), 'tous marchands')}
          ${kpi('Serveuses / serveurs', Number(data.team?.waitresses || 0), 'tous marchands')}
          ${kpi('Marchands au quota', Number(data.team?.merchantsAtQuota || 0), 'ne peuvent plus créer', Number(data.team?.merchantsAtQuota || 0) > 0 ? 'warn' : '')}
        </div>

        <div class="ctl-grid-2" style="margin-top:14px">
          <div class="ctl-card">
            <h3>Dernières opérations sensibles</h3>
            ${(data.recent?.sensitive || []).length ? `<div class="ctl-rows">${data.recent.sensitive.map((row) => `
              <div class="ctl-row"><span class="k">${esc(row.summary || row.action)}</span><span class="v">${fmtDate(row.createdAt)}</span></div>`).join('')}</div>`
              : '<div class="ctl-empty">Aucune opération sensible enregistrée.</div>'}
          </div>
          <div class="ctl-card">
            <h3>Marchands ayant atteint leurs quotas</h3>
            ${(data.team?.merchantsAtQuotaList || []).length ? `<div class="ctl-table-wrap"><table class="ctl-table"><thead><tr><th>Marchand</th><th>Gérant</th><th>Serveuses</th></tr></thead><tbody>
              ${data.team.merchantsAtQuotaList.map((row) => `<tr><td>${esc(row.displayName)}</td>
                <td>${Number(row.usedGeneralManagers)}/${Number(row.maxGeneralManagers)}</td>
                <td>${Number(row.usedWaitresses)}/${Number(row.maxWaitresses)}</td></tr>`).join('')}
            </tbody></table></div>` : '<div class="ctl-empty">Aucun marchand au maximum de son équipe.</div>'}
          </div>
        </div>

        <div class="ctl-card" style="margin-top:14px">
          <h3>Dernières activités des gestionnaires</h3>
          ${(data.recent?.managerActivity || []).length ? `<div class="ctl-rows">${data.recent.managerActivity.map((row) => `
            <div class="ctl-row"><span class="k">${esc(row.actorLabel || '—')} · ${esc(row.summary || row.action)}</span><span class="v">${fmtDate(row.createdAt)}</span></div>`).join('')}</div>`
            : '<div class="ctl-empty">Aucune activité enregistrée.</div>'}
        </div>`);
      $('#ctlApplyDates').addEventListener('click', () => {
        state.filters = { from: $('#ctlFrom').value || '', to: $('#ctlTo').value || '' };
        load();
      });
      $('#ctlClearDates').addEventListener('click', () => { state.filters = {}; load(); });
    }

    // ---------------------------------------------------------------- inscriptions
    async function renderRegistrations() {
      const filters = state.filters.registrations || { status: 'open', type: '', managerId: '' };
      const query = new URLSearchParams({ status: filters.status || 'all' });
      if (filters.type) query.set('type', filters.type);
      if (filters.managerId) query.set('managerId', filters.managerId);
      const result = await api(`/api/admin/control/registrations?${query}`);
      const rows = result.data || [];
      const counts = result.counts || {};
      count('registrations', Number(counts.open || 0));
      body(`
        <div class="ctl-toolbar">
          <select id="ctlRegStatus" aria-label="Filtrer par statut">
            ${[['open', 'À traiter'], ['pending', 'En attente'], ['needs_info', 'Infos demandées'], ['in_review', 'En examen'],
               ['approved', 'Approuvées'], ['rejected', 'Refusées'], ['suspended', 'Suspendues'], ['all', 'Toutes']]
              .map(([value, label]) => `<option value="${value}" ${filters.status === value ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
          <select id="ctlRegType" aria-label="Filtrer par origine">
            <option value="">Toutes origines</option>
            <option value="self_service" ${filters.type === 'self_service' ? 'selected' : ''}>Demande directe</option>
            <option value="field" ${filters.type === 'field' ? 'selected' : ''}>Code terrain</option>
          </select>
          <span class="spacer"></span>
          <span class="ctl-badge warn">${Number(counts.pending || 0)} en attente</span>
          <span class="ctl-badge info">${Number(counts.needs_info || 0)} à compléter</span>
        </div>
        <div class="ctl-table-wrap"><table class="ctl-table">
          <thead><tr><th>Référence</th><th>Établissement</th><th>Contact</th><th>Origine</th><th>Reçue le</th><th>Statut</th><th>Actions</th></tr></thead>
          <tbody>${rows.length ? rows.map((row) => `
            <tr data-reg-row="${esc(row.id)}">
              <td><strong>${esc(row.reference)}</strong></td>
              <td>${esc(row.businessName)}<div class="hint">${esc(row.city || '')}</div></td>
              <td>${esc(row.contactName || '—')}<div class="hint">${esc(row.phone || '')}</div></td>
              <td>${row.source === 'field' ? `<span class="ctl-badge info">Terrain</span><div class="hint">${esc(row.fieldManagerLabel || 'gestionnaire')}</div>` : '<span class="ctl-badge muted">Directe</span>'}</td>
              <td>${fmtDate(row.createdAt)}</td>
              <td>${badge(row.status)}</td>
              <td><div class="ctl-actions">
                <button class="button button-small" type="button" data-reg-open="${esc(row.id)}">Dossier</button>
                ${['pending', 'in_review', 'needs_info'].includes(row.status) ? `<button class="button button-primary button-small" type="button" data-reg-approve="${esc(row.id)}">Approuver</button>` : ''}
              </div></td>
            </tr>`).join('') : '<tr><td colspan="7"><div class="ctl-empty">Aucune demande pour ce filtre.</div></td></tr>'}
          </tbody></table></div>`);

      $('#ctlRegStatus').addEventListener('change', (event) => {
        state.filters.registrations = { ...filters, status: event.target.value };
        load();
      });
      $('#ctlRegType').addEventListener('change', (event) => {
        state.filters.registrations = { ...filters, type: event.target.value };
        load();
      });
      $$('[data-reg-open]').forEach((button) => button.addEventListener('click', () => openRegistration(button.dataset.regOpen)));
      $$('[data-reg-approve]').forEach((button) => button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await api(`/api/admin/merchant-registrations/${button.dataset.regApprove}/decision`, { method: 'POST', body: { action: 'approve', reason: 'Approbation depuis le contrôle des comptes.' } });
          notify('Inscription approuvée. Le compte marchand est actif.');
          await load();
        } catch (error) { notify(error.message); button.disabled = false; }
      }));
    }

    async function openRegistration(id) {
      const { data: reg } = await api(`/api/admin/control/registrations/${id}`);
      const photos = reg.photos || [];
      const panel = document.createElement('div');
      panel.className = 'ctl-lightbox';
      panel.style.background = 'rgba(9,9,11,.6)';
      panel.innerHTML = `<div class="ctl-card" style="max-width:820px;width:min(94vw,820px);max-height:88vh;overflow:auto;text-align:left">
        <div class="ctl-toolbar" style="margin-bottom:10px">
          <h3 style="margin:0;flex:1 1 auto">${esc(reg.businessName)} <span class="ctl-badge muted">${esc(reg.reference)}</span> ${badge(reg.status)}</h3>
          <button class="button button-secondary button-small" type="button" data-close>Fermer</button>
        </div>
        <div class="ctl-grid-2">
          <div class="ctl-rows">
            <div class="ctl-row"><span class="k">Responsable</span><span class="v">${esc(reg.contactName || '—')}</span></div>
            <div class="ctl-row"><span class="k">Téléphone</span><span class="v">${esc(reg.phone || '—')}</span></div>
            <div class="ctl-row"><span class="k">E-mail</span><span class="v">${esc(reg.email || '—')}</span></div>
            <div class="ctl-row"><span class="k">Activité</span><span class="v">${esc(reg.activityDomainLabel || reg.activityDomain || '—')}</span></div>
            <div class="ctl-row"><span class="k">Ville / quartier</span><span class="v">${esc([reg.city, reg.location].filter(Boolean).join(' · ') || '—')}</span></div>
            <div class="ctl-row"><span class="k">Adresse</span><span class="v">${esc(reg.address || '—')}</span></div>
            <div class="ctl-row"><span class="k">Reçue le</span><span class="v">${fmtDate(reg.createdAt)}</span></div>
            ${reg.field ? `<div class="ctl-row"><span class="k">Ouverte par</span><span class="v">${esc(reg.field.managerName)} (@${esc(reg.field.managerUsername)})<br><span class="hint">code ${esc(reg.field.codeHint || '')}</span></span></div>` : ''}
          </div>
          <div>
            <h4 style="margin-top:0">Photos de l’établissement (${photos.length})</h4>
            ${photos.length ? `<div class="ctl-gallery">${photos.map((photo) => `
              <figure><img alt="${esc(photo.label || 'Photo')}" data-photo="${esc(photo.id)}" src="/api/admin/control/registrations/${encodeURIComponent(reg.id)}/photos/${encodeURIComponent(photo.id)}">
              <figcaption>${esc(photo.label || 'Photo')} · ${Math.round(Number(photo.byteSize || 0) / 1024)} Ko</figcaption></figure>`).join('')}</div>`
              : '<div class="ctl-empty">Aucune photo jointe.</div>'}
            <h4>Description</h4>
            <p style="font-size:.85rem;color:#4b5563">${esc(reg.description || '—')}</p>
          </div>
        </div>
        ${reg.infoRequested ? `<div class="ctl-alert warn" style="margin-top:12px">Complément demandé : ${esc(reg.infoRequested)}</div>` : ''}
        <div class="ctl-toolbar" style="margin-top:14px">
          ${['pending', 'in_review', 'needs_info'].includes(reg.status) ? `
            <button class="button button-primary button-small" type="button" data-act="approve">Approuver</button>
            <button class="button button-danger button-small" type="button" data-act="reject">Refuser</button>
            <button class="button button-secondary button-small" type="button" data-act="info">Demander un complément</button>` : ''}
          ${reg.status === 'approved' ? '<button class="button button-danger button-small" type="button" data-act="suspend">Suspendre le compte</button>' : ''}
        </div>
      </div>`;
      $('[data-close]', panel).addEventListener('click', () => panel.remove());
      panel.addEventListener('click', (event) => { if (event.target === panel) panel.remove(); });
      $$('[data-photo]', panel).forEach((img) => img.addEventListener('click', () => lightbox(img.src)));
      const act = async (action, body) => {
        try {
          if (action === 'info') {
            const message = window.prompt('Que manque-t-il au demandeur ?', 'Merci d’envoyer une photo de la devanture prise de jour.');
            if (!message) return;
            await api(`/api/admin/control/registrations/${reg.id}/request-info`, { method: 'POST', body: { message } });
          } else {
            const reason = action === 'approve' ? 'Dossier complet.' : window.prompt(action === 'reject' ? 'Motif du refus ?' : 'Motif de la suspension ?', '') || '';
            if (action !== 'approve' && !reason) return;
            await api(`/api/admin/merchant-registrations/${reg.id}/decision`, { method: 'POST', body: { action, reason } });
          }
          panel.remove();
          notify('Décision enregistrée.');
          await load();
        } catch (error) { notify(error.message); }
      };
      $$('[data-act]', panel).forEach((button) => button.addEventListener('click', () => act(button.dataset.act)));
      document.body.appendChild(panel);
    }

    // ---------------------------------------------------------------- marchands
    async function renderMerchants() {
      const filters = state.filters.merchants || { search: '', status: '' };
      const query = new URLSearchParams();
      if (filters.search) query.set('search', filters.search);
      if (filters.status) query.set('status', filters.status);
      const result = await api(`/api/admin/control/merchants?${query}`);
      const rows = result.data || [];
      body(`
        <div class="ctl-toolbar">
          <input id="ctlMerchantSearch" type="search" placeholder="Nom, identifiant, téléphone, boutique" value="${esc(filters.search)}" aria-label="Rechercher un marchand">
          <select id="ctlMerchantStatus" aria-label="Filtrer par statut">
            <option value="">Tous les statuts</option>
            ${['active', 'suspended', 'blocked'].map((value) => `<option value="${value}" ${filters.status === value ? 'selected' : ''}>${STATUS_LABELS[value]}</option>`).join('')}
          </select>
          <span class="spacer"></span><span class="ctl-badge muted">${rows.length} compte(s)</span>
        </div>
        <div class="ctl-table-wrap"><table class="ctl-table">
          <thead><tr><th>Marchand</th><th>Boutique</th><th>Équipe</th><th>QR</th><th>Commandes</th><th>Scans</th><th>Statut</th><th>Actions</th></tr></thead>
          <tbody>${rows.length ? rows.map((row) => `
            <tr>
              <td><strong>${esc(row.displayName)}</strong><div class="hint">@${esc(row.username)} · ${esc(row.phone || '')}</div></td>
              <td>${esc(row.storeName || '—')}<div class="hint">${row.storePublished ? 'publiée' : 'non publiée'}</div></td>
              <td>${Number(row.usedGeneralManagers || 0)}/${Number(row.maxGeneralManagers || 0)} gérant<br>${Number(row.usedWaitresses || 0)}/${Number(row.maxWaitresses || 0)} serveuse(s)</td>
              <td>${Number(row.qrCount || 0)}</td>
              <td>${Number(row.orderCount || 0)}</td>
              <td>${Number(row.scanCount || 0)}</td>
              <td>${badge(row.status)}</td>
              <td><div class="ctl-actions"><button class="button button-small" type="button" data-merchant-open="${esc(row.id)}">Fiche</button>
                <button class="button button-secondary button-small" type="button" data-merchant-assign="${esc(row.id)}" title="Rattacher ce marchand à un gestionnaire">Réattribuer</button></div>
                ${row.managerUnavailable || !row.hasSupervisor ? `<div class="hint" style="color:#b45309">${row.managerName ? `gestionnaire ${esc(row.managerName)} indisponible` : 'aucun gestionnaire rattaché'}</div>` : ''}</td>
            </tr>`).join('') : '<tr><td colspan="8"><div class="ctl-empty">Aucun marchand ne correspond à cette recherche.</div></td></tr>'}
          </tbody></table></div>`);
      let timer = null;
      $('#ctlMerchantSearch').addEventListener('input', (event) => {
        clearTimeout(timer);
        timer = setTimeout(() => { state.filters.merchants = { ...filters, search: event.target.value }; load(); }, 350);
      });
      $('#ctlMerchantStatus').addEventListener('change', (event) => { state.filters.merchants = { ...filters, status: event.target.value }; load(); });
      $$('[data-merchant-open]').forEach((button) => button.addEventListener('click', () => openMerchant(button.dataset.merchantOpen)));
      $$('[data-merchant-assign]').forEach((button) => button.addEventListener('click', () => openAssignment(button.dataset.merchantAssign)));
    }

    // ---------------------------------------------------------------------------------------
    // RÉATTRIBUTION D’UN MARCHAND (Mission 9)
    // Le marchand reste propriétaire de son compte : on ne change que le gestionnaire qui
    // l’accompagne et les permissions qui lui sont ouvertes. Chaque changement est journalisé
    // côté serveur (/api/admin/merchants/:id/assignments) et visible par le marchand.
    // ---------------------------------------------------------------------------------------
    const ASSIGNMENT_PERMISSIONS = [
      ['canManageStore', 'Informations et configuration de l’établissement'],
      ['canManageProducts', 'Produits et prix'],
      ['canManageOrders', 'Commandes et statistiques'],
      ['canCreateStoreQr', 'QR codes du point de vente'],
      ['canViewAudit', 'Journal des interventions'],
    ];

    async function openAssignment(merchantId) {
      let context;
      try {
        const [merchants, managers] = await Promise.all([
          api('/api/admin/control/merchants'),
          api('/api/admin/control/managers').catch(() => ({ data: [] })),
        ]);
        context = { merchant: (merchants.data || []).find((row) => row.id === merchantId) || {}, managers: (managers.data || []) };
      } catch (error) { return notify(error.message); }
      const { merchant, managers } = context;
      const candidates = managers.filter((row) => !row.deletedAt);
      const existing = await api(`/api/admin/merchants/${encodeURIComponent(merchantId)}/assignments`).catch(() => ({ data: [] }));
      const current = (existing.data || [])[0] || null;

      const panel = document.createElement('div');
      panel.className = 'ctl-lightbox';
      panel.style.background = 'rgba(9,9,11,.6)';
      panel.innerHTML = `<div class="ctl-card" style="max-width:640px;width:min(94vw,640px);text-align:left">
        <div class="ctl-toolbar" style="margin-bottom:10px">
          <h3 style="margin:0;flex:1 1 auto">Réattribuer « ${esc(merchant.displayName || 'ce marchand')} »</h3>
          <button class="button button-secondary button-small" type="button" data-close>Fermer</button>
        </div>
        <p class="hint" style="margin-top:0">Le compte et les données restent la propriété du marchand. Vous choisissez seulement le gestionnaire qui l’accompagne : il ne peut agir que dans les limites cochées, et le marchand voit toutes ses interventions.</p>
        ${merchant.managerName ? `<p class="hint">Gestionnaire d’origine : <strong>${esc(merchant.managerName)}</strong>${merchant.managerStatus && merchant.managerStatus !== 'active' ? ` — compte ${esc(merchant.managerStatus)}` : ''}.</p>` : '<p class="hint" style="color:#b45309">Aucun gestionnaire rattaché : ce marchand est orphelin.</p>'}
        <div class="ctl-field"><label>Gestionnaire</label>
          <select id="ctlAssignManager">
            <option value="">— Aucun (marchand autonome) —</option>
            ${candidates.map((row) => `<option value="${esc(row.id)}" ${current && current.managerId === row.id ? 'selected' : ''}>${esc(row.displayName)} · @${esc(row.username)}${row.status !== 'active' ? ` (${esc(row.status)})` : ''}</option>`).join('')}
          </select>
        </div>
        <div class="ctl-form-row" style="margin-top:10px"><div class="ctl-field"><label>Permissions ouvertes</label>
          ${ASSIGNMENT_PERMISSIONS.map(([key, label]) => `<label style="display:flex;gap:8px;align-items:center;font-size:.86rem;margin:4px 0">
            <input type="checkbox" data-assign-perm="${key}" style="width:auto" ${current && current[key] ? 'checked' : ''}> ${esc(label)}</label>`).join('')}
        </div></div>
        <div class="ctl-toolbar" style="margin-top:12px">
          <button class="button button-primary button-small" type="button" data-assign-save>Enregistrer</button>
          ${current ? '<button class="button button-danger button-small" type="button" data-assign-remove>Retirer l’attribution actuelle</button>' : ''}
          <span class="hint" data-assign-status></span>
        </div>
      </div>`;
      document.body.appendChild(panel);
      $('[data-close]', panel).addEventListener('click', () => panel.remove());
      panel.addEventListener('click', (event) => { if (event.target === panel) panel.remove(); });
      const status = $('[data-assign-status]', panel);

      $('[data-assign-save]', panel).addEventListener('click', async () => {
        const managerId = $('#ctlAssignManager', panel).value;
        if (!managerId) {
          // « Aucun » : on retire l'attribution courante, jamais le marchand lui-même.
          if (!current) { status.textContent = 'Aucune attribution à retirer.'; return; }
          try {
            await api(`/api/admin/merchants/${encodeURIComponent(merchantId)}/assignments/${encodeURIComponent(current.managerId)}`, { method: 'DELETE' });
            panel.remove(); notify('Marchand détaché : il reste autonome et conserve tous ses accès.'); load();
          } catch (error) { status.textContent = error.message; }
          return;
        }
        const body = { managerId };
        ASSIGNMENT_PERMISSIONS.forEach(([key]) => { body[key] = $(`[data-assign-perm="${key}"]`, panel).checked; });
        try {
          await api(`/api/admin/merchants/${encodeURIComponent(merchantId)}/assignments`, { method: 'POST', body });
          panel.remove(); notify('Rattachement enregistré : le gestionnaire voit désormais ce marchand.'); load();
        } catch (error) { status.textContent = error.message; }
      });

      $('[data-assign-remove]', panel)?.addEventListener('click', async () => {
        try {
          await api(`/api/admin/merchants/${encodeURIComponent(merchantId)}/assignments/${encodeURIComponent(current.managerId)}`, { method: 'DELETE' });
          panel.remove(); notify('Attribution retirée.'); load();
        } catch (error) { status.textContent = error.message; }
      });
    }

    async function openMerchant(id) {
      const { data } = await api(`/api/admin/control/merchants/${id}`);
      const merchant = data.merchant || {};
      const quotas = data.quotas || {};
      const panel = document.createElement('div');
      panel.className = 'ctl-lightbox';
      panel.style.background = 'rgba(9,9,11,.6)';
      const teamRows = (data.team || []).map((member) => `<tr>
        <td>${esc(member.designation || member.fullName)}<div class="hint">${member.role === 'general_manager' ? 'Gérant général' : 'Serveuse / serveur'}</div></td>
        <td>${badge(member.status)}</td>
        <td>${fmtDate(member.lastLoginAt)}</td>
        <td>${Number(member.points || 0)}</td>
        <td>${member.status === 'active' || member.status === 'pending'
          ? `<button class="button button-danger button-small" type="button" data-member-cut="${esc(member.id)}">Couper l’accès</button>`
          : `<button class="button button-secondary button-small" type="button" data-member-restore="${esc(member.id)}">Rétablir</button>`}</td>
      </tr>`).join('');
      panel.innerHTML = `<div class="ctl-card" style="max-width:900px;width:min(95vw,900px);max-height:90vh;overflow:auto;text-align:left">
        <div class="ctl-toolbar" style="margin-bottom:10px">
          <h3 style="margin:0;flex:1 1 auto">${esc(merchant.displayName)} ${badge(merchant.status)}</h3>
          <button class="button button-secondary button-small" type="button" data-close>Fermer</button>
        </div>
        <div class="ctl-grid-2">
          <div class="ctl-rows">
            <div class="ctl-row"><span class="k">Identifiant</span><span class="v">@${esc(merchant.username)}</span></div>
            <div class="ctl-row"><span class="k">Téléphone</span><span class="v">${esc(merchant.phone || '—')}</span></div>
            <div class="ctl-row"><span class="k">E-mail</span><span class="v">${esc(merchant.email || '—')}</span></div>
            <div class="ctl-row"><span class="k">Inscrit le</span><span class="v">${fmtDay(merchant.createdAt)}</span></div>
            <div class="ctl-row"><span class="k">Boutique</span><span class="v">${esc(data.store?.name || '—')}</span></div>
            <div class="ctl-row"><span class="k">Quotas d’équipe</span><span class="v">${Number(data.counts?.generalManagers || 0)}/${Number(quotas.effectiveMaxGeneralManagers || 0)} gérant · ${Number(data.counts?.waitresses || 0)}/${Number(quotas.effectiveMaxWaitresses || 0)} serveuse(s)</span></div>
            <div class="ctl-row"><span class="k">Source du quota</span><span class="v">${{ platform: 'général', override: 'fixé par le PDG', field_code: 'hérité du code terrain', admin_code: 'code du PDG' }[quotas.source] || quotas.source || '—'}</span></div>
            <div class="ctl-row"><span class="k">Consignations ouvertes</span><span class="v">${Number(data.consignments?.open || 0)} (${Number(data.consignments?.openUnits || 0)} unité(s))</span></div>
            <div class="ctl-row"><span class="k">Scans</span><span class="v">${Number(data.scans?.total || 0)} au total · ${Number(data.scans?.last30 || 0)} sur 30 jours</span></div>
          </div>
          <div class="ctl-rows">
            <div class="ctl-row"><span class="k">Produits</span><span class="v">${Number(data.products?.total || 0)}</span></div>
            <div class="ctl-row"><span class="k">Commandes</span><span class="v">${Number(data.orders?.total || 0)}</span></div>
            <div class="ctl-row"><span class="k">QR codes</span><span class="v">${(data.qrCodes || []).length}</span></div>
            ${(data.registration ? `<div class="ctl-row"><span class="k">Dossier d’inscription</span><span class="v">${esc(data.registration.reference)} · ${badge(data.registration.status)}</span></div>` : '')}
          </div>
        </div>

        <h4>Équipe (${(data.team || []).length})</h4>
        ${teamRows ? `<div class="ctl-table-wrap"><table class="ctl-table"><thead><tr><th>Membre</th><th>Statut</th><th>Dernière connexion</th><th>Points</th><th>Accès</th></tr></thead><tbody>${teamRows}</tbody></table></div>`
          : '<div class="ctl-empty">Aucun membre d’équipe.</div>'}

        ${(data.registration?.photos || []).length ? `<h4>Photos de l’établissement</h4><div class="ctl-gallery">
          ${data.registration.photos.map((photo) => `<figure><img alt="${esc(photo.label || 'Photo')}" src="/api/admin/control/registrations/${encodeURIComponent(data.registration.id)}/photos/${encodeURIComponent(photo.id)}"><figcaption>${esc(photo.label || 'Photo')}</figcaption></figure>`).join('')}
        </div>` : ''}

        <h4>Quotas d’équipe</h4>
        <div class="ctl-form">
          <div class="ctl-form-row">
            <div class="ctl-field"><label>Gérants généraux</label><input type="number" min="0" max="200" value="${Number(quotas.maxGeneralManagers || 0)}" data-quota="general"></div>
            <div class="ctl-field"><label>Serveuses / serveurs</label><input type="number" min="0" max="500" value="${Number(quotas.maxWaitresses || 0)}" data-quota="waitress"></div>
            <div class="ctl-field"><label>Dépassement : gérants</label><input type="number" min="0" max="200" value="${Number(quotas.extraGeneralManagers || 0)}" data-quota="extraGeneral"></div>
            <div class="ctl-field"><label>Dépassement : serveuses</label><input type="number" min="0" max="500" value="${Number(quotas.extraWaitresses || 0)}" data-quota="extraWaitress"></div>
          </div>
          <div class="ctl-form-row">
            <div class="ctl-field"><label>Fin du dépassement</label><input type="date" data-quota="extraExpiresAt" value="${quotas.extraExpiresAt ? String(quotas.extraExpiresAt).slice(0, 10) : ''}"></div>
            <div class="ctl-field"><label>Motif</label><input type="text" data-quota="reason" maxlength="300" value="${esc(quotas.reason || '')}" placeholder="Ex. saison haute"></div>
          </div>
          <label style="font-size:.82rem;display:flex;gap:8px;align-items:center"><input type="checkbox" data-quota="suspendedReservesSlot" ${quotas.suspendedReservesSlot ? 'checked' : ''} style="width:auto"> Un compte suspendu réserve encore une place</label>
          <label style="font-size:.82rem;display:flex;gap:8px;align-items:center"><input type="checkbox" data-quota="merchantCanEditQuotas" ${quotas.merchantCanEditQuotas ? 'checked' : ''} style="width:auto"> Autoriser ce marchand à modifier lui-même ses quotas</label>
          <div class="ctl-toolbar"><button class="button button-primary button-small" type="button" data-save-quotas>Enregistrer les quotas</button>
            <span class="hint">Les nouveaux chiffres s’appliquent immédiatement. Les comptes existants ne sont jamais supprimés.</span></div>
        </div>

        <h4>Compte</h4>
        <div class="ctl-toolbar">
          ${merchant.status === 'active'
            ? '<button class="button button-danger button-small" type="button" data-account="suspended">Suspendre le compte</button>'
            : '<button class="button button-small" type="button" data-account="active">Réactiver le compte</button>'}
          <button class="button button-secondary button-small" type="button" data-account="blocked">Bloquer définitivement</button>
        </div>
      </div>`;
      $('[data-close]', panel).addEventListener('click', () => panel.remove());
      panel.addEventListener('click', (event) => { if (event.target === panel) panel.remove(); });
      const value = (key) => $(`[data-quota="${key}"]`, panel);
      $('[data-save-quotas]', panel).addEventListener('click', async () => {
        try {
          await api(`/api/admin/control/merchants/${merchant.id}/quotas`, { method: 'PUT', body: {
            maxGeneralManagers: Number(value('general').value) || 0,
            maxWaitresses: Number(value('waitress').value) || 0,
            extraGeneralManagers: Number(value('extraGeneral').value) || 0,
            extraWaitresses: Number(value('extraWaitress').value) || 0,
            extraExpiresAt: value('extraExpiresAt').value || null,
            reason: value('reason').value,
            suspendedReservesSlot: value('suspendedReservesSlot').checked,
            merchantCanEditQuotas: value('merchantCanEditQuotas').checked,
          } });
          notify('Quotas enregistrés.');
          panel.remove();
          await load();
        } catch (error) { notify(error.message); }
      });
      $$('[data-member-cut]', panel).forEach((button) => button.addEventListener('click', async () => {
        const reason = window.prompt('Motif de la coupure d’accès ?', 'Décision du PDG') || '';
        if (!reason) return;
        try {
          await api(`/api/admin/control/merchants/${merchant.id}/team-members/${button.dataset.memberCut}/status`, { method: 'POST', body: { status: 'blocked', reason } });
          notify('Accès coupé immédiatement.');
          panel.remove(); await load();
        } catch (error) { notify(error.message); }
      }));
      $$('[data-member-restore]', panel).forEach((button) => button.addEventListener('click', async () => {
        try {
          await api(`/api/admin/control/merchants/${merchant.id}/team-members/${button.dataset.memberRestore}/status`, { method: 'POST', body: { status: 'active', reason: 'Rétabli par le PDG' } });
          notify('Accès rétabli.');
          panel.remove(); await load();
        } catch (error) { notify(error.message); }
      }));
      $$('[data-account]', panel).forEach((button) => button.addEventListener('click', async () => {
        const status = button.dataset.account;
        const reason = status === 'active' ? '' : (window.prompt('Motif ?', 'Décision du PDG') || '');
        if (status !== 'active' && !reason) return;
        try {
          await api(`/api/admin/control/merchants/${merchant.id}/account-status`, { method: 'POST', body: { status, reason } });
          notify('Statut du compte mis à jour.');
          panel.remove(); await load();
        } catch (error) { notify(error.message); }
      }));
      document.body.appendChild(panel);
    }

    // ---------------------------------------------------------------- gestionnaires
    // ---------------------------------------------------------------- réinitialisations (Mission 9)
    // Deux fonctions : émettre un code provisoire (INITIALES-XXXXXX, usage unique) pour n'importe
    // quel compte, et renseigner les coordonnées RÉELLES affichées par « Mot de passe oublié ? ».
    async function renderResets() {
      const [{ data: codes }, merchants, managers, settings] = await Promise.all([
        api('/api/admin/access-resets'),
        api('/api/admin/control/merchants?limit=200').catch(() => ({ data: [] })),
        api('/api/admin/control/managers').catch(() => ({ data: [] })),
        api('/api/admin/settings').catch(() => ({ data: {} })),
      ]);
      const merchantRows = merchants.data || [];
      const managerRows = managers.data || [];
      const contact = settings.data?.supportContact || {};
      const options = [
        ...merchantRows.map((row) => `<option value="merchant:${esc(row.id)}">Marchand — ${esc(row.displayName)} (@${esc(row.username)})</option>`),
        ...managerRows.map((row) => `<option value="manager:${esc(row.id)}">Gestionnaire — ${esc(row.displayName)} (@${esc(row.username)})</option>`),
      ].join('');
      body(`
        <div class="ctl-toolbar"><span class="ctl-badge muted">${(codes || []).length} code(s) provisoire(s) émis</span>
          <span class="spacer"></span><span class="hint">Un code provisoire sert UNE fois, expire, et impose un nouveau mot de passe personnel à la connexion.</span></div>
        <section class="ctl-card">
          <h3>Émettre un code provisoire</h3>
          <p class="hint">Format : initiales de l’établissement + 6 caractères aléatoires (exemple : CG-A2Z4TD). Le code n’est affiché qu’une seule fois et n’est jamais journalisé.</p>
          <div class="ctl-form-row">
            <label>Compte concerné<select id="ctlResetAccount">${options || '<option value="">Aucun compte disponible</option>'}</select></label>
            <label>Motif (facultatif)<input id="ctlResetReason" maxlength="240" placeholder="Mot de passe oublié"></label>
            <label>Validité<select id="ctlResetTtl"><option value="1">1 heure</option><option value="48" selected>48 heures</option><option value="168">7 jours</option></select></label>
            <button class="button button-small" type="button" id="ctlResetGenerate">Générer le code</button>
          </div>
          <div id="ctlResetOutput"></div>
        </section>
        <section class="ctl-card">
          <h3>Coordonnées affichées par « Mot de passe oublié ? »</h3>
          <p class="hint">Aucun numéro n’est inventé : seules ces valeurs, si elles sont renseignées, sont affichées aux utilisateurs.</p>
          <div class="ctl-form-row">
            <label>Téléphone de contact<input id="ctlSupportPhone" maxlength="32" value="${esc(contact.phone || '')}" placeholder="Laisser vide si inconnu"></label>
            <label>E-mail de contact<input id="ctlSupportEmail" maxlength="160" value="${esc(contact.email || '')}" placeholder="Laisser vide si inconnu"></label>
            <button class="button button-small" type="button" id="ctlSupportSave">Enregistrer</button>
          </div>
        </section>
        <h3>Historique des codes provisoires</h3>
        <div class="ctl-table-wrap"><table class="ctl-table">
          <thead><tr><th>Compte</th><th>Code</th><th>Émis par</th><th>Créé le</th><th>Expire le</th><th>Statut</th><th>Utilisé le</th><th></th></tr></thead>
          <tbody>${(codes || []).length ? codes.map((row) => `<tr>
            <td><strong>${esc(row.accountLabel || row.accountId)}</strong><div class="hint">${esc(row.accountType === 'merchant' ? 'Marchand' : 'Gestionnaire')}</div></td>
            <td><code>${esc(row.codePrefix || '')}-${esc(String(row.hint || '').replace(/^•+/, '••'))}</code></td>
            <td>${esc(row.requestedByLabel || '—')}<div class="hint">${esc(row.reason || '')}</div></td>
            <td>${esc(fmtDate(row.createdAt))}</td>
            <td>${esc(fmtDate(row.expiresAt))}</td>
            <td>${badge(row.status)}</td>
            <td>${row.usedAt ? esc(fmtDate(row.usedAt)) : '—'}</td>
            <td>${row.status === 'available' ? `<button class="button button-small button-secondary" type="button" data-reset-revoke="${esc(row.id)}">Révoquer</button>` : ''}</td>
          </tr>`).join('') : '<tr><td colspan="8"><div class="ctl-empty">Aucun code provisoire émis.</div></td></tr>'}</tbody>
        </table></div>`);

      $('#ctlResetGenerate')?.addEventListener('click', async () => {
        const [accountType, accountId] = String($('#ctlResetAccount')?.value || '').split(':');
        if (!accountId) return;
        try {
          const result = await api('/api/admin/access-resets', { method: 'POST', body: {
            accountType, accountId, reason: $('#ctlResetReason')?.value || '', ttlHours: Number($('#ctlResetTtl')?.value) || 48 } });
          const data = result.data || {};
          $('#ctlResetOutput').innerHTML = `<div class="ctl-alert ok">Code provisoire émis pour <strong>${esc(data.accountLabel || '')}</strong>.
            Il ne sera plus affiché.</div>
            <div class="ctl-code-big"><code>${esc(data.code || '')}</code>
              <button class="button button-small button-secondary" type="button" id="ctlCopyReset">Copier</button></div>
            <p class="hint">Identifiant : ${esc(data.username || '—')} · valable jusqu’au ${esc(fmtDate(data.expiresAt))}.</p>`;
          $('#ctlCopyReset')?.addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(data.code); } catch (_) { window.prompt('Copiez ce code :', data.code); }
          });
          await renderResets();
        } catch (error) { toast(error.message); }
      });
      $('#ctlSupportSave')?.addEventListener('click', async () => {
        try {
          await api('/api/admin/settings', { method: 'PUT', body: { supportContact: {
            phone: String($('#ctlSupportPhone')?.value || '').trim(), email: String($('#ctlSupportEmail')?.value || '').trim() } } });
          toast('Coordonnées enregistrées.');
        } catch (error) { toast(error.message); }
      });
      $$('[data-reset-revoke]').forEach((button) => button.addEventListener('click', async () => {
        try { await api(`/api/admin/access-resets/${encodeURIComponent(button.dataset.resetRevoke)}/revoke`, { method: 'POST', body: {} });
          toast('Code révoqué.'); await renderResets(); }
        catch (error) { toast(error.message); }
      }));
    }

    async function renderManagers() {
      const { data } = await api('/api/admin/control/managers');
      const rows = data || [];
      body(`
        <div class="ctl-toolbar"><span class="ctl-badge muted">${rows.length} gestionnaire(s)</span>
          <span class="spacer"></span><span class="hint">Créez les comptes depuis la rubrique « Gestionnaires » existante ; cette vue pilote permissions, codes, points et historique.</span></div>
        <div class="ctl-table-wrap"><table class="ctl-table">
          <thead><tr><th>Gestionnaire</th><th>Statut</th><th>Codes générés</th><th>Inscriptions terrain</th><th>Points</th><th>Codes terrain</th><th>Actions</th></tr></thead>
          <tbody>${rows.length ? rows.map((row) => `
            <tr>
              <td><strong>${esc(row.displayName)}</strong><div class="hint">@${esc(row.username)} · ${esc(row.phone || row.email || '')}</div></td>
              <td>${badge(row.status)}</td>
              <td>${Number(row.codesGenerated || 0)}<div class="hint">${Number(row.codesUsed || 0)} utilisé(s)</div></td>
              <td>${Number(row.enrollments || 0)}</td>
              <td>${Number(row.points || 0)}${row.pointsProtected ? ' <span class="ctl-badge info">protégé</span>' : ''}</td>
              <td>${row.permissions?.canCreateFieldCodes ? '<span class="ctl-badge ok">autorisé</span>' : '<span class="ctl-badge muted">non autorisé</span>'}</td>
              <td><div class="ctl-actions"><button class="button button-small" type="button" data-manager-open="${esc(row.id)}">Fiche</button></div></td>
            </tr>`).join('') : '<tr><td colspan="7"><div class="ctl-empty">Aucun gestionnaire enregistré.</div></td></tr>'}
          </tbody></table></div>`);
      $$('[data-manager-open]').forEach((button) => button.addEventListener('click', () => openManager(button.dataset.managerOpen)));
    }

    async function openManager(id) {
      const { data } = await api(`/api/admin/control/managers/${id}`);
      const manager = data.manager || {};
      const points = data.points || { points: 0, events: [] };
      const codes = data.codes?.data || [];
      const history = data.history || [];
      const panel = document.createElement('div');
      panel.className = 'ctl-lightbox';
      panel.style.background = 'rgba(9,9,11,.6)';
      panel.innerHTML = `<div class="ctl-card" style="max-width:900px;width:min(95vw,900px);max-height:90vh;overflow:auto;text-align:left">
        <div class="ctl-toolbar" style="margin-bottom:10px">
          <h3 style="margin:0;flex:1 1 auto">${esc(manager.displayName)} ${badge(manager.status)}</h3>
          <button class="button button-secondary button-small" type="button" data-close>Fermer</button>
        </div>
        <div class="ctl-grid-2">
          <div class="ctl-rows">
            <div class="ctl-row"><span class="k">Identifiant</span><span class="v">@${esc(manager.username)}</span></div>
            <div class="ctl-row"><span class="k">Téléphone</span><span class="v">${esc(manager.phone || '—')}</span></div>
            <div class="ctl-row"><span class="k">E-mail</span><span class="v">${esc(manager.email || '—')}</span></div>
            <div class="ctl-row"><span class="k">Compte créé le</span><span class="v">${fmtDay(manager.createdAt)}</span></div>
            <div class="ctl-row"><span class="k">Dernière connexion</span><span class="v">${fmtDate(manager.lastLoginAt)}</span></div>
            <div class="ctl-row"><span class="k">Marchands attribués</span><span class="v">${(data.merchants || []).length}</span></div>
          </div>
          <div>
            <h4 style="margin-top:0">Permissions</h4>
            <div class="ctl-rows">
              ${[['canCreateCodes', 'Créer des codes QR'], ['canManageMerchants', 'Gérer des comptes marchands'],
                 ['canValidateMerchantRegistrations', 'Valider des inscriptions marchands'],
                 ['canCreateFieldCodes', 'Générer des codes d’inscription terrain'],
                 ['canViewFieldHistory', 'Consulter l’historique terrain']]
                .map(([key, label]) => `<label style="display:flex;gap:8px;align-items:center;font-size:.85rem"><input type="checkbox" data-perm="${key}" ${manager[key] ? 'checked' : ''} style="width:auto">${label}</label>`).join('')}
            </div>
            <div class="ctl-toolbar" style="margin-top:8px"><button class="button button-primary button-small" type="button" data-save-perms>Enregistrer les permissions</button></div>
            <div class="ctl-toolbar">
              ${manager.status === 'active'
                ? '<button class="button button-danger button-small" type="button" data-mstatus="suspended">Suspendre</button>'
                : '<button class="button button-small" type="button" data-mstatus="active">Réactiver</button>'}
              <button class="button button-secondary button-small" type="button" data-mstatus="blocked">Bloquer</button>
            </div>
          </div>
        </div>

        <h4>Points du gestionnaire — ${Number(points.points || 0)} point(s) ${manager.pointsCodeHash ? '<span class="ctl-badge info">code défini</span>' : '<span class="ctl-badge warn">aucun code</span>'}</h4>
        <div class="ctl-form">
          <div class="ctl-form-row">
            <div class="ctl-field"><label>Mouvement</label><input type="number" data-points="delta" placeholder="ex. 25 ou -10"></div>
            <div class="ctl-field"><label>Motif (obligatoire)</label><input type="text" data-points="reason" maxlength="300" placeholder="Ex. bonus inscriptions terrain"></div>
            <button class="button button-small" type="button" data-save-points>Enregistrer le mouvement</button>
          </div>
          <div class="ctl-form-row">
            <div class="ctl-field"><label>Code de sécurité (6 chiffres)</label><input type="text" inputmode="numeric" maxlength="6" data-points="code" placeholder="••••••"></div>
            <button class="button button-secondary button-small" type="button" data-save-code>Définir / réinitialiser</button>
            <label style="display:flex;gap:8px;align-items:center;font-size:.82rem"><input type="checkbox" data-points="required" ${manager.pointsCodeRequired ? 'checked' : ''} style="width:auto"> Exiger le code pour consulter ses points</label>
            <button class="button button-quiet button-small" type="button" data-save-policy>Appliquer la règle</button>
          </div>
        </div>
        ${(points.events || []).length ? `<div class="ctl-table-wrap" style="margin-top:10px"><table class="ctl-table">
          <thead><tr><th>Date</th><th>Avant</th><th>Après</th><th>Variation</th><th>Motif</th><th>Par</th></tr></thead>
          <tbody>${points.events.slice(0, 10).map((event) => `<tr><td>${fmtDate(event.createdAt)}</td><td>${Number(event.pointsBefore)}</td><td>${Number(event.pointsAfter)}</td>
            <td>${Number(event.delta) > 0 ? '+' : ''}${Number(event.delta)}</td><td>${esc(event.reason)}</td><td>${esc(event.actorLabel || '—')}</td></tr>`).join('')}</tbody>
        </table></div>` : '<div class="ctl-empty" style="margin-top:10px">Aucun mouvement de points enregistré.</div>'}

        <h4>Codes terrain générés (${codes.length})</h4>
        ${codes.length ? `<div class="ctl-table-wrap"><table class="ctl-table"><thead><tr><th>Indice</th><th>Statut</th><th>Créé le</th><th>Expire le</th><th>Utilisations</th></tr></thead>
          <tbody>${codes.slice(0, 15).map((code) => `<tr><td><code>••••-${esc(code.hint)}</code></td><td>${badge(code.status)}</td><td>${fmtDay(code.createdAt)}</td><td>${fmtDate(code.expiresAt)}</td><td>${Number(code.uses)}/${Number(code.maxUses)}</td></tr>`).join('')}</tbody></table></div>`
          : '<div class="ctl-empty">Aucun code généré par ce gestionnaire.</div>'}

        <h4>Inscriptions réalisées sur le terrain (${history.length})</h4>
        ${history.length ? `<div class="ctl-table-wrap"><table class="ctl-table"><thead><tr><th>Date</th><th>Établissement</th><th>Contact</th><th>Dossier</th><th>Statut</th></tr></thead>
          <tbody>${history.slice(0, 15).map((row) => `<tr><td>${fmtDate(row.usedAt)}</td><td>${esc(row.businessName || '—')}</td><td>${esc(row.phone || row.contactName || '—')}</td><td>${esc(row.reference || '—')}</td><td>${badge(row.status || 'pending')}</td></tr>`).join('')}</tbody></table></div>`
          : '<div class="ctl-empty">Aucune inscription terrain pour ce gestionnaire.</div>'}

        <h4>Historique des opérations</h4>
        ${(data.journal || []).length ? `<div class="ctl-rows">${data.journal.slice(0, 15).map((row) => `<div class="ctl-row"><span class="k">${esc(row.summary || row.action)}</span><span class="v">${fmtDate(row.createdAt)}</span></div>`).join('')}</div>`
          : '<div class="ctl-empty">Aucune opération enregistrée.</div>'}
      </div>`;
      $('[data-close]', panel).addEventListener('click', () => panel.remove());
      panel.addEventListener('click', (event) => { if (event.target === panel) panel.remove(); });
      $('[data-save-perms]', panel).addEventListener('click', async () => {
        const body = {};
        $$('[data-perm]', panel).forEach((input) => { body[input.dataset.perm] = input.checked; });
        try { await api(`/api/admin/control/managers/${manager.id}`, { method: 'PATCH', body }); notify('Permissions enregistrées.'); panel.remove(); await load(); }
        catch (error) { notify(error.message); }
      });
      $$('[data-mstatus]', panel).forEach((button) => button.addEventListener('click', async () => {
        const status = button.dataset.mstatus;
        const reason = status === 'active' ? '' : (window.prompt('Motif ?', 'Décision du PDG') || '');
        if (status !== 'active' && !reason) return;
        try { await api(`/api/admin/control/managers/${manager.id}/status`, { method: 'POST', body: { status, reason } }); notify('Statut mis à jour.'); panel.remove(); await load(); }
        catch (error) { notify(error.message); }
      }));
      $('[data-save-points]', panel).addEventListener('click', async () => {
        try {
          await api(`/api/admin/control/managers/${manager.id}/points`, { method: 'POST', body: {
            delta: Number($('[data-points="delta"]', panel).value), reason: $('[data-points="reason"]', panel).value } });
          notify('Mouvement de points enregistré et historisé.'); panel.remove(); await load();
        } catch (error) { notify(error.message); }
      });
      $('[data-save-code]', panel).addEventListener('click', async () => {
        const code = $('[data-points="code"]', panel).value.trim();
        try {
          await api(`/api/admin/control/managers/${manager.id}/points-code`, { method: 'POST', body: { code } });
          notify('Code de sécurité défini. Transmettez-le au gestionnaire de vive voix.');
          panel.remove(); await load();
        } catch (error) { notify(error.message); }
      });
      $('[data-save-policy]', panel).addEventListener('click', async () => {
        try {
          await api(`/api/admin/control/managers/${manager.id}/points-code-policy`, { method: 'POST', body: { required: $('[data-points="required"]', panel).checked } });
          notify('Règle enregistrée.'); panel.remove(); await load();
        } catch (error) { notify(error.message); }
      });
      document.body.appendChild(panel);
    }

    // ---------------------------------------------------------------- codes terrain
    async function renderCodes() {
      const filters = state.filters.codes || { status: 'all' };
      const result = await api(`/api/admin/control/field-codes?status=${encodeURIComponent(filters.status)}`);
      const rows = result.data || [];
      const counts = result.counts || {};
      const history = await api('/api/admin/control/field-codes/history?limit=20').catch(() => ({ data: [] }));
      count('codes', Number(counts.available || 0));
      body(`
        <div class="ctl-card">
          <h3>Générer des codes d’inscription terrain</h3>
          <p class="hint" style="margin:0 0 10px">Chaque code sert <strong>une seule fois</strong> et ouvre le formulaire de terrain. Il ne donne aucun droit d’administration : le dossier suit ensuite la validation normale du PDG.</p>
          <div class="ctl-form">
            <div class="ctl-form-row">
              <div class="ctl-field"><label>Nombre de codes (1 à 25)</label><input type="number" min="1" max="25" value="1" data-code="count"></div>
              <div class="ctl-field"><label>Validité (heures)</label><input type="number" min="1" max="720" value="72" data-code="ttl"></div>
              <div class="ctl-field"><label>Quota gérants pour ce code</label><input type="number" min="0" max="200" placeholder="hérite du défaut" data-code="gm"></div>
              <div class="ctl-field"><label>Quota serveuses pour ce code</label><input type="number" min="0" max="500" placeholder="hérite du défaut" data-code="wt"></div>
            </div>
            <div class="ctl-toolbar"><button class="button button-primary button-small" type="button" data-generate>Générer</button>
              <span class="hint">Les codes ne sont affichés qu’une fois, juste après leur création.</span></div>
          </div>
          <div data-code-output style="margin-top:12px"></div>
        </div>

        <div class="ctl-card">
          <div class="ctl-toolbar">
            <select data-code-filter aria-label="Filtrer les codes">
              ${[['all', 'Tous'], ['available', 'Disponibles'], ['used', 'Utilisés'], ['expired', 'Expirés'], ['revoked', 'Révoqués']]
                .map(([value, label]) => `<option value="${value}" ${filters.status === value ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
            <span class="spacer"></span>
            <span class="ctl-badge ok">${Number(counts.available || 0)} disponible(s)</span>
            <span class="ctl-badge muted">${Number(counts.used || 0)} utilisé(s)</span>
            <span class="ctl-badge warn">${Number(counts.expired || 0)} expiré(s)</span>
            <span class="ctl-badge danger">${Number(counts.revoked || 0)} révoqué(s)</span>
          </div>
          <div class="ctl-table-wrap"><table class="ctl-table">
            <thead><tr><th>Code</th><th>Créateur</th><th>Statut</th><th>Créé le</th><th>Expire le</th><th>Utilisations</th><th>Action</th></tr></thead>
            <tbody>${rows.length ? rows.map((row) => `
              <tr><td><code>••••-${esc(row.hint)}</code></td>
              <td>${esc(row.createdByLabel || '—')}<div class="hint">${row.managerId ? 'gestionnaire' : 'PDG'}</div></td>
              <td>${badge(row.status)}</td>
              <td>${fmtDay(row.createdAt)}</td>
              <td>${fmtDate(row.expiresAt)}</td>
              <td>${Number(row.uses)}/${Number(row.maxUses)}</td>
              <td>${row.status === 'available' ? `<button class="button button-danger button-small" type="button" data-revoke="${esc(row.id)}">Révoquer</button>` : '—'}</td></tr>`).join('')
              : '<tr><td colspan="7"><div class="ctl-empty">Aucun code pour ce filtre.</div></td></tr>'}
            </tbody></table></div>
        </div>

        <div class="ctl-card">
          <h3>Historique des inscriptions terrain</h3>
          ${(history.data || []).length ? `<div class="ctl-table-wrap"><table class="ctl-table">
            <thead><tr><th>Date</th><th>Gestionnaire</th><th>Établissement</th><th>Contact</th><th>Dossier</th><th>Statut</th></tr></thead>
            <tbody>${(history.data || []).map((row) => `<tr><td>${fmtDate(row.usedAt)}</td><td>${esc(row.managerLabel || '—')}</td>
              <td>${esc(row.businessName || '—')}</td><td>${esc(row.phone || row.contactName || '—')}</td>
              <td>${esc(row.reference || '—')}</td><td>${badge(row.status || 'pending')}</td></tr>`).join('')}</tbody></table></div>`
            : '<div class="ctl-empty">Aucune inscription terrain réalisée.</div>'}
        </div>`);

      $('[data-generate]').addEventListener('click', async () => {
        const body = {
          count: Number($('[data-code="count"]').value) || 1,
          ttlHours: Number($('[data-code="ttl"]').value) || 72,
        };
        const gm = $('[data-code="gm"]').value; const wt = $('[data-code="wt"]').value;
        if (gm !== '') body.teamMaxGeneralManagers = Number(gm) || 0;
        if (wt !== '') body.teamMaxWaitresses = Number(wt) || 0;
        try {
          const result = await api('/api/admin/control/field-codes', { method: 'POST', body });
          const codes = result.data?.codes || [];
          $('[data-code-output]').innerHTML = `<div class="ctl-alert warn">Notez ces codes maintenant : ils ne seront plus jamais affichés.</div>
            <div class="ctl-code-list" style="margin-top:8px">${codes.map((code) => `<div class="ctl-code"><code>${esc(code.code)}</code>
              <span class="hint">valable jusqu’au ${fmtDate(code.expiresAt)}</span>
              <button class="button button-secondary button-small" type="button" data-copy="${esc(code.code)}">Copier</button></div>`).join('')}</div>`;
          $$('[data-copy]').forEach((button) => button.addEventListener('click', () => {
            navigator.clipboard?.writeText(button.dataset.copy).then(() => notify('Code copié.')).catch(() => notify('Copie impossible : notez le code.'));
          }));
          notify(`${codes.length} code(s) généré(s).`);
        } catch (error) { notify(error.message); }
      });
      $('[data-code-filter]').addEventListener('change', (event) => { state.filters.codes = { status: event.target.value }; load(); });
      $$('[data-revoke]').forEach((button) => button.addEventListener('click', async () => {
        const reason = window.prompt('Motif de la révocation ?', 'Code non utilisé') || '';
        if (!reason) return;
        try { await api(`/api/admin/control/field-codes/${button.dataset.revoke}/revoke`, { method: 'POST', body: { reason } }); notify('Code révoqué : il est immédiatement inutilisable.'); await load(); }
        catch (error) { notify(error.message); }
      }));
    }

    // ---------------------------------------------------------------- quotas
    async function renderQuotas() {
      const { data } = await api('/api/admin/control/team-limits');
      const platform = data.platform || {};
      const rows = data.merchants || [];
      body(`
        <div class="ctl-card">
          <h3>Limite générale applicable à tous les marchands</h3>
          <div class="ctl-form">
            <div class="ctl-form-row">
              <div class="ctl-field"><label>Gérants généraux par marchand</label><input type="number" min="0" max="200" value="${Number(platform.maxGeneralManagersPerMerchant ?? 1)}" data-limit="gm"></div>
              <div class="ctl-field"><label>Serveuses / serveurs par marchand</label><input type="number" min="0" max="500" value="${Number(platform.maxWaitressesPerMerchant ?? 2)}" data-limit="wt"></div>
              <div class="ctl-field"><label>Validité des codes d’activation (heures)</label><input type="number" min="1" max="720" value="${Number(platform.activationCodeTtlHours ?? 72)}" data-limit="ttl"></div>
            </div>
            <div class="ctl-toolbar"><button class="button button-primary button-small" type="button" data-save-limits>Enregistrer la limite générale</button>
              <span class="hint">Les marchands qui dépassent déjà gardent leurs membres : le blocage ne concerne que les créations futures.</span></div>
          </div>
        </div>
        <div class="ctl-card">
          <h3>Quotas par marchand</h3>
          <div class="ctl-table-wrap"><table class="ctl-table">
            <thead><tr><th>Marchand</th><th>Gérants</th><th>Serveuses</th><th>Dépassement</th><th>Source</th><th>Action</th></tr></thead>
            <tbody>${rows.length ? rows.map((row) => {
              const usedGm = Number(row.usedGeneralManagers || 0); const maxGm = Number(row.maxGeneralManagers || 0) + (row.extraExpiresAt && new Date(row.extraExpiresAt) > new Date() ? Number(row.extraGeneralManagers || 0) : 0);
              const usedWt = Number(row.usedWaitresses || 0); const maxWt = Number(row.maxWaitresses || 0) + (row.extraExpiresAt && new Date(row.extraExpiresAt) > new Date() ? Number(row.extraWaitresses || 0) : 0);
              return `<tr>
                <td>${esc(row.displayName)}<div class="hint">${badge(row.status)}</div></td>
                <td>${usedGm}/${maxGm} ${usedGm >= maxGm ? '<span class="ctl-badge warn">complet</span>' : ''}</td>
                <td>${usedWt}/${maxWt} ${usedWt >= maxWt ? '<span class="ctl-badge warn">complet</span>' : ''}</td>
                <td>${Number(row.extraGeneralManagers || 0) > 0 || Number(row.extraWaitresses || 0) > 0 ? `+${Number(row.extraGeneralManagers || 0)} / +${Number(row.extraWaitresses || 0)}${row.extraExpiresAt ? ` jusqu’au ${fmtDay(row.extraExpiresAt)}` : ''}` : '—'}</td>
                <td>${row.hasOverride ? '<span class="ctl-badge info">fixé par le PDG</span>' : '<span class="ctl-badge muted">général</span>'}</td>
                <td><button class="button button-small" type="button" data-quota-open="${esc(row.id)}">Modifier</button></td>
              </tr>`;
            }).join('') : '<tr><td colspan="6"><div class="ctl-empty">Aucun marchand.</div></td></tr>'}
            </tbody></table></div>
        </div>`);
      $('[data-save-limits]').addEventListener('click', async () => {
        try {
          await api('/api/admin/control/team-limits', { method: 'PATCH', body: {
            maxGeneralManagersPerMerchant: Number($('[data-limit="gm"]').value) || 0,
            maxWaitressesPerMerchant: Number($('[data-limit="wt"]').value) || 0,
            activationCodeTtlHours: Number($('[data-limit="ttl"]').value) || 72,
          } });
          notify('Limite générale enregistrée.');
          await load();
        } catch (error) { notify(error.message); }
      });
      $$('[data-quota-open]').forEach((button) => button.addEventListener('click', () => openMerchant(button.dataset.quotaOpen)));
    }

    // ---------------------------------------------------------------- audit
    async function renderAudit() {
      const filters = state.filters.audit || { entityType: '' };
      const query = new URLSearchParams({ limit: '150' });
      if (filters.entityType) query.set('entityType', filters.entityType);
      const { data } = await api(`/api/admin/control/journal?${query}`);
      const rows = data || [];
      body(`
        <div class="ctl-toolbar">
          <select data-audit-filter aria-label="Filtrer par objet">
            <option value="">Tous les objets</option>
            ${['merchant_registration', 'merchant', 'manager', 'field_enrollment_code', 'team_member', 'settings']
              .map((value) => `<option value="${value}" ${filters.entityType === value ? 'selected' : ''}>${value}</option>`).join('')}
          </select>
          <span class="spacer"></span>
          <button class="button button-secondary button-small" type="button" data-export>Exporter en CSV</button>
        </div>
        <div class="ctl-table-wrap"><table class="ctl-table">
          <thead><tr><th>Date</th><th>Acteur</th><th>Action</th><th>Objet</th><th>Résumé</th></tr></thead>
          <tbody>${rows.length ? rows.map((row) => `<tr><td>${fmtDate(row.createdAt)}</td>
            <td>${esc(row.actorLabel)}<div class="hint">${esc(row.actorType)}</div></td>
            <td><code>${esc(row.action)}</code></td><td>${esc(row.entityType)}<div class="hint">${esc(String(row.entityId || '').slice(0, 24))}</div></td>
            <td>${esc(row.summary)}</td></tr>`).join('') : '<tr><td colspan="5"><div class="ctl-empty">Journal vide.</div></td></tr>'}
          </tbody></table></div>
        <p class="hint">Le journal est en lecture seule : aucune opération enregistrée ne peut être modifiée ni supprimée, même par le PDG.</p>`);
      $('[data-audit-filter]').addEventListener('change', (event) => { state.filters.audit = { entityType: event.target.value }; load(); });
      $('[data-export]').addEventListener('click', () => { window.location.href = '/api/admin/control/journal/export'; });
    }

    return {
      async mount({ root: mountRoot, notify: notifyFn } = {}) {
        root = mountRoot || document.getElementById('adminControlRoot');
        if (!root) return;
        if (typeof notifyFn === 'function') notify = notifyFn;
        await load();
      },
      // Rechargement à l'ouverture d'une rubrique (le PDG revient sur la vue, les données changent).
      async refresh() { if (root) await load(); },
      openTab(tab) { state.tab = tab; return load(); },
    };
  })();

  // ================================================================ notifications
  const Notifications = (() => {
    let root = null;
    const state = { unreadOnly: false };
    async function load() {
      if (!root) return;
      root.innerHTML = '<div class="ctl-loading">Chargement…</div>';
      try {
        const result = await fetch(`/api/admin/control/notifications?limit=60${state.unreadOnly ? '&unread=1' : ''}`, { credentials: 'same-origin' }).then((res) => res.json());
        const rows = result.data || [];
        const counts = result.counts || {};
        root.innerHTML = `<div class="ctl-shell">
          <div class="ctl-toolbar">
            <span class="ctl-badge warn">${Number(counts.unread || 0)} non lue(s)</span>
            <span class="ctl-badge muted">${Number(counts.total || 0)} au total</span>
            <label style="display:flex;gap:6px;align-items:center;font-size:.84rem"><input type="checkbox" data-unread ${state.unreadOnly ? 'checked' : ''} style="width:auto">Non lues seulement</label>
            <span class="spacer"></span>
            <button class="button button-secondary button-small" type="button" data-read-all>Tout marquer comme lu</button>
            <button class="button button-quiet button-small" type="button" data-refresh>Actualiser</button>
          </div>
          <div class="ctl-feed">${rows.length ? rows.map((row) => `
            <div class="ctl-note ${row.readAt ? '' : 'unread'}">
              <span class="dot ${esc(row.severity)}"></span>
              <div>
                <div class="title">${esc(row.title)}</div>
                <div class="body">${esc(row.body)}</div>
                ${row.linkView ? `<button class="link" type="button" data-open="${esc(row.linkView)}" data-id="${esc(row.linkId || '')}">Ouvrir le dossier →</button>` : ''}
              </div>
              <div class="when">${fmtDate(row.createdAt)}</div>
            </div>`).join('') : '<div class="ctl-empty">Aucune notification.</div>'}</div>
        </div>`;
        $('[data-unread]', root).addEventListener('change', (event) => { state.unreadOnly = event.target.checked; load(); });
        $('[data-refresh]', root).addEventListener('click', load);
        $('[data-read-all]', root).addEventListener('click', async () => {
          await fetch('/api/admin/control/notifications/read', { method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [] }) });
          load();
          window.dispatchEvent(new CustomEvent('qria:admin-notifications-read'));
        });
        $$('[data-open]', root).forEach((button) => button.addEventListener('click', () => {
          // Le PDG clique sur une alerte : il atterrit directement sur le dossier concerné.
          const view = button.dataset.open === 'admin-registrations' ? 'admin-control' : 'admin-control';
          window.dispatchEvent(new CustomEvent('qria:open-view', { detail: { view, tab: view === 'admin-control' ? (button.dataset.open === 'admin-registrations' ? 'registrations' : 'merchants') : 'registrations', id: button.dataset.id } }));
        }));
      } catch (error) {
        root.innerHTML = `<div class="ctl-alert error">${esc(error.message)}</div>`;
      }
    }
    return {
      async mount({ root: mountRoot } = {}) {
        root = mountRoot || document.getElementById('adminNotificationsRoot');
        await load();
      },
      refresh: load,
    };
  })();

  window.QRIAAdminControl = Accounts;
  window.QRIAAdminNotifications = Notifications;
})();
