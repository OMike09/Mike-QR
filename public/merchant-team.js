'use strict';

// ============================================================================================
// Rubrique « Mon équipe » du tableau de bord marchand.
//
// Contrat : l'interface ne fait aucun contrôle d'accès. Elle appelle les routes /api/merchant/team
// et affiche ce que le serveur renvoie. Un code d'activation n'est affiché qu'une seule fois,
// immédiatement après sa création : il n'est jamais relisible ensuite.
// ============================================================================================
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dateTime = (value) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(d); };
  const roleLabels = { general_manager: 'Gérant général', waitress: 'Serveuse' };
  const statusLabels = { pending: 'En attente d’activation', active: 'Actif', blocked: 'Bloqué', suspended: 'Suspendu', archived: 'Archivé' };
  const statusClass = { active: 'ok', pending: 'warn', blocked: 'danger', suspended: 'danger', archived: '' };
  const state = { overview: null, selectedMember: '', permissions: [], roles: [], pendingCode: null };

  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const failure = new Error(data.error || `Erreur ${response.status}`); failure.status = response.status; failure.code = data.code || ''; failure.data = data; throw failure; }
    return data;
  }
  function notify(message) { if (typeof window.merchantToast === 'function') return window.merchantToast(message); const node = $('#toast'); if (!node) return; node.textContent = message; node.classList.add('visible'); setTimeout(() => node.classList.remove('visible'), 3200); }

  // ------------------------------------------------------------------ chargement
  async function load() {
    try {
      const data = (await api('/api/merchant/team')).data;
      state.overview = data; state.permissions = data.permissions || []; state.roles = data.roles || [];
      $('#teamBlockedNotice').hidden = data.teamBlocked !== true;
      renderCounts(data); renderMembers(data.members || []); renderTasks(data.tasks || []); fillTaskMembers(data.members || []);
      fillSettings(data.settings || {});
      if (!state.permissions.length) await loadPermissionList();
      renderPermissions();
      await loadActivity();
    } catch (failure) {
      $('#teamMembers').innerHTML = `<p class="message error">${esc(failure.message)}</p>`;
    }
  }

  async function loadPermissionList() {
    // Les libellés viennent du serveur : aucune liste dupliquée côté navigateur.
    try {
      const data = (await api('/api/merchant/team')).data;
      state.permissions = data.permissions || [];
    } catch (_) { /* déjà signalé */ }
  }

  function renderCounts(data) {
    const counts = data.counts || {};
    const settings = data.settings || {};
    $('#teamCounts').innerHTML = `
      <span class="team-count">${counts.generalManagers || 0} / ${settings.effectiveMaxGeneralManagers} gérant(s) général(aux)</span>
      <span class="team-count">${counts.waitresses || 0} / ${settings.effectiveMaxWaitresses} serveuse(s)</span>
      <span class="team-count">${counts.active || 0} actif(s)</span>
      <span class="team-count ${counts.blocked ? 'danger' : ''}">${counts.blocked || 0} bloqué(s)</span>`;
  }

  function fillSettings(settings) {
    $('#teamMaxGm').value = settings.maxGeneralManagers ?? '';
    $('#teamMaxWaitress').value = settings.maxWaitresses ?? '';
    $('#teamCodeTtl').value = settings.activationCodeTtlHours ?? '';
    $('#teamDiscount').value = settings.waitressMaxDiscountPercent ?? 0;
    $('#teamFreePriceMax').value = settings.freePriceMaxXof ?? 0;
    $('#teamAllowFreePrice').checked = settings.allowFreePrice !== false;
  }

  // ------------------------------------------------------------------ permissions
  function renderPermissions() {
    const role = $('#teamRole').value;
    const relevant = state.permissions.filter((permission) => permission.appliesTo === 'both' || permission.appliesTo === role);
    $('#teamPermissions').innerHTML = relevant.map((permission) => {
      const preset = role === 'general_manager' ? permission.managerDefault : permission.waitressDefault;
      return `<label class="permission-item"><input type="checkbox" value="${esc(permission.code)}"${preset ? ' checked' : ''}${permission.code === 'members.manage' ? ' disabled' : ''}><span><strong>${esc(permission.label)}</strong><small>${esc(permission.description)}</small></span></label>`;
    }).join('');
  }

  // ------------------------------------------------------------------ membres
  function memberCard(member) {
    const chips = (member.permissions || []).length;
    return `<article class="team-member" data-member="${esc(member.id)}">
      <header>
        <div><strong>${esc(member.designation || member.fullName)}</strong><small>${esc(member.fullName)} · @${esc(member.username)}</small></div>
        <span class="state-pill ${statusClass[member.status] || ''}">${esc(statusLabels[member.status] || member.status)}</span>
      </header>
      <div class="team-member-meta">
        <span>${esc(roleLabels[member.role] || member.role)}</span>
        ${member.phone ? `<span>${esc(member.phone)}</span>` : ''}
        <span>${chips} permission(s)</span>
        <span>${Number(member.openTasks) || 0} tâche(s) ouverte(s)</span>
        <span>${member.points} point(s)</span>
        <span>${member.lastLoginAt ? `Vu ${dateTime(member.lastLoginAt)}` : 'Jamais connecté'}</span>
      </div>
      <div class="team-member-actions">
        <button class="button outline" type="button" data-team-action="edit" data-id="${esc(member.id)}">Modifier</button>
        <button class="button outline" type="button" data-team-action="codes" data-id="${esc(member.id)}">Codes d’accès</button>
        ${member.status === 'blocked' ? `<button class="button outline" type="button" data-team-action="active" data-id="${esc(member.id)}">Débloquer</button>`
          : `<button class="button outline" type="button" data-team-action="blocked" data-id="${esc(member.id)}">Bloquer</button>`}
        ${member.status === 'active' ? `<button class="button outline" type="button" data-team-action="suspended" data-id="${esc(member.id)}">Suspendre</button>` : ''}
        <button class="button outline" type="button" data-team-action="reset" data-id="${esc(member.id)}">Réinitialiser l’accès</button>
        <button class="button outline" type="button" data-team-action="stats" data-id="${esc(member.id)}">Statistiques</button>
        <button class="button outline danger-outline" type="button" data-team-action="archive" data-id="${esc(member.id)}">Archiver</button>
      </div>
      <div class="team-member-detail" data-detail="${esc(member.id)}" hidden></div>
    </article>`;
  }

  function renderMembers(members) {
    $('#teamMembers').innerHTML = members.length
      ? members.map(memberCard).join('')
      : '<p class="empty">Aucun membre pour le moment. Créez votre premier gérant général ou votre première serveuse.</p>';
    $$('#teamMembers [data-team-action]').forEach((button) => button.addEventListener('click', () => handleMemberAction(button.dataset.teamAction, button.dataset.id)));
  }

  function fillTaskMembers(members) {
    $('#teamTaskMember').innerHTML = members.filter((member) => member.status !== 'archived')
      .map((member) => `<option value="${esc(member.id)}">${esc(member.designation || member.fullName)} — ${esc(roleLabels[member.role] || member.role)}</option>`).join('');
  }

  async function handleMemberAction(action, id) {
    const member = (state.overview?.members || []).find((row) => row.id === id);
    if (!member) return;
    try {
      if (action === 'edit') return openEdit(member);
      if (action === 'codes') return openCodes(member);
      if (action === 'stats') return openStats(member);
      if (action === 'reset') {
        if (!window.confirm(`Réinitialiser l’accès de ${member.designation} ? Ses sessions seront coupées et un nouveau code sera généré.`)) return;
        const data = (await api(`/api/merchant/team/members/${encodeURIComponent(id)}/reset-access`, { method: 'POST' })).data;
        showCode(`Nouveau code pour ${member.designation}`, data.activation);
        await load(); return;
      }
      if (action === 'archive') {
        if (!window.confirm(`Archiver ${member.designation} ? Le membre perd l’accès. Ses commandes et statistiques sont conservées.`)) return;
        await api(`/api/merchant/team/members/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify({ status: 'archived', reason: 'Archivé par le marchand' }) });
        notify('Membre archivé. Historique conservé.'); await load(); return;
      }
      if (['blocked', 'suspended', 'active'].includes(action)) {
        const labels = { blocked: 'bloquer', suspended: 'suspendre', active: 'réactiver' };
        if (!window.confirm(`Confirmer : ${labels[action]} ${member.designation} ? L’accès est coupé immédiatement, sessions ouvertes comprises.`)) return;
        await api(`/api/merchant/team/members/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify({ status: action, reason: `Décision du marchand (${action})` }) });
        notify(action === 'active' ? 'Membre réactivé.' : 'Accès coupé immédiatement.'); await load();
      }
    } catch (failure) { notify(failure.message); }
  }

  // ------------------------------------------------------------------ édition
  function openEdit(member) {
    const detail = $(`[data-detail="${member.id}"]`);
    if (!detail) return;
    detail.hidden = false;
    const relevant = state.permissions.filter((permission) => permission.appliesTo === 'both' || permission.appliesTo === member.role);
    detail.innerHTML = `<form class="form-grid team-edit-form">
      <div class="field"><label>Nom et prénom</label><input name="fullName" maxlength="120" value="${esc(member.fullName)}" required></div>
      <div class="field"><label>Téléphone</label><input name="phone" type="tel" maxlength="32" value="${esc(member.phone || '')}"></div>
      <div class="field"><label>Désignation interne</label><input name="designation" maxlength="60" value="${esc(member.designation || '')}"><small>Modifiable sans changer l’identifiant @${esc(member.username)}.</small></div>
      <div class="field"><label>Fonction</label><select name="role"${member.status === 'active' ? ' disabled' : ''}>
        <option value="waitress"${member.role === 'waitress' ? ' selected' : ''}>Serveuse</option>
        <option value="general_manager"${member.role === 'general_manager' ? ' selected' : ''}>Gérant général</option></select>
        <small>${member.status === 'active' ? 'Archivez ou suspendez le membre avant de changer sa fonction.' : 'Modifiable tant que le compte n’est pas actif.'}</small></div>
      <div class="field span-two"><strong>Permissions</strong><div class="permission-grid">${relevant.map((permission) => `<label class="permission-item"><input type="checkbox" name="permissions" value="${esc(permission.code)}"${(member.permissions || []).includes(permission.code) ? ' checked' : ''}${permission.code === 'members.manage' ? ' disabled' : ''}><span><strong>${esc(permission.label)}</strong><small>${esc(permission.description)}</small></span></label>`).join('')}</div></div>
      <div class="field span-two form-actions"><button class="button primary" type="submit">Enregistrer</button><button class="button outline" type="button" data-cancel>Fermer</button></div>
    </form>`;
    detail.querySelector('[data-cancel]').addEventListener('click', () => { detail.hidden = true; detail.innerHTML = ''; });
    detail.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const permissions = $$('input[name="permissions"]:checked', form).map((input) => input.value);
      try {
        await api(`/api/merchant/team/members/${encodeURIComponent(member.id)}`, { method: 'PATCH', body: JSON.stringify({
          fullName: form.fullName.value, phone: form.phone.value, designation: form.designation.value,
          role: form.role.disabled ? undefined : form.role.value, permissions }) });
        notify('Membre mis à jour.'); await load();
      } catch (failure) { notify(failure.message); }
    });
  }

  // ------------------------------------------------------------------ codes
  async function openCodes(member) {
    const detail = $(`[data-detail="${member.id}"]`);
    if (!detail) return;
    detail.hidden = false;
    try {
      const codes = (await api(`/api/merchant/team/members/${encodeURIComponent(member.id)}/codes`)).data.codes || [];
      detail.innerHTML = `<div class="team-code-list">
        <div class="form-actions"><button class="button primary" type="button" data-new-code>Générer un nouveau code</button><small>Générer un code révoque automatiquement le précédent code non utilisé.</small></div>
        ${codes.length ? codes.map((code) => `<div class="team-code-row"><span class="team-code-hint">••••-••••-••••-${esc(code.hint)}</span>
          <span class="state-pill ${code.state === 'open' ? 'ok' : ''}">${code.state === 'open' ? 'Utilisable' : code.state === 'used' ? 'Utilisé' : code.state === 'revoked' ? 'Révoqué' : 'Expiré'}</span>
          <span>${dateTime(code.expiresAt)}</span>
          ${code.state === 'open' ? `<button class="link-button" type="button" data-revoke="${esc(code.id)}">Révoquer</button>` : ''}</div>`).join('')
          : '<p class="empty">Aucun code pour ce membre.</p>'}
        <p class="muted small-note">Les codes sont stockés hachés : un code déjà affiché ne peut plus être relu. Générez-en un nouveau si besoin.</p>
      </div>`;
      detail.querySelector('[data-new-code]').addEventListener('click', async () => {
        try {
          const data = (await api(`/api/merchant/team/members/${encodeURIComponent(member.id)}/codes`, { method: 'POST' })).data;
          showCode(`Nouveau code pour ${member.designation}`, data.activation);
          await openCodes(member);
        } catch (failure) { notify(failure.message); }
      });
      $$('[data-revoke]', detail).forEach((button) => button.addEventListener('click', async () => {
        try { await api(`/api/merchant/team/members/${encodeURIComponent(member.id)}/codes/${encodeURIComponent(button.dataset.revoke)}`, { method: 'DELETE' }); notify('Code révoqué.'); await openCodes(member); }
        catch (failure) { notify(failure.message); }
      }));
    } catch (failure) { detail.innerHTML = `<p class="message error">${esc(failure.message)}</p>`; }
  }

  function showCode(title, activation) {
    const box = $('#teamCodeResult');
    box.hidden = false;
    box.innerHTML = `<h3>${esc(title)}</h3>
      <p class="team-code-value">${esc(activation.code)}</p>
      <p class="muted">Valable jusqu’au ${dateTime(activation.expiresAt)}. Ce code ne sera plus affiché : transmettez-le maintenant au membre. Il est à usage unique.</p>
      <button class="button outline" type="button" data-copy-code>Copier le code</button>
      <button class="button quiet" type="button" data-close-code>J’ai transmis le code</button>`;
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    box.querySelector('[data-copy-code]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(activation.code); notify('Code copié.'); } catch (_) { notify('Copie impossible : notez le code.'); }
    });
    box.querySelector('[data-close-code]').addEventListener('click', () => { box.hidden = true; box.innerHTML = ''; });
  }

  // ------------------------------------------------------------------ statistiques
  async function openStats(member) {
    const detail = $(`[data-detail="${member.id}"]`);
    if (!detail) return;
    detail.hidden = false;
    try {
      const data = (await api(`/api/merchant/team/members/${encodeURIComponent(member.id)}/stats`)).data;
      detail.innerHTML = `<div class="team-stats">
        <div><span>Commandes saisies</span><strong>${data.orders.count}</strong></div>
        <div><span>Montant cumulé</span><strong>${new Intl.NumberFormat('fr-FR').format(data.orders.totalXof)} XOF</strong></div>
        <div><span>Dernière commande</span><strong>${data.orders.lastAt ? dateTime(data.orders.lastAt) : '—'}</strong></div>
        <div><span>Tâches</span><strong>${data.tasks.done} / ${data.tasks.total}</strong></div>
        <div><span>Points</span><strong>${data.member.points}</strong></div>
      </div>`;
    } catch (failure) { detail.innerHTML = `<p class="message error">${esc(failure.message)}</p>`; }
  }

  // ------------------------------------------------------------------ tâches et activité
  function renderTasks(tasks) {
    const node = $('#teamTaskList');
    if (!node) return;
    node.innerHTML = tasks.length ? tasks.map((task) => `<div class="team-task">
      <div><strong>${esc(task.title)}</strong><small>${esc(task.designation || 'Non attribuée')} · ${esc(task.priority)}${task.dueAt ? ` · échéance ${dateTime(task.dueAt)}` : ''}</small></div>
      <span class="state-pill ${task.status === 'done' ? 'ok' : task.status === 'cancelled' ? 'danger' : 'warn'}">${esc(task.status)}</span>
      ${task.status !== 'done' && task.status !== 'cancelled' ? `<button class="link-button" type="button" data-task-done="${esc(task.id)}">Marquer terminée</button>` : ''}
    </div>`).join('') : '<p class="empty">Aucune tâche attribuée.</p>';
    $$('[data-task-done]', node).forEach((button) => button.addEventListener('click', async () => {
      try { await api(`/api/merchant/team/tasks/${encodeURIComponent(button.dataset.taskDone)}/status`, { method: 'POST', body: JSON.stringify({ status: 'done' }) }); await load(); }
      catch (failure) { notify(failure.message); }
    }));
  }

  async function loadActivity() {
    try {
      const rows = (await api('/api/merchant/team/activity?limit=40')).data || [];
      $('#teamActivityList').innerHTML = rows.length ? rows.map((row) => `<div class="team-activity-row">
        <span>${dateTime(row.createdAt)}</span><span>${esc(row.designation || 'Équipe')}</span><span>${esc(row.summary)}</span>
        ${row.result !== 'success' ? `<span class="state-pill danger">${esc(row.result)}</span>` : ''}</div>`).join('') : '<p class="empty">Aucune activité enregistrée.</p>';
    } catch (_) { $('#teamActivityList').innerHTML = '<p class="empty">Activité indisponible.</p>'; }
  }

  // ------------------------------------------------------------------ actions globales
  function bind() {
    const createPanel = $('#teamCreatePanel');
    $('#teamCreateButton').addEventListener('click', () => { createPanel.hidden = !createPanel.hidden; });
    $('#teamCreateCancel').addEventListener('click', () => { createPanel.hidden = true; });
    $('#teamSettingsButton').addEventListener('click', () => { const panel = $('#teamSettingsPanel'); panel.hidden = !panel.hidden; });
    $('#teamRole').addEventListener('change', renderPermissions);
    $('#teamRefresh').addEventListener('click', () => load());
    $('#teamCreateForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const error = $('#teamCreateError'); error.hidden = true;
      const permissions = $$('#teamPermissions input:checked').map((input) => input.value);
      try {
        const data = (await api('/api/merchant/team/members', { method: 'POST', body: JSON.stringify({
          role: $('#teamRole').value, fullName: $('#teamFullName').value, phone: $('#teamPhone').value,
          designation: $('#teamDesignation').value, permissions }) })).data;
        $('#teamFullName').value = ''; $('#teamPhone').value = ''; $('#teamDesignation').value = '';
        createPanel.hidden = true;
        showCode(`Code d’activation de ${data.member.designation}`, data.activation);
        await load();
      } catch (failure) { error.textContent = failure.message; error.hidden = false; }
    });
    $('#teamSettingsForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api('/api/merchant/team/settings', { method: 'PATCH', body: JSON.stringify({
          maxGeneralManagers: Number($('#teamMaxGm').value), maxWaitresses: Number($('#teamMaxWaitress').value),
          activationCodeTtlHours: Number($('#teamCodeTtl').value), waitressMaxDiscountPercent: Number($('#teamDiscount').value),
          freePriceMaxXof: Number($('#teamFreePriceMax').value), allowFreePrice: $('#teamAllowFreePrice').checked }) });
        $('#teamSettingsStatus').textContent = 'Enregistré.'; await load();
      } catch (failure) { $('#teamSettingsStatus').textContent = failure.message; }
    });
    $('#teamBlockAllButton').addEventListener('click', () => statusAll('blocked'));
    $('#teamUnblockAllButton').addEventListener('click', () => statusAll('active'));
    $('#teamTaskForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api('/api/merchant/team/tasks', { method: 'POST', body: JSON.stringify({
          memberId: $('#teamTaskMember').value, title: $('#teamTaskTitle').value, description: $('#teamTaskDescription').value,
          dueAt: $('#teamTaskDue').value || undefined, priority: $('#teamTaskPriority').value }) });
        $('#teamTaskTitle').value = ''; $('#teamTaskDescription').value = ''; $('#teamTaskDue').value = '';
        notify('Tâche attribuée et notifiée.'); await load();
      } catch (failure) { notify(failure.message); }
    });
    // L'onglet est rendu par merchant.js : on écoute le clic sans modifier son code.
    document.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-tab="team"]');
      if (tab) load();
    });
  }

  async function statusAll(status) {
    const label = status === 'blocked' ? 'bloquer TOUTE l’équipe' : 'débloquer toute l’équipe';
    const answer = window.prompt(`Confirmez en tapant TOUTE-EQUIPE pour ${label}. Les sessions ouvertes seront coupées immédiatement, les commandes et statistiques sont conservées.`);
    if (answer !== 'TOUTE-EQUIPE') { notify('Confirmation annulée : rien n’a été modifié.'); return; }
    try {
      const data = (await api('/api/merchant/team/status-all', { method: 'POST', body: JSON.stringify({ status, confirm: true, acknowledge: 'TOUTE-EQUIPE', reason: 'Décision du marchand' }) })).data;
      notify(`${data.changed} membre(s) mis à jour.`); await load();
    } catch (failure) { notify(failure.message); }
  }

  function init() {
    if (!$('#panel-team')) return;
    bind();
    // Premier chargement uniquement quand la session marchand est déjà ouverte.
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (!$('#appView')?.hidden && $('#appView')) { clearInterval(timer); load(); }
      if (attempts > 120) clearInterval(timer);
    }, 500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
