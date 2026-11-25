// ============================================================================================
// Mission 9 — Rubrique « Mon équipe » : demandes de création de comptes, validation par le
// marchand, réinitialisation d'accès du personnel.
//
// L'interface n'applique AUCUN contrôle de droits : elle affiche ce que le serveur accepte.
// Les quotas sont vérifiés côté serveur au moment exact de la validation ; l'écran ne fait que
// les annoncer, et affiche le refus serveur tel quel s'il arrive.
// ============================================================================================
(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dateTime = (value) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(d); };
  const roleLabels = { general_manager: 'Gérant général', waitress: 'Serveur / Serveuse' };
  const statusLabels = { pending: 'En attente de validation', approved: 'Validée', rejected: 'Refusée' };
  const statusClass = { pending: 'warn', approved: 'ok', rejected: 'danger' };
  const state = { requests: [], seats: null, busy: false, loadedAt: 0 };

  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || `Erreur ${response.status}`); error.code = data.code || ''; error.status = response.status; error.data = data; throw error; }
    return data;
  }
  function toast(message) {
    if (typeof window.merchantToast === 'function') return window.merchantToast(message);
    const node = $('#toast'); if (!node) return;
    node.textContent = message; node.classList.add('visible');
    setTimeout(() => node.classList.remove('visible'), 3600);
  }
  function money() { return ''; }

  function seatsLabel() {
    const seats = state.seats || {};
    const gm = seats.general_manager || { used: 0, max: '—' };
    const wt = seats.waitress || { used: 0, max: '—' };
    return `<span class="team-count">${gm.used} / ${gm.max} gérant(s) général(aux)</span>
      <span class="team-count">${wt.used} / ${wt.max} serveur(s) / serveuse(s)</span>`;
  }

  function card(row) {
    const pending = row.status === 'pending';
    return `<article class="team-request" data-request="${esc(row.id)}">
      <header>
        <div>
          <strong>${esc(row.fullName)}</strong>
          <small>${esc(roleLabels[row.role] || row.role)}${row.designation ? ` · ${esc(row.designation)}` : ''}</small>
        </div>
        <span class="state-pill ${statusClass[row.status] || ''}">${esc(statusLabels[row.status] || row.status)}</span>
      </header>
      <div class="team-member-meta">
        <span>${row.phone ? esc(row.phone) : 'Téléphone non fourni'}</span>
        <span>Demande du ${dateTime(row.createdAt)}</span>
        ${row.note ? `<span>Note : ${esc(row.note)}</span>` : ''}
        ${row.decisionReason || row.reason ? `<span>Motif : ${esc(row.reason || '')}</span>` : ''}
      </div>
      ${pending ? `<div class="team-member-actions">
        <button class="button primary" type="button" data-approve="${esc(row.id)}">Valider ce compte</button>
        <button class="button outline danger-outline" type="button" data-reject="${esc(row.id)}">Refuser</button>
      </div>` : `<p class="muted small-note">${row.status === 'approved'
        ? `Compte créé et code d’activation émis le ${dateTime(row.decidedAt)}. Le membre doit activer ce code pour se connecter.`
        : `Demande refusée le ${dateTime(row.decidedAt)}. Aucun compte n’a été créé.`}</p>`}
    </article>`;
  }

  function render() {
    const list = $('#teamRequestsList');
    if (!list) return;
    $('#teamRequestsSeats').innerHTML = seatsLabel();
    const pending = state.requests.filter((row) => row.status === 'pending');
    $('#teamRequestsPendingCount').textContent = String(pending.length);
    $('#teamRequestsPendingCount').hidden = pending.length === 0;
    list.innerHTML = state.requests.length
      ? state.requests.map(card).join('')
      : '<p class="empty">Aucune demande pour le moment. Utilisez le formulaire ci-dessus pour créer un compte de gérant général ou de serveur / serveuse.</p>';
    $$('[data-approve]', list).forEach((button) => button.addEventListener('click', () => decide(button.dataset.approve, 'approve')));
    $$('[data-reject]', list).forEach((button) => button.addEventListener('click', () => decide(button.dataset.reject, 'reject')));
  }

  async function load() {
    try {
      const result = await api('/api/merchant/team/requests?limit=100');
      state.requests = result.data || [];
      state.seats = result.seats || null;
      state.loadedAt = Date.now();
      render();
    } catch (error) {
      const list = $('#teamRequestsList');
      if (list) list.innerHTML = `<p class="message error">${esc(error.message)}</p>`;
    }
  }

  async function decide(id, action) {
    if (state.busy) return;
    const row = state.requests.find((item) => item.id === id);
    if (!row) return;
    if (!window.confirm(action === 'approve'
      ? `Valider le compte de ${row.fullName} (${roleLabels[row.role] || row.role}) ?\nLe serveur vérifie les places disponibles ; le compte est créé et un code d’activation est émis.`
      : `Refuser la demande de ${row.fullName} ? Aucun compte ne sera créé.`)) return;
    let reason = '';
    if (action === 'reject') {
      reason = window.prompt('Motif du refus (visible par votre gestionnaire) :', '') ?? null;
      if (reason === null) return;
    }
    state.busy = true;
    try {
      const result = await api(`/api/merchant/team/requests/${encodeURIComponent(id)}/decision`, {
        method: 'POST', body: JSON.stringify({ action, reason }) });
      if (action === 'approve' && result.activation?.code) {
        showActivation(row, result);
      } else {
        toast('Demande refusée. Aucun compte n’a été créé.');
      }
      await load();
    } catch (error) {
      if (error.code === 'TEAM_LIMIT') {
        toast(error.message);
        $('#teamRequestsLimitNotice').hidden = false;
        $('#teamRequestsLimitNotice').textContent = `${error.message} (${error.data?.quota?.used ?? '?'} / ${error.data?.quota?.max ?? '?'})`;
      } else if (error.code === 'STORE_REQUIRED') {
        toast('Publiez d’abord votre boutique, puis validez la demande.');
      } else toast(error.message);
    } finally { state.busy = false; }
  }

  function showActivation(row, result) {
    const box = $('#teamRequestCodeBox');
    if (!box) return;
    box.hidden = false;
    box.innerHTML = `<h3>Compte validé</h3>
      <p><strong>${esc(row.fullName)}</strong> — ${esc(roleLabels[row.role] || row.role)} est créé(e). Transmettez ce code d’activation : il ne sera plus affiché.</p>
      <div class="code-display"><code>${esc(result.activation.code)}</code>
        <button class="button outline" type="button" id="copyActivation">Copier</button></div>
      <p class="muted small-note">Valable jusqu’au ${dateTime(result.activation.expiresAt)}. Le membre définira lui-même son mot de passe en l’activant.</p>`;
    $('#copyActivation')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(result.activation.code); toast('Code copié.'); }
      catch (_) { window.prompt('Copiez ce code :', result.activation.code); }
    });
  }

  async function submitRequest(event) {
    event.preventDefault();
    if (state.busy) return;
    const error = $('#teamRequestError');
    error.hidden = true;
    const role = $('#teamRequestRole').value;
    const fullName = $('#teamRequestName').value.trim();
    const phone = $('#teamRequestPhone').value.trim();
    if (fullName.length < 2) { error.textContent = 'Indiquez le nom et le prénom.'; error.hidden = false; return; }
    state.busy = true;
    const button = $('#teamRequestSubmit');
    button.disabled = true;
    try {
      await api('/api/merchant/team/requests', { method: 'POST', body: JSON.stringify({
        role, fullName, phone, designation: $('#teamRequestDesignation').value.trim(), note: $('#teamRequestNote').value.trim() }) });
      $('#teamRequestName').value = ''; $('#teamRequestPhone').value = ''; $('#teamRequestDesignation').value = ''; $('#teamRequestNote').value = '';
      toast('Demande enregistrée. Validez-la dans la liste ci-dessous pour créer le compte.');
      await load();
    } catch (failure) {
      error.textContent = failure.message; error.hidden = false;
    } finally { state.busy = false; button.disabled = false; }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!$('#teamRequestsList')) return;
    $('#teamRequestForm')?.addEventListener('submit', submitRequest);
    $('#teamRequestsRefresh')?.addEventListener('click', load);
    // La rubrique se rafraîchit À CHAQUE ouverture de l'onglet « Mon équipe », sans toucher aux
    // autres onglets : aucun appel réseau n'est fait ailleurs.
    document.addEventListener('click', (event) => {
      const tab = event.target.closest?.('[data-tab="team"]');
      if (!tab) return;
      setTimeout(() => {
        load();
        if (typeof window.QRIAMerchantTeamRefresh === 'function') window.QRIAMerchantTeamRefresh();
      }, 80);
    });
    if ($('#panel-team') && !$('#panel-team').hidden) load();
  });

  window.QRIAMerchantTeamRequests = { load };
})();
