// ============================================================================================
// Oymike Tech — Mission 6 : contrôle opérationnel côté MARCHAND.
//   1. Vue d'ensemble (chiffres réels : commandes, CA, scans, équipe, tâches, articles)
//   2. Points des serveuses + barème modifiable + corrections motivées + historique
//   3. Classement « Performance de l'équipe »
//   4. Traçabilité des commandes (source, auteur, serveuse, table, transferts)
//   5. Tables et emplacements (occupation, affectation)
//   6. Messagerie (support gestionnaire + consignes internes)
// Aucune valeur n'est calculée dans le navigateur : tout vient du serveur.
// ============================================================================================
(function () {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { period: 'all', boardPeriod: 'week', stats: null };
  const PERIODS = { today: 'Aujourd’hui', week: '7 derniers jours', month: '30 derniers jours', all: 'Tout l’historique' };

  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (value) => `${(Number(value) || 0).toLocaleString('fr-FR')} XOF`;
  const dateFr = (value) => { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }); };

  function toast(message, tone = 'info') {
    const node = $('#toast');
    if (!node) return;
    node.textContent = message;
    node.className = `toast visible ${tone}`;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { node.className = 'toast'; }, 3800);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      method: options.method || 'GET',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    let json = null; try { json = JSON.parse(text); } catch (_) {}
    if (!response.ok) {
      const error = new Error((json && (json.error || json.message)) || `Erreur ${response.status}`);
      error.status = response.status; error.code = json && json.code;
      throw error;
    }
    return json;
  }

  function sourceLabel(source, createdBy) {
    if (createdBy && createdBy.type === 'customer') return 'Client (QR)';
    const map = { staff_assisted: 'Serveuse', manager_assisted: 'Gérant général', merchant_manual: 'Marchand', customer_qr: 'Client (QR boutique)', customer_table_qr: 'Client (QR table)', customer_link: 'Client (lien)', admin: 'Administrateur général' };
    return map[source] || source || '—';
  }
  function orderPill(status) {
    const map = { pending: ['À confirmer', 'warn'], confirmed: ['Confirmée', 'brand'], preparing: ['En préparation', 'brand'], ready: ['Prête', 'brand'], completed: ['Terminée', 'ok'], cancelled: ['Annulée', 'danger'], rejected: ['Refusée', 'danger'] };
    const [label, tone] = map[status] || [status || '—', ''];
    return `<span class="pill ${tone}">${esc(label)}</span>`;
  }

  // ------------------------------------------------------------------ 1. vue d'ensemble
  async function renderOverview(root) {
    const response = await api(`/api/merchant/overview?period=${state.period}`);
    const data = response.data;
    const s = data.stats;
    state.stats = s;
    root.innerHTML = `
      <div class="ops-hero">
        <div><span class="eyebrow">VUE D’ENSEMBLE</span><h1>${esc(data.store ? data.store.name : 'Ma boutique')}</h1>
        <p>Chaque chiffre provient des opérations réellement enregistrées : aucune valeur n’est simulée ni complétée artificiellement.</p></div>
        <div class="ops-hero-actions"><button type="button" data-refresh="overview">Actualiser</button></div>
      </div>
      <div class="ops-filter"><label for="overviewPeriod">Période</label>
        <select id="overviewPeriod">${Object.entries(PERIODS).map(([value, label]) => `<option value="${value}" ${value === state.period ? 'selected' : ''}>${label}</option>`).join('')}</select>
        <span class="pill brand">Mis à jour le ${esc(dateFr(s.serverTime))}</span></div>
      <div class="ops-grid">
        <div class="ops-tile accent"><span>Commandes du jour</span><strong>${s.orders.today}</strong><small>${money(s.revenue.today)} encaissés hors annulations</small></div>
        <div class="ops-tile warn"><span>En attente</span><strong>${s.orders.pending}</strong><small>${s.orders.confirmed} acceptée(s)</small></div>
        <div class="ops-tile"><span>En préparation</span><strong>${s.orders.preparing + s.orders.ready}</strong><small>${s.orders.ready} prête(s) à servir</small></div>
        <div class="ops-tile"><span>Terminées</span><strong>${s.orders.completed}</strong><small>${s.orders.cancelled} annulée(s)</small></div>
        <div class="ops-tile"><span>Chiffre d’affaires</span><strong>${money(s.revenue.total)}</strong><small>${s.revenue.orderCount} commande(s) hors annulations</small></div>
        <div class="ops-tile"><span>Scans clients</span><strong>${s.scans.customer}</strong><small>${s.scans.staff} par le personnel · ${s.scans.total} au total</small></div>
        <div class="ops-tile"><span>Serveuses actives</span><strong>${s.team.waitressesActive}</strong><small>sur ${s.team.waitressesTotal} · ${s.team.blocked} bloquée(s)</small></div>
        <div class="ops-tile"><span>Gérants actifs</span><strong>${s.team.managersActive}</strong><small>sur ${s.team.managersTotal}</small></div>
        <div class="ops-tile"><span>Tâches en cours</span><strong>${s.tasks.open}</strong><small>${s.tasks.done} terminée(s) · ${s.tasks.late} en retard</small></div>
        <div class="ops-tile"><span>Tables occupées</span><strong>${data.servicePoints.occupied}</strong><small>sur ${data.servicePoints.total} emplacement(s)</small></div>
        <div class="ops-tile"><span>Messages non traités</span><strong>${data.unreadMessages}</strong><small>Demandes de l’équipe</small></div>
      </div>
      <section class="ops-card"><header><div><h2>Articles les plus commandés</h2><p>Calculé sur les commandes non annulées de la période.</p></div></header>
        ${s.topProducts.length ? `<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Article</th><th class="num">Quantité</th><th class="num">Montant</th></tr></thead><tbody>
        ${s.topProducts.map((row) => `<tr><td>${esc(row.name)}</td><td class="num">${row.quantity}</td><td class="num">${money(row.revenue)}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="ops-empty">Aucune vente enregistrée sur cette période.</div>'}
      </section>
      <section class="ops-card"><header><div><h2>Activité par membre</h2><p>Commandes et scans rattachés à chaque membre, avec les points réellement crédités.</p></div></header>
        ${s.memberActivity.length ? `<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Membre</th><th>Fonction</th><th class="num">Commandes</th><th class="num">Scans</th><th class="num">Points</th></tr></thead><tbody>
        ${s.memberActivity.map((row) => `<tr><td>${esc(row.designation || row.fullName || '—')}</td><td>${esc(row.role === 'general_manager' ? 'Gérant général' : 'Serveuse')}</td>
          <td class="num">${row.orders}</td><td class="num">${row.scans}</td><td class="num"><strong>${row.points}</strong></td></tr>`).join('')}
        </tbody></table></div>` : '<div class="ops-empty">Aucun membre actif pour l’instant.</div>'}
      </section>`;
    $('#overviewPeriod', root)?.addEventListener('change', (event) => { state.period = event.target.value; renderOverview(root); });
  }

  // ------------------------------------------------------------------ 2. points des serveuses
  async function renderPoints(root) {
    const [points, board] = await Promise.all([
      api(`/api/merchant/points?period=${state.period}`),
      api(`/api/merchant/leaderboard?period=${state.boardPeriod === 'all' ? 'month' : state.boardPeriod}`),
    ]);
    const settings = points.data.settings;
    const waitresses = points.data.waitresses || [];
    const history = points.data.history || [];
    root.innerHTML = `
      <div class="ops-hero"><div><span class="eyebrow">POINTS DES SERVEUSES</span><h1>Un barème clair, un journal vérifiable</h1>
      <p>Les points sont calculés à partir des événements réels. Une serveuse ne peut jamais modifier ses points ; toute correction est une nouvelle ligne motivée, signée et conservée.</p></div>
      <div class="ops-hero-actions"><button type="button" data-refresh="points">Actualiser</button></div></div>
      <section class="ops-card"><header><div><h2>Barème en vigueur</h2><p>Modifiez les valeurs : elles s’appliquent aux prochains événements, jamais aux points déjà acquis.</p></div></header>
        <form id="opsPointsSettings" class="ops-grid" style="align-items:end">
          <div class="field"><label for="pScan">Scan de table</label><input id="pScan" type="number" min="0" max="100" value="${Number(settings.pointsScan)}"></div>
          <div class="field"><label for="pOrder">Commande enregistrée</label><input id="pOrder" type="number" min="0" max="100" value="${Number(settings.pointsOrder)}"></div>
          <div class="field"><label for="pDone">Commande terminée</label><input id="pDone" type="number" min="0" max="100" value="${Number(settings.pointsOrderCompleted)}"></div>
          <div class="field"><label for="pTask">Tâche validée</label><input id="pTask" type="number" min="0" max="100" value="${Number(settings.pointsTask)}"></div>
          <div class="field field-check"><span class="field-label">Crédit de la responsable</span>
            <label class="ops-check" for="pCredit"><input id="pCredit" type="checkbox" ${settings.creditAssignedServer ? 'checked' : ''}><span>Créditer la serveuse responsable de la commande</span></label>
            <small class="sub">Désactivé : la commande crédite uniquement celle qui l’a enregistrée.</small></div>
          <div class="ops-actions"><button class="ops-btn primary" type="submit">Enregistrer le barème</button></div>
        </form>
        <div class="ops-notice" style="margin-top:12px">${(points.data.rules || []).map((rule) => `• ${esc(rule)}`).join('<br>')}</div>
      </section>
      <section class="ops-card"><header><div><h2>Points par serveuse</h2><p>${esc(PERIODS[state.period] || '')}</p></div>
        <select id="pointsPeriod" aria-label="Période des points">${Object.entries(PERIODS).map(([value, label]) => `<option value="${value}" ${value === state.period ? 'selected' : ''}>${label}</option>`).join('')}</select></header>
        ${waitresses.length ? `<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Serveuse</th><th class="num">Points</th><th class="num">Scans</th><th class="num">Commandes</th><th class="num">Terminées</th><th class="num">Tâches</th><th>Correction motivée</th></tr></thead><tbody>
        ${waitresses.map((row) => `<tr><td>${esc(row.designation || row.fullName)}<span class="sub">${esc(row.status === 'active' ? 'Active' : row.status === 'blocked' ? 'Bloquée' : row.status)}</span></td>
          <td class="num"><strong>${row.points}</strong></td><td class="num">${row.scans}</td><td class="num">${row.orders}</td>
          <td class="num">${row.completedOrders}</td><td class="num">${row.tasksDone}${row.tasksLate ? `<span class="sub">${row.tasksLate} en retard</span>` : ''}</td>
          <td><form class="ops-inline" data-adjust="${esc(row.id)}"><input name="points" type="number" min="-99" max="99" placeholder="±pts" required style="width:64px">
            <input name="reason" maxlength="200" placeholder="Motif obligatoire" required style="min-width:150px">
            <button class="ops-btn small" type="submit">Corriger</button></form></td></tr>`).join('')}
        </tbody></table></div>` : '<div class="ops-empty">Créez d’abord une serveuse dans « Mon équipe ».</div>'}
      </section>
      <section class="ops-card"><header><div><h2>Performance de l’équipe</h2><p>Classement d’activité : il décrit le travail réalisé sur la période, sans jugement de valeur.</p></div>
        <select id="boardPeriod" aria-label="Période du classement">${['today', 'week', 'month'].map((value) => `<option value="${value}" ${value === state.boardPeriod ? 'selected' : ''}>${esc(PERIODS[value])}</option>`).join('')}</select></header>
        <div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Position</th><th>Serveuse</th><th class="num">Scans</th><th class="num">Commandes</th><th class="num">Terminées</th><th class="num">Tâches</th><th class="num">Points</th></tr></thead><tbody>
        ${(board.data.rows || []).length ? board.data.rows.map((row) => `<tr><td><span class="ops-rank ${row.rank === 1 ? 'first' : ''}">${row.rank}</span></td>
          <td>${esc(row.designation || row.fullName)}</td><td class="num">${row.scans}</td><td class="num">${row.orders}</td>
          <td class="num">${row.completedOrders}</td><td class="num">${row.tasksDone}</td><td class="num"><strong>${row.points}</strong></td></tr>`).join('')
          : '<tr><td colspan="7"><div class="ops-empty">Aucune activité sur la période.</div></td></tr>'}
        </tbody></table></div>
      </section>
      <section class="ops-card"><header><div><h2>Journal des points</h2><p>Chaque ligne est un événement ou une correction : rien n’est effacé.</p></div></header>
        ${history.length ? `<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Date</th><th>Membre</th><th>Action</th><th>Motif</th><th>Auteur</th><th class="num">Points</th></tr></thead><tbody>
        ${history.slice(0, 80).map((row) => `<tr><td>${esc(dateFr(row.createdAt))}</td><td>${esc(row.memberLabel || '—')}</td>
          <td>${esc(row.actionLabel || row.action)}</td><td>${esc(row.reason || '—')}</td><td>${esc(row.actorLabel || 'Système')}</td>
          <td class="num" style="color:${row.points < 0 ? '#b91c1c' : '#15803d'}">${row.points > 0 ? '+' : ''}${row.points}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="ops-empty">Aucun point enregistré pour le moment.</div>'}
      </section>`;

    $('#pointsPeriod', root)?.addEventListener('change', (event) => { state.period = event.target.value; renderPoints(root); });
    $('#boardPeriod', root)?.addEventListener('change', (event) => { state.boardPeriod = event.target.value; renderPoints(root); });
    $('#opsPointsSettings', root)?.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api('/api/merchant/points/settings', { method: 'PUT', body: {
          pointsScan: Number($('#pScan', root).value), pointsOrder: Number($('#pOrder', root).value),
          pointsOrderCompleted: Number($('#pDone', root).value), pointsTask: Number($('#pTask', root).value),
          creditAssignedServer: $('#pCredit', root).checked } });
        toast('Barème enregistré.', 'ok');
        await renderPoints(root);
      } catch (error) { toast(error.message, 'danger'); }
    });
    $$('[data-adjust]', root).forEach((form) => form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const points = Number(form.querySelector('[name=points]').value);
      const reason = form.querySelector('[name=reason]').value.trim();
      try {
        await api('/api/merchant/points/adjust', { method: 'POST', body: { memberId: form.dataset.adjust, points, reason } });
        toast('Correction enregistrée et tracée.', 'ok');
        await renderPoints(root);
      } catch (error) { toast(error.message, 'danger'); }
    }));
  }

  // ------------------------------------------------------------------ 4. traçabilité des commandes
  async function renderOrders(root) {
    const [tracking, points] = await Promise.all([
      // Mission 10 : 40 lignes suffisent pour la première vue (au lieu de 100) ; le serveur reste
      // la source de vérité et la pagination existante n'est pas modifiée.
      api('/api/merchant/orders-tracking?limit=40'),
      api('/api/merchant/points?period=all').catch(() => ({ data: { waitresses: [] } })),
    ]);
    const rows = tracking.data.rows || [];
    const waitresses = points.data.waitresses || [];
    root.innerHTML = `
      <div class="ops-hero"><div><span class="eyebrow">TRAÇABILITÉ DES COMMANDES</span><h1>Qui a pris la commande, qui la suit</h1>
      <p>La source, l’auteur et son rôle restent attachés à la commande. Une modification par une autre personne ne remplace jamais l’auteur d’origine ; un transfert de suivi est enregistré avec son motif.</p></div>
      <div class="ops-hero-actions"><button type="button" data-refresh="orders">Actualiser</button></div></div>
      <section class="ops-card"><div class="ops-filter">
        <label for="trackingStatus">État</label><select id="trackingStatus"><option value="">Tous</option>
          <option value="pending">À confirmer</option><option value="confirmed">Confirmées</option><option value="preparing">En préparation</option>
          <option value="completed">Terminées</option><option value="cancelled">Annulées</option></select>
        <label for="trackingSource">Source</label><select id="trackingSource"><option value="">Toutes</option>
          <option value="customer_qr">Client (QR)</option><option value="staff_assisted">Serveuse</option><option value="manager_assisted">Gérant général</option><option value="merchant_manual">Marchand</option></select>
      </div>
      ${rows.length ? `<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Référence</th><th>Source · auteur</th><th>Serveuse responsable</th><th>Table</th><th>État</th><th class="num">Total</th><th>Suivi</th></tr></thead><tbody>
      ${rows.map((row) => `<tr><td>${esc(row.reference)}<span class="sub">${esc(dateFr(row.createdAt))} · ${row.itemCount} article(s)</span></td>
        <td>${esc(row.sourceLabel)}<span class="sub">${esc(row.createdBy?.label || '—')}</span></td>
        <td>${esc(row.assignedDesignation || 'Non affectée')}</td>
        <td>${esc(row.servicePointName || '—')}</td>
        <td>${orderPill(row.status)}</td>
        <td class="num">${money(row.totalAmountXof)}</td>
        <td><select data-order-assign="${esc(row.id)}" aria-label="Serveuse responsable"><option value="">— Aucune —</option>
          ${waitresses.map((w) => `<option value="${esc(w.id)}" ${row.assignedMemberId === w.id ? 'selected' : ''}>${esc(w.designation || w.fullName)}</option>`).join('')}
        </select></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="ops-empty">Aucune commande enregistrée.</div>'}
      </section>`;
    $$('[data-order-assign]', root).forEach((select) => select.addEventListener('change', async () => {
      select.disabled = true;
      try {
        await api(`/api/merchant/orders/${encodeURIComponent(select.dataset.orderAssign)}/assign`, { method: 'POST', body: { memberId: select.value, reason: 'Affectation depuis la traçabilité' } });
        toast(select.value ? 'Commande affectée. La serveuse est notifiée.' : 'Affectation retirée.', 'ok');
        await renderOrders(root);
      } catch (error) { toast(error.message, 'danger'); select.disabled = false; }
    }));
  }

  // ------------------------------------------------------------------ 5. tables
  async function renderTables(root) {
    const [tables, points] = await Promise.all([
      api('/api/merchant/tables'),
      api('/api/merchant/points?period=all').catch(() => ({ data: { waitresses: [] } })),
    ]);
    const rows = tables.data.tables || [];
    const waitresses = points.data.waitresses || [];
    root.innerHTML = `
      <div class="ops-hero"><div><span class="eyebrow">TABLES ET EMPLACEMENTS</span><h1>Occupation et affectation</h1>
      <p>Le scan du QR d’une table identifie automatiquement l’emplacement : une commande prise sur une table arrive toujours sur la bonne table. Les QR restent cloisonnés par boutique.</p></div>
      <div class="ops-hero-actions"><button type="button" data-refresh="tables">Actualiser</button></div></div>
      <div class="ops-grid">
        <div class="ops-tile accent"><span>Emplacements</span><strong>${rows.length}</strong></div>
        <div class="ops-tile warn"><span>Occupés</span><strong>${rows.filter((row) => row.occupied).length}</strong></div>
        <div class="ops-tile"><span>Libres</span><strong>${rows.filter((row) => !row.occupied).length}</strong></div>
        <div class="ops-tile"><span>Affectés</span><strong>${rows.filter((row) => row.assignedTo).length}</strong></div>
      </div>
      <section class="ops-card">${rows.length ? `<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Table</th><th>Zone</th><th>État</th><th class="num">Scans QR</th><th>Affectée à</th><th>Commandes en cours</th></tr></thead><tbody>
        ${rows.map((row) => `<tr><td>${esc(row.name)}<span class="sub">${esc(row.type === 'table' ? 'Table' : row.type)} · ${esc(row.publicCode)}</span></td>
          <td>${esc(row.zone || '—')}</td><td>${row.occupied ? '<span class="pill warn">Occupée</span>' : '<span class="pill ok">Libre</span>'}</td>
          <td class="num">${row.qrScanCount}</td>
          <td><select data-table-assign="${esc(row.id)}"><option value="">— Non affectée —</option>
            ${waitresses.map((w) => `<option value="${esc(w.id)}" ${row.assignedTo?.memberId === w.id ? 'selected' : ''}>${esc(w.designation || w.fullName)}</option>`).join('')}
          </select></td>
          <td>${row.activeOrders.length ? row.activeOrders.map((order) => `${esc(order.reference)} ${orderPill(order.status)}`).join('<br>') : '<span class="sub">—</span>'}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="ops-empty">Créez vos tables depuis « Scans & activation ».</div>'}</section>`;
    $$('[data-table-assign]', root).forEach((select) => select.addEventListener('change', async () => {
      select.disabled = true;
      try {
        await api(`/api/merchant/tables/${encodeURIComponent(select.dataset.tableAssign)}/assign`, { method: 'POST', body: { memberId: select.value } });
        toast(select.value ? 'Table affectée : les commandes de cette table suivront cette serveuse.' : 'Table libérée.', 'ok');
        await renderTables(root);
      } catch (error) { toast(error.message, 'danger'); select.disabled = false; }
    }));
  }

  // ------------------------------------------------------------------ 6. messagerie
  async function renderMessages(root) {
    const list = await api('/api/merchant/messages');
    const conversations = list.data.conversations || [];
    const points = await api('/api/merchant/points?period=all').catch(() => ({ data: { waitresses: [] } }));
    root.innerHTML = `
      <div class="ops-hero"><div><span class="eyebrow">MESSAGERIE</span><h1>Votre gestionnaire et votre équipe</h1>
      <p>Le canal gestionnaire relie votre boutique à votre interlocuteur Oymike. Le canal interne transmet une consigne à un membre précis, avec accusé de lecture.</p></div>
      <div class="ops-hero-actions"><button type="button" data-refresh="messages">Actualiser</button></div></div>
      <section class="ops-card"><header><div><h2>Nouveau message</h2><p>${list.data.manager ? `Gestionnaire rattaché : ${esc(list.data.manager.displayName || list.data.manager.username)}` : 'Aucun gestionnaire Oymike n’est rattaché à votre boutique pour le moment : le canal interne reste disponible.'}</p></div></header>
        <form id="merchantMessageForm" class="ops-compose">
          <select id="msgKind"><option value="support" ${list.data.manager ? '' : 'disabled'}>Au gestionnaire Oymike</option><option value="internal">Consigne à un membre de l’équipe</option></select>
          <select id="msgMember" hidden>${(points.data.waitresses || []).map((w) => `<option value="${esc(w.id)}">${esc(w.designation || w.fullName)}</option>`).join('')}</select>
          <input id="msgSubject" maxlength="140" placeholder="Sujet" required>
          <textarea id="msgBody" maxlength="4000" placeholder="Votre message…" required></textarea>
          <div class="ops-actions"><button class="ops-btn primary" type="submit">Envoyer</button></div>
        </form></section>
      <section class="ops-card"><header><div><h2>Fils</h2><p>${conversations.length} conversation(s).</p></div></header>
        ${conversations.length ? `<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Sujet</th><th>Type</th><th>Auteur</th><th>Statut</th><th>Dernier message</th></tr></thead><tbody>
        ${conversations.map((row) => `<tr><td>${esc(row.subject)}<span class="sub">${row.messageCount} message(s) · ${esc(row.lastBody || '')}</span></td>
          <td>${row.kind === 'support' ? '<span class="pill brand">Gestionnaire</span>' : '<span class="pill">Équipe</span>'}</td>
          <td>${esc(row.createdByLabel || '—')}${row.memberDesignation ? `<span class="sub">Pour ${esc(row.memberDesignation)}</span>` : ''}</td>
          <td>${row.status === 'closed' ? '<span class="pill">Clôturé</span>' : row.status === 'answered' ? '<span class="pill ok">Répondu</span>' : '<span class="pill warn">En attente</span>'}</td>
          <td>${esc(dateFr(row.lastMessageAt))}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="ops-empty">Aucun message pour le moment.</div>'}
      </section>`;
    const kindSelect = $('#msgKind', root);
    kindSelect?.addEventListener('change', () => { $('#msgMember', root).hidden = kindSelect.value !== 'internal'; });
    if (kindSelect && !list.data.manager) $('#msgMember', root).hidden = false;
    $('#merchantMessageForm', root)?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = event.target.querySelector('button[type=submit]');
      button.disabled = true;
      try {
        await api('/api/merchant/messages', { method: 'POST', body: {
          kind: $('#msgKind', root).value, memberId: $('#msgMember', root).value,
          subject: $('#msgSubject', root).value.trim(), body: $('#msgBody', root).value.trim() } });
        toast('Message envoyé.', 'ok');
        await renderMessages(root);
      } catch (error) { toast(error.message, 'danger'); button.disabled = false; }
    });
  }

  // ------------------------------------------------------------------ routage
  const VIEWS = { overview: renderOverview, points: renderPoints, orders: renderOrders, tables: renderTables, messages: renderMessages };
  const TARGETS = { overview: 'opsOverview', points: 'opsPoints', orders: 'opsOrders', tables: 'opsTables', messages: 'opsMessages' };

  async function openView(view) {
    const render = VIEWS[view];
    const root = document.getElementById(TARGETS[view]);
    if (!render || !root) return;
    $$('[data-ops-tab]').forEach((node) => node.classList.toggle('active', node.dataset.opsTab === view));
    // Un seul hôte visible : les autres restent rendus en mémoire, jamais empilés à l'écran.
    $$('.ops-host').forEach((node) => { node.hidden = node.id !== TARGETS[view]; });
    root.innerHTML = '<div class="ops-empty">Chargement…</div>';
    try { await render(root); } catch (error) { root.innerHTML = `<div class="ops-notice danger">${esc(error.message)}</div>`; }
  }

  function boot() {
    $$('[data-ops-tab]').forEach((button) => button.addEventListener('click', () => openView(button.dataset.opsTab)));
    document.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-refresh]');
      if (trigger) openView(trigger.dataset.refresh);
    });
  }

  // Badge de messagerie : compteur de demandes non traitées, rafraîchi sans doublon.
  async function refreshBadge() {
    const badge = document.getElementById('opsUnreadBadge');
    if (!badge) return;
    try {
      const response = await api('/api/merchant/messages');
      const unread = Number(response.data.unread) || 0;
      badge.textContent = unread; badge.hidden = !unread;
    } catch (_) { badge.hidden = true; }
  }

  // Mission 11 : le badge de messagerie n'interroge le serveur qu'une fois la session ouverte.
  // Avant, il partait au chargement de la page : un 401 inutile s'affichait sur l'écran de connexion.
  let messagerieTimer = null;
  function startMessagerie() {
    refreshBadge();
    if (!messagerieTimer) messagerieTimer = setInterval(() => { if (!document.hidden && document.body.dataset.wsApp === 'true') refreshBadge(); }, 45000);
  }
  document.addEventListener('workspace:session', startMessagerie);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { boot(); if (document.body.dataset.wsApp === 'true') startMessagerie(); });
  else { boot(); if (document.body.dataset.wsApp === 'true') startMessagerie(); }
  window.MerchantOps = { openView };
})();
