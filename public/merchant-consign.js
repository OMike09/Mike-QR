'use strict';

// ============================================================================================
// CONSIGNATION — interface marchand (onglet « Consignation »).
// Aucun calcul de solde ici : le serveur est la seule source de vérité. L'écran se contente
// d'afficher ce qu'il renvoie et de transmettre des intentions (dépôt, retour, usage, remboursement).
// ============================================================================================

(function consignUi() {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const state = { kind: 'bottle', period: 'all', filterStatus: '', bottleTypes: [], lastCode: null, detail: null, hasLoaded: false };

  const money = (value) => `${Number(value || 0).toLocaleString('fr-FR')} FCFA`;
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (value) => {
    if (!value) return '—';
    try { return new Date(value).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    catch (_) { return String(value); }
  };
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  function toast(text) {
    const node = document.getElementById('consignToast');
    if (!node) return;
    node.textContent = text; node.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { node.hidden = true; }, 4200);
  }
  async function api(path, options = {}) {
    const response = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    let payload = null; try { payload = await response.json(); } catch (_) {}
    if (!response.ok) { const error = new Error(payload?.error || `Erreur ${response.status}`); error.code = payload?.code; throw error; }
    return payload;
  }

  // ------------------------------------------------------------------ rendu principal
  async function render(root) {
    root.innerHTML = '<div class="consign-loading">Chargement des consignations…</div>';
    let stats = null, settings = null, list = [];
    try {
      const [statsResult, settingsResult, listResult] = await Promise.all([
        api('/api/merchant/consignments/stats?period=' + encodeURIComponent(state.period)),
        api('/api/merchant/consignment-settings'),
        api(`/api/merchant/consignments?period=${encodeURIComponent(state.period)}${state.filterStatus ? `&status=${state.filterStatus}` : ''}${state.kind ? `&kind=${state.kind}` : ''}`),
      ]);
      stats = statsResult.data; settings = settingsResult.data; list = listResult.data?.consignments || [];
    } catch (error) {
      root.innerHTML = `<div class="ops-notice danger">${esc(error.message)}</div>`;
      return;
    }
    state.bottleTypes = settings?.bottleTypes || [];
    state.hasLoaded = true;

    root.innerHTML = `
      <div class="consign-hero">
        <div>
          <span class="eyebrow">CONSIGNATION</span>
          <h2>Bouteilles et monnaie laissées par vos clients</h2>
          <p>Chaque dépôt reçoit un <strong>code secret</strong> remis au client. Une consignation n’est jamais un paiement : aucun montant n’entre dans votre chiffre d’affaires.</p>
        </div>
        <div class="consign-hero-actions">
          <button class="ops-btn primary" type="button" data-consign-new="bottle">+ Dépôt de bouteilles</button>
          <button class="ops-btn" type="button" data-consign-new="money">+ Dépôt de monnaie</button>
        </div>
      </div>

      <div class="consign-stats">
        ${statCard('Bouteilles déposées', stats?.bottlesDeposited ?? 0, `${stats?.bottlesCount ?? 0} consignation(s)`)}
        ${statCard('Bouteilles restant à rendre', stats?.bottlesRemaining ?? 0, `${stats?.bottlesRecovered ?? 0} déjà rendues`)}
        ${statCard('Monnaie consignée', money(stats?.moneyDeposited), `${stats?.moneyCount ?? 0} consignation(s)`)}
        ${statCard('Solde dû aux clients', money(stats?.moneyRemaining), `${money(stats?.moneyUsed)} utilisés · ${money(stats?.moneyRefunded)} remboursés`)}
        ${statCard('En cours', stats?.openCount ?? 0, 'à suivre')}
        ${statCard('Soldées', stats?.settledCount ?? 0, 'terminées')}
      </div>

      <section class="ops-card">
        <div class="consign-toolbar">
          <div class="consign-segmented" role="tablist">
            <button type="button" class="${state.kind === 'bottle' ? 'active' : ''}" data-consign-kind="bottle">Bouteilles</button>
            <button type="button" class="${state.kind === 'money' ? 'active' : ''}" data-consign-kind="money">Monnaie</button>
            <button type="button" class="${state.kind === '' ? 'active' : ''}" data-consign-kind="">Tout</button>
          </div>
          <select id="consignPeriod">
            <option value="all"${state.period === 'all' ? ' selected' : ''}>Toutes les périodes</option>
            <option value="today"${state.period === 'today' ? ' selected' : ''}>Aujourd’hui</option>
            <option value="week"${state.period === 'week' ? ' selected' : ''}>7 derniers jours</option>
            <option value="month"${state.period === 'month' ? ' selected' : ''}>30 derniers jours</option>
          </select>
          <select id="consignStatus">
            <option value="">Tous les statuts</option>
            <option value="open"${state.filterStatus === 'open' ? ' selected' : ''}>En cours</option>
            <option value="settled"${state.filterStatus === 'settled' ? ' selected' : ''}>Soldées</option>
          </select>
          <form id="consignSearch" class="consign-search">
            <input id="consignSearchInput" placeholder="Référence, nom ou téléphone">
            <button class="ops-btn" type="submit">Rechercher</button>
          </form>
          <button class="ops-btn" type="button" data-consign-lookup>Retrouver par code</button>
          <button class="ops-btn" type="button" data-consign-settings>Réglages</button>
        </div>
        ${list.length ? `<div class="consign-list">${list.map(rowHtml).join('')}</div>` : '<div class="ops-empty">Aucune consignation pour ces critères. Enregistrez un dépôt pour commencer.</div>'}
      </section>

      <div id="consignModal" class="consign-modal" hidden><div class="consign-modal-card" role="dialog" aria-modal="true"></div></div>
      <div id="consignToast" class="consign-toast" hidden></div>
    `;
    bind(root);
  }

  function statCard(label, value, sub) {
    return `<div class="consign-stat"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub)}</small></div>`;
  }

  function rowHtml(item) {
    const isBottle = item.kind === 'bottle';
    const balance = isBottle ? `${item.balanceQuantity} bouteille(s)` : money(item.balanceAmountXof);
    const statusLabel = item.status === 'settled' ? 'Soldée' : item.status === 'cancelled' ? 'Annulée' : 'En cours';
    return `<article class="consign-row" data-consign-id="${esc(item.id)}">
      <div class="consign-row-main">
        <div>
          <strong>${esc(item.reference)}</strong>
          <span class="consign-tag ${esc(item.kind)}">${isBottle ? 'Bouteilles' : 'Monnaie'}</span>
          <span class="consign-status ${esc(item.status)}">${statusLabel}</span>
        </div>
        <small>${esc(item.customerName || 'Client non nommé')}${item.customerPhone ? ` · ${esc(item.customerPhone)}` : ''} · ${esc(fmt(item.createdAt))}</small>
        <small>${isBottle ? `${esc(item.bottleTypeLabel || 'Bouteille')} · ${item.quantityDeposited} déposée(s) · ${item.quantityRecovered} rendue(s)` : `${money(item.amountDepositedXof)} déposés · ${money(item.amountUsedXof)} utilisés · ${money(item.amountRefundedXof)} remboursés`}</small>
      </div>
      <div class="consign-row-balance">
        <span>Solde</span><strong>${esc(balance)}</strong>
        ${item.codeHint ? `<small>Code ${esc(item.codeHint)}</small>` : ''}
      </div>
      <div class="consign-row-actions">
        <button class="ops-btn" type="button" data-consign-open="${esc(item.id)}">Ouvrir</button>
        ${item.status === 'open' ? (isBottle
          ? `<button class="ops-btn primary" type="button" data-consign-return="${esc(item.id)}">Retour</button>`
          : `<button class="ops-btn primary" type="button" data-consign-use="${esc(item.id)}">Utiliser</button>
             <button class="ops-btn" type="button" data-consign-refund="${esc(item.id)}">Rembourser</button>`) : ''}
      </div>
    </article>`;
  }

  function bind(root) {
    for (const button of $$('[data-consign-kind]', root)) button.addEventListener('click', () => { state.kind = button.dataset.consignKind; render(root); });
    $('#consignPeriod', root)?.addEventListener('change', (event) => { state.period = event.target.value; render(root); });
    $('#consignStatus', root)?.addEventListener('change', (event) => { state.filterStatus = event.target.value; render(root); });
    $('#consignSearch', root)?.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = $('#consignSearchInput', root).value.trim();
      if (value) searchBy(value, root);
    });
    for (const button of $$('[data-consign-new]', root)) button.addEventListener('click', () => openDeposit(button.dataset.consignNew, root));
    for (const button of $$('[data-consign-open]', root)) button.addEventListener('click', () => openDetail(button.dataset.consignOpen, root));
    for (const button of $$('[data-consign-return]', root)) button.addEventListener('click', () => openMovement('return', button.dataset.consignReturn, root));
    for (const button of $$('[data-consign-use]', root)) button.addEventListener('click', () => openMovement('use', button.dataset.consignUse, root));
    for (const button of $$('[data-consign-refund]', root)) button.addEventListener('click', () => openMovement('refund', button.dataset.consignRefund, root));
    $('[data-consign-lookup]', root)?.addEventListener('click', () => openLookup(root));
    $('[data-consign-settings]', root)?.addEventListener('click', () => openSettings(root));
  }

  // ------------------------------------------------------------------ modale générique
  function modal(root, html) {
    const host = $('#consignModal', root); if (!host) return null;
    host.hidden = false;
    const card = $('.consign-modal-card', host);
    card.innerHTML = html;
    $('[data-consign-close]', card)?.addEventListener('click', () => { host.hidden = true; });
    host.onclick = (event) => { if (event.target === host) host.hidden = true; };
    return card;
  }
  function closeModal(root) { const host = $('#consignModal', root); if (host) host.hidden = true; }

  // ------------------------------------------------------------------ dépôt
  function openDeposit(kind, root) {
    const isBottle = kind === 'bottle';
    const typeOptions = state.bottleTypes.filter((t) => t.active).map((t) => `<option value="${esc(t.id)}" data-value="${t.unitValueXof}">${esc(t.label)}${t.unitValueXof ? ` — ${money(t.unitValueXof)} / bouteille` : ' — sans valeur'}</option>`).join('');
    const card = modal(root, `
      <header><h3>${isBottle ? 'Dépôt de bouteilles' : 'Dépôt de monnaie'}</h3><button type="button" class="consign-x" data-consign-close aria-label="Fermer">×</button></header>
      <form id="consignDepositForm" class="consign-form">
        <div class="consign-grid">
          <div class="field"><label for="cName">Nom du client <span class="muted">(facultatif)</span></label><input id="cName" maxlength="120" placeholder="Awa Koffi"></div>
          <div class="field"><label for="cPhone">Téléphone <span class="muted">(facultatif)</span></label><input id="cPhone" type="tel" maxlength="32" placeholder="+225 07 00 00 00 00"></div>
          ${isBottle ? `
            <div class="field"><label for="cType">Type de bouteille</label>
              <select id="cType" required><option value="">Choisir…</option>${typeOptions}</select></div>
            <div class="field"><label for="cQty">Quantité déposée</label><input id="cQty" type="number" min="1" step="1" value="1" required></div>
            <div class="field"><label for="cUnit">Valeur unitaire de consigne (FCFA)</label><input id="cUnit" type="number" min="0" step="1" value="0"></div>
          ` : `
            <div class="field"><label for="cAmount">Montant consigné (FCFA)</label><input id="cAmount" type="number" min="1" step="1" required placeholder="10000"></div>
            <div class="field"><label for="cReason">Motif</label><input id="cReason" maxlength="200" placeholder="Avance pour la prochaine visite"></div>
          `}
          <div class="field span-two"><label for="cNote">Observation <span class="muted">(facultatif)</span></label><input id="cNote" maxlength="500"></div>
          <p class="consign-note span-two" id="cPreview"></p>
        </div>
        <div class="consign-form-actions">
          <button class="ops-btn primary" type="submit">Enregistrer et générer le code</button>
          <button class="ops-btn" type="button" data-consign-close>Annuler</button>
        </div>
      </form>`);
    if (!card) return;
    const preview = $('#cPreview', card);
    const updatePreview = () => {
      if (isBottle) {
        const qty = Number($('#cQty', card).value || 0);
        const unit = Number($('#cUnit', card).value || 0);
        preview.textContent = qty && unit ? `Valeur de consigne : ${money(qty * unit)} (${qty} × ${money(unit)}).` : 'Aucune valeur de consigne : le dépôt est enregistré sans montant.';
      } else {
        const amount = Number($('#cAmount', card).value || 0);
        preview.textContent = amount ? `Le client disposera d’un crédit de ${money(amount)}. Ce montant n’est pas un encaissement.` : '';
      }
    };
    if (isBottle) {
      $('#cType', card).addEventListener('change', (event) => {
        const option = event.target.selectedOptions[0];
        $('#cUnit', card).value = option?.dataset.value || 0; updatePreview();
      });
      $('#cQty', card).addEventListener('input', updatePreview);
      $('#cUnit', card).addEventListener('input', updatePreview);
      if (!state.bottleTypes.filter((t) => t.active).length) {
        preview.innerHTML = 'Aucun type de bouteille configuré. <button type="button" class="link-btn" data-consign-settings>Créer un type de bouteille</button>';
        $('[data-consign-settings]', card)?.addEventListener('click', () => { closeModal(root); openSettings(root); });
      }
    } else {
      $('#cAmount', card).addEventListener('input', updatePreview);
    }
    $('#consignDepositForm', card).addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = $('button[type=submit]', card); button.disabled = true;
      const body = { kind, customerName: $('#cName', card).value, customerPhone: $('#cPhone', card).value,
        observation: $('#cNote', card).value, idempotencyKey: uid() };
      if (isBottle) { body.bottleTypeId = $('#cType', card).value; body.quantity = Number($('#cQty', card).value); body.unitValueXof = Number($('#cUnit', card).value); }
      else { body.amountXof = Number($('#cAmount', card).value); body.reason = $('#cReason', card).value; }
      try {
        const result = await api('/api/merchant/consignments', { method: 'POST', body: JSON.stringify(body) });
        // Ordre important : on rafraîchit la liste AVANT d'afficher le reçu. L'inverse effaçait
        // le reçu (et donc le code secret, affiché une seule fois) dans le même souffle.
        await render(root);
        showReceipt(result.data, root);
      } catch (error) { toast(error.message); }
      finally { button.disabled = false; }
    });
  }

  // ------------------------------------------------------------------ fiche de confirmation / reçu
  function showReceipt(payload, root, { rotated = false } = {}) {
    const consignment = payload.consignment || payload;
    const code = payload.code || '';
    const isBottle = consignment.kind === 'bottle';
    const balance = isBottle ? `${consignment.balanceQuantity} bouteille(s)` : money(consignment.balanceAmountXof);
    const storeName = document.querySelector('.brand')?.textContent?.trim() || 'Votre boutique';
    const card = modal(root, `
      <header><h3>${rotated ? 'Nouveau code généré' : 'Consignation enregistrée'}</h3><button type="button" class="consign-x" data-consign-close aria-label="Fermer">×</button></header>
      <div id="consignReceipt" class="consign-receipt">
        <div class="consign-receipt-head"><strong>${esc(storeName)}</strong><span>Fiche client</span></div>
        <dl>
          <div><dt>Référence</dt><dd>${esc(consignment.reference)}</dd></div>
          <div><dt>Nature</dt><dd>${isBottle ? `Bouteilles — ${esc(consignment.bottleTypeLabel || '')}` : 'Monnaie'}</dd></div>
          <div><dt>${isBottle ? 'Bouteilles déposées' : 'Montant déposé'}</dt><dd>${isBottle ? consignment.quantityDeposited : money(consignment.amountDepositedXof)}</dd></div>
          <div><dt>Date</dt><dd>${esc(fmt(consignment.createdAt))}</dd></div>
          <div><dt>Restant à récupérer</dt><dd>${esc(balance)}</dd></div>
          ${consignment.customerName ? `<div><dt>Client</dt><dd>${esc(consignment.customerName)}</dd></div>` : ''}
        </dl>
        ${code ? `<div class="consign-code-block"><span>CODE SECRET DU CLIENT</span><code id="consignCodeValue">${esc(code)}</code>
          <small>Ce code n’est affiché qu’une seule fois. Notez-le ou remettez-le au client maintenant.</small></div>` : ''}
        <p class="consign-note">Conservez cette fiche. Le client présentera son code lors de son prochain passage ; aucune donnée d’un autre client n’est visible ici.</p>
      </div>
      <div class="consign-form-actions">
        ${code ? '<button class="ops-btn primary" type="button" id="consignShowCode">Afficher le code</button>' : ''}
        ${code ? '<button class="ops-btn" type="button" id="consignCopyCode">Copier le code</button>' : ''}
        <button class="ops-btn" type="button" id="consignPrint">Imprimer le reçu</button>
        <button class="ops-btn" type="button" id="consignShare">Partager le reçu</button>
        <button class="ops-btn" type="button" data-consign-close>Fermer</button>
      </div>`);
    if (!card) return;
    state.lastCode = code;
    $('#consignShowCode', card)?.addEventListener('click', () => {
      const node = $('#consignCodeValue', card);
      if (!node) return;
      node.textContent = node.textContent.includes('•') ? code : '•'.repeat(6);
    });
    $('#consignCopyCode', card)?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(code); toast('Code copié.'); }
      catch (_) { toast(`Code : ${code}`); }
    });
    $('#consignPrint', card)?.addEventListener('click', () => printReceipt(consignment, code));
    $('#consignShare', card)?.addEventListener('click', async () => {
      const text = `Consignation ${consignment.reference} — ${isBottle ? balance : `solde ${balance}`}. Code : ${code || '(voir la fiche)'}`;
      if (navigator.share) { try { await navigator.share({ title: 'Consignation', text }); return; } catch (_) {} }
      try { await navigator.clipboard.writeText(text); toast('Reçu copié dans le presse-papiers.'); }
      catch (_) { toast(text); }
    });
  }

  function printReceipt(consignment, code) {
    const isBottle = consignment.kind === 'bottle';
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed'; frame.style.right = '0'; frame.style.bottom = '0'; frame.style.width = '0'; frame.style.height = '0'; frame.style.border = '0';
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    doc.open();
    doc.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Reçu ${esc(consignment.reference)}</title>
      <style>body{font-family:system-ui,sans-serif;padding:18px;color:#111}h1{font-size:17px;margin:0 0 4px}
      .muted{color:#666;font-size:12px}table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
      td{padding:6px 0;border-bottom:1px dashed #ddd}td:last-child{text-align:right;font-weight:600}
      .code{margin-top:14px;padding:12px;border:2px dashed #0c4a3a;border-radius:10px;text-align:center}
      .code strong{display:block;font-size:26px;letter-spacing:6px;margin-top:4px}</style></head><body>
      <h1>${esc(document.querySelector('.brand')?.textContent?.trim() || 'Oymike Tech')}</h1>
      <div class="muted">Reçu de consignation — à conserver avec votre code</div>
      <table>
        <tr><td>Référence</td><td>${esc(consignment.reference)}</td></tr>
        <tr><td>Nature</td><td>${isBottle ? 'Bouteilles' : 'Monnaie'}</td></tr>
        <tr><td>${isBottle ? 'Quantité déposée' : 'Montant déposé'}</td><td>${isBottle ? consignment.quantityDeposited : money(consignment.amountDepositedXof)}</td></tr>
        <tr><td>Date</td><td>${esc(fmt(consignment.createdAt))}</td></tr>
        <tr><td>Restant</td><td>${isBottle ? `${consignment.balanceQuantity} bouteille(s)` : money(consignment.balanceAmountXof)}</td></tr>
      </table>
      ${code ? `<div class="code">CODE SECRET<strong>${esc(code)}</strong></div>` : ''}
      <p class="muted">Ce reçu n’est pas une facture et ne vaut pas paiement. Présentez le code pour récupérer vos bouteilles ou utiliser votre crédit.</p>
      </body></html>`);
    doc.close();
    frame.contentWindow.focus(); frame.contentWindow.print();
    setTimeout(() => frame.remove(), 1500);
  }

  // ------------------------------------------------------------------ détail
  async function openDetail(id, root) {
    try {
      const result = await api(`/api/merchant/consignments/${encodeURIComponent(id)}`);
      const item = result.data; state.detail = item;
      const isBottle = item.kind === 'bottle';
      const movements = (item.movements || []).map((m) => `<tr><td>${esc(fmt(m.createdAt))}</td><td>${esc({
        deposit: 'Dépôt', return: 'Retour', use: 'Crédit utilisé', refund: 'Remboursement', cancel: 'Annulation', code_rotation: 'Code renouvelé', adjustment: 'Rectification' }[m.type] || m.type)}</td>
        <td>${m.quantityDelta ? `${m.quantityDelta} bouteille(s)` : ''}${m.amountDeltaXof ? ` ${money(m.amountDeltaXof)}` : ''}</td>
        <td>${esc(m.actorLabel || '')}</td><td>${isBottle ? `${m.balanceQuantityAfter} bouteille(s)` : money(m.balanceAmountAfter)}</td></tr>`).join('');
      const card = modal(root, `
        <header><h3>${esc(item.reference)}</h3><button type="button" class="consign-x" data-consign-close aria-label="Fermer">×</button></header>
        <div class="consign-detail">
          <div class="consign-detail-head">
            <span class="consign-tag ${esc(item.kind)}">${isBottle ? 'Bouteilles' : 'Monnaie'}</span>
            <span class="consign-status ${esc(item.status)}">${item.status === 'settled' ? 'Soldée' : item.status === 'cancelled' ? 'Annulée' : 'En cours'}</span>
            <small>Créée le ${esc(fmt(item.createdAt))} par ${esc(item.createdByLabel || '—')}</small>
          </div>
          <div class="consign-stats compact">
            ${statCard(isBottle ? 'Déposées' : 'Déposé', isBottle ? item.quantityDeposited : money(item.amountDepositedXof), '')}
            ${statCard(isBottle ? 'Rendues' : 'Utilisé', isBottle ? item.quantityRecovered : money(item.amountUsedXof), '')}
            ${statCard(isBottle ? 'Restant' : 'Remboursé', isBottle ? item.balanceQuantity : money(item.amountRefundedXof), '')}
            ${statCard('Solde', isBottle ? `${item.balanceQuantity} bouteille(s)` : money(item.balanceAmountXof), '')}
          </div>
          <p class="consign-note">${esc(item.customerName || 'Client non nommé')}${item.customerPhone ? ` · ${esc(item.customerPhone)}` : ''}${item.observation ? ` · ${esc(item.observation)}` : ''}</p>
          <h4>Historique (non modifiable)</h4>
          <div class="consign-table-wrap"><table class="ops-table"><thead><tr><th>Date</th><th>Opération</th><th>Mouvement</th><th>Par</th><th>Solde après</th></tr></thead>
            <tbody>${movements || '<tr><td colspan="5">Aucun mouvement.</td></tr>'}</tbody></table></div>
          <h4>Journal</h4>
          <ul class="consign-events">${(item.events || []).map((e) => `<li>${esc(fmt(e.createdAt))} — ${esc(e.detail || e.action)} <span class="muted">(${esc(e.actorLabel || '')})</span></li>`).join('') || '<li>Aucun événement.</li>'}</ul>
        </div>
        <div class="consign-form-actions">
          ${item.status === 'open' ? (isBottle
            ? `<button class="ops-btn primary" type="button" id="detailReturn">Enregistrer un retour</button>`
            : `<button class="ops-btn primary" type="button" id="detailUse">Utiliser le crédit</button>
               <button class="ops-btn" type="button" id="detailRefund">Rembourser</button>`) : ''}
          <button class="ops-btn" type="button" id="detailRotate">Renouveler le code</button>
          <button class="ops-btn" type="button" data-consign-close>Fermer</button>
        </div>`);
      if (!card) return;
      $('#detailReturn', card)?.addEventListener('click', () => openMovement('return', id, root));
      $('#detailUse', card)?.addEventListener('click', () => openMovement('use', id, root));
      $('#detailRefund', card)?.addEventListener('click', () => openMovement('refund', id, root));
      $('#detailRotate', card)?.addEventListener('click', async () => {
        if (!window.confirm('Renouveler le code client ? L’ancien code cessera immédiatement de fonctionner.')) return;
        try {
          const rotated = await api(`/api/merchant/consignments/${encodeURIComponent(id)}/rotate-code`, { method: 'POST', body: '{}' });
          await render(root);
          showReceipt({ consignment: rotated.data.consignment, code: rotated.data.code }, root, { rotated: true });
        } catch (error) { toast(error.message); }
      });
    } catch (error) { toast(error.message); }
  }

  // ------------------------------------------------------------------ mouvement (retour / usage / remboursement)
  function openMovement(type, id, root) {
    const labels = { return: 'Retour de bouteilles', use: 'Utiliser le crédit', refund: 'Remboursement' };
    const isAmount = type !== 'return';
    const card = modal(root, `
      <header><h3>${labels[type]}</h3><button type="button" class="consign-x" data-consign-close aria-label="Fermer">×</button></header>
      <form id="consignMoveForm" class="consign-form">
        <div class="consign-grid">
          <div class="field"><label for="mAmount">${isAmount ? 'Montant (FCFA)' : 'Nombre de bouteilles rendues'}</label>
            <input id="mAmount" type="number" min="1" step="1" required autofocus></div>
          ${type === 'use' ? '<div class="field"><label for="mOrder">Référence de commande <span class="muted">(facultatif)</span></label><input id="mOrder" maxlength="40" placeholder="OY-…"></div>' : ''}
          <div class="field span-two"><label for="mReason">Motif</label><input id="mReason" maxlength="200" required placeholder="${type === 'refund' ? 'Remboursement demandé par le client' : type === 'use' ? 'Commande réglée avec le crédit' : 'Retour au comptoir'}"></div>
          <div class="field span-two"><label for="mNote">Observation <span class="muted">(facultatif)</span></label><input id="mNote" maxlength="500"></div>
        </div>
        <p class="consign-note">Un double clic ne créera pas deux opérations : chaque validation porte un identifiant unique vérifié par le serveur. Le solde ne peut jamais devenir négatif.</p>
        <div class="consign-form-actions">
          <button class="ops-btn primary" type="submit">Valider</button>
          <button class="ops-btn" type="button" data-consign-close>Annuler</button>
        </div>
      </form>`);
    if (!card) return;
    const idempotencyKey = uid();
    $('#consignMoveForm', card).addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = $('button[type=submit]', card); button.disabled = true;
      const body = { idempotencyKey, reason: $('#mReason', card).value, observation: $('#mNote', card).value };
      if (isAmount) body.amountXof = Number($('#mAmount', card).value); else body.quantity = Number($('#mAmount', card).value);
      if (type === 'use' && $('#mOrder', card)?.value.trim()) body.orderId = $('#mOrder', card).value.trim();
      try {
        const result = await api(`/api/merchant/consignments/${encodeURIComponent(id)}/${type}`, { method: 'POST', body: JSON.stringify(body) });
        const balance = result.data.consignment.kind === 'bottle'
          ? `${result.data.consignment.balanceQuantity} bouteille(s) restantes`
          : `solde ${money(result.data.consignment.balanceAmountXof)}`;
        toast(`${labels[type]} enregistré — ${balance}.`);
        closeModal(root);
        await render(root);
      } catch (error) { toast(error.message); }
      finally { button.disabled = false; }
    });
  }

  // ------------------------------------------------------------------ recherche par code
  function openLookup(root) {
    const card = modal(root, `
      <header><h3>Retrouver une consignation</h3><button type="button" class="consign-x" data-consign-close aria-label="Fermer">×</button></header>
      <form id="consignLookupForm" class="consign-form">
        <div class="consign-grid">
          <div class="field span-two"><label for="lCode">Code secret du client (6 caractères)</label>
            <input id="lCode" maxlength="6" autocapitalize="characters" placeholder="K7P4M2" required style="letter-spacing:5px;font-size:20px;text-transform:uppercase"></div>
        </div>
        <p class="consign-note">Le code ne permet de voir que la consignation correspondante, dans votre boutique. Les tentatives sont limitées côté serveur.</p>
        <div class="consign-form-actions"><button class="ops-btn primary" type="submit">Rechercher</button>
          <button class="ops-btn" type="button" data-consign-close>Annuler</button></div>
      </form>
      <div id="consignLookupResult"></div>`);
    if (!card) return;
    $('#consignLookupForm', card).addEventListener('submit', async (event) => {
      event.preventDefault();
      const target = $('#consignLookupResult', card);
      target.innerHTML = '<p class="consign-note">Recherche…</p>';
      try {
        const result = await api(`/api/merchant/consignments/lookup?code=${encodeURIComponent($('#lCode', card).value.trim())}`);
        const item = (result.data || [])[0];
        if (!item) { target.innerHTML = '<p class="ops-notice danger">Aucune consignation trouvée.</p>'; return; }
        target.innerHTML = rowHtml(item);
        $('[data-consign-open]', target)?.addEventListener('click', () => openDetail(item.id, root));
        const returnButton = $('[data-consign-return]', target); if (returnButton) returnButton.addEventListener('click', () => openMovement('return', item.id, root));
        const useButton = $('[data-consign-use]', target); if (useButton) useButton.addEventListener('click', () => openMovement('use', item.id, root));
        const refundButton = $('[data-consign-refund]', target); if (refundButton) refundButton.addEventListener('click', () => openMovement('refund', item.id, root));
      } catch (error) { target.innerHTML = `<p class="ops-notice danger">${esc(error.message)}</p>`; }
    });
  }

  function searchBy(value, root) {
    const input = $('#consignSearchInput', root);
    if (input) input.value = value;
    api(`/api/merchant/consignments?search=${encodeURIComponent(value)}&period=${encodeURIComponent(state.period)}`)
      .then((result) => {
        const list = result.data?.consignments || [];
        const host = $('.consign-list', root) || $('.ops-empty', root)?.parentElement;
        if (!host) return;
        if (!list.length) { toast('Aucune consignation pour cette recherche.'); return; }
        if (host.classList.contains('consign-list')) host.innerHTML = list.map(rowHtml).join('');
        else { host.insertAdjacentHTML('beforeend', `<div class="consign-list">${list.map(rowHtml).join('')}</div>`); }
        bind(root);
        toast(`${list.length} consignation(s) trouvée(s).`);
      })
      .catch((error) => toast(error.message));
  }

  // ------------------------------------------------------------------ réglages & types de bouteilles
  async function openSettings(root) {
    let settings = null, types = [];
    try {
      const result = await api('/api/merchant/consignment-settings');
      settings = result.data?.settings || {}; types = result.data?.bottleTypes || [];
    } catch (error) { toast(error.message); return; }
    const card = modal(root, `
      <header><h3>Réglages de la consignation</h3><button type="button" class="consign-x" data-consign-close aria-label="Fermer">×</button></header>
      <form id="consignSettingsForm" class="consign-form">
        <h4>Types de bouteilles et valeurs</h4>
        <div class="consign-types">
          ${types.length ? types.map((type) => `<div class="consign-type-row" data-type="${esc(type.id)}">
            <input data-type-label value="${esc(type.label)}" maxlength="80" placeholder="Nom">
            <input data-type-ref value="${esc(type.reference || '')}" maxlength="80" placeholder="Marque / référence">
            <input data-type-value type="number" min="0" step="1" value="${type.unitValueXof}" placeholder="Valeur FCFA">
            <label class="consign-inline"><input data-type-active type="checkbox" ${type.active ? 'checked' : ''}> Active</label>
          </div>`).join('') : '<p class="consign-note">Aucun type de bouteille pour l’instant.</p>'}
        </div>
        <div class="consign-type-row new">
          <input id="newTypeLabel" maxlength="80" placeholder="Nouveau type (ex. Bouteille 33cl)">
          <input id="newTypeRef" maxlength="80" placeholder="Marque / référence">
          <input id="newTypeValue" type="number" min="0" step="1" placeholder="Valeur FCFA">
          <button class="ops-btn" type="button" id="addTypeBtn">Ajouter</button>
        </div>
        <h4>Ce que les serveuses peuvent faire</h4>
        <label class="consign-inline"><input id="setBottles" type="checkbox" ${settings.waitress_can_create_bottles ? 'checked' : ''}> Enregistrer un dépôt de bouteilles</label>
        <label class="consign-inline"><input id="setMoney" type="checkbox" ${settings.waitress_can_create_money ? 'checked' : ''}> Enregistrer un dépôt de monnaie</label>
        <label class="consign-inline"><input id="setReturn" type="checkbox" ${settings.waitress_can_return ? 'checked' : ''}> Enregistrer un retour de bouteilles</label>
        <label class="consign-inline"><input id="setRefund" type="checkbox" ${settings.waitress_can_refund ? 'checked' : ''}> Utiliser un crédit ou rembourser</label>
        <label class="consign-inline"><input id="setPhone" type="checkbox" ${settings.require_phone_for_money ? 'checked' : ''}> Exiger un téléphone pour une consignation de monnaie</label>
        <div class="consign-form-actions"><button class="ops-btn primary" type="submit">Enregistrer les réglages</button>
          <button class="ops-btn" type="button" data-consign-close>Fermer</button></div>
      </form>`);
    if (!card) return;
    $('#addTypeBtn', card).addEventListener('click', async () => {
      const label = $('#newTypeLabel', card).value.trim();
      if (label.length < 2) { toast('Indiquez un nom de type de bouteille.'); return; }
      try {
        await api('/api/merchant/consignment-settings/bottle-types', { method: 'POST', body: JSON.stringify({
          label, reference: $('#newTypeRef', card).value, unitValueXof: Number($('#newTypeValue', card).value || 0) }) });
        toast('Type de bouteille ajouté.');
        const refreshed = await api('/api/merchant/consignment-settings');
        state.bottleTypes = refreshed.data?.bottleTypes || [];
        closeModal(root); openSettings(root);
      } catch (error) { toast(error.message); }
    });
    for (const row of $$('.consign-type-row[data-type]', card)) {
      const save = async () => {
        try {
          await api(`/api/merchant/consignment-settings/bottle-types/${encodeURIComponent(row.dataset.type)}`, { method: 'PUT', body: JSON.stringify({
            label: $('[data-type-label]', row).value, reference: $('[data-type-ref]', row).value,
            unitValueXof: Number($('[data-type-value]', row).value || 0), active: $('[data-type-active]', row).checked }) });
          toast('Type enregistré.');
        } catch (error) { toast(error.message); }
      };
      $('[data-type-value]', row).addEventListener('change', save);
      $('[data-type-active]', row).addEventListener('change', save);
      $('[data-type-label]', row).addEventListener('change', save);
      $('[data-type-ref]', row).addEventListener('change', save);
    }
    $('#consignSettingsForm', card).addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api('/api/merchant/consignment-settings', { method: 'PUT', body: JSON.stringify({
          waitressCanCreateBottles: $('#setBottles', card).checked, waitressCanCreateMoney: $('#setMoney', card).checked,
          waitressCanReturn: $('#setReturn', card).checked, waitressCanRefund: $('#setRefund', card).checked,
          requirePhoneForMoney: $('#setPhone', card).checked }) });
        toast('Réglages enregistrés.');
        closeModal(root);
        const refreshed = await api('/api/merchant/consignment-settings');
        state.bottleTypes = refreshed.data?.bottleTypes || [];
        await render(root);
      } catch (error) { toast(error.message); }
    });
  }

  window.MerchantConsign = { render };
})();
