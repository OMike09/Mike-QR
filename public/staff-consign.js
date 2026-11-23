'use strict';

// ============================================================================================
// CONSIGNATION — espace ÉQUIPE (gérant général / serveuse).
//
// Deux garde-fous, tous deux côté serveur :
//   1. la permission attribuée par le marchand (`consignment.view`, `.create`, `.return`) ;
//   2. les réglages de la boutique (dépôt bouteilles/monnaie, retours, remboursements).
// L'interface se contente de masquer ce qui sera refusé — elle n'accorde jamais rien.
// ============================================================================================

(function staffConsignUi() {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const state = { kind: '', settings: null, role: '', types: [] };
  const money = (v) => `${Number(v || 0).toLocaleString('fr-FR')} FCFA`;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v) => { try { return v ? new Date(v).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; } catch (_) { return '—'; } };
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  function toast(text) {
    const node = document.getElementById('toast');
    if (node) { node.textContent = text; node.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => { node.hidden = true; }, 4000); }
  }
  async function api(path, options = {}) {
    const response = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    let payload = null; try { payload = await response.json(); } catch (_) {}
    if (!response.ok) { const error = new Error(payload?.error || `Erreur ${response.status}`); error.code = payload?.code; throw error; }
    return payload;
  }

  async function render(root) {
    if (!root) return;
    root.innerHTML = '<div class="ops-empty">Chargement des consignations…</div>';
    let result;
    try { result = await api('/api/staff/consignments'); }
    catch (error) { root.innerHTML = `<div class="ops-notice danger">${esc(error.message)}</div>`; return; }
    const data = result.data || {};
    state.settings = data.settings || {}; state.role = data.role || '';
    const stats = data.stats || {}; const list = data.consignments || [];
    try { state.types = (await api('/api/staff/consignments/bottle-types')).data || []; } catch (_) { state.types = []; }
    // Les permissions réelles viennent du serveur (`/api/staff/me`) : l'interface ne devine rien.
    try { state.permissions = ((await api('/api/staff/me')).data.session || {}).permissions || []; } catch (_) { state.permissions = []; }
    const perm = (name) => state.permissions.includes(name);
    // Mêmes règles que le serveur : réglages « serveuse » uniquement pour une serveuse.
    const waitress = state.role === 'waitress';
    const canCreateBottles = perm('consignment.create') && (!waitress || state.settings.waitressCanCreateBottles !== false);
    const canCreateMoney = perm('consignment.create') && (!waitress || state.settings.waitressCanCreateMoney !== false);

    root.innerHTML = `
      <div class="ops-hero">
        <div><span class="eyebrow">CONSIGNATION</span><h1>Bouteilles et crédits des clients</h1>
          <p>Enregistrez un dépôt et remettez le code secret au client. Un dépôt n’est jamais un paiement.</p></div>
        <div class="ops-hero-actions">
          ${canCreateBottles ? '<button type="button" data-staff-consign-new="bottle">+ Dépôt de bouteilles</button>' : ''}
          ${canCreateMoney ? '<button type="button" data-staff-consign-new="money">+ Dépôt de monnaie</button>' : ''}
          <button type="button" data-staff-consign-lookup>Code client</button>
        </div>
      </div>
      <div class="ops-grid">
        <div class="ops-tile"><span>Bouteilles déposées</span><strong>${stats.bottlesDeposited ?? 0}</strong><small>${stats.bottlesRecovered ?? 0} rendues</small></div>
        <div class="ops-tile accent"><span>Restant à rendre</span><strong>${stats.bottlesRemaining ?? 0}</strong><small>bouteilles</small></div>
        <div class="ops-tile"><span>Monnaie consignée</span><strong>${money(stats.moneyDeposited)}</strong><small>${money(stats.moneyUsed)} utilisés</small></div>
        <div class="ops-tile"><span>Solde dû aux clients</span><strong>${money(stats.moneyRemaining)}</strong><small>${money(stats.moneyRefunded)} remboursés</small></div>
      </div>
      <section class="ops-card">
        <header><div><h2>Consignations de la boutique</h2><p>${list.length} fiche(s) · la plus récente en premier</p></div></header>
        ${list.length ? `<div class="consign-list">${list.map(rowHtml).join('')}</div>` : '<div class="ops-empty">Aucune consignation enregistrée.</div>'}
      </section>
      <div id="staffConsignModal" class="consign-modal" hidden><div class="consign-modal-card" role="dialog" aria-modal="true"></div></div>`;

    for (const button of $$('[data-staff-consign-new]', root)) button.addEventListener('click', () => openDeposit(button.dataset.staffConsignNew, root));
    $('[data-staff-consign-lookup]', root)?.addEventListener('click', () => openLookup(root));
    for (const button of $$('[data-consign-return]', root)) button.addEventListener('click', () => openMovement('return', button.dataset.consignReturn, root));
    for (const button of $$('[data-consign-use]', root)) button.addEventListener('click', () => openMovement('use', button.dataset.consignUse, root));
    for (const button of $$('[data-consign-refund]', root)) button.addEventListener('click', () => openMovement('refund', button.dataset.consignRefund, root));
  }

  function rowHtml(item) {
    const isBottle = item.kind === 'bottle';
    // Deux conditions serveur, reproduites ici pour l'affichage : la permission ET le réglage de la boutique.
    const perm = (state.permissions || []).includes('consignment.return');
    const waitress = state.role === 'waitress';
    const canReturn = perm && (!waitress || state.settings?.waitressCanReturn !== false);
    const canRefund = perm && (!waitress || state.settings?.waitressCanRefund !== false);
    const isOpen = item.status === 'open';
    return `<article class="consign-row">
      <div class="consign-row-main">
        <strong>${esc(item.reference)}</strong>
        <span class="consign-tag ${esc(item.kind)}">${isBottle ? 'Bouteilles' : 'Monnaie'}</span>
        <span class="consign-status ${esc(item.status)}">${item.status === 'settled' ? 'Soldée' : item.status === 'cancelled' ? 'Annulée' : 'En cours'}</span>
        <small>${esc(item.customerName || 'Client non nommé')}${item.customerPhone ? ` · ${esc(item.customerPhone)}` : ''} · ${esc(fmt(item.createdAt))} · par ${esc(item.createdByLabel || '—')}</small>
      </div>
      <div class="consign-row-balance"><span>Solde</span><strong>${isBottle ? `${item.balanceQuantity} bouteille(s)` : money(item.balanceAmountXof)}</strong>
        ${item.codeHint ? `<small>Code ${esc(item.codeHint)}</small>` : ''}</div>
      <div class="consign-row-actions">
        ${isOpen && isBottle && canReturn ? `<button class="ops-btn primary" type="button" data-consign-return="${esc(item.id)}">Retour</button>` : ''}
        ${isOpen && !isBottle && canRefund ? `<button class="ops-btn primary" type="button" data-consign-use="${esc(item.id)}">Utiliser</button>
          <button class="ops-btn" type="button" data-consign-refund="${esc(item.id)}">Rembourser</button>` : ''}
      </div>
    </article>`;
  }

  function modal(root, html) {
    const host = $('#staffConsignModal', root); if (!host) return null;
    host.hidden = false;
    const card = $('.consign-modal-card', host); card.innerHTML = html;
    $('[data-staff-close]', card)?.addEventListener('click', () => { host.hidden = true; });
    host.onclick = (event) => { if (event.target === host) host.hidden = true; };
    return card;
  }
  const closeModal = (root) => { const host = $('#staffConsignModal', root); if (host) host.hidden = true; };

  function openDeposit(kind, root) {
    const isBottle = kind === 'bottle';
    const options = state.types.map((t) => `<option value="${esc(t.id)}" data-value="${t.unitValueXof}">${esc(t.label)}${t.unitValueXof ? ` — ${money(t.unitValueXof)}` : ''}</option>`).join('');
    const card = modal(root, `
      <header><h3>${isBottle ? 'Dépôt de bouteilles' : 'Dépôt de monnaie'}</h3><button type="button" class="consign-x" data-staff-close>×</button></header>
      <form id="staffDeposit" class="consign-form">
        <div class="consign-grid">
          <div class="field"><label for="sName">Nom du client (facultatif)</label><input id="sName" maxlength="120"></div>
          <div class="field"><label for="sPhone">Téléphone (facultatif)</label><input id="sPhone" type="tel" maxlength="32"></div>
          ${isBottle
            ? `<div class="field"><label for="sType">Type de bouteille</label><select id="sType" required><option value="">Choisir…</option>${options}</select></div>
               <div class="field"><label for="sQty">Quantité</label><input id="sQty" type="number" min="1" value="1" required></div>`
            : `<div class="field"><label for="sAmount">Montant (FCFA)</label><input id="sAmount" type="number" min="1" required></div>
               <div class="field"><label for="sReason">Motif</label><input id="sReason" maxlength="200"></div>`}
          <div class="field span-two"><label for="sNote">Observation</label><input id="sNote" maxlength="500"></div>
        </div>
        <div class="consign-form-actions"><button class="ops-btn primary" type="submit">Enregistrer et générer le code</button>
          <button class="ops-btn" type="button" data-staff-close>Annuler</button></div>
      </form>`);
    if (!card) return;
    $('#staffDeposit', card).addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = $('button[type=submit]', card); button.disabled = true;
      const body = { kind, customerName: $('#sName', card).value, customerPhone: $('#sPhone', card).value,
        observation: $('#sNote', card).value, idempotencyKey: uid() };
      if (isBottle) { body.bottleTypeId = $('#sType', card).value; body.quantity = Number($('#sQty', card).value); }
      else { body.amountXof = Number($('#sAmount', card).value); body.reason = $('#sReason', card).value; }
      try {
        const result = await api('/api/staff/consignments', { method: 'POST', body: JSON.stringify(body) });
        await render(root);
        showCode(result.data, root);
      } catch (error) { toast(error.message); }
      finally { button.disabled = false; }
    });
  }

  function showCode(payload, root) {
    const item = payload.consignment; const code = payload.code;
    const card = modal(root, `
      <header><h3>Code à remettre au client</h3><button type="button" class="consign-x" data-staff-close>×</button></header>
      <div class="consign-receipt">
        <div class="consign-receipt-head"><strong>${esc(item.reference)}</strong><span>${item.kind === 'bottle' ? 'Bouteilles' : 'Monnaie'}</span></div>
        <dl>
          <div><dt>Dépôt</dt><dd>${item.kind === 'bottle' ? `${item.quantityDeposited} bouteille(s)` : money(item.amountDepositedXof)}</dd></div>
          <div><dt>Restant</dt><dd>${item.kind === 'bottle' ? `${item.balanceQuantity} bouteille(s)` : money(item.balanceAmountXof)}</dd></div>
        </dl>
        <div class="consign-code-block"><span>CODE SECRET DU CLIENT</span><code>${esc(code)}</code>
          <small>Affiché une seule fois. Écrivez-le ou montrez-le au client maintenant.</small></div>
      </div>
      <div class="consign-form-actions">
        <button class="ops-btn primary" type="button" id="staffCopyCode">Copier le code</button>
        <button class="ops-btn" type="button" data-staff-close>Fermer</button>
      </div>`);
    if (!card) return;
    $('#staffCopyCode', card)?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(code); toast('Code copié.'); } catch (_) { toast(`Code : ${code}`); }
    });
  }

  function openMovement(type, id, root) {
    const isAmount = type !== 'return';
    const card = modal(root, `
      <header><h3>${type === 'return' ? 'Retour de bouteilles' : type === 'use' ? 'Utiliser le crédit' : 'Remboursement'}</h3>
        <button type="button" class="consign-x" data-staff-close>×</button></header>
      <form id="staffMove" class="consign-form">
        <div class="consign-grid">
          <div class="field"><label for="sValue">${isAmount ? 'Montant (FCFA)' : 'Nombre de bouteilles'}</label><input id="sValue" type="number" min="1" required></div>
          <div class="field"><label for="sWhy">Motif</label><input id="sWhy" maxlength="200" required></div>
        </div>
        <p class="consign-note">Le solde est vérifié par le serveur : impossible de rendre plus de bouteilles qu’il n’en reste ou de rembourser plus que le crédit disponible.</p>
        <div class="consign-form-actions"><button class="ops-btn primary" type="submit">Valider</button>
          <button class="ops-btn" type="button" data-staff-close>Annuler</button></div>
      </form>`);
    if (!card) return;
    const key = uid();
    $('#staffMove', card).addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = $('button[type=submit]', card); button.disabled = true;
      const body = { idempotencyKey: key, reason: $('#sWhy', card).value };
      if (isAmount) body.amountXof = Number($('#sValue', card).value); else body.quantity = Number($('#sValue', card).value);
      try {
        await api(`/api/staff/consignments/${encodeURIComponent(id)}/${type}`, { method: 'POST', body: JSON.stringify(body) });
        toast('Opération enregistrée.');
        closeModal(root); await render(root);
      } catch (error) { toast(error.message); }
      finally { button.disabled = false; }
    });
  }

  function openLookup(root) {
    const card = modal(root, `
      <header><h3>Retrouver avec le code client</h3><button type="button" class="consign-x" data-staff-close>×</button></header>
      <form id="staffLookup" class="consign-form">
        <div class="field"><label for="sCode">Code (6 caractères)</label>
          <input id="sCode" maxlength="6" required style="letter-spacing:5px;font-size:20px;text-transform:uppercase"></div>
        <div class="consign-form-actions"><button class="ops-btn primary" type="submit">Rechercher</button>
          <button class="ops-btn" type="button" data-staff-close>Annuler</button></div>
      </form>
      <div id="staffLookupResult"></div>`);
    if (!card) return;
    $('#staffLookup', card).addEventListener('submit', async (event) => {
      event.preventDefault();
      const target = $('#staffLookupResult', card);
      try {
        const result = await api(`/api/staff/consignments/lookup?code=${encodeURIComponent($('#sCode', card).value)}`);
        // La recherche renvoie une liste (contrat unique avec l'espace marchand) : on prend la fiche.
        const item = Array.isArray(result.data) ? result.data[0] : result.data;
        if (!item) { target.innerHTML = '<div class="ops-notice danger">Aucune consignation ne correspond à ce code dans cette boutique.</div>'; return; }
        target.innerHTML = rowHtml(item);
        $('[data-consign-return]', target)?.addEventListener('click', () => openMovement('return', item.id, root));
        $('[data-consign-use]', target)?.addEventListener('click', () => openMovement('use', item.id, root));
        $('[data-consign-refund]', target)?.addEventListener('click', () => openMovement('refund', item.id, root));
      } catch (error) { target.innerHTML = `<div class="ops-notice danger">${esc(error.message)}</div>`; }
    });
  }

  window.StaffConsign = { render };
})();
