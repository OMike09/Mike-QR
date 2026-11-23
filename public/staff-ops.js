// ============================================================================================
// Oymike Tech — Mission 6 : espace ÉQUIPE.
//   - serveuse : ses points, son classement, ses tables, ses commandes, ses messages
//   - gérant général : tableau de bord de la boutique, points de l'équipe, affectations,
//     messages reçus de l'équipe
// Tout est calculé par le serveur. L'interface n'invente aucun chiffre et n'accorde aucun droit :
// chaque appel est vérifié côté serveur (403 si la permission manque).
// ============================================================================================
(function () {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { me: null, permissions: [], period: 'week', conversations: [], activeConversation: null, poll: null };

  // ------------------------------------------------------------------ utilitaires
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (value) => `${(Number(value) || 0).toLocaleString('fr-FR')} XOF`;
  const dateFr = (value) => { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }); };
  const can = (permission) => state.permissions.includes(permission);
  const isManager = () => state.me?.role === 'general_manager';
  const PERIODS = { today: 'Aujourd’hui', week: '7 derniers jours', month: '30 derniers jours', all: 'Tout l’historique' };

  function toast(message, tone = 'info') {
    const node = $('#opsToast');
    if (!node) return;
    node.textContent = message;
    node.className = `ops-toast visible ${tone}`;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { node.className = 'ops-toast'; }, 3600);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      method: options.method || 'GET',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    let json = null; try { json = JSON.parse(text); } catch (_) { /* réponse non JSON */ }
    if (!response.ok) {
      const error = new Error((json && (json.error || json.message)) || `Erreur ${response.status}`);
      error.status = response.status; error.code = json && json.code;
      throw error;
    }
    return json;
  }

  function statusPill(status) {
    const map = { sent: ['Envoyé', 'warn'], received: ['Reçu', 'warn'], read: ['Lu', 'brand'], answered: ['Répondu', 'ok'], closed: ['Clôturé', ''] };
    const [label, tone] = map[status] || [status || '—', ''];
    return `<span class="pill ${tone}">${esc(label)}</span>`;
  }

  function orderPill(status) {
    const map = { pending: ['À confirmer', 'warn'], confirmed: ['Confirmée', 'brand'], preparing: ['En préparation', 'brand'], ready: ['Prête', 'brand'], completed: ['Terminée', 'ok'], cancelled: ['Annulée', 'danger'], rejected: ['Refusée', 'danger'] };
    const [label, tone] = map[status] || [status || '—', ''];
    return `<span class="pill ${tone}">${esc(label)}</span>`;
  }

  // ------------------------------------------------------------------ points et classement
  async function renderPoints(root) {
    const canSeeAll = can('points.view');
    const [points, board] = await Promise.all([
      api(`/api/staff/points/history?period=${state.period}`),
      api(`/api/staff/leaderboard?period=${state.period === 'all' ? 'month' : state.period}`).catch(() => ({ data: { rows: [] } })),
    ]);
    const stats = points.data.stats || {};
    const rows = board.data.rows || [];
    const mine = board.data.myPosition;
    const html = [];
    html.push(`<div class="ops-hero">
      <div><span class="eyebrow">MES POINTS</span><h1>${esc(state.me.designation || state.me.fullName)}</h1>
      <p>Vos points sont calculés automatiquement à partir de vos actions réelles : scan de table, commande enregistrée, commande terminée et tâche validée. Vous ne pouvez pas les modifier.</p></div>
      <div class="ops-hero-actions"><button data-refresh="points" type="button">Actualiser</button></div>
    </div>`);
    html.push(`<div class="ops-grid">
      <div class="ops-tile accent"><span>Mes points</span><strong>${Number(stats.points) || 0}</strong><small>${esc(PERIODS[state.period] || '')}</small></div>
      <div class="ops-tile"><span>Scans de table</span><strong>${Number(stats.scans) || 0}</strong><small>Un scan ne compte qu’une fois</small></div>
      <div class="ops-tile"><span>Commandes enregistrées</span><strong>${Number(stats.orders) || 0}</strong><small>${Number(stats.validatedOrders) || 0} validée(s)</small></div>
      <div class="ops-tile"><span>Commandes terminées</span><strong>${Number(stats.completedOrders) || 0}</strong><small>Une annulation ne compte pas</small></div>
      <div class="ops-tile"><span>Tâches terminées</span><strong>${Number(stats.tasksDone) || 0}</strong><small>${Number(stats.tasksLate) || 0} en retard</small></div>
    </div>`);
    html.push(`<section class="ops-card"><header><div><h2>Performance de l’équipe</h2><p>Classement d’activité sur la période : il reflète le travail réalisé, jamais la valeur des personnes. ${mine ? `Vous êtes ${mine}<sup>e</sup> sur ${board.data.teamSize}.` : ''}</p></div>
      <div class="ops-actions">
        <label for="pointsPeriod" class="ops-filter" style="margin:0"><label for="pointsPeriod">Période</label></label>
        <select id="pointsPeriod" aria-label="Période du classement">${Object.entries(PERIODS).map(([value, label]) => `<option value="${value}" ${value === state.period ? 'selected' : ''}>${label}</option>`).join('')}</select>
      </div></header>
      <div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Position</th><th>Membre</th><th class="num">Scans</th><th class="num">Commandes</th><th class="num">Terminées</th><th class="num">Tâches</th><th class="num">Points</th></tr></thead><tbody>
      ${rows.length ? rows.map((row) => `<tr class="${row.id === state.me.id ? 'me' : ''}">
        <td><span class="ops-rank ${row.rank === 1 ? 'first' : ''}">${row.rank}</span></td>
        <td>${esc(row.designation || row.fullName)}<span class="sub">${esc(row.role === 'general_manager' ? 'Gérant général' : 'Serveuse')}${row.id === state.me.id ? ' · vous' : ''}</span></td>
        <td class="num">${row.scans}</td><td class="num">${row.orders}</td><td class="num">${row.completedOrders}</td><td class="num">${row.tasksDone}</td>
        <td class="num"><strong>${row.points}</strong></td></tr>`).join('')
        : `<tr><td colspan="7"><div class="ops-empty">Aucune activité enregistrée sur cette période.</div></td></tr>`}
      </tbody></table></div></section>`);

    if (canSeeAll) {
      const history = points.data.history || [];
      html.push(`<section class="ops-card"><header><div><h2>Historique de mes points</h2><p>Chaque ligne est un événement réel, conservé même si les points sont corrigés plus tard. Une correction est une nouvelle ligne motivée, jamais un effacement.</p></div></header>
        <div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Date</th><th>Action</th><th>Motif</th><th>Auteur</th><th class="num">Points</th></tr></thead><tbody>
        ${history.length ? history.slice(0, 60).map((row) => `<tr><td>${esc(dateFr(row.createdAt))}</td><td>${esc(row.actionLabel || row.action)}</td>
          <td>${esc(row.reason || '—')}</td><td>${esc(row.actorLabel || 'Système')}<span class="sub">${esc(row.actorType || '')}</span></td>
          <td class="num" style="color:${row.points < 0 ? '#b91c1c' : '#15803d'}">${row.points > 0 ? '+' : ''}${row.points}</td></tr>`).join('')
          : `<tr><td colspan="5"><div class="ops-empty">Aucun point enregistré pour le moment. Scannez une table ou enregistrez une commande : vos points apparaîtront ici.</div></td></tr>`}
        </tbody></table></div></section>`);
    }
    root.innerHTML = html.join('');
    const selector = $('#pointsPeriod', root);
    if (selector) selector.addEventListener('change', () => { state.period = selector.value; renderPoints(root); });
    wire(root);
  }

  // ------------------------------------------------------------------ tableau de bord du gérant
  async function renderManagerDashboard(root) {
    const response = await api(`/api/staff/manager-dashboard?period=${state.period}`);
    const d = response.data;
    const html = [];
    html.push(`<div class="ops-hero">
      <div><span class="eyebrow">TABLEAU DE BORD · GÉRANT GÉNÉRAL</span><h1>${esc(d.store.name)}</h1>
      <p>Vous voyez la boutique dans la limite des droits que le marchand vous a accordés. ${d.statisticsAuthorized ? '' : 'Les chiffres financiers ne vous sont pas accessibles.'}</p></div>
      <div class="ops-hero-actions"><button data-refresh="manager" type="button">Actualiser</button></div>
    </div>`);
    html.push(`<div class="ops-filter"><label for="mgrPeriod">Période</label><select id="mgrPeriod">${Object.entries(PERIODS).map(([value, label]) => `<option value="${value}" ${value === state.period ? 'selected' : ''}>${label}</option>`).join('')}</select></div>`);
    html.push(`<div class="ops-grid">
      <div class="ops-tile accent"><span>Commandes</span><strong>${d.orders.total}</strong><small>${d.orders.pending} à confirmer · ${d.orders.confirmed} confirmée(s)</small></div>
      <div class="ops-tile"><span>En préparation</span><strong>${d.orders.preparing}</strong><small>${d.orders.ready} prête(s) à servir</small></div>
      <div class="ops-tile"><span>Terminées</span><strong>${d.orders.completed}</strong><small>${d.orders.cancelled} annulée(s)</small></div>
      ${d.revenue ? `<div class="ops-tile"><span>Chiffre d’affaires</span><strong>${money(d.revenue.total)}</strong><small>${d.revenue.orderCount} commande(s) hors annulations</small></div>` : ''}
      <div class="ops-tile"><span>Scans clients</span><strong>${d.scans.customer}</strong><small>${d.scans.staff} par le personnel · ${d.scans.total} au total</small></div>
      <div class="ops-tile"><span>Serveuses actives</span><strong>${d.team.waitressesActive}</strong><small>${d.team.managersActive} gérant(s) actif(s)</small></div>
      <div class="ops-tile"><span>Tâches en cours</span><strong>${d.tasks.open}</strong><small>${d.tasks.done} terminée(s) · ${d.tasks.late} en retard</small></div>
    </div>`);
    html.push(`<section class="ops-card"><header><div><h2>Commandes par auteur</h2><p>Chaque commande porte l’identité de celui qui l’a saisie. Une modification ultérieure ne change jamais l’auteur d’origine.</p></div></header>
      <div class="ops-grid">
        <div class="ops-tile"><span>Par moi</span><strong>${d.ordersByManager}</strong></div>
        <div class="ops-tile"><span>Par les serveuses</span><strong>${Math.max(0, d.orders.total - d.ordersByManager - d.ordersByCustomers)}</strong></div>
        <div class="ops-tile"><span>Par les clients (QR)</span><strong>${d.ordersByCustomers}</strong></div>
      </div>
      ${d.ordersByMember.length ? `<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Membre</th><th>État</th><th class="num">Nombre</th></tr></thead><tbody>
        ${d.ordersByMember.map((row) => `<tr><td>${esc(row.designation || 'Client / direct')}</td><td>${orderPill(row.status)}</td><td class="num">${row.n}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
    </section>`);
    if (d.scansByMember.length) {
      html.push(`<section class="ops-card"><header><div><h2>Scans par serveuse</h2><p>Un scan relancé n’est compté qu’une fois.</p></div></header>
        <div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Membre</th><th class="num">Scans</th></tr></thead><tbody>
        ${d.scansByMember.map((row) => `<tr><td>${esc(row.designation || '—')}</td><td class="num">${row.scans}</td></tr>`).join('')}</tbody></table></div></section>`);
    }
    if (d.tables.length) {
      html.push(`<section class="ops-card"><header><div><h2>Tables et emplacements</h2><p>Occupée dès qu’une commande est en cours sur la table.</p></div></header>
        <div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Table</th><th>Zone</th><th>État</th><th>Affectée à</th><th class="num">Commandes</th></tr></thead><tbody>
        ${d.tables.map((row) => `<tr><td>${esc(row.name)}</td><td>${esc(row.zone || '—')}</td>
          <td>${row.occupied ? '<span class="pill warn">Occupée</span>' : '<span class="pill ok">Libre</span>'}</td>
          <td>${esc(row.assignedDesignation || 'Non affectée')}</td><td class="num">${row.activeOrders}</td></tr>`).join('')}
        </tbody></table></div></section>`);
    }
    if (d.leaderboard.length) {
      html.push(`<section class="ops-card"><header><div><h2>Performance de l’équipe</h2><p>Classement d’activité, sans jugement de valeur.</p></div></header>
        <div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Position</th><th>Membre</th><th class="num">Scans</th><th class="num">Commandes</th><th class="num">Points</th></tr></thead><tbody>
        ${d.leaderboard.map((row) => `<tr><td><span class="ops-rank ${row.rank === 1 ? 'first' : ''}">${row.rank}</span></td><td>${esc(row.designation || row.fullName)}</td>
          <td class="num">${row.scans}</td><td class="num">${row.orders}</td><td class="num"><strong>${row.points}</strong></td></tr>`).join('')}
        </tbody></table></div></section>`);
    }
    if (d.myTasks.length) {
      html.push(`<section class="ops-card"><header><div><h2>Mes tâches</h2></div></header>
        <div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Tâche</th><th>État</th><th>Échéance</th></tr></thead><tbody>
        ${d.myTasks.map((task) => `<tr><td>${esc(task.title)}</td><td>${esc(task.status === 'done' ? 'Terminée' : task.status === 'in_progress' ? 'En cours' : 'À faire')}</td><td>${task.dueAt ? esc(dateFr(task.dueAt)) : '—'}</td></tr>`).join('')}
        </tbody></table></div></section>`);
    }
    root.innerHTML = html.join('');
    $('#mgrPeriod', root)?.addEventListener('change', (event) => { state.period = event.target.value; renderManagerDashboard(root); });
    wire(root);
  }

  // ------------------------------------------------------------------ tables (affectation)
  async function renderTables(root) {
    const response = await api('/api/staff/tables').catch((error) => ({ error }));
    if (response.error) { root.innerHTML = `<div class="ops-notice warn">${esc(response.error.message)}</div>`; return; }
    const tables = response.data.tables || [];
    const canAssign = can('tables.assign');
    const team = canAssign ? (await api('/api/staff/dashboard').then((r) => r.data.team || []).catch(() => [])) : [];
    root.innerHTML = `<div class="ops-hero"><div><span class="eyebrow">TABLES ET EMPLACEMENTS</span><h1>Qui suit quelle table</h1>
      <p>Une table affectée à une serveuse lui envoie automatiquement les commandes prises sur cette table. Le scan du QR de table identifie l’emplacement : la commande n’est jamais attribuée à la mauvaise table.</p></div>
      <div class="ops-hero-actions"><button data-refresh="tables" type="button">Actualiser</button></div></div>
      <section class="ops-card"><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Table</th><th>Zone</th><th>État</th><th>Affectée à</th><th>Action</th></tr></thead><tbody>
      ${tables.length ? tables.map((table) => `<tr><td>${esc(table.name)}<span class="sub">${esc(table.type === 'table' ? 'Table' : table.type === 'counter' ? 'Comptoir' : table.type === 'salon' ? 'Salon' : 'Emplacement')}${table.mine ? ' · la vôtre' : ''}</span></td>
        <td>${esc(table.zone || '—')}</td>
        <td>${table.occupied ? `<span class="pill warn">Occupée</span><span class="sub">${table.activeOrders} commande(s)</span>` : '<span class="pill ok">Libre</span>'}</td>
        <td>${esc(table.assignedTo?.designation || 'Non affectée')}</td>
        <td>${canAssign ? `<select data-assign="${esc(table.id)}" aria-label="Affecter ${esc(table.name)}">
            <option value="">— Non affectée —</option>
            ${team.filter((m) => m.role === 'waitress').map((m) => `<option value="${esc(m.id)}" ${table.assignedTo?.memberId === m.id ? 'selected' : ''}>${esc(m.designation || m.fullName)}</option>`).join('')}
          </select>` : (table.mine ? '<span class="pill brand">Vous</span>' : '—')}</td></tr>`).join('')
        : `<tr><td colspan="5"><div class="ops-empty">Aucune table enregistrée. Le marchand peut en créer depuis son espace.</div></td></tr>`}
      </tbody></table></div></section>`;
    $$('[data-assign]', root).forEach((select) => select.addEventListener('change', async () => {
      select.disabled = true;
      try {
        await api(`/api/staff/tables/${encodeURIComponent(select.dataset.assign)}/assign`, { method: 'POST', body: { memberId: select.value } });
        toast(select.value ? 'Table affectée.' : 'Table libérée.', 'ok');
        await renderTables(root);
      } catch (error) { toast(error.message, 'danger'); select.disabled = false; }
    }));
    wire(root);
  }

  // ------------------------------------------------------------------ commandes et affectation
  async function renderOrders(root) {
    const response = await api('/api/staff/orders?limit=50').catch((error) => ({ error }));
    if (response.error) { root.innerHTML = `<div class="ops-notice warn">${esc(response.error.message)}</div>`; return; }
    const rows = response.data.rows || response.data || [];
    const canAssign = can('tasks.assign');
    const team = canAssign ? (await api('/api/staff/dashboard').then((r) => r.data.team || []).catch(() => [])) : [];
    root.innerHTML = `<div class="ops-hero"><div><span class="eyebrow">SUIVI DES COMMANDES</span><h1>Qui a pris quoi</h1>
      <p>Chaque commande garde son auteur d’origine. La serveuse responsable du suivi peut être différente de l’auteur : un transfert est tracé, jamais silencieux.</p></div>
      <div class="ops-hero-actions"><button data-refresh="orders" type="button">Actualiser</button></div></div>
      <section class="ops-card"><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Référence</th><th>Client / table</th><th>État</th><th>Auteur</th><th>Suivi</th><th class="num">Montant</th>${canAssign ? '<th>Affecter</th>' : ''}</tr></thead><tbody>
      ${rows.length ? rows.map((row) => `<tr><td>${esc(row.reference)}<span class="sub">${esc(dateFr(row.createdAt))}</span></td>
        <td>${esc(row.customerName || '—')}<span class="sub">${esc(row.servicePointName || '—')}</span></td>
        <td>${orderPill(row.status)}</td>
        <td>${esc(row.createdByDesignation || (row.createdByType === 'customer' ? 'Client (QR)' : '—'))}<span class="sub">${esc(row.createdByMemberId === state.me.id ? 'vous' : '')}</span></td>
        <td>${esc(row.assignedDesignation || '—')}</td>
        <td class="num">${money(row.totalAmountXof)}</td>
        ${canAssign ? `<td><select data-order="${esc(row.id)}"><option value="">— Non affectée —</option>
          ${team.filter((m) => m.role === 'waitress').map((m) => `<option value="${esc(m.id)}" ${row.assignedMemberId === m.id ? 'selected' : ''}>${esc(m.designation || m.fullName)}</option>`).join('')}
        </select></td>` : ''}</tr>`).join('')
        : `<tr><td colspan="${canAssign ? 7 : 6}"><div class="ops-empty">Aucune commande pour le moment.</div></td></tr>`}
      </tbody></table></div></section>`;
    $$('[data-order]', root).forEach((select) => select.addEventListener('change', async () => {
      select.disabled = true;
      try {
        await api(`/api/staff/orders/${encodeURIComponent(select.dataset.order)}/assign`, { method: 'POST', body: { memberId: select.value, reason: 'Affectation depuis le suivi des commandes' } });
        toast('Commande affectée. La serveuse est notifiée.', 'ok');
        await renderOrders(root);
      } catch (error) { toast(error.message, 'danger'); select.disabled = false; }
    }));
    wire(root);
  }

  // ------------------------------------------------------------------ messagerie
  async function renderMessages(root) {
    const listResponse = await api('/api/staff/messages').catch((error) => ({ error }));
    if (listResponse.error) { root.innerHTML = `<div class="ops-notice warn">${esc(listResponse.error.message)}</div>`; return; }
    const conversations = listResponse.data.conversations || [];
    const active = conversations.find((row) => row.id === state.activeConversation) || conversations[0] || null;
    let thread = null;
    if (active) thread = await api(`/api/staff/messages?conversationId=${encodeURIComponent(active.id)}`).catch(() => null);
    const manager = can('messaging.manage');
    root.innerHTML = `<div class="ops-hero"><div><span class="eyebrow">MESSAGERIE</span><h1>${manager ? 'Messages de l’équipe' : 'Contacter mon gestionnaire'}</h1>
      <p>${manager ? 'Vous recevez les demandes de l’équipe et y répondez. Chaque échange est conservé avec sa date, son auteur et son statut.' : 'Votre demande est transmise à votre gérant général avec sa date, son auteur et son statut. Vous êtes notifiée dès qu’elle est lue et répondue.'}</p></div>
      <div class="ops-hero-actions"><button data-refresh="messages" type="button">Actualiser</button></div></div>
      <section class="ops-card"><header><div><h2>Nouvelle demande</h2><p>Une pièce jointe est facultative (image, PDF ou texte, 3 Mo maximum).</p></div></header>
        <form id="opsMessageForm" class="ops-compose">
          <input id="opsMessageSubject" maxlength="140" placeholder="Sujet (obligatoire)" required>
          <select id="opsMessageCategory"><option value="material">Matériel</option><option value="order">Commande</option><option value="table">Table ou emplacement</option><option value="client">Client</option><option value="other">Autre</option></select>
          <textarea id="opsMessageBody" maxlength="4000" placeholder="Décrivez précisément votre demande…" required></textarea>
          <input id="opsMessageFile" type="file" accept="image/png,image/jpeg,image/webp,application/pdf,text/plain">
          <div class="ops-actions"><button class="ops-btn primary" type="submit">Envoyer au gestionnaire</button><small class="sub" id="opsMessageHint"></small></div>
        </form>
      </section>
      <section class="ops-card"><header><div><h2>Mes échanges</h2><p>${conversations.length} conversation(s).</p></div></header>
        ${conversations.length ? `<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Sujet</th><th>Auteur</th><th>Statut</th><th>Dernier message</th><th></th></tr></thead><tbody>
          ${conversations.map((row) => `<tr class="${active && row.id === active.id ? 'me' : ''}"><td>${esc(row.subject)}<span class="sub">${row.messageCount} message(s)</span></td>
            <td>${esc(row.createdByLabel || '—')}</td><td>${statusPill(row.status)}</td><td>${esc(dateFr(row.lastMessageAt))}</td>
            <td><button class="ops-btn small" data-open="${esc(row.id)}" type="button">Ouvrir</button></td></tr>`).join('')}
        </tbody></table></div>` : '<div class="ops-empty">Aucune demande pour le moment.</div>'}
      </section>
      ${active ? `<section class="ops-card"><header><div><h2>${esc(active.subject)}</h2><p>${statusPill(active.status)}</p></div></header>
        <div class="ops-thread" id="opsThread">${(thread?.data?.messages || []).map((message) => `
          <div class="ops-msg ${message.authorType === (isManager() ? 'general_manager' : 'waitress') ? 'mine' : ''} ${message.authorType === 'system' ? 'system' : ''}">
            <span class="meta">${esc(message.authorLabel || message.authorType)} · ${esc(dateFr(message.createdAt))}</span>${esc(message.body)}
            ${message.hasAttachment ? `<br><span class="attach">Pièce jointe : ${esc(message.attachmentName)} (${Math.round((message.attachmentBytes || 0) / 1024)} Ko)</span>` : ''}
          </div>`).join('') || '<div class="ops-empty">Aucun message.</div>'}</div>
        <form id="opsReplyForm" class="ops-compose"><textarea id="opsReplyBody" maxlength="4000" placeholder="Votre réponse…" required></textarea>
          <div class="ops-actions"><button class="ops-btn primary" type="submit">Répondre</button></div></form></section>` : ''}`;

    $('#opsMessageForm', root)?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const subject = $('#opsMessageSubject', root).value.trim();
      const body = $('#opsMessageBody', root).value.trim();
      const file = $('#opsMessageFile', root).files[0];
      const button = event.target.querySelector('button[type=submit]');
      button.disabled = true;
      try {
        const attachment = file ? { name: file.name, mime: file.type, data: await readFileBase64(file) } : undefined;
        const created = await api('/api/staff/messages', { method: 'POST', body: { subject, body, category: $('#opsMessageCategory', root).value, attachment } });
        toast('Message envoyé à votre gestionnaire.', 'ok');
        state.activeConversation = created.data.conversationId;
        await renderMessages(root);
      } catch (error) { toast(error.message, 'danger'); button.disabled = false; }
    });
    $$('[data-open]', root).forEach((button) => button.addEventListener('click', async () => {
      state.activeConversation = button.dataset.open;
      await renderMessages(root);
    }));
    $('#opsReplyForm', root)?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = $('#opsReplyBody', root).value.trim();
      const button = event.target.querySelector('button[type=submit]');
      button.disabled = true;
      try {
        await api(`/api/staff/messages/${encodeURIComponent(active.id)}/reply`, { method: 'POST', body: { body } });
        toast('Réponse envoyée.', 'ok');
        await renderMessages(root);
      } catch (error) { toast(error.message, 'danger'); button.disabled = false; }
    });
    const threadNode = $('#opsThread', root);
    if (threadNode) threadNode.scrollTop = threadNode.scrollHeight;
    wire(root);
  }

  function readFileBase64(file) {
    return new Promise((resolve, reject) => {
      if (file.size > 3 * 1024 * 1024) { reject(new Error('La pièce jointe dépasse 3 Mo.')); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(new Error('Lecture du fichier impossible.'));
      reader.readAsDataURL(file);
    });
  }

  // ------------------------------------------------------------------ notifications
  async function renderNotifications(root) {
    const response = await api('/api/staff/notifications').catch((error) => ({ error }));
    if (response.error) { root.innerHTML = `<div class="ops-notice warn">${esc(response.error.message)}</div>`; return; }
    const data = response.data;
    root.innerHTML = `<div class="ops-hero"><div><span class="eyebrow">NOTIFICATIONS</span><h1>Ce qui vous concerne</h1>
      <p>Chaque notification est enregistrée en base : elle reste visible après la fermeture de l’application et n’est jamais comptée deux fois.</p></div>
      <div class="ops-hero-actions"><button data-mark-read type="button">Tout marquer comme lu</button><button data-refresh="notifications" type="button">Actualiser</button></div></div>
      <section class="ops-card"><header><div><h2>${data.unread} non lue(s)</h2></div></header>
      ${(data.items || []).length ? `<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Type</th><th>Titre</th><th>Message</th><th>Date</th></tr></thead><tbody>
        ${data.items.map((row) => `<tr><td>${esc(row.type)}</td><td>${esc(row.title)}${row.readAt ? '' : ' <span class="pill danger">Nouveau</span>'}</td><td>${esc(row.message || '—')}</td><td>${esc(dateFr(row.createdAt))}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="ops-empty">Aucune notification.</div>'}
      ${(data.taskItems || []).length ? `<h3 style="margin-top:16px">Tâches assignées</h3><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Tâche</th><th>État</th><th>Échéance</th></tr></thead><tbody>
        ${data.taskItems.map((task) => `<tr><td>${esc(task.title)}</td><td>${esc(task.status)}</td><td>${task.dueAt ? esc(dateFr(task.dueAt)) : '—'}</td></tr>`).join('')}</tbody></table></div>` : ''}
      </section>`;
    $('[data-mark-read]', root)?.addEventListener('click', async () => {
      try { await api('/api/staff/notifications/read', { method: 'POST', body: {} }); toast('Notifications marquées comme lues.', 'ok'); await renderNotifications(root); }
      catch (error) { toast(error.message, 'danger'); }
    });
    wire(root);
  }

  // ------------------------------------------------------------------ routage des vues
  const VIEWS = {
    points: { label: 'Mes points', render: renderPoints, permission: null },
    manager: { label: 'Tableau de bord', render: renderManagerDashboard, managerOnly: true },
    tables: { label: 'Tables', render: renderTables, permission: 'tables.view_all' },
    orders: { label: 'Suivi des commandes', render: renderOrders, permission: 'orders.view' },
    messages: { label: 'Messagerie', render: renderMessages, permission: 'messaging.reply' },
    notifications: { label: 'Notifications', render: renderNotifications, permission: null },
  };

  const HOSTS = { manager: '#opsManagerView', tables: '#opsTablesView', messages: '#opsMessagesView' };

  async function renderInto(host, view) {
    const definition = VIEWS[view];
    if (!definition || !host) return;
    host.innerHTML = '<div class="ops-empty">Chargement…</div>';
    try { await definition.render(host); }
    catch (error) { host.innerHTML = `<div class="ops-notice danger">${esc(error.message)}</div>`; }
  }

  async function openView(view) {
    const definition = VIEWS[view];
    if (!definition) return;
    $$('[data-ops-nav]').forEach((button) => button.classList.toggle('active', button.dataset.opsNav === view));
    const host = HOSTS[view] ? $(HOSTS[view]) : $('#opsView');
    if (!host) return;
    await renderInto(host, view);
  }

  function wire(root) {
    $$('[data-refresh]', root).forEach((button) => button.addEventListener('click', () => openView(button.dataset.refresh)));
  }

  async function boot() {
    const root = $('#opsView');
    if (!root) return;
    try {
      const me = await api('/api/staff/me');
      state.me = me.data.member || me.data;
      state.permissions = state.me.permissions || [];
    } catch (_) { return; } // pas de session : la page de connexion de l'espace équipe reste affichée
    const nav = $('#opsNav');
    if (nav) {
      nav.innerHTML = Object.entries(VIEWS)
        .filter(([, definition]) => (!definition.managerOnly || isManager()) && (!definition.permission || can(definition.permission)))
        .map(([key, definition]) => `<button class="tab" type="button" data-ops-nav="${key}">${esc(definition.label)}</button>`).join('');
      $$('[data-ops-nav]', nav).forEach((button) => button.addEventListener('click', () => openView(button.dataset.opsNav)));
    }
    // Un hôte par onglet principal de l'espace équipe : chaque vue a sa propre zone de rendu.
    ['manager', 'tables', 'messages'].forEach((view) => {
      const host = HOSTS[view];
      if (!host) return;
      const button = nav && nav.querySelector(`[data-ops-nav="${view}"]`);
      if (!button) return;
      if (!host.dataset.wired) {
        host.dataset.wired = '1';
        host.addEventListener('click', (event) => {
          const trigger = event.target.closest('[data-refresh]');
          if (trigger) renderInto(host, trigger.dataset.refresh);
        });
        host.addEventListener('change', async (event) => {
          const assign = event.target.closest('[data-assign]');
          if (assign) {
            try { await api(`/api/staff/tables/${encodeURIComponent(assign.dataset.assign)}/assign`, { method: 'POST', body: { memberId: assign.value } }); toast('Table affectée.', 'ok'); renderInto(host, 'tables'); }
            catch (error) { toast(error.message, 'danger'); }
          }
          const order = event.target.closest('[data-order]');
          if (order) {
            try { await api(`/api/staff/orders/${encodeURIComponent(order.dataset.order)}/assign`, { method: 'POST', body: { memberId: order.value, reason: 'Affectation depuis le suivi des commandes' } }); toast('Commande affectée.', 'ok'); renderInto(host, 'tables'); }
            catch (error) { toast(error.message, 'danger'); }
          }
        });
        host.addEventListener('submit', (event) => {
          if (event.target.id === 'opsReplyForm') {
            event.preventDefault();
            const body = $('#opsReplyBody', host)?.value.trim();
            if (!body) return;
            api(`/api/staff/messages/${encodeURIComponent(state.activeConversation)}/reply`, { method: 'POST', body: { body } })
              .then(() => { toast('Réponse envoyée.', 'ok'); renderInto(host, 'messages'); })
              .catch((error) => toast(error.message, 'danger'));
          }
        });
      }
    });
    const notificationBadge = $('#opsNotificationBadge');
    const refreshBadge = async () => {
      try {
        const count = await api('/api/staff/notifications/count');
        if (notificationBadge) { notificationBadge.textContent = count.data.unread; notificationBadge.classList.toggle('ops-badge-count', true); notificationBadge.hidden = !count.data.unread; }
      } catch (_) {}
    };
    await refreshBadge();
    state.poll = setInterval(() => { if (!document.hidden) refreshBadge(); }, 30000);
    await openView(isManager() ? 'manager' : 'points');
  }

  document.addEventListener('DOMContentLoaded', boot);
  window.OpsUI = { openView, state };
})();
