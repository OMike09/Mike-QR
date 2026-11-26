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
  const roleLabels = { general_manager: 'Gérant général', waitress: 'Serveuse / Serveur' };
  const statusLabels = { pending: 'En attente de validation', active: 'Actif', blocked: 'Bloqué', suspended: 'Suspendu', archived: 'Archivé' };
  const statusClass = { active: 'ok', pending: 'warn', blocked: 'danger', suspended: 'danger', archived: '' };
  const state = { overview: null, selectedMember: '', permissions: [], roles: [], pendingCode: null,
    createRole: '', selectedPoints: new Set(), lastPassword: '' };
  const typeLabels = { table: 'Table', counter: 'Comptoir', salon: 'Salon', location: 'Espace' };

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
    // Mission 11 : « autorisés / déjà créés » doit être lisible d'un coup d'œil (ex. 1/2 et 3/5).
    const gmUsed = Number(counts.generalManagers) || 0;
    const wtUsed = Number(counts.waitresses) || 0;
    const gmMax = Number(settings.effectiveMaxGeneralManagers) || 0;
    const wtMax = Number(settings.effectiveMaxWaitresses) || 0;
    $('#teamCounts').innerHTML = `
      <span class="team-count${gmUsed >= gmMax ? ' danger' : ''}">Gérants généraux : <strong>${gmUsed}/${gmMax}</strong></span>
      <span class="team-count${wtUsed >= wtMax ? ' danger' : ''}">Serveuses et serveurs : <strong>${wtUsed}/${wtMax}</strong></span>
      <span class="team-count">${counts.active || 0} actif(s)</span>
      <span class="team-count ${counts.blocked ? 'danger' : ''}">${counts.blocked || 0} bloqué(s)</span>`;
    const usage = data.quotaUsage || {};
    const details = [usage.generalManagersDetail, usage.waitressesDetail].filter(Boolean);
    const notice = $('#teamQuotaUsage');
    if (notice) notice.innerHTML = details.map((row) => `<span class="team-count${row.remaining === 0 ? ' danger' : ''}">${esc(row.label)} : <strong>${row.used}/${row.max}</strong>${row.remaining === 0 ? ' — quota atteint' : ` — ${row.remaining} place(s)`}</span>`).join('');
  }

  function fillSettings(settings) {
    const quota = settings.quota || {};
    // Mission 9 : les effectifs sont fixés par le PDG (ou hérités du code de terrain). Le marchand
    // ne les fixe plus librement : les champs affichent la limite EFFECTIVE et sont verrouillés.
    const locked = quota.merchantCanEditQuotas !== true;
    $('#teamMaxGm').value = settings.effectiveMaxGeneralManagers ?? settings.maxGeneralManagers ?? '';
    $('#teamMaxWaitress').value = settings.effectiveMaxWaitresses ?? settings.maxWaitresses ?? '';
    $('#teamMaxGm').readOnly = locked; $('#teamMaxWaitress').readOnly = locked;
    $('#teamMaxGm').title = locked ? 'Limite fixée par l’Administrateur général.' : '';
    $('#teamMaxWaitress').title = locked ? 'Limite fixée par l’Administrateur général.' : '';
    const note = $('#teamQuotaLockedNote');
    if (note) {
      note.hidden = !locked;
      note.textContent = locked
        ? `Vos effectifs sont plafonnés à ${settings.effectiveMaxGeneralManagers} gérant(s) général(aux) et ${settings.effectiveMaxWaitresses} serveur(s)/serveuse(s), selon la décision de l’Administrateur général${quota.source === 'field_code' ? ' (limite héritée du code d’inscription)' : ''}. Toute demande de dépassement passe par l’Administrateur général.`
        : '';
    }
    if ($('#teamGmLimitLabel')) $('#teamGmLimitLabel').textContent = `Limite appliquée : ${settings.effectiveMaxGeneralManagers ?? '—'}`;
    if ($('#teamWaitressLimitLabel')) $('#teamWaitressLimitLabel').textContent = `Limite appliquée : ${settings.effectiveMaxWaitresses ?? '—'}`;
    $('#teamCodeTtl').value = settings.activationCodeTtlHours ?? '';
    $('#teamDiscount').value = settings.waitressMaxDiscountPercent ?? 0;
    $('#teamFreePriceMax').value = settings.freePriceMaxXof ?? 0;
    $('#teamAllowFreePrice').checked = settings.allowFreePrice !== false;
  }

  // ------------------------------------------------------------------ permissions
  function renderPermissions(roleOverride) {
    // Mission 11 : le rôle n'est plus un menu déroulant du formulaire : il est CHOISI avant, sur
    // l'écran à deux choix. `state.createRole` porte donc la décision du marchand.
    const role = roleOverride || state.createRole || 'waitress';
    const relevant = state.permissions.filter((permission) => permission.appliesTo === 'both' || permission.appliesTo === role);
    $('#teamPermissions').innerHTML = relevant.map((permission) => {
      const preset = role === 'general_manager' ? permission.managerDefault : permission.waitressDefault;
      return `<label class="permission-item"><input type="checkbox" value="${esc(permission.code)}"${preset ? ' checked' : ''}${permission.code === 'members.manage' ? ' disabled' : ''}><span><strong>${esc(permission.label)}</strong><small>${esc(permission.description)}</small></span></label>`;
    }).join('');
  }

  // ------------------------------------------------------------------ création en deux temps (M11)
  const quotaOf = (data, role) => (role === 'general_manager'
    ? (data?.quotaUsage?.generalManagersDetail || data?.quotaUsage?.generalManagers || { used: 0, max: 0 })
    : (data?.quotaUsage?.waitressesDetail || data?.quotaUsage?.waitresses || { used: 0, max: 0 }));

  function renderCreateQuotas() {
    const data = state.overview || {};
    const parts = [['general_manager', 'Gérants généraux'], ['waitress', 'Serveuses et serveurs']].map(([role, label]) => {
      const quota = quotaOf(data, role);
      const used = Number(quota.used) || 0; const max = Number(quota.max) || 0;
      const full = used >= max;
      const text = `${label} : ${used}/${max}`;
      const slot = $(`[data-role-quota="${role}"]`);
      if (slot) { slot.textContent = full ? `${text} — quota atteint` : `${text} — ${Math.max(0, max - used)} place(s) disponible(s)`; slot.classList.toggle('is-full', full); }
      return { role, label, used, max, full, text };
    });
    const notice = $('#teamCreateQuotaNotice');
    if (notice) notice.innerHTML = parts.map((part) => `<span class="team-count${part.full ? ' danger' : ''}">${esc(part.text)}</span>`).join('');
    $$('[data-team-role]').forEach((button) => {
      const part = parts.find((row) => row.role === button.dataset.teamRole);
      button.classList.toggle('is-full', Boolean(part?.full));
      button.setAttribute('aria-disabled', part?.full ? 'true' : 'false');
    });
    return parts;
  }

  function stepRoleChoice() {
    state.createRole = '';
    $('#teamCreateStepRole').hidden = false;
    $('#teamCreateForm').hidden = true;
    $('#teamRoleBlockedNote').hidden = true;
    renderCreateQuotas();
  }

  function stepForm(role) {
    const quota = quotaOf(state.overview, role);
    const used = Number(quota.used) || 0; const max = Number(quota.max) || 0;
    if (used >= max) {
      // Blocage d'affichage : le serveur refuse de toute façon (aucun contournement possible).
      const note = $('#teamRoleBlockedNote');
      note.hidden = false;
      note.textContent = `Le quota des ${role === 'general_manager' ? 'gérants généraux' : 'serveuses et serveurs'} est atteint (${used}/${max}). Vous ne pouvez pas créer de compte supplémentaire. Contactez l’Administrateur général pour une autorisation de dépassement.`;
      return;
    }
    state.createRole = role;
    state.selectedPoints = new Set();
    $('#teamCreateStepRole').hidden = true;
    $('#teamCreateForm').hidden = false;
    $('#teamCreateFormTitle').textContent = role === 'general_manager' ? 'Nouveau gérant général' : 'Nouvelle serveuse / nouveau serveur';
    $('#teamCreateFormEyebrow').textContent = role === 'general_manager' ? 'COMPTE GÉRANT GÉNÉRAL' : 'COMPTE SERVEUSE / SERVEUR';
    $('#teamCreateForm').reset();
    $('#teamCreateError').hidden = true;
    renderPermissions(role);
    renderPointList();
    const first = $('#teamFullName'); if (first) first.focus();
  }

  // Liste cliquable des tables et salons DÉJÀ enregistrés : nom, salon (zone), type, disponibilité.
  function renderPointList() {
    const node = $('#teamPointList');
    if (!node) return;
    const points = state.overview?.servicePoints || [];
    if (!points.length) {
      node.innerHTML = '<p class="muted">Aucune table ni aucun salon enregistré pour le moment. Créez-les d’abord dans la rubrique « Tables et emplacements », puis revenez ici : ils seront proposés automatiquement.</p>';
      return;
    }
    const groups = new Map();
    for (const point of points) {
      const key = point.type === 'salon' ? 'Salons et espaces' : point.type === 'counter' ? 'Comptoirs' : point.type === 'location' ? 'Emplacements' : 'Tables';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(point);
    }
    const others = state.overview?.members || [];
    node.innerHTML = [...groups.entries()].map(([label, rows]) => `<fieldset class="team-point-group"><legend>${esc(label)} <small>${rows.length}</small></legend>
      <div class="team-point-items">${rows.map((point) => {
        const holders = others.filter((member) => (member.servicePoints || []).some((row) => (row.servicePointId || row.id) === point.id));
        const state_ = point.activeOrders > 0 ? `Occupé (${point.activeOrders} commande(s))` : 'Disponible';
        return `<label class="team-point-item">
          <input type="checkbox" name="servicePointIds" value="${esc(point.id)}">
          <span><strong>${esc(point.name)}</strong>
          <small>${esc(point.zone || 'Sans salon')} · ${esc(typeLabels[point.type] || point.type)} · ${esc(state_)}</small>
          ${holders.length ? `<small class="team-point-holders">Déjà attribué à ${holders.map((member) => esc(member.designation || member.fullName)).join(', ')}</small>` : ''}</span>
        </label>`;
      }).join('')}</div></fieldset>`).join('');
    $$('#teamPointList input[name="servicePointIds"]').forEach((input) => input.addEventListener('change', () => {
      if (input.checked) state.selectedPoints.add(input.value); else state.selectedPoints.delete(input.value);
    }));
  }

  function collectCreatePayload(form) {
    return {
      role: state.createRole,
      fullName: form.fullName.value.trim(),
      phone: form.phone.value.trim(),
      username: form.username.value.trim() || undefined,
      designation: form.designation.value.trim() || undefined,
      password: form.password.value,
      servicePointIds: [...state.selectedPoints],
      permissions: $$('#teamPermissions input:checked').map((input) => input.value),
      // Le gérant général suit le circuit d'approbation (créé « en attente », validé par le marchand) ;
      // la serveuse / le serveur est validée à la création.
      approveNow: state.createRole === 'waitress',
    };
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
      ${(member.servicePoints || []).length ? `<div class="team-member-spaces">${member.servicePoints.map((space) => `<span class="team-space-chip">${esc(space.name)}${space.zone ? ` <small>${esc(space.zone)}</small>` : ''}${(space.servicePointId || space.id) && member.primaryPointId === (space.servicePointId || space.id) ? ' ★' : ''}</span>`).join('')}</div>`
        : '<div class="team-member-spaces"><span class="muted small-note">Aucune table ni aucun salon attribué.</span></div>'}
      ${member.lockActive ? `<p class="message warn">Compte temporairement verrouillé après plusieurs échecs de connexion${member.lockedUntil ? ` (jusqu’au ${dateTime(member.lockedUntil)})` : ''}. Vous pouvez le débloquer en réinitialisant son accès.</p>` : ''}
      <div class="team-member-actions">
        ${member.status === 'pending' ? `<button class="button primary" type="button" data-team-action="validate" data-id="${esc(member.id)}">Valider le compte</button>` : ''}
        <button class="button outline" type="button" data-team-action="edit" data-id="${esc(member.id)}">Modifier</button>
        <button class="button outline" type="button" data-team-action="points" data-id="${esc(member.id)}">Tables et salons</button>
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
      if (action === 'points') return openAssignments(member);
      if (action === 'validate') {
        if (!window.confirm(`Valider le compte de ${member.designation} ? Le membre pourra activer son accès avec le code transmis.`)) return;
        await api(`/api/merchant/team/members/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify({ status: 'active', reason: 'Compte validé par le marchand' }) });
        notify('Compte validé : le membre peut désormais activer son accès.'); await load(); return;
      }
      if (action === 'codes') return openCodes(member);
      if (action === 'stats') return openStats(member);
      if (action === 'reset') {
        if (!window.confirm(`Réinitialiser l’accès de ${member.designation} ?\nSes sessions seront coupées immédiatement et un mot de passe temporaire à 6 chiffres sera généré.`)) return;
        const response = await api(`/api/merchant/team/members/${encodeURIComponent(id)}/access-code`, { method: 'POST', body: JSON.stringify({}) });
        showResetAccess(member, response.data);
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

  // Mot de passe temporaire + code d'activation : affichés UNE fois, jamais relisibles ensuite.
  function showResetAccess(member, data) {
    const detail = $(`[data-detail="${member.id}"]`);
    if (!detail) return;
    detail.hidden = false;
    detail.innerHTML = `<div class="team-code-list">
      <h4>Accès réinitialisé pour ${esc(member.designation || member.fullName)}</h4>
      <p class="muted small-note">Ses sessions sont coupées. Communiquez ces deux valeurs : elles ne seront plus affichées.</p>
      <div class="field"><label>Mot de passe temporaire (6 chiffres)</label><strong class="code-value">${esc(data.temporaryPassword || '')}</strong></div>
      ${data.accessCode ? `<div class="field"><label>Code provisoire (fenêtre « Mot de passe oublié ? »)</label><strong class="code-value">${esc(data.accessCode)}</strong></div>` : ''}
      <div class="field"><label>Code d’activation</label><strong class="code-value">${esc(data.activation?.code || '')}</strong></div>
      <div class="form-actions">
        <button class="button primary" type="button" data-copy-reset>Copier les deux</button>
        <button class="button outline" type="button" data-close-reset>Fermer</button>
      </div>
      <p class="muted small-note">À sa première connexion, le membre devra choisir un nouveau mot de passe personnel.</p>
    </div>`;
    detail.querySelector('[data-close-reset]').addEventListener('click', () => { detail.hidden = true; detail.innerHTML = ''; });
    detail.querySelector('[data-copy-reset]').addEventListener('click', async () => {
      const text = `Mot de passe temporaire : ${data.temporaryPassword}`
        + (data.accessCode ? `\nCode provisoire : ${data.accessCode}` : '')
        + `\nCode d’activation : ${data.activation?.code || ''}`;
      try { await navigator.clipboard.writeText(text); notify('Identifiants copiés.'); }
      catch (_) { window.prompt('Copiez ces informations :', text); }
    });
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
      <div class="field"><label>Identifiant de connexion</label><input name="username" maxlength="40" pattern="[A-Za-z0-9._-]{3,40}" value="${esc(member.username)}"${member.status === 'active' ? ' disabled' : ''}>
        <small>${member.status === 'active' ? 'Non modifiable sur un compte actif.' : 'Modifiable tant que le compte n’est pas actif.'} Le mot de passe ne s’affiche jamais.</small></div>
      <div class="field span-two">
        <strong>Tables et salons attribués</strong>
        <div class="team-member-spaces">${(member.servicePoints || []).length ? member.servicePoints.map((space) => `<span class="team-space-chip">${esc(space.name)}${space.zone ? ` <small>${esc(space.zone)}</small>` : ''}</span>`).join('') : '<span class="muted small-note">Aucun espace attribué.</span>'}</div>
        <button class="button outline" type="button" data-edit-points>Modifier les tables et salons</button>
      </div>
      <div class="field span-two">
        <strong>Photo de profil</strong>
        <p class="muted small-note">La photo est facultative. Elle n’est pas encore stockée sur le serveur : les comptes existants restent inchangés et aucune image n’est inventée. Cet emplacement est réservé à la prochaine étape.</p>
      </div>
      <div class="field"><label>Fonction</label><select name="role"${member.status === 'active' ? ' disabled' : ''}>
        <option value="waitress"${member.role === 'waitress' ? ' selected' : ''}>Serveuse / Serveur</option>
        <option value="general_manager"${member.role === 'general_manager' ? ' selected' : ''}>Gérant général</option></select>
        <small>${member.status === 'active' ? 'Archivez ou suspendez le membre avant de changer sa fonction.' : 'Modifiable tant que le compte n’est pas actif.'}</small></div>
      <div class="field span-two"><strong>Permissions</strong><div class="permission-grid">${relevant.map((permission) => `<label class="permission-item"><input type="checkbox" name="permissions" value="${esc(permission.code)}"${(member.permissions || []).includes(permission.code) ? ' checked' : ''}${permission.code === 'members.manage' ? ' disabled' : ''}><span><strong>${esc(permission.label)}</strong><small>${esc(permission.description)}</small></span></label>`).join('')}</div></div>
      <div class="field span-two form-actions"><button class="button primary" type="submit">Enregistrer</button><button class="button outline" type="button" data-cancel>Fermer</button></div>
    </form>`;
    detail.querySelector('[data-cancel]').addEventListener('click', () => { detail.hidden = true; detail.innerHTML = ''; });
    const pointsButton = detail.querySelector('[data-edit-points]');
    if (pointsButton) pointsButton.addEventListener('click', () => openAssignments(member));
    detail.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const permissions = $$('input[name="permissions"]:checked', form).map((input) => input.value);
      try {
        await api(`/api/merchant/team/members/${encodeURIComponent(member.id)}`, { method: 'PATCH', body: JSON.stringify({
          fullName: form.fullName.value, phone: form.phone.value, designation: form.designation.value,
          role: form.role.disabled ? undefined : form.role.value,
          username: form.username.disabled ? undefined : form.username.value, permissions }) });
        notify('Membre mis à jour.'); await load();
      } catch (failure) { notify(failure.message); }
    });
  }

  // ------------------------------------------------------------------ tables et salons d'un membre
  // L'ancien responsable est conservé dans l'historique : on ne « déballe » jamais une table,
  // on enregistre un retrait daté.
  async function openAssignments(member) {
    const detail = $(`[data-detail="${member.id}"]`);
    if (!detail) return;
    detail.hidden = false;
    detail.innerHTML = '<p class="muted">Chargement des tables et salons…</p>';
    try {
      const data = (await api(`/api/merchant/team/members/${encodeURIComponent(member.id)}/assignments`)).data;
      const current = new Set((data.assignments || []).map((row) => row.servicePointId));
      const points = (state.overview?.servicePoints || []).length ? state.overview.servicePoints : (data.servicePoints || []);
      const groups = new Map();
      for (const point of points) {
        const key = point.type === 'salon' ? 'Salons et espaces' : point.type === 'counter' ? 'Comptoirs' : point.type === 'location' ? 'Emplacements' : 'Tables';
        if (!groups.has(key)) groups.set(key, []); groups.get(key).push(point);
      }
      detail.innerHTML = `<form class="team-assign-form">
        <h4>Tables et salons de ${esc(member.designation || member.fullName)}</h4>
        <p class="muted small-note">Cochez les espaces déjà enregistrés. Plusieurs tables et plusieurs salons par membre sont possibles ; une même table peut être partagée. Toute modification est historisée.</p>
        ${points.length ? [...groups.entries()].map(([label, rows]) => `<fieldset class="team-point-group"><legend>${esc(label)} <small>${rows.length}</small></legend>
          <div class="team-point-items">${rows.map((point) => `<label class="team-point-item">
            <input type="checkbox" name="servicePointIds" value="${esc(point.id)}"${current.has(point.id) ? ' checked' : ''}>
            <span><strong>${esc(point.name)}</strong><small>${esc(point.zone || 'Sans salon')} · ${esc(typeLabels[point.type] || point.type)}</small>
            ${point.publicCode ? `<small>Code public : ${esc(point.publicCode)}</small>` : ''}</span>
            <button class="link-button" type="button" data-point-history="${esc(point.id)}">Historique</button>
          </label>`).join('')}</div></fieldset>`).join('')
          : '<p class="muted">Aucune table ni aucun salon enregistré : créez-les d’abord dans « Tables et emplacements ».</p>'}
        <div class="form-actions"><button class="button primary" type="submit">Enregistrer les affectations</button><button class="button outline" type="button" data-cancel>Fermer</button></div>
        <div data-history-host class="team-history" hidden></div>
      </form>`;
      const form = detail.querySelector('form');
      form.querySelector('[data-cancel]').addEventListener('click', () => { detail.hidden = true; detail.innerHTML = ''; });
      $$('[data-point-history]', form).forEach((button) => button.addEventListener('click', async (event) => {
        event.preventDefault();
        const host = form.querySelector('[data-history-host]');
        host.hidden = false;
        host.innerHTML = '<p class="muted">Chargement de l’historique…</p>';
        try {
          const rows = (await api(`/api/merchant/team/service-points/${encodeURIComponent(button.dataset.pointHistory)}/history`)).data.history || [];
          host.innerHTML = `<h5>Historique d’affectation</h5>${rows.length ? rows.map((row) => `<div class="team-history-row">
            <span>${dateTime(row.createdAt)}</span>
            <span>${row.action === 'assigned' ? 'Affecté à' : 'Retiré à'} <strong>${esc(row.memberLabel)}</strong></span>
            <span>${row.fromMemberLabel ? `(précédent : ${esc(row.fromMemberLabel)})` : ''}</span>
            <span>${esc(row.actorLabel || row.actorType || '')}</span></div>`).join('') : '<p class="empty">Aucun changement d’affectation enregistré.</p>'}`;
        } catch (failure) { host.innerHTML = `<p class="message error">${esc(failure.message)}</p>`; }
      }));
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const ids = $$('input[name="servicePointIds"]:checked', form).map((input) => input.value);
        try {
          await api(`/api/merchant/team/members/${encodeURIComponent(member.id)}/assignments`, { method: 'PUT', body: JSON.stringify({ servicePointIds: ids }) });
          notify('Affectations enregistrées. L’ancien responsable reste inscrit dans l’historique.');
          await load();
        } catch (failure) { notify(failure.message); }
      });
    } catch (failure) { detail.innerHTML = `<p class="message error">${esc(failure.message)}</p>`; }
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

  function showCode(title, activation, created) {
    const box = $('#teamCodeResult');
    box.hidden = false;
    const spaces = (created?.assignments?.assignments || []).map((row) => row.name).filter(Boolean);
    box.innerHTML = `<h3>${esc(title)}</h3>
      ${created?.temporaryPassword ? `<p class="muted">Mot de passe généré (six chiffres) : <strong class="code-value">${esc(created.temporaryPassword)}</strong></p>` : ''}
      ${spaces.length ? `<p class="muted">Espaces attribués : ${spaces.map((name) => esc(name)).join(', ')}.</p>` : ''}
      <p class="team-code-value">${esc(activation.code)}</p>
      <p class="muted">Valable jusqu’au ${dateTime(activation.expiresAt)}. Ce code ne sera plus affiché : transmettez-le maintenant au membre. Il est à usage unique.</p>
      <button class="button outline" type="button" data-copy-code>Copier</button>
      <button class="button quiet" type="button" data-close-code>J’ai transmis le code</button>`;
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    box.querySelector('[data-copy-code]').addEventListener('click', async () => {
      const text = `${activation.code}${created?.temporaryPassword ? `\nMot de passe : ${created.temporaryPassword}` : ''}`;
      try { await navigator.clipboard.writeText(text); notify('Code copié.'); } catch (_) { notify('Copie impossible : notez le code.'); }
    });
    box.querySelector('[data-close-code]').addEventListener('click', () => {
      box.hidden = true; box.innerHTML = '';
      // Fin du parcours de création : on referme le panneau et on revient au choix du type de compte.
      const panel = $('#teamCreatePanel');
      if (panel) panel.hidden = true;
      stepRoleChoice();
    });
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

  window.QRIAMerchantTeamRefresh = () => load().catch(() => {});

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
    const closeCreate = () => { createPanel.hidden = true; stepRoleChoice(); };
    // Étape 1 : « Créer un compte » n'ouvre QUE le choix du type de compte.
    $('#teamCreateButton').addEventListener('click', () => { createPanel.hidden = !createPanel.hidden; if (!createPanel.hidden) stepRoleChoice(); });
    $('#teamCreateCancel').addEventListener('click', closeCreate);
    $('#teamCreateClose')?.addEventListener('click', closeCreate);
    $('#teamCreateBack')?.addEventListener('click', stepRoleChoice);
    $$('[data-team-role]').forEach((button) => button.addEventListener('click', () => stepForm(button.dataset.teamRole)));
    $('#teamPasswordGenerate')?.addEventListener('click', () => {
      // Proposé au marchand, qui reste libre de le changer : six chiffres, chaîne (zéros conservés).
      const digits = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
      $('#teamPassword').value = digits; $('#teamPasswordConfirm').value = digits;
      notify(`Mot de passe proposé : ${digits}. Notez-le puis transmettez-le au membre.`);
    });
    $('#teamSettingsButton').addEventListener('click', () => { const panel = $('#teamSettingsPanel'); panel.hidden = !panel.hidden; });
    $('#teamRefresh').addEventListener('click', () => load());
    $('#teamCreateForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const error = $('#teamCreateError'); error.hidden = true;
      const form = event.currentTarget;
      const failForm = (message) => { error.textContent = message; error.hidden = false; error.scrollIntoView({ block: 'nearest' }); };
      const password = form.password.value;
      if (!state.createRole) return failForm('Choisissez d’abord le type de compte à créer.');
      if (form.fullName.value.trim().length < 2) return failForm('Indiquez le nom complet du membre.');
      if (!/^\d{6}$/.test(password)) return failForm('Le mot de passe doit comporter exactement six chiffres (0 à 9). Les zéros au début sont conservés.');
      if (password !== form.passwordConfirm.value) return failForm('Les deux mots de passe ne correspondent pas.');
      const submit = $('#teamCreateSubmit'); submit.disabled = true;
      try {
        const data = (await api('/api/merchant/team/members', { method: 'POST', body: JSON.stringify(collectCreatePayload(form)) })).data;
        // Le panneau reste ouvert : le code d'activation doit être VU. On masque seulement le
        // formulaire, et le bouton « J'ai transmis le code » referme l'ensemble.
        $('#teamCreateStepRole').hidden = true;
        $('#teamCreateForm').hidden = true;
        showCode(`Compte créé : ${data.member.designation}`, data.activation, data);
        await load();
      } catch (failure) { failForm(failure.message); }
      finally { submit.disabled = false; }
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
