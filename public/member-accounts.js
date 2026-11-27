'use strict';

// ============================================================================================
// MISSION 12 — « Mes comptes créés » (rubrique Mon équipe, espace marchand).
//
// Une seule liste, une seule fiche : ouvrir un compte montre TOUT sur une seule page (identité,
// tables et salons, permissions, sécurité, historique). Pas de sous-menus, pas de fenêtres
// empilées : la fiche se déplie sous la ligne du compte.
//
// Aucun contrôle d'accès n'est décidé ici : /api/merchant/member-accounts vérifie que chaque
// compte appartient bien à l'établissement du marchand connecté (sinon 404).
// ============================================================================================
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const dateTime = (value) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(date); };
  const STATUS_CLASS = { active: 'ok', pending: 'warn', suspended: 'danger', blocked: 'danger', archived: '' };
  const state = { data: null, openedId: '', busy: false };

  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(payload.error || `Erreur ${response.status}`); error.code = payload.code || ''; throw error; }
    return payload;
  }
  function notify(message) {
    if (typeof window.merchantToast === 'function') return window.merchantToast(message);
    const node = $('#toast'); if (!node) return;
    node.textContent = message; node.classList.add('visible');
    setTimeout(() => node.classList.remove('visible'), 3200);
  }

  // ------------------------------------------------------------------ la liste
  async function load() {
    const body = $('#memberAccountsBody');
    if (!body) return;
    try {
      const payload = await api('/api/merchant/member-accounts');
      state.data = payload.data;
      renderSummary();
      renderRows();
    } catch (failure) {
      body.innerHTML = `<tr><td colspan="6"><p class="message error">${esc(failure.message)}</p></td></tr>`;
    }
  }

  function renderSummary() {
    const host = $('#memberAccountsSummary'); if (!host || !state.data) return;
    const { counts, quotas } = state.data;
    host.innerHTML = `
      <span class="team-count">Comptes : <strong>${counts.total}</strong></span>
      <span class="team-count">Actifs : <strong>${counts.active}</strong></span>
      ${counts.pending ? `<span class="team-count warn">En attente : <strong>${counts.pending}</strong></span>` : ''}
      ${counts.suspended ? `<span class="team-count danger">Suspendus : <strong>${counts.suspended}</strong></span>` : ''}
      <span class="team-count${quotas.generalManagers.used >= quotas.generalManagers.max ? ' danger' : ''}">Gérants : <strong>${quotas.generalManagers.used}/${quotas.generalManagers.max}</strong></span>
      <span class="team-count${quotas.waitresses.used >= quotas.waitresses.max ? ' danger' : ''}">Serveuses / serveurs : <strong>${quotas.waitresses.used}/${quotas.waitresses.max}</strong></span>
      <small class="team-quota-note">Effectifs fixés par l’Administrateur général : le marchand les respecte, il ne les modifie pas.</small>`;
  }

  function renderRows() {
    const body = $('#memberAccountsBody'); if (!body) return;
    const accounts = state.data?.accounts || [];
    if (!accounts.length) {
      body.innerHTML = '<tr><td colspan="6" class="muted">Aucun compte créé pour le moment. Utilisez « + Créer un compte » : vous choisissez d’abord le type de compte, puis ses informations.</td></tr>';
      return;
    }
    body.innerHTML = accounts.map((account) => `
      <tr class="account-row${account.status === 'active' ? '' : ' is-idle'}" data-account="${esc(account.id)}">
        <td data-label="Nom complet"><strong>${esc(account.fullName)}</strong><small>${esc(account.designation || `@${account.username}`)}</small></td>
        <td data-label="Téléphone">${account.phone ? `<a href="tel:${esc(account.phone)}">${esc(account.phone)}</a>` : '<span class="muted">—</span>'}</td>
        <td data-label="Rôle">${esc(account.roleLabel)}</td>
        <td data-label="Tables et salons">${(account.points || []).length
          ? `<span class="account-points">${account.points.map((point) => `<span class="team-space-chip">${esc(point.number ? `Table ${point.number}` : point.name)}</span>`).join('')}</span>`
          : '<span class="muted">Aucune table</span>'}</td>
        <td data-label="Statut"><span class="account-status ${STATUS_CLASS[account.status] || ''}">${esc(account.statusLabel)}</span>
          ${account.lockActive ? '<small class="account-lock">verrouillé</small>' : ''}</td>
        <td class="account-open-cell"><button type="button" class="button outline" data-open-account="${esc(account.id)}">Ouvrir</button></td>
      </tr>
      <tr class="account-detail-row" data-detail-row="${esc(account.id)}" hidden><td colspan="6"><div class="member-account-view" data-view="${esc(account.id)}"></div></td></tr>`).join('');
    $$('[data-open-account]', body).forEach((button) => button.addEventListener('click', () => open(button.dataset.openAccount)));
  }

  // ------------------------------------------------------------------ la fiche d'un compte
  async function open(memberId) {
    const row = $(`[data-detail-row="${memberId}"]`);
    const view = row ? $('[data-view]', row) : null;
    if (!row || !view) return;
    if (state.openedId === memberId) { row.hidden = true; state.openedId = ''; return; }
    $$('[data-detail-row]', $('#memberAccountsBody')).forEach((node) => { node.hidden = true; });
    state.openedId = memberId;
    row.hidden = false;
    view.innerHTML = '<p class="muted">Chargement du compte…</p>';
    try {
      const payload = await api(`/api/merchant/member-accounts/${encodeURIComponent(memberId)}`);
      renderView(view, payload.data);
    } catch (failure) {
      view.innerHTML = `<p class="message error">${esc(failure.message)}</p>`;
    }
  }

  function renderView(view, data) {
    const { account, permissions, points, history } = data;
    view.dataset.accountId = account.id;
    const local = (account.phone || '').replace(/[^0-9+]/g, '');
    view.innerHTML = `
      <header class="account-view-head">
        <div><span class="eyebrow">${esc(account.roleLabel.toUpperCase())}</span>
          <h3>${esc(account.fullName)}</h3>
          <p class="muted">@${esc(account.username)}${account.designation ? ` · ${esc(account.designation)}` : ''} · créé le ${dateTime(account.createdAt)}
            ${account.lastLoginAt ? ` · dernière connexion ${dateTime(account.lastLoginAt)}` : ' · jamais connecté'}</p></div>
        <div class="account-view-head-actions">
          <span class="account-status ${STATUS_CLASS[account.status] || ''}">${esc(account.statusLabel)}</span>
          <button type="button" class="button outline" data-close-account>Fermer</button>
        </div>
      </header>

      <form class="account-form" data-account-form>
        <div class="account-grid">
          <label>Nom complet *<input name="fullName" maxlength="120" required value="${esc(account.fullName)}"></label>
          <label>Numéro de téléphone<input name="phone" type="tel" maxlength="32" value="${esc(account.phone)}" placeholder="+225 07 00 00 00 00">
            <small>${local ? `<a href="tel:${esc(local)}">Appeler ce numéro</a>` : 'Permet de joindre le membre depuis cet écran.'}</small></label>
          <label>Désignation interne<input name="designation" maxlength="60" value="${esc(account.designation || '')}" placeholder="Serveur salle"><small>Affichée dans les commandes, sans changer l’identifiant @${esc(account.username)}.</small></label>
        </div>

        <section class="account-section">
          <h4>Tables et salons affectés</h4>
          <p class="muted small-note">Cochez les espaces que ce compte gère. Les espaces listés sont ceux de votre établissement : aucune table n’est créée ici.</p>
          <div class="account-points-picker">
            ${(points || []).length ? points.map((point) => `<label class="account-point">
              <input type="checkbox" name="servicePointIds" value="${esc(point.id)}"${point.checked ? ' checked' : ''}>
              <span><strong>${esc(point.number ? `Table ${point.number}` : point.name)}</strong><small>${esc(point.zone || 'Sans salon')} · ${esc(point.type === 'salon' ? 'Salon' : point.type === 'location' ? 'Espace' : point.type === 'counter' ? 'Comptoir' : 'Table')}</small></span>
            </label>`).join('') : '<p class="muted">Aucune table enregistrée. Créez-les dans « Gestion des tables et espaces ».</p>'}
          </div>
        </section>

        <section class="account-section">
          <h4>Permissions</h4>
          <div class="permission-grid">
            ${(permissions || []).map((permission) => `<label class="permission-item${permission.locked ? ' is-locked' : ''}">
              <input type="checkbox" name="permissions" value="${esc(permission.code)}"${permission.granted ? ' checked' : ''}${permission.locked ? ' disabled' : ''}>
              <span><strong>${esc(permission.label)}</strong><small>${esc(permission.description)}</small></span>
            </label>`).join('')}
          </div>
        </section>

        <p class="message" data-form-message role="status" hidden></p>
        <div class="account-form-actions">
          <button type="submit" class="button primary">Enregistrer les modifications</button>
          <small class="muted">Les permissions s’appliquent immédiatement, sans reconnexion du membre.</small>
        </div>
      </form>

      <section class="account-section account-security">
        <h4>Sécurité et accès</h4>
        <div class="account-security-grid">
          <div>
            <strong>${account.status === 'active' ? 'Suspendre ce compte' : 'Réactiver ce compte'}</strong>
            <p class="muted small-note">${account.status === 'active'
              ? 'L’accès est coupé immédiatement, sessions ouvertes comprises. Les données, tables et historique sont conservés.'
              : 'Le membre pourra se reconnecter avec son code à 6 chiffres.'}</p>
            <button type="button" class="button outline${account.status === 'active' ? ' danger-outline' : ''}" data-account-status>${account.status === 'active' ? 'Suspendre' : 'Réactiver'}</button>
          </div>
          <div>
            <strong>Réinitialiser le mot de passe</strong>
            <p class="muted small-note">Le nouveau code à 6 chiffres est affiché <em>une seule fois</em>. Toutes les sessions du membre sont fermées.</p>
            <div class="account-reset-row">
              <input type="text" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" placeholder="6 chiffres (ou vide = généré)" data-reset-password>
              <button type="button" class="button outline" data-account-reset>Réinitialiser</button>
            </div>
            <p class="account-reset-result" data-reset-result hidden></p>
          </div>
        </div>
      </section>

      <section class="account-section">
        <h4>Historique d’activité</h4>
        ${(history || []).length ? `<ul class="account-history">${history.map((row) => `<li>
          <span class="account-history-date">${dateTime(row.createdAt)}</span>
          <span>${esc(row.summary || row.action)}</span>
          <span class="account-history-result ${row.result === 'success' ? 'ok' : ''}">${esc(row.result || '')}</span></li>`).join('')}</ul>`
          : '<p class="muted">Aucune activité enregistrée pour ce compte.</p>'}
      </section>`;

    $('[data-close-account]', view).addEventListener('click', () => { const row = view.closest('[data-detail-row]'); if (row) row.hidden = true; state.openedId = ''; });
    $('[data-account-form]', view).addEventListener('submit', (event) => save(view, event));
    $('[data-account-status]', view).addEventListener('click', () => toggleStatus(view, account));
    $('[data-account-reset]', view).addEventListener('click', () => resetPassword(view, account));
  }

  async function save(view, event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $('[data-form-message]', view);
    const submit = $('button[type="submit"]', form);
    message.hidden = true; submit.disabled = true;
    const servicePointIds = $$('input[name="servicePointIds"]:checked', form).map((input) => input.value);
    // Les permissions verrouillées (membres/gestion des comptes) restent hors de portée du marchand.
    const permissions = $$('input[name="permissions"]:checked', form).map((input) => input.value);
    const body = { fullName: form.fullName.value, phone: form.phone.value, designation: form.designation.value, permissions, servicePointIds };
    try {
      const payload = await api(`/api/merchant/member-accounts/${encodeURIComponent(view.dataset.accountId || currentId(view))}`, { method: 'PUT', body: JSON.stringify(body) });
      const keepOpen = view.dataset.accountId || currentId(view);
      await load();
      // La liste est rechargée mais la fiche reste OUVERTE : le marchand continue sur le même
      // compte (tables, permissions, sécurité, historique) sans avoir à recliquer.
      state.openedId = ''; await open(keepOpen);
      const fresh = document.querySelector(`[data-view="${keepOpen}"] [data-form-message]`);
      if (fresh) { fresh.className = 'message ok'; fresh.textContent = payload.data?.notice || 'Compte mis à jour.'; fresh.hidden = false; }
      notify('Compte enregistré.');
    } catch (failure) {
      message.className = 'message error'; message.textContent = failure.message; message.hidden = false;
    } finally { submit.disabled = false; }
  }

  function currentId(view) { return view.closest('[data-detail-row]')?.dataset.detailRow || ''; }

  async function toggleStatus(view, account) {
    const next = account.status === 'active' ? 'suspended' : 'active';
    const label = next === 'suspended' ? 'suspendre' : 'réactiver';
    if (!window.confirm(`Confirmer : ${label} le compte de ${account.fullName} ?\n${next === 'suspended' ? 'L’accès est coupé immédiatement, sessions ouvertes comprises.' : 'Le membre pourra se reconnecter avec son code.'}`)) return;
    try {
      const payload = await api(`/api/merchant/member-accounts/${encodeURIComponent(account.id)}/status`, { method: 'POST', body: JSON.stringify({ status: next, reason: `Décision du marchand (${next})` }) });
      notify(payload.data?.notice || 'État du compte mis à jour.');
      await load();
      await open(account.id);
    } catch (failure) { notify(failure.message); }
  }

  async function resetPassword(view, account) {
    const field = $('[data-reset-password]', view);
    const result = $('[data-reset-result]', view);
    const password = (field.value || '').trim();
    if (password && !/^[0-9]{6}$/.test(password)) { notify('Le nouveau code doit être exactement 6 chiffres.'); field.focus(); return; }
    if (!window.confirm(`Réinitialiser le mot de passe de ${account.fullName} ?\nToutes ses sessions seront fermées immédiatement.`)) return;
    try {
      const payload = await api(`/api/merchant/member-accounts/${encodeURIComponent(account.id)}/reset-password`, { method: 'POST', body: JSON.stringify(password ? { password } : {}) });
      const code = payload.data.temporaryPassword;
      result.hidden = false;
      result.innerHTML = `<span>Nouveau code à ${code.length} chiffres <strong>(affiché une seule fois)</strong> :</span>
        <code class="account-reset-code">${esc(code)}</code>
        <button type="button" class="link-button" data-copy-code>Copier</button>
        <small>Sessions fermées. Transmettez ce code au membre : il ne sera plus jamais affiché.</small>`;
      $('[data-copy-code]', result).addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(code); notify('Code copié.'); } catch (_) { window.prompt('Copiez ce code :', code); }
      });
      field.value = '';
    } catch (failure) { notify(failure.message); }
  }

  // ------------------------------------------------------------------ branchement
  // Le bloc « Mes comptes créés » vit dans la rubrique Mon équipe : il se recharge aussi quand on
  // y revient par le menu, pour refléter immédiatement une création ou une suspension.
  document.addEventListener('click', (event) => {
    // Seuls les BOUTONS de menu déclenchent un rechargement (pas les clics dans le panneau, qui
    // refermaient la fiche du compte en cours de consultation).
    if (event.target.closest?.('button[data-rubric="team"], button[data-tab="team"]')) setTimeout(() => load(), 350);
  });
  document.addEventListener('DOMContentLoaded', () => {
    $('#memberAccountsCreate')?.addEventListener('click', () => {
      // On ne duplique pas le formulaire de création : on utilise celui de « Mon équipe »,
      // déjà relié aux quotas du PDG et aux mêmes règles de code à 6 chiffres.
      const button = document.getElementById('teamCreateButton');
      if (button) { button.click(); document.getElementById('teamCreatePanel')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      else { notify('Le formulaire de création est indisponible sur cet écran.'); }
    });
    load();
  });
  window.MemberAccounts = { load, open };
})();
