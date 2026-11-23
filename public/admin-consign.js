'use strict';

// ============================================================================================
// CONSIGNATION — contrôle Administrateur général.
//
// Lecture seule par principe : l'Administrateur général supervise l'ensemble des boutiques
// (volumes de bouteilles, crédits en circulation, historique des opérations sensibles) mais ne
// crée ni ne rembourse une consignation à la place d'un marchand. Aucune donnée n'est modifiable
// depuis cet écran, et la base reste la seule source de vérité (aucun chiffre calculé côté client).
// ============================================================================================
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (v) => `${(Number(v) || 0).toLocaleString('fr-FR')} FCFA`;
  const dateFr = (v) => { if (!v) return '—'; const d = new Date(v); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }); };
  const state = { period: 'all', kind: '', search: '', loaded: false };

  async function api(url) {
    const response = await fetch(url, { credentials: 'same-origin' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Erreur inattendue.');
    return payload.data;
  }

  const KIND_LABEL = { bottle: 'Bouteilles', money: 'Monnaie' };
  const MOVES = { return: 'Retour', use: 'Crédit utilisé', refund: 'Remboursement', cancel: 'Annulation', deposit: 'Dépôt' };

  async function load() {
    const root = $('#adminConsignRoot');
    if (!root) return;
    root.innerHTML = '<p class="hint">Chargement des consignations…</p>';
    try {
      const [overview, history] = await Promise.all([
        api('/api/admin/consignments/overview'),
        api(`/api/admin/consignments/history?limit=80${state.kind ? `&kind=${state.kind}` : ''}${state.period !== 'all' ? `&period=${state.period}` : ''}${state.search ? `&search=${encodeURIComponent(state.search)}` : ''}`),
      ]);
      const g = overview.totals || {};
      const stores = overview.stores || [];
      const rows = history.consignments || history.history || [];
      const moves = history.movements || [];
      root.innerHTML = `
        <div class="page-heading page-heading-compact"><div>
          <span class="eyebrow">CONTRÔLE Administrateur général · CONSIGNATION</span>
          <h1>Bouteilles et crédits des clients</h1>
          <p>Les consignations sont des dettes de la boutique envers ses clients : elles ne sont jamais comptées comme un chiffre d’affaires. Vous supervisez, vous ne modifiez pas.</p>
        </div><button id="adminConsignRefresh" class="button outline" type="button">Actualiser</button></div>
        <div class="ops-grid">
          <div class="ops-tile accent"><span>Boutiques avec consignation</span><strong>${g.stores ?? stores.length}</strong><small>sur ${g.storesTotal ?? stores.length} boutique(s) de la plateforme</small></div>
          <div class="ops-tile"><span>Consignations</span><strong>${g.total ?? 0}</strong><small>${g.open ?? 0} en cours · ${g.settled ?? 0} soldées</small></div>
          <div class="ops-tile"><span>Bouteilles à rendre</span><strong>${g.bottlesRemaining ?? 0}</strong><small>engagement des boutiques</small></div>
          <div class="ops-tile warn"><span>Crédits en circulation</span><strong>${money(g.moneyRemaining)}</strong><small>${money(g.moneyRefunded)} déjà remboursés</small></div>
        </div>
        <section class="panel settings-card"><h2>Par boutique</h2>
          <p>Chaque ligne est une boutique réelle. Les soldes affichés sont ceux enregistrés en base.</p>
          ${stores.length ? `<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Boutique</th><th>Marchand</th><th class="num">Fiches</th><th class="num">En cours</th><th class="num">Bouteilles</th><th class="num">Crédit restant</th><th class="num">Remboursé</th><th class="num">Soldées</th><th>Dernière activité</th></tr></thead><tbody>
            ${stores.map((row) => `<tr><td>${esc(row.storeName || '—')}</td><td>${esc(row.merchantName || '—')}<span class="sub">@${esc(row.merchantUsername || '')}</span></td>
              <td class="num">${row.total ?? 0}</td><td class="num">${row.open ?? 0}</td><td class="num">${row.bottlesRemaining ?? 0}</td>
              <td class="num">${money(row.moneyRemaining)}</td><td class="num">${money(row.moneyRefunded)}</td>
              <td>${row.settled ?? 0}</td><td>${esc(dateFr(row.lastActivityAt))}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="hint">Aucune consignation enregistrée sur la plateforme.</p>'}
        </section>
        <section class="panel settings-card"><h2>Consignations récentes</h2>
          <div class="ops-filter"><label for="adminConsignPeriod">Période</label>
            <select id="adminConsignPeriod">${[['all', 'Tout l’historique'], ['today', 'Aujourd’hui'], ['week', '7 derniers jours'], ['month', '30 derniers jours']].map(([v, l]) => `<option value="${v}" ${v === state.period ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <select id="adminConsignKind"><option value="">Tous les types</option>${Object.entries(KIND_LABEL).map(([v, l]) => `<option value="${v}" ${v === state.kind ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <input id="adminConsignSearch" type="search" placeholder="Référence, téléphone, boutique" value="${esc(state.search)}">
          </div>
          ${rows.length ? `<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Référence</th><th>Boutique</th><th>Type</th><th>Client</th><th>Solde</th><th>Statut</th><th>Créée le</th><th>Par</th></tr></thead><tbody>
            ${rows.map((row) => `<tr><td>${esc(row.reference)}</td><td>${esc(row.storeName || '—')}</td><td>${esc(KIND_LABEL[row.kind] || row.kind)}</td>
              <td>${esc(row.customerName || 'Client non nommé')}${row.customerPhone ? `<span class="sub">${esc(row.customerPhone)}</span>` : ''}</td>
              <td class="num">${row.kind === 'bottle' ? `${row.balanceQuantity ?? 0} bouteille(s)` : money(row.balanceAmountXof)}</td>
              <td>${row.status === 'open' ? '<span class="pill brand">En cours</span>' : row.status === 'settled' ? '<span class="pill ok">Soldée</span>' : `<span class="pill">${esc(row.status)}</span>`}</td>
              <td>${esc(dateFr(row.createdAt))}</td><td>${esc(row.createdByLabel || '—')}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="hint">Aucune consignation sur cette période.</p>'}
        </section>
        <section class="panel settings-card"><h2>Historique des opérations sensibles</h2>
          <p>Retours, crédits utilisés, remboursements et annulations : chaque ligne est horodatée et rattachée à son auteur. Ces événements ne peuvent pas être supprimés.</p>
          ${moves.length ? `<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Date</th><th>Boutique</th><th>Référence</th><th>Opération</th><th class="num">Quantité / montant</th><th>Motif</th><th>Auteur</th></tr></thead><tbody>
            ${moves.map((row) => `<tr><td>${esc(dateFr(row.createdAt))}</td><td>${esc(row.storeName || '—')}</td><td>${esc(row.reference || '—')}</td>
              <td>${esc(MOVES[row.type] || row.type)}</td><td class="num">${row.type === 'return' || row.type === 'cancel' ? `${row.quantity ?? 0}` : money(row.amountXof)}</td>
              <td>${esc(row.reason || '—')}</td><td>${esc(row.actorLabel || '—')}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="hint">Aucune opération enregistrée.</p>'}
        </section>`;
      $('#adminConsignRefresh', root).addEventListener('click', () => load());
      $('#adminConsignPeriod', root).addEventListener('change', (e) => { state.period = e.target.value; load(); });
      $('#adminConsignKind', root).addEventListener('change', (e) => { state.kind = e.target.value; load(); });
      $('#adminConsignSearch', root).addEventListener('change', (e) => { state.search = e.target.value.trim(); load(); });
      state.loaded = true;
    } catch (error) {
      root.innerHTML = `<p class="message error">${esc(error.message)}</p>`;
    }
  }

  window.AdminConsign = { load };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.addEventListener('qria:admin-consign', () => load()));
  else window.addEventListener('qria:admin-consign', () => load());
})();
