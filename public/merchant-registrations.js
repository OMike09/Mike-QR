// Rubrique Administrateur général « Demandes d'inscription des marchands » : liste, examen, décision, historique.
// Tout est calculé côté serveur ; l'interface n'invente aucune donnée et ne montre un bouton
// que si le rôle a réellement le droit d'agir.
(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const STATUS_LABELS = { pending: 'En attente de validation', in_review: 'En cours d’examen', approved: 'Approuvée', rejected: 'Refusée', suspended: 'Suspendue' };
  const STATUS_TONES = { pending: 'warn', in_review: 'info', approved: 'ok', rejected: 'danger', suspended: 'muted' };
  const SECTOR_LABELS = { general: 'Général', restaurant: 'Restaurant', maquis: 'Maquis / bar', hardware: 'Quincaillerie', clothing: 'Habillement', outdoor: 'Plein air' };
  const FEATURE_LABELS = {
    selfServiceRegistration: 'Inscription autonome des marchands',
    merchantAssistedOrders: 'Prise de commande par le marchand',
    merchantScanner: 'Scanner QR intégré à l’espace marchand',
    scanSplitStatistics: 'Statistiques de scans séparées (clients / marchands)',
  };

  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function dateTime(value) { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(d); }
  function money(value) { return `${new Intl.NumberFormat('fr-FR').format(Number(value) || 0)} XOF`; }
  function badge(status) { return `<span class="status-badge tone-${STATUS_TONES[status] || 'muted'}">${esc(STATUS_LABELS[status] || status || '—')}</span>`; }

  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || `Erreur ${response.status}`); error.status = response.status; error.code = data.code || ''; throw error; }
    return data;
  }

  const state = { role: 'admin', loaded: false, rows: [], counts: {}, status: 'open', search: '', page: 1, total: 0, flags: null, stats: null, statsPeriod: '30', orders: [], ordersPage: 1, ordersTotal: 0, managerId: '', managers: [], ordersSource: '', featureSaving: false };

  function mountSkeleton(root) {
    root.innerHTML = `
      <section class="panel" id="mreg-features">
        <div class="page-heading page-heading-compact"><div><span class="eyebrow">CONTRÔLE Administrateur général</span><h2>Activation des nouvelles fonctionnalités marchands</h2>
          <p>Chaque fonctionnalité peut être coupée sans supprimer les données déjà enregistrées. La désactivation n’efface ni les comptes, ni les QR, ni les commandes, ni les statistiques.</p></div>
          <button class="button button-secondary" type="button" id="mregRefreshAll">Actualiser</button></div>
        <div id="mregFeatureList" class="mreg-feature-list"><p class="muted">Chargement des réglages…</p></div>
      </section>
      <section class="panel">
        <div class="page-heading page-heading-compact"><div><span class="eyebrow">INSCRIPTIONS</span><h2>Demandes d’inscription des marchands</h2>
          <p>Une demande n’ouvre aucun accès actif : ni commande, ni QR public, tant qu’elle n’est pas approuvée et que l’Administrateur général n’a pas activé le QR selon la procédure existante.</p></div></div>
        <div class="table-toolbar">
          <input id="mregSearch" type="search" placeholder="Rechercher (nom, identifiant, téléphone, référence)" aria-label="Rechercher une demande">
          <select id="mregStatus" aria-label="Filtrer par statut">
            <option value="open">À traiter (en attente + examen)</option><option value="pending">En attente</option><option value="in_review">En cours d’examen</option>
            <option value="approved">Approuvées</option><option value="rejected">Refusées</option><option value="suspended">Suspendues</option><option value="all">Toutes</option>
          </select>
          <span class="hint" id="mregCounts">—</span>
        </div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>RÉFÉRENCE / REÇUE</th><th>MARCHAND / CONTACT</th><th>VILLE / DOMAINE</th><th>STATUT</th><th>DÉCISION</th></tr></thead>
          <tbody id="mregRows"><tr><td colspan="5">Ouvrez cette rubrique pour charger les demandes.</td></tr></tbody></table></div>
        <div class="mreg-pager"><button class="button button-secondary" type="button" id="mregPrev">Précédent</button><span id="mregPage">Page 1</span><button class="button button-secondary" type="button" id="mregNext">Suivant</button></div>
      </section>
      <section class="panel" id="mreg-stats">
        <div class="page-heading page-heading-compact"><div><span class="eyebrow">STATISTIQUES</span><h2>Scans clients et scans marchands</h2>
          <p>Les deux catégories restent séparées. Le total général est la somme des scans clients et des scans marchands. L’historique antérieur, non classable, est affiché à part et n’est jamais remis à zéro.</p></div>
          <select id="mregStatsPeriod" aria-label="Période des statistiques"><option value="1">Aujourd’hui (24 h)</option><option value="7">7 jours</option><option value="30" selected>30 jours</option><option value="90">90 jours</option><option value="all">Tout l’historique</option></select></div>
        <div id="mregStatsBody"><p class="muted">Chargement…</p></div>
      </section>
      <section class="panel">
        <div class="page-heading page-heading-compact"><div><span class="eyebrow">COMMANDES MARCHANDS</span><h2>Commandes saisies par les marchands</h2>
          <p>Ces commandes passent par le circuit normal. Rien n’est dupliqué et le stock n’est déduit qu’une fois.</p></div></div>
        <div id="mregOrdersBody"><p class="muted">Chargement…</p></div>
      </section>`;
  }

  function renderFeatures() {
    const root = $('#mregFeatureList'); if (!root) return;
    if (!state.flags) { root.innerHTML = '<p class="muted">Réglages indisponibles.</p>'; return; }
    root.innerHTML = Object.entries(FEATURE_LABELS).map(([key, label]) => `
      <label class="mreg-feature"><span><strong>${esc(label)}</strong><small>${state.flags[key] ? 'Activée' : 'Désactivée'}</small></span>
      <input type="checkbox" data-mreg-feature="${esc(key)}" ${state.flags[key] ? 'checked' : ''} aria-label="${esc(label)}"></label>`).join('');
    $$('[data-mreg-feature]', root).forEach((input) => input.addEventListener('change', () => saveFeature(input.dataset.mregFeature, input.checked)));
  }

  async function saveFeature(key, value) {
    if (state.featureSaving) return;
    state.featureSaving = true;
    try {
      const result = await request('/api/admin/merchant-lifecycle/features', { method: 'PUT', body: JSON.stringify({ [key]: value }) });
      state.flags = result.data || state.flags; renderFeatures();
      $('#mregFeatureState')?.remove();
    } catch (error) {
      // En cas d'échec, l'interrupteur revient à l'état réellement enregistré.
      state.flags = (await request('/api/admin/merchant-lifecycle/features').catch(() => ({ data: state.flags }))).data;
      renderFeatures(); alert(error.message);
    } finally { state.featureSaving = false; }
  }

  function renderCounts() {
    const node = $('#mregCounts'); if (!node) return;
    const c = state.counts || {};
    node.textContent = `En attente : ${Number(c.pending) || 0} · En examen : ${Number(c.in_review) || 0} · Approuvées : ${Number(c.approved) || 0} · Refusées : ${Number(c.rejected) || 0} · Suspendues : ${Number(c.suspended) || 0}`;
  }

  function renderRows() {
    const root = $('#mregRows'); if (!root) return;
    if (!state.rows.length) { root.innerHTML = '<tr><td colspan="5">Aucune demande pour ce filtre. Les demandes réellement reçues apparaîtront ici.</td></tr>'; return; }
    root.innerHTML = state.rows.map((row) => {
      const open = ['pending', 'in_review'].includes(row.status);
      const actions = open
        ? `<button class="button button-primary" type="button" data-mreg-action="approve" data-id="${esc(row.id)}">Approuver</button>
           <button class="button button-secondary" type="button" data-mreg-action="reject" data-id="${esc(row.id)}">Refuser</button>
           ${row.status === 'pending' ? `<button class="button button-quiet" type="button" data-mreg-action="review" data-id="${esc(row.id)}">Marquer en examen</button>` : ''}`
        : row.status === 'approved' ? `<button class="button button-secondary" type="button" data-mreg-action="suspend" data-id="${esc(row.id)}">Suspendre</button>` : '';
      return `<tr>
        <td><strong>${esc(row.reference)}</strong><br><small>${esc(dateTime(row.createdAt))}</small></td>
        <td><strong>${esc(row.businessName)}</strong><br><small>${esc(row.contactName)} · ${esc(row.username)}</small><br><small>${esc(row.phone)}${row.email ? ` · ${esc(row.email)}` : ''}</small></td>
        <td>${esc(row.city || '—')}<br><small>${esc(SECTOR_LABELS[row.sector] || row.activityDomain || '—')}</small></td>
        <td>${badge(row.status)}${row.decisionReason ? `<br><small>Motif : ${esc(row.decisionReason)}</small>` : ''}</td>
        <td><div class="mreg-actions"><button class="button button-quiet" type="button" data-mreg-open="${esc(row.id)}">Dossier</button>${actions}</div></td>
      </tr>`;
    }).join('');
    $$('[data-mreg-open]', root).forEach((button) => button.addEventListener('click', () => openDetail(button.dataset.mregOpen)));
    $$('[data-mreg-action]', root).forEach((button) => button.addEventListener('click', () => decide(button.dataset.id, button.dataset.mregAction)));
    const page = $('#mregPage');
    if (page) page.textContent = state.rows.length ? `Page ${state.page} · ${state.total} demande(s)` : 'Aucune demande sur cette page';
    const prev = $('#mregPrev'); const next = $('#mregNext');
    if (prev) prev.disabled = state.page <= 1;
    if (next) next.disabled = state.page * 20 >= state.total;
  }

  async function loadRegistrations() {
    const query = new URLSearchParams({ status: state.status, search: state.search, page: String(state.page), limit: '20' });
    const result = await request(`/api/admin/merchant-registrations?${query}`);
    state.rows = result.data || []; state.total = result.total || 0; state.counts = result.counts || {};
    renderCounts(); renderRows();
  }

  async function openDetail(id) {
    const result = await request(`/api/admin/merchant-registrations/${encodeURIComponent(id)}`);
    const row = result.data;
    const events = (row.events || []).map((event) => `<li><strong>${esc(event.action)}</strong> — ${esc(dateTime(event.createdAt))}
      <br><small>${esc(event.fromStatus || '—')} → ${esc(event.toStatus || '—')} · ${esc(event.actorType)} ${esc(event.actorLabel || '')}${event.reason ? ` · motif : ${esc(event.reason)}` : ''}</small></li>`).join('');
    const documents = [['Logo', row.logo], ['Couverture', row.coverImageUrl]].filter(([, value]) => value)
      .map(([label, value]) => `<figure><img src="${esc(value)}" alt="${esc(label)} de ${esc(row.businessName)}"><figcaption>${esc(label)}</figcaption></figure>`).join('');
    window.QRIAAdminModal?.show(`<article class="modal-card"><div class="modal-header"><div><span class="eyebrow">DOSSIER ${esc(row.reference)}</span><h2>${esc(row.businessName)}</h2><p>${esc(STATUS_LABELS[row.status] || row.status)} · reçue le ${esc(dateTime(row.createdAt))}</p></div><button class="modal-close" type="button" data-close-modal aria-label="Fermer">×</button></div>
      <div class="modal-body"><dl class="mreg-facts">
        <div><dt>Responsable</dt><dd>${esc(row.contactName)}</dd></div><div><dt>Identifiant souhaité</dt><dd>${esc(row.username)}</dd></div>
        <div><dt>Téléphone</dt><dd>${esc(row.phone)}</dd></div><div><dt>E-mail</dt><dd>${esc(row.email || '—')}</dd></div>
        <div><dt>Ville / quartier</dt><dd>${esc(row.city || '—')}${row.location ? ` · ${esc(row.location)}` : ''}</dd></div><div><dt>Adresse</dt><dd>${esc(row.address || '—')}</dd></div>
        <div><dt>Domaine d’activité</dt><dd>${esc(row.activityDomain || '—')} (${esc(SECTOR_LABELS[row.sector] || row.sector)})</dd></div><div><dt>Description</dt><dd>${esc(row.description || '—')}</dd></div>
        ${Object.entries(row.sectorDetails || {}).map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join('')}
      </dl>${documents ? `<div class="mreg-docs">${documents}</div>` : '<p class="muted">Aucune pièce jointe image fournie.</p>'}
      <h3>Historique du dossier</h3><ul class="mreg-events">${events || '<li>Aucun événement enregistré.</li>'}</ul></div>
      <div class="modal-footer"><span class="modal-footer-note">Chaque décision est journalisée et ne peut pas être rejouée.</span><div class="modal-footer-actions"><button class="button button-secondary" type="button" data-close-modal>Fermer</button></div></div></article>`);
  }

  async function decide(id, action) {
    const labels = { approve: 'approuver', reject: 'refuser', suspend: 'suspendre', review: 'passer en examen' };
    let reason = '';
    if (action !== 'approve') {
      reason = window.prompt(`Motif pour ${labels[action]} cette demande (obligatoire, communiqué au marchand) :`, '') ?? null;
      if (reason === null) return;
      if (!reason.trim()) { alert('Le motif est obligatoire pour cette décision.'); return; }
    } else if (!window.confirm('Approuver cette demande ? Un compte marchand sera créé. La boutique restera non publiée et le QR devra être activé par l’Administrateur général.')) return;
    try {
      await request(`/api/admin/merchant-registrations/${encodeURIComponent(id)}/decision`, { method: 'POST', body: JSON.stringify({ action, reason, note: action === 'approve' ? 'Approbation depuis la rubrique Administrateur général.' : '' }) });
      window.QRIAAdminModal?.close();
      await loadRegistrations();
      window.QRIAAdminNotify?.(action === 'approve' ? 'Demande approuvée. Le QR reste à activer par l’Administrateur général.' : 'Décision enregistrée.');
    } catch (error) {
      alert(error.code === 'CONCURRENT_DECISION' || error.code === 'ALREADY_DECIDED'
        ? 'Cette demande vient d’être traitée par une autre personne. La liste a été actualisée.'
        : error.message);
      await loadRegistrations().catch(() => {});
    }
  }

  function bars(rows, key, label) {
    const max = Math.max(1, ...rows.map((row) => Number(row[key]) || 0));
    return rows.map((row) => `<div class="mreg-bar"><span>${esc(row.day || row.week || row.month || '')}</span>
      <div class="mreg-bar-track"><i style="width:${Math.round(((Number(row[key]) || 0) / max) * 100)}%"></i></div>
      <strong>${Number(row[key]) || 0}</strong></div>`).join('') || `<p class="muted">Aucun scan ${esc(label)} sur la période.</p>`;
  }

  function renderStats() {
    const root = $('#mregStatsBody'); if (!root) return;
    if (!state.stats) { root.innerHTML = '<p class="muted">Statistiques indisponibles.</p>'; return; }
    const stats = state.stats;
    const c = stats.counts || {};
    const byStore = (stats.byStore || []).map((row) => `<tr><td>${esc(row.name || row.storeId)}</td><td>${Number(row.counts?.customer) || 0}</td><td>${Number(row.counts?.merchant) || 0}</td><td>${Number(row.counts?.total) || 0}</td></tr>`).join('');
    const top = (stats.top || []).slice(0, 10).map((row) => `<tr><td>${esc(row.qrCode || '—')}</td><td>${row.qrKind === 'store' ? 'Boutique' : 'Table / emplacement'}</td><td>${row.category === 'merchant' ? 'Marchand' : row.category === 'customer' ? 'Client' : 'Antérieur'}</td><td>${Number(row.count) || 0}</td></tr>`).join('');
    root.innerHTML = `
      <div class="mreg-kpis">
        <div><span>Scans clients</span><strong>${Number(c.customer) || 0}</strong></div>
        <div><span>Scans marchands</span><strong>${Number(c.merchant) || 0}</strong></div>
        <div class="is-total"><span>Total général (clients + marchands)</span><strong>${(Number(c.customer) || 0) + (Number(c.merchant) || 0)}</strong></div>
        <div><span>Historique antérieur / origine inconnue</span><strong>${(Number(c.legacy) || 0) + (Number(c.unknown) || 0)}</strong></div>
      </div>
      <p class="hint">Les ${Number(c.legacy) || 0} scans antérieurs correspondent aux compteurs historiques conservés : ils ne sont ni reclassés ni remis à zéro.${Number(c.unknown) ? ` ${Number(c.unknown)} scan(s) non classables sont également conservés.` : ''}</p>
      <div class="mreg-charts">
        <section><h3>Évolution des scans clients</h3>${bars(stats.timeline || [], 'customer', 'client')}</section>
        <section><h3>Évolution des scans marchands</h3>${bars(stats.timeline || [], 'merchant', 'marchand')}</section>
      </div>
      <div class="mreg-tables">
        <section><h3>Par boutique</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>BOUTIQUE</th><th>CLIENTS</th><th>MARCHANDS</th><th>TOTAL</th></tr></thead><tbody>${byStore || '<tr><td colspan="4">Aucune boutique avec scans sur la période.</td></tr>'}</tbody></table></div></section>
        <section><h3>QR les plus utilisés</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>QR</th><th>TYPE</th><th>CATÉGORIE</th><th>SCANS</th></tr></thead><tbody>${top || '<tr><td colspan="4">Aucun scan enregistré.</td></tr>'}</tbody></table></div></section>
      </div>
      <h3>Historique détaillé (100 derniers événements)</h3>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>DATE</th><th>CATÉGORIE</th><th>QR</th><th>AUTEUR</th><th>CANAL</th></tr></thead><tbody>
        ${(stats.history || []).map((row) => `<tr><td>${esc(dateTime(row.scannedAt))}</td><td>${row.category === 'merchant' ? 'Marchand' : row.category === 'customer' ? 'Client' : 'Antérieur'}</td><td>${esc(row.qrCode || '—')}</td><td>${esc(row.actorType || '—')}</td><td>${esc(row.channel || '—')}</td></tr>`).join('') || '<tr><td colspan="5">Aucun événement.</td></tr>'}
      </tbody></table></div>`;
  }

  async function loadStats() {
    const [stats] = await Promise.all([request(`/api/admin/scan-stats/merchant-qr?period=${encodeURIComponent(state.statsPeriod)}`)]);
    state.stats = stats.data; renderStats();
  }

  function renderOrders() {
    const root = $('#mregOrdersBody'); if (!root) return;
    if (!state.orders.length) { root.innerHTML = '<p class="muted">Aucune commande marchand pour ce filtre.</p>'; return; }
    root.innerHTML = `<div class="table-toolbar"><select id="mregOrdersSource" aria-label="Filtrer par origine">
        <option value="">Toutes les commandes marchands</option><option value="merchant_assisted"${state.ordersSource === 'merchant_assisted' ? ' selected' : ''}>Saisies par un marchand</option><option value="customer_qr"${state.ordersSource === 'customer_qr' ? ' selected' : ''}>Passées par un client</option></select>
        <span class="hint">${state.ordersTotal} commande(s). Les coordonnées absentes sont signalées « non disponibles ».</span></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>RÉFÉRENCE / DATE</th><th>BOUTIQUE</th><th>CLIENT</th><th>PROVENANCE</th><th>TOTAL</th><th>STATUT</th></tr></thead><tbody>
      ${state.orders.map((order) => `<tr><td><strong>${esc(order.reference)}</strong><br><small>${esc(dateTime(order.createdAt))}</small></td>
        <td>${esc(order.storeName || order.storeId)}</td>
        <td>${esc(order.customerName || '—')}<br><small>${order.customerContactStatus === 'not_available' || !order.customerPhone ? 'Coordonnées non disponibles' : esc(order.customerPhone)}</small></td>
        <td>${order.source === 'merchant_assisted' ? 'Marchand' : 'Client'}<br><small>${esc(order.servicePointName || order.orderType || '')}${order.scannedVia === 'scanner' ? ' · scan QR' : order.scannedVia === 'manual' ? ' · sélection manuelle' : ''}</small></td>
        <td>${esc(money(order.grandTotalXof ?? order.totalAmountXof))}</td><td>${esc(order.status)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="mreg-pager"><button class="button button-secondary" type="button" id="mregOrdersPrev">Précédent</button><span>Page ${state.ordersPage}</span><button class="button button-secondary" type="button" id="mregOrdersNext">Suivant</button></div>`;
    $('#mregOrdersSource')?.addEventListener('change', (event) => { state.ordersSource = event.target.value; state.ordersPage = 1; loadOrders().catch((error) => { $('#mregOrdersBody').innerHTML = `<p class="message error">${esc(error.message)}</p>`; }); });
    $('#mregOrdersPrev')?.addEventListener('click', () => { if (state.ordersPage > 1) { state.ordersPage -= 1; loadOrders(); } });
    $('#mregOrdersNext')?.addEventListener('click', () => { if (state.ordersPage * 20 < state.ordersTotal) { state.ordersPage += 1; loadOrders(); } });
  }

  async function loadOrders() {
    const query = new URLSearchParams({ page: String(state.ordersPage), limit: '20' });
    if (state.ordersSource) query.set('source', state.ordersSource);
    const result = await request(`/api/admin/merchant-orders?${query}`);
    state.orders = result.data || []; state.ordersTotal = result.total || 0; renderOrders();
  }

  async function loadAll() {
    await Promise.all([
      request('/api/admin/merchant-lifecycle/features').then((result) => { state.flags = result.data; renderFeatures(); }).catch((error) => { $('#mregFeatureList').innerHTML = `<p class="message error">${esc(error.message)}</p>`; }),
      loadRegistrations().catch((error) => { $('#mregRows').innerHTML = `<tr><td colspan="5">${esc(error.message)}</td></tr>`; }),
      loadStats().catch((error) => { $('#mregStatsBody').innerHTML = `<p class="message error">${esc(error.message)}</p>`; }),
      loadOrders().catch((error) => { $('#mregOrdersBody').innerHTML = `<p class="message error">${esc(error.message)}</p>`; }),
    ]);
    state.loaded = true;
  }

  let searchTimer = 0;
  window.QRIAAdminRegistrations = {
    async mount({ root, notify }) {
      window.QRIAAdminNotify = notify || (() => {});
      if (!root) return;
      if (!root.dataset.ready) {
        mountSkeleton(root); root.dataset.ready = '1';
        $('#mregRefreshAll').addEventListener('click', () => { state.loaded = false; loadAll().catch((error) => notify?.(error.message)); });
        $('#mregSearch').addEventListener('input', (event) => { clearTimeout(searchTimer); const value = event.target.value; searchTimer = setTimeout(() => { state.search = value; state.page = 1; loadRegistrations().catch((error) => notify?.(error.message)); }, 350); });
        $('#mregStatus').addEventListener('change', (event) => { state.status = event.target.value; state.page = 1; loadRegistrations().catch((error) => notify?.(error.message)); });
        $('#mregPrev').addEventListener('click', () => { if (state.page > 1) { state.page -= 1; loadRegistrations(); } });
        $('#mregNext').addEventListener('click', () => { if (state.page * 20 < state.total) { state.page += 1; loadRegistrations(); } });
        $('#mregStatsPeriod').addEventListener('change', (event) => { state.statsPeriod = event.target.value; loadStats().catch((error) => notify?.(error.message)); });
      }
      await loadAll();
    },
    counts: () => state.counts,
  };
})();
