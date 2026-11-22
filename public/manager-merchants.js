// Espace gestionnaire : demandes d'inscription (si l’Administrateur général l'a autorisé) et commandes de SES marchands.
// Aucun bouton n'est affiché sans permission réellement accordée et vérifiée par le serveur.
(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const STATUS_LABELS = { pending: 'En attente', in_review: 'En examen', approved: 'Approuvée', rejected: 'Refusée', suspended: 'Suspendue' };
  const state = { manager: null, registrations: [], counts: {}, status: 'open', search: '', orders: [], ordersSource: '', loaded: false };
  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function money(value) { return `${new Intl.NumberFormat('fr-FR').format(Number(value) || 0)} XOF`; }
  function dateTime(value) { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(d); }

  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || `Erreur ${response.status}`); error.code = data.code || ''; error.status = response.status; throw error; }
    return data;
  }

  // Les entrées de navigation n'apparaissent que si la permission est réellement accordée.
  function applyPermissions(manager) {
    state.manager = manager || state.manager;
    const canValidate = state.manager?.canValidateMerchantRegistrations === true;
    const canManage = state.manager?.canManageMerchants === true;
    const navRegistrations = $('#navMerchantRegistrations'); if (navRegistrations) navRegistrations.hidden = !canValidate;
    const navOrders = $('#navMerchantOrders'); if (navOrders) navOrders.hidden = !canManage;
    if (!canValidate && !$('#view-merchant-registrations')?.hidden) window.QRIAManagerView?.('overview');
    if (!canManage && !$('#view-merchant-orders')?.hidden) window.QRIAManagerView?.('overview');
  }

  async function loadRegistrations() {
    const query = new URLSearchParams({ status: state.status, search: state.search, limit: '50' });
    try {
      const result = await api(`/api/manager/merchant-registrations?${query}`);
      state.registrations = result.data || []; state.counts = result.counts || {};
    } catch (error) {
      $('#mgrRegRows').innerHTML = `<tr><td colspan="5">${esc(error.code === 'REGISTRATION_VALIDATION_FORBIDDEN' ? 'L’Administrateur général ne vous a pas autorisé à valider les inscriptions marchands.' : error.message)}</td></tr>`;
      $('#mgrRegCounts').textContent = '—';
      return;
    }
    const c = state.counts;
    $('#mgrRegCounts').textContent = `En attente : ${Number(c.pending) || 0} · En examen : ${Number(c.in_review) || 0} · Approuvées : ${Number(c.approved) || 0} · Refusées : ${Number(c.rejected) || 0}`;
    const root = $('#mgrRegRows');
    if (!state.registrations.length) { root.innerHTML = '<tr><td colspan="5">Aucune demande pour ce filtre.</td></tr>'; return; }
    root.innerHTML = state.registrations.map((row) => `<tr>
      <td><strong>${esc(row.reference)}</strong><br><small>${esc(dateTime(row.createdAt))}</small></td>
      <td>${esc(row.businessName)}<br><small>${esc(row.contactName)} · ${esc(row.username)} · ${esc(row.phone)}</small></td>
      <td>${esc(row.city || '—')}<br><small>${esc(row.activityDomain || '')}</small></td>
      <td>${esc(STATUS_LABELS[row.status] || row.status)}${row.decisionReason ? `<br><small>Motif : ${esc(row.decisionReason)}</small>` : ''}</td>
      <td><div class="row-actions">${['pending', 'in_review'].includes(row.status)
        ? `<button class="button button-primary" type="button" data-mgr-approve="${esc(row.id)}">Approuver</button><button class="button button-secondary" type="button" data-mgr-reject="${esc(row.id)}">Refuser</button>`
        : '<small>Décision enregistrée</small>'}</div></td></tr>`).join('');
    $$('[data-mgr-approve]', root).forEach((button) => button.addEventListener('click', () => decide(button.dataset.mgrApprove, 'approve')));
    $$('[data-mgr-reject]', root).forEach((button) => button.addEventListener('click', () => decide(button.dataset.mgrReject, 'reject')));
  }

  async function decide(id, action) {
    let reason = '';
    if (action === 'reject') {
      reason = window.prompt('Motif du refus (obligatoire, communiqué au marchand) :', '') ?? null;
      if (reason === null || !reason.trim()) return;
    } else if (!window.confirm('Approuver cette demande ? Le compte sera créé, la boutique restera non publiée et le QR devra être activé par l’Administrateur général.')) return;
    try {
      await api(`/api/manager/merchant-registrations/${encodeURIComponent(id)}/decision`, { method: 'POST', body: JSON.stringify({ action, reason }) });
      window.QRIAManagerToast?.(action === 'approve' ? 'Demande approuvée. Le QR reste à activer par l’Administrateur général.' : 'Refus enregistré et tracé.');
      await loadRegistrations();
    } catch (error) {
      window.QRIAManagerToast?.(error.code === 'CONCURRENT_DECISION' ? 'Cette demande vient d’être traitée par une autre personne.' : error.message);
      await loadRegistrations().catch(() => {});
    }
  }

  async function loadOrders() {
    const root = $('#mgrOrderRows'); if (!root) return;
    const query = new URLSearchParams({ limit: '50' }); if (state.ordersSource) query.set('source', state.ordersSource);
    try {
      const result = await api(`/api/manager/merchant-orders?${query}`);
      state.orders = result.data || [];
    } catch (error) {
      root.innerHTML = `<tr><td colspan="6">${esc(error.message)}</td></tr>`; return;
    }
    if (!state.orders.length) { root.innerHTML = '<tr><td colspan="6">Aucune commande pour le moment.</td></tr>'; return; }
    root.innerHTML = state.orders.map((order) => `<tr>
      <td><strong>${esc(order.reference)}</strong><br><small>${esc(dateTime(order.createdAt))}</small></td>
      <td>${esc(order.storeName || order.storeId)}</td>
      <td>${esc(order.customerName || '—')}<br><small>${order.customerContactStatus === 'not_available' || !order.customerPhone ? 'Coordonnées non disponibles' : esc(order.customerPhone)}</small></td>
      <td>${order.source === 'merchant_assisted' ? 'Marchand' : 'Client'}<br><small>${order.scannedVia === 'scanner' ? 'scan QR' : ''}${order.servicePointName ? ` · ${esc(order.servicePointName)}` : ''}</small></td>
      <td>${esc(money(order.grandTotalXof ?? order.totalAmountXof))}</td><td>${esc(order.status)}</td></tr>`).join('');
  }

  let searchTimer = 0;
  window.QRIAManagerMerchants = {
    async applyPermissions(manager) { applyPermissions(manager); },
    async mount(view) {
      if (view === 'merchant-registrations') {
        if (state.manager?.canValidateMerchantRegistrations !== true) return;
        if (!state.wired) {
          $('#mgrRegStatus')?.addEventListener('change', (event) => { state.status = event.target.value; loadRegistrations(); });
          $('#mgrRegSearch')?.addEventListener('input', (event) => { clearTimeout(searchTimer); const value = event.target.value; searchTimer = setTimeout(() => { state.search = value; loadRegistrations(); }, 350); });
          state.wired = true;
        }
        await loadRegistrations();
      }
      if (view === 'merchant-orders') {
        if (state.manager?.canManageMerchants !== true) return;
        $('#mgrOrdersRefresh')?.addEventListener('click', () => loadOrders());
        await loadOrders();
      }
    },
  };
})();
