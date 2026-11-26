'use strict';

// ============================================================================================
// Contrôle opérationnel — Administrateur général.
//
// L'Administrateur général supervise la plateforme (marchands, équipes, commandes, scans,
// messages) et peut intervenir sur les comptes. Il NE remplace PAS le marchand : aucune création
// de gérant ou de serveuse ici, et la vue est en lecture seule sur les opérations de boutique.
// ============================================================================================
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (value) => `${(Number(value) || 0).toLocaleString('fr-FR')} XOF`;
  const dateFr = (value) => { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }); };
  const state = { period: 'week', loaded: false };

  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Erreur inattendue.');
    return payload;
  }
  function notify(message) {
    const node = $('#toast');
    if (!node) return;
    node.textContent = message; node.classList.add('visible');
    setTimeout(() => node.classList.remove('visible'), 3200);
  }

  async function load() {
    const root = $('#adminOpsRoot');
    if (!root) return;
    root.innerHTML = '<p class="hint">Chargement…</p>';
    try {
      const [overview, history, support] = await Promise.all([
        api(`/api/admin/ops/overview?period=${state.period}`),
        api('/api/admin/ops/history?limit=60'),
        api('/api/admin/ops/support').catch(() => ({ data: { conversations: [] } })),
      ]);
      const g = overview.data.global || {};
      const merchants = overview.data.merchants || [];
      const staff = overview.data.staff || [];
      root.innerHTML = `
        <div class="page-heading page-heading-compact"><div><span class="eyebrow">SUPERVISION OPÉRATIONNELLE</span><h1>Activité de la plateforme</h1>
          <p>Toutes les boutiques, leurs équipes et leurs opérations réelles. Vous contrôlez les comptes et les accès ; le marchand reste responsable de son exploitation.</p></div>
          <button id="adminOpsRefresh" class="button outline" type="button">Actualiser</button></div>
        <div class="ops-filter"><label for="adminOpsPeriod">Période</label>
          <select id="adminOpsPeriod">${[['today', 'Aujourd’hui'], ['week', '7 derniers jours'], ['month', '30 derniers jours'], ['all', 'Tout l’historique']].map(([value, label]) => `<option value="${value}" ${value === state.period ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
        <div class="ops-grid">
          <div class="ops-tile accent"><span>Marchands</span><strong>${g.merchants || 0}</strong><small>${g.merchantsActive || 0} actif(s) · ${g.merchantsBlocked || 0} bloqué(s)/suspendu(s)</small></div>
          <div class="ops-tile"><span>Gestionnaires</span><strong>${g.managers || 0}</strong><small>Comptes de la plateforme</small></div>
          <div class="ops-tile"><span>Membres d’équipe</span><strong>${g.membersActive || 0}</strong><small>${g.membersBlocked || 0} bloqué(s)</small></div>
          <div class="ops-tile"><span>Commandes</span><strong>${g.orders || 0}</strong><small>${money(g.revenue)} hors annulations</small></div>
          <div class="ops-tile"><span>Scans</span><strong>${g.scans || 0}</strong><small>Clients et personnel</small></div>
          <div class="ops-tile ${Number(g.openMessages) ? 'warn' : ''}"><span>Messages ouverts</span><strong>${g.openMessages || 0}</strong><small>Support équipe</small></div>
        </div>
        <section class="panel settings-card"><h2>Marchands et équipes</h2>
          <p>Lecture seule : la création et le blocage des membres restent entre les mains de chaque marchand.</p>
          ${merchants.length ? `<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Marchand</th><th>Boutique</th><th>État</th><th class="num">Équipe</th><th class="num">Actifs</th><th class="num">Commandes</th><th class="num">Scans</th><th>Créé le</th></tr></thead><tbody>
            ${merchants.map((row) => `<tr><td>${esc(row.displayName || row.username)}<span class="sub">@${esc(row.username)}</span></td>
              <td>${esc(row.storeName || '—')}</td><td>${row.status === 'active' ? '<span class="pill ok">Actif</span>' : `<span class="pill danger">${esc(row.status)}</span>`}</td>
              <td class="num">${row.teamMembers}</td><td class="num">${row.teamActive}</td><td class="num">${row.orders}</td><td class="num">${row.scans}</td>
              <td>${esc(dateFr(row.createdAt))}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="hint">Aucun marchand.</p>'}
        </section>
        <section class="panel settings-card"><h2>Membres d’équipe</h2>
          <p>Les données historiques (commandes, scans, points) sont conservées même si un compte est bloqué ou désactivé : seule la connexion est coupée.</p>
          ${staff.length ? `<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Membre</th><th>Marchand</th><th>Fonction</th><th>État</th><th class="num">Points</th><th>Dernière connexion</th><th>Historique</th></tr></thead><tbody>
            ${staff.slice(0, 80).map((row) => `<tr><td>${esc(row.designation || row.fullName)}</td><td>${esc(row.merchantName || '—')}</td>
              <td>${esc(row.role === 'general_manager' ? 'Gérant général' : 'Serveuse / Serveur')}</td>
              <td>${row.status === 'active' ? '<span class="pill ok">Actif</span>' : row.status === 'blocked' ? '<span class="pill danger">Bloqué</span>' : `<span class="pill">${esc(row.status)}</span>`}</td>
              <td class="num">${Number(row.points) || 0}</td><td>${esc(dateFr(row.lastLoginAt))}</td>
              <td>${row.hasData ? '<span class="pill brand">Conservé</span>' : '—'}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="hint">Aucun membre d’équipe.</p>'}
        </section>
        <section class="panel settings-card"><h2>Dernières commandes</h2>
          ${(history.data.orders || []).length ? `<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Référence</th><th>Marchand</th><th>Source · auteur</th><th>Suivi</th><th>État</th><th class="num">Total</th><th>Date</th></tr></thead><tbody>
            ${history.data.orders.map((row) => `<tr><td>${esc(row.reference)}</td><td>${esc(row.merchantName || '—')}<span class="sub">${esc(row.storeName || '')}</span></td>
              <td>${esc(row.createdByDesignation || row.createdByType || '—')}<span class="sub">${esc(row.source || '')}</span></td>
              <td>${esc(row.assignedDesignation || '—')}</td><td>${esc(row.status)}</td><td class="num">${money(row.totalAmountXof)}</td><td>${esc(dateFr(row.createdAt))}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="hint">Aucune commande.</p>'}
        </section>
        <section class="panel settings-card"><h2>Derniers scans</h2>
          ${(history.data.scans || []).length ? `<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Date</th><th>Marchand</th><th>Nature</th><th>Table</th><th>Auteur</th></tr></thead><tbody>
            ${history.data.scans.map((row) => `<tr><td>${esc(dateFr(row.scannedAt))}</td><td>${esc(row.merchantName || '—')}</td>
              <td>${row.category === 'staff' ? '<span class="pill brand">Personnel</span>' : row.category === 'merchant' ? '<span class="pill">Marchand</span>' : '<span class="pill">Client</span>'}</td>
              <td>${esc(row.servicePointName || '—')}</td><td>${esc(row.memberDesignation || '—')}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="hint">Aucun scan.</p>'}
        </section>
        <section class="panel settings-card"><h2>Messages de support</h2>
          <p>Supervision en lecture : vous contrôlez les échanges, vous ne répondez pas à la place du gestionnaire.</p>
          ${(support.data.conversations || []).length ? `<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Sujet</th><th>Marchand</th><th>Auteur</th><th>Statut</th><th>Dernier message</th></tr></thead><tbody>
            ${support.data.conversations.map((row) => `<tr><td>${esc(row.subject)}<span class="sub">${row.messageCount} message(s)</span></td><td>${esc(row.merchantName || '—')}</td>
              <td>${esc(row.createdByLabel || '—')}</td><td>${esc(row.status)}</td><td>${esc(dateFr(row.lastMessageAt))}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="hint">Aucun message.</p>'}
        </section>`;
      $('#adminOpsRefresh').addEventListener('click', () => load());
      $('#adminOpsPeriod').addEventListener('change', (event) => { state.period = event.target.value; load(); });
      state.loaded = true;
    } catch (error) {
      root.innerHTML = `<p class="message error">${esc(error.message)}</p>`;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { window.addEventListener('qria:admin-ops', () => load()); });
  else window.addEventListener('qria:admin-ops', () => load());
})();
