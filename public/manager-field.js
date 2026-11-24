'use strict';
// ============================================================================================
// MISSION 8 — espace gestionnaire : codes d'inscription terrain, validation terrain, historique.
//
//   window.QRIAManagerField.mount({ root, view, notify })
//     view = 'codes'     → générer / suivre / révoquer ses codes à usage unique
//     view = 'terrain'   → saisir un code, ouvrir le formulaire du client, suivre ses inscriptions
//
// Le gestionnaire ne voit QUE ses propres codes et ses propres inscriptions : le filtrage est fait
// côté serveur (son identifiant de session), jamais à partir d'un paramètre d'URL.
// ============================================================================================

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function fmtDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function fmtDay(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('fr-FR');
  }
  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      ...options,
      body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
    });
    const text = await response.text();
    let payload = null; try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = null; }
    if (!response.ok) {
      const error = new Error(payload?.error || `Erreur ${response.status}`);
      error.code = payload?.code; error.status = response.status;
      throw error;
    }
    return payload;
  }
  const LABELS = { available: 'Disponible', used: 'Utilisé', expired: 'Expiré', revoked: 'Révoqué' };
  const TONES = { available: 'ok', used: 'muted', expired: 'warn', revoked: 'danger' };
  const badge = (status) => `<span class="badge badge-${TONES[status] || 'muted'}">${LABELS[status] || status}</span>`;

  let root = null;
  let notify = (message) => window.showToast?.(message);
  let canCreate = false;

  const STYLE = `
    .field-shell{display:flex;flex-direction:column;gap:14px}
    .field-card{background:#fff;border:1px solid #e4e7ec;border-radius:16px;padding:18px}
    .field-card h2{margin:0 0 6px;font-size:1.02rem}
    .field-card .muted{color:#6b7280;font-size:.86rem;margin:0 0 12px}
    .field-form{display:grid;gap:12px}
    .field-row{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}
    .field-input{display:flex;flex-direction:column;gap:5px}
    .field-input label{font-size:.8rem;font-weight:650;color:#374151}
    .field-input input,.field-input select{font:inherit;padding:9px 11px;border:1px solid #e4e7ec;border-radius:9px;background:#fff;width:100%}
    .code-card{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border:1px dashed #d4d4d8;border-radius:12px;background:#fffbeb;margin-top:10px}
    .code-card code{font-family:ui-monospace,Menlo,monospace;font-size:1.25rem;font-weight:750;letter-spacing:.08em}
    .field-table-wrap{overflow:auto;border:1px solid #e4e7ec;border-radius:12px}
    .field-table{width:100%;border-collapse:collapse;font-size:.86rem}
    .field-table th{text-align:left;padding:9px 12px;background:#fafafa;border-bottom:1px solid #e4e7ec;font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;white-space:nowrap}
    .field-table td{padding:9px 12px;border-bottom:1px solid #f1f2f4;vertical-align:top}
    .field-empty{padding:22px;text-align:center;border:1px dashed #e4e7ec;border-radius:12px;color:#6b7280;font-size:.88rem;background:#fafafa}
    .badge{display:inline-block;padding:3px 9px;border-radius:99px;font-size:.74rem;font-weight:700}
    .badge-ok{background:#dcfce7;color:#166534}.badge-warn{background:#fef3c7;color:#92400e}
    .badge-danger{background:#fee2e2;color:#991b1b}.badge-muted{background:#f4f4f5;color:#3f3f46}
    .field-alert{padding:10px 13px;border-radius:10px;font-size:.85rem}
    .field-alert.error{background:#fef2f2;color:#991b1b;border:1px solid #fecaca}
    .field-alert.ok{background:#f0fdf4;color:#166534;border:1px solid #bbf7d0}
    .field-alert.warn{background:#fffbeb;color:#92400e;border:1px solid #fde68a}
  `;
  function injectStyle() { if (!document.getElementById('fieldStyle')) { const node = document.createElement('style'); node.id = 'fieldStyle'; node.textContent = STYLE; document.head.appendChild(node); } }

  // ------------------------------------------------------------------ génération de codes
  async function renderCodes() {
    root.innerHTML = '<p class="muted">Chargement…</p>';
    const result = await api('/api/manager/control/field-codes');
    canCreate = result.canCreate === true;
    const rows = result.data || [];
    const counts = result.counts || {};
    root.innerHTML = `<div class="field-shell">
      <div class="field-card">
        <h2>Générer un code d’inscription terrain</h2>
        <p class="muted">Un code sert <strong>une seule fois</strong>. Il ouvre le formulaire d’inscription du client ; le dossier passe ensuite par la validation du PDG. Il ne donne aucun droit d’administration.</p>
        ${canCreate ? `<div class="field-form">
          <div class="field-row">
            <div class="field-input"><label for="fieldCount">Nombre de codes</label><input id="fieldCount" type="number" min="1" max="25" value="1"></div>
            <div class="field-input"><label for="fieldTtl">Validité (heures)</label><input id="fieldTtl" type="number" min="1" max="720" value="72"></div>
            <div class="field-input"><label for="fieldNote">Note interne</label><input id="fieldNote" maxlength="240" placeholder="Ex. marché de Cocody"></div>
          </div>
          <div><button class="button" type="button" id="fieldGenerate">Générer</button></div>
          <div id="fieldOutput"></div>
        </div>` : `<div class="field-alert warn">Le PDG ne vous a pas encore autorisé à générer des codes terrain. Demandez-lui l’autorisation depuis votre fiche gestionnaire.</div>`}
      </div>

      <div class="field-card">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
          <span class="badge badge-ok">${Number(counts.available || 0)} disponible(s)</span>
          <span class="badge badge-muted">${Number(counts.used || 0)} utilisé(s)</span>
          <span class="badge badge-warn">${Number(counts.expired || 0)} expiré(s)</span>
          <span class="badge badge-danger">${Number(counts.revoked || 0)} révoqué(s)</span>
        </div>
        ${rows.length ? `<div class="field-table-wrap"><table class="field-table">
          <thead><tr><th>Code</th><th>Statut</th><th>Créé le</th><th>Expire le</th><th>Utilisation</th><th></th></tr></thead>
          <tbody>${rows.map((row) => `<tr>
            <td><code>••••-${esc(row.hint)}</code><div class="muted" style="font-size:.76rem">${esc(row.note || '')}</div></td>
            <td>${badge(row.status)}</td>
            <td>${fmtDay(row.createdAt)}</td>
            <td>${fmtDate(row.expiresAt)}</td>
            <td>${Number(row.uses)}/${Number(row.maxUses)}</td>
            <td>${row.status === 'available' && canCreate ? `<button class="button button-danger button-small" type="button" data-revoke="${esc(row.id)}">Révoquer</button>` : ''}</td>
          </tr>`).join('')}</tbody></table></div>`
          : '<div class="field-empty">Vous n’avez encore généré aucun code.</div>'}
      </div>
    </div>`;

    $('#fieldGenerate')?.addEventListener('click', async () => {
      try {
        const body = { count: Number($('#fieldCount').value) || 1, ttlHours: Number($('#fieldTtl').value) || 72, note: $('#fieldNote').value };
        const created = await api('/api/manager/control/field-codes', { method: 'POST', body });
        const codes = created.data?.codes || [];
        $('#fieldOutput').innerHTML = `<div class="field-alert ok">Notez ces codes maintenant : ils ne seront plus jamais affichés.</div>
          ${codes.map((code) => `<div class="code-card"><code>${esc(code.code)}</code>
            <span class="muted" style="font-size:.78rem">valable jusqu’au ${fmtDate(code.expiresAt)}</span>
            <button class="button button-secondary button-small" type="button" data-copy="${esc(code.code)}">Copier</button>
            <button class="button button-small" type="button" data-open-form="${esc(code.code)}">Ouvrir le formulaire</button></div>`).join('')}`;
        $$('[data-copy]').forEach((button) => button.addEventListener('click', () => {
          navigator.clipboard?.writeText(button.dataset.copy).then(() => notify('Code copié.')).catch(() => notify('Copie impossible : notez le code affiché.'));
        }));
        $$('[data-open-form]').forEach((button) => button.addEventListener('click', () => openForm(button.dataset.openForm)));
        notify(`${codes.length} code(s) généré(s).`);
      } catch (error) { notify(error.message); }
    });
    $$('[data-revoke]').forEach((button) => button.addEventListener('click', async () => {
      const reason = window.prompt('Motif de la révocation ?', 'Code non utilisé') || '';
      if (!reason) return;
      try { await api(`/api/manager/control/field-codes/${button.dataset.revoke}/revoke`, { method: 'POST', body: { reason } }); notify('Code révoqué : il est immédiatement inutilisable.'); await renderCodes(); }
      catch (error) { notify(error.message); }
    }));
  }

  // ------------------------------------------------------------------ validation terrain
  function openForm(code) {
    window.open(`/devenir-marchand?code=${encodeURIComponent(code)}`, '_blank', 'noopener');
  }

  async function renderTerrain() {
    root.innerHTML = '<p class="muted">Chargement…</p>';
    const history = await api('/api/manager/control/field-codes/history').catch(() => ({ data: [] }));
    const codes = await api('/api/manager/control/field-codes?status=available').catch(() => ({ data: [] }));
    const rows = history.data || [];
    const available = codes.data || [];
    root.innerHTML = `<div class="field-shell">
      <div class="field-card">
        <h2>Validation terrain</h2>
        <p class="muted">Saisissez le code que vous avez généré, puis ouvrez le formulaire sur l’appareil du client. Le code est consommé à l’envoi de la demande.</p>
        <div class="field-form">
          <div class="field-row">
            <div class="field-input"><label for="terrainCode">Code d’inscription</label><input id="terrainCode" maxlength="20" placeholder="OY-XXXX-XXXX" autocomplete="off"></div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="button" type="button" id="terrainCheck">Vérifier le code</button>
            <button class="button button-secondary" type="button" id="terrainOpen" disabled>Ouvrir le formulaire</button>
          </div>
          <div id="terrainStatus"></div>
        </div>
        ${available.length ? `<div style="margin-top:14px"><span class="muted" style="font-size:.8rem">Vos codes encore disponibles :</span>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${available.map((code) => `<button class="button button-quiet button-small" type="button" data-use-code="${esc(code.hint)}">••••-${esc(code.hint)}</button>`).join('')}</div></div>` : ''}
      </div>

      <div class="field-card">
        <h2>Mes inscriptions terrain</h2>
        ${rows.length ? `<div class="field-table-wrap"><table class="field-table">
          <thead><tr><th>Date</th><th>Établissement</th><th>Contact</th><th>Dossier</th><th>Statut</th></tr></thead>
          <tbody>${rows.map((row) => `<tr><td>${fmtDate(row.usedAt)}</td><td>${esc(row.businessName || '—')}</td>
            <td>${esc(row.phone || row.contactName || '—')}</td><td>${esc(row.reference || '—')}</td>
            <td>${esc(row.status || 'pending')}</td></tr>`).join('')}</tbody></table></div>`
          : '<div class="field-empty">Aucune inscription réalisée avec vos codes pour le moment.</div>'}
      </div>
    </div>`;

    let verified = false;
    const status = (message, tone = 'warn') => { $('#terrainStatus').innerHTML = message ? `<div class="field-alert ${tone}">${esc(message)}</div>` : ''; };
    $('#terrainCheck').addEventListener('click', async () => {
      const code = $('#terrainCode').value.trim().toUpperCase();
      if (!code) { status('Saisissez un code.', 'error'); return; }
      status('Vérification…');
      try {
        const result = await api('/api/public/field-codes/check', { method: 'POST', body: { code } });
        verified = true;
        $('#terrainOpen').disabled = false;
        status(`Code valide${result.data.managerLabel ? ` — ${result.data.managerLabel}` : ''}. Ouvrez le formulaire sur l’appareil du client.`, 'ok');
      } catch (error) { verified = false; $('#terrainOpen').disabled = true; status(error.message, 'error'); }
    });
    $('#terrainOpen').addEventListener('click', () => { if (verified) openForm($('#terrainCode').value.trim().toUpperCase()); });
    $$('[data-use-code]').forEach((button) => button.addEventListener('click', () => {
      $('#terrainCode').value = `••••-${button.dataset.useCode}`.replace('••••-', '');
      $('#terrainCode').value = '';
      status('Les codes complets ne sont affichés qu’à leur création. Saisissez ou collez le code complet.', 'warn');
    }));
  }

  window.QRIAManagerField = {
    async mount({ root: mountRoot, view = 'codes', notify: notifyFn } = {}) {
      injectStyle();
      root = mountRoot || document.getElementById('managerFieldRoot');
      if (!root) return;
      if (typeof notifyFn === 'function') notify = notifyFn;
      try { if (view === 'terrain') await renderTerrain(); else await renderCodes(); }
      catch (error) { root.innerHTML = `<div class="field-alert error">${esc(error.message)}</div>`; }
    },
  };
})();
