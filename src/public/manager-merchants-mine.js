// ============================================================================================
// Mission 9 — Espace gestionnaire
//   • « Mes marchands »      : les marchands créés avec SES codes, consultation à distance.
//   • « Codes d'inscription »: bouton « Générer un code unique d'inscription », historique complet.
//   • « Mot de passe oublié »: réinitialisation des comptes qu'il a lui-même créés.
//
// Aucun contrôle de droits ici : chaque bouton n'est proposé que si le serveur l'autorise, et
// chaque action est revalidée par le serveur (permissions, périmètre, quotas).
// ============================================================================================
(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dateTime = (value) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(d); };
  const day = (value) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(d); };
  const statusLabels = { available: 'Disponible', used: 'Utilisé', expired: 'Expiré', revoked: 'Révoqué', active: 'Actif', suspended: 'Suspendu', blocked: 'Bloqué' };
  const state = { merchants: [], codes: [], selected: '', loaded: false, lastCode: null };

  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || `Erreur ${response.status}`); error.code = data.code || ''; error.status = response.status; throw error; }
    return data;
  }
  function notify(message) { if (typeof window.QRIAManagerToast === 'function') window.QRIAManagerToast(message); }

  // ------------------------------------------------------------------ « Mes marchands »
  async function loadMerchants() {
    const root = $('#managerMyMerchantsRoot');
    if (!root) return;
    try {
      const result = await api('/api/manager/my-merchants');
      state.merchants = result.data || [];
      state.loaded = true;
      renderMerchants();
    } catch (error) {
      root.innerHTML = `<p class="message error">${esc(error.message)}</p>`;
    }
  }

  function renderMerchants() {
    const root = $('#managerMyMerchantsRoot');
    if (!root) return;
    if (!state.merchants.length) {
      root.innerHTML = `<div class="mine-empty">
        <p><strong>Aucun marchand pour le moment.</strong></p>
        <p>Les marchands que vous inscrivez avec un de vos codes apparaissent ici automatiquement, avec leur boutique et leur QR.</p>
        <button class="button" type="button" data-mine-go="codes">Générer un code unique d’inscription</button>
      </div>`;
      $$('[data-mine-go]', root).forEach((button) => button.addEventListener('click', () => go(button.dataset.mineGo)));
      return;
    }
    root.innerHTML = `<div class="mine-grid">${state.merchants.map((merchant) => `<article class="mine-card" data-merchant="${esc(merchant.id)}">
      <header><div><strong>${esc(merchant.store?.name || merchant.displayName)}</strong><small>${esc(merchant.displayName)} · @${esc(merchant.username)}</small></div>
        <span class="state-pill ${merchant.status === 'active' ? 'ok' : 'warn'}">${esc(statusLabels[merchant.status] || merchant.status)}</span></header>
      <div class="mine-meta">
        <span>${merchant.phone ? esc(merchant.phone) : 'Téléphone non renseigné'}</span>
        <span>Créé le ${day(merchant.createdAt)}</span>
        <span>${merchant.store ? (merchant.store.isPublished ? 'Boutique publiée' : 'Boutique non publiée') : 'Pas encore de boutique'}</span>
        <span>${merchant.store?.qrPublicCode ? `QR : ${merchant.store.qrEnabled ? 'actif' : 'désactivé'}` : 'QR non activé'}</span>
      </div>
      <div class="mine-actions">
        <button class="button button-secondary" type="button" data-open="${esc(merchant.id)}">Ouvrir la fiche</button>
        <button class="button button-secondary" type="button" data-reset="${esc(merchant.id)}">Réinitialiser son accès</button>
        ${merchant.store?.slug ? `<a class="button button-quiet" href="/s/${esc(merchant.store.slug)}" target="_blank" rel="noopener">Voir la boutique</a>` : ''}
      </div>
      <p class="mine-ownership">${esc(merchant.ownership || '')}</p>
      <div class="mine-detail" data-detail="${esc(merchant.id)}" hidden></div>
    </article>`).join('')}</div>`;
    $$('[data-open]', root).forEach((button) => button.addEventListener('click', () => openDetail(button.dataset.open)));
    $$('[data-reset]', root).forEach((button) => button.addEventListener('click', () => resetAccess(button.dataset.reset)));
  }

  async function openDetail(id) {
    const box = $(`[data-detail="${id}"]`);
    if (!box) return;
    if (!box.hidden) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<p class="muted">Chargement…</p>';
    try {
      const [detail, activity] = await Promise.all([
        api(`/api/manager/my-merchants/${encodeURIComponent(id)}`),
        api(`/api/manager/my-merchants/${encodeURIComponent(id)}/activity`).catch(() => ({ data: [] })),
      ]);
      const merchant = detail.data;
      const permissions = merchant.permissions || {};
      const permLabels = [['canManageStore', 'Informations de boutique'], ['canManageProducts', 'Produits et prix'],
        ['canManageOrders', 'Commandes'], ['canCreateStoreQr', 'QR de boutique'], ['canViewAudit', 'Journal commercial']];
      box.innerHTML = `<div class="mine-detail-grid">
        <div>
          <h4>Établissement</h4>
          <p><strong>${esc(merchant.store?.name || '—')}</strong><br>${esc(merchant.store?.description || '')}</p>
          <p class="muted small-note">${merchant.store?.slug ? `Adresse publique : /s/${esc(merchant.store.slug)}` : 'Aucune adresse publique.'}</p>
          <h4>QR code</h4>
          <p>${merchant.store?.qrPublicCode ? `Code ${esc(merchant.store.qrPublicCode)} — ${merchant.store.qrEnabled ? 'activé' : 'désactivé'}` : 'Non encore activé par l’Administrateur général.'}</p>
          <h4>Accompagnement autorisé</h4>
          <p>${permLabels.map(([key, label]) => `${permissions[key] ? '✔' : '—'} ${label}`).join('<br>')}</p>
          <p class="mine-ownership">Le gestionnaire ne devient pas propriétaire du compte. Chaque intervention est tracée et le marchand peut la consulter.</p>
        </div>
        <div>
          <h4>Équipe du marchand (${(merchant.team || []).length})</h4>
          ${(merchant.team || []).length ? `<div class="mine-team">${merchant.team.map((member) => `<div class="mine-team-row">
            <span>${esc(member.fullName)}</span><small>${esc(member.role === 'general_manager' ? 'Gérant général' : 'Serveuse / Serveur')} · ${esc(statusLabels[member.status] || member.status)}</small></div>`).join('')}</div>`
            : '<p class="muted">Aucun compte d’équipe pour le moment.</p>'}
          <h4>Vos interventions sur ce marchand</h4>
          ${(activity.data || []).length ? `<div class="mine-activity">${(activity.data || []).slice(0, 12).map((row) => `<div><span>${dateTime(row.createdAt)}</span><span>${esc(row.summary || row.action || '')}</span></div>`).join('')}</div>`
            : '<p class="muted">Aucune intervention tracée.</p>'}
        </div>
      </div>`;
    } catch (error) {
      box.innerHTML = `<p class="message error">${esc(error.message)}</p>`;
    }
  }

  async function resetAccess(id) {
    const merchant = state.merchants.find((row) => row.id === id);
    if (!merchant) return;
    const reason = window.prompt(`Réinitialiser l’accès de ${merchant.displayName} ?\nCes comptes sont vérifiés côté serveur : vous ne pouvez réinitialiser qu’un marchand que vous avez vous-même créé.\n\nMotif (facultatif) :`, 'Marchand a oublié son mot de passe') ?? null;
    if (reason === null) return;
    try {
      // Le serveur joint au code provisoire un mot de passe à 6 chiffres : la personne peut soit
      // passer par « Mot de passe oublié ? », soit se connecter directement.
      const result = await api('/api/manager/access-resets', { method: 'POST', body: JSON.stringify({ accountType: 'merchant', accountId: id, reason }) });
      showCode(result.data, result.notice);
    } catch (error) { notify(error.message); }
  }

  function showCode(data, notice) {
    const box = $('#managerAccessCodeBox');
    if (!box) return;
    box.hidden = false;
    box.innerHTML = `<h3>Code provisoire pour ${esc(data.accountLabel || '')}</h3>
      <p class="muted small-note">${esc(notice || 'Ce code n’est affiché qu’une fois.')}</p>
      <div class="code-card"><code>${esc(data.code)}</code>
        <span class="muted">Code provisoire → « Mot de passe oublié ? » sur la connexion</span>
        <button class="button button-secondary button-small" type="button" data-copy-code>Copier</button></div>
      ${data.temporaryPassword ? `<div class="code-card"><code>${esc(data.temporaryPassword)}</code>
        <span class="muted">Mot de passe à 6 chiffres → connexion directe</span>
        <button class="button button-secondary button-small" type="button" data-copy-pin>Copier</button></div>` : ''}
      <p class="small-note">Identifiant : ${esc(data.username || '—')} · valable jusqu’au ${dateTime(data.expiresAt)}. Les deux valeurs fonctionnent ; un nouveau mot de passe personnel sera demandé à la connexion.</p>`;
    box.querySelector('[data-copy-code]')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(data.code); notify('Code copié.'); } catch (_) { window.prompt('Copiez ce code :', data.code); }
    });
    box.querySelector('[data-copy-pin]')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(data.temporaryPassword); notify('Mot de passe copié.'); } catch (_) { window.prompt('Copiez ce mot de passe :', data.temporaryPassword); }
    });
  }

  // ------------------------------------------------------------------ Codes d'inscription
  async function loadCodes() {
    const root = $('#managerSignupCodeRoot');
    if (!root) return;
    try {
      const [result, history] = await Promise.all([api('/api/manager/signup-codes'), api('/api/manager/control/field-codes/history').catch(() => ({ data: [] }))]);
      state.codes = result.data || [];
      renderCodes(result.canCreate === true, history.data || []);
    } catch (error) {
      root.innerHTML = `<p class="message error">${esc(error.message)}</p>`;
    }
  }

  function renderCodes(canCreate, history) {
    const root = $('#managerSignupCodeRoot');
    if (!root) return;
    const pending = state.codes.filter((row) => row.status === 'available');
    root.innerHTML = `<div class="mine-codes">
      <div class="mine-codes-head">
        <div>
          <h3>Génération de codes uniques</h3>
          <p class="muted small-note">Un code ouvre la fenêtre d’inscription d’un seul futur marchand, une seule fois. Il est associé à votre identité et le marchand vous sera automatiquement rattaché.</p>
        </div>
        ${canCreate ? '<button class="button" type="button" id="managerGenerateCode">Générer un code unique d’inscription</button>'
          : '<span class="badge badge-warn">Génération non autorisée par l’Administrateur général</span>'}
      </div>
      ${canCreate ? `<div class="mine-form-row">
        <label>Validité du code
          <select id="managerCodeTtl"><option value="1">1 heure</option><option value="24" selected>24 heures</option><option value="72">72 heures</option><option value="168">7 jours</option></select>
        </label>
        <label>Places gérant général <input id="managerQuotaGm" type="number" min="1" max="50" value="1"></label>
        <label>Places serveuse <input id="managerQuotaWt" type="number" min="0" max="100" value="2"></label>
      </div>` : ''}
      <div id="managerCodeOutput"></div>
      <div class="mine-codes-list">
        <h4>Mes codes (${state.codes.length})</h4>
        ${state.codes.length ? `<div class="mine-table-wrap"><table class="mine-table">
          <thead><tr><th>Code</th><th>Généré le</th><th>Expire le</th><th>Statut</th><th>Inscrit</th><th></th></tr></thead>
          <tbody>${state.codes.map((row) => `<tr>
            <td><code>••••-${esc(row.hint)}</code></td>
            <td>${dateTime(row.createdAt)}</td>
            <td>${dateTime(row.expiresAt)}</td>
            <td><span class="state-pill ${row.status === 'available' ? 'ok' : row.status === 'used' ? 'warn' : ''}">${esc(statusLabels[row.status] || row.status)}</span></td>
            <td>${row.usedByName ? `${esc(row.usedByName)}<br><small>${esc(row.usedByReference || '')} · ${dateTime(row.usedAt)}</small>` : '—'}</td>
            <td>${row.status === 'available' ? `<button class="button button-danger button-small" type="button" data-revoke-code="${esc(row.id)}">Révoquer</button>` : ''}</td>
          </tr>`).join('')}</tbody></table></div>` : '<p class="muted">Aucun code généré pour le moment.</p>'}
      </div>
      <div class="mine-codes-list">
        <h4>Inscriptions réalisées avec mes codes</h4>
        ${history.length ? `<div class="mine-table-wrap"><table class="mine-table">
          <thead><tr><th>Date</th><th>Établissement</th><th>Contact</th><th>Référence</th><th>Statut</th></tr></thead>
          <tbody>${history.map((row) => `<tr><td>${dateTime(row.usedAt)}</td><td>${esc(row.businessName || '—')}</td>
            <td>${esc(row.phone || row.contactName || '—')}</td><td>${esc(row.reference || '—')}</td>
            <td>${esc(row.status || 'pending')}</td></tr>`).join('')}</tbody></table></div>`
          : '<p class="muted">Aucune inscription avec vos codes pour le moment.</p>'}
        <p class="muted small-note">${pending.length} code(s) encore disponible(s).</p>
      </div>
    </div>`;

    $('#managerGenerateCode')?.addEventListener('click', generateCode);
    $$('[data-revoke-code]', root).forEach((button) => button.addEventListener('click', () => revokeCode(button.dataset.revokeCode)));
    // Le code fraîchement généré reste affiché après le rafraîchissement de l'historique :
    // il n'est plus jamais visible ensuite, donc il ne doit pas disparaître d'un re-rendu.
    if (state.lastCode) renderCodeOutput(state.lastCode);
  }

  function renderCodeOutput(data) {
    const output = $('#managerCodeOutput');
    if (!output || !data) return;
    output.innerHTML = `<div class="field-alert ok">Code généré. Il ne sera plus jamais affiché : transmettez-le maintenant.</div>
      <div class="mine-code-big">
        <code>${esc(data.code)}</code>
        <div class="mine-code-actions">
          <button class="button button-secondary" type="button" data-copy-signup>Copier le code</button>
          <button class="button button-secondary" type="button" data-copy-link>Copier le lien d’inscription</button>
          <button class="button button-quiet" type="button" data-open-signup>Ouvrir le formulaire</button>
        </div>
        <p class="muted small-note">Valable ${esc(String(data.ttlHours))} h, jusqu’au ${dateTime(data.expiresAt)}. Usage unique.</p>
      </div>`;
    output.querySelector('[data-copy-signup]')?.addEventListener('click', () => copy(data.code));
    output.querySelector('[data-copy-link]')?.addEventListener('click', () => copy(data.signupUrl || `${location.origin}${data.signupPath}`));
    output.querySelector('[data-open-signup]')?.addEventListener('click', () => window.open(data.signupPath, '_blank', 'noopener'));
  }

  async function generateCode() {
    const button = $('#managerGenerateCode');
    if (button.disabled) return;
    button.disabled = true; button.textContent = 'Génération…';
    try {
      const result = await api('/api/manager/signup-code', { method: 'POST', body: JSON.stringify({
        ttlHours: Number($('#managerCodeTtl')?.value) || 24,
        teamQuotas: { maxGeneralManagers: Number($('#managerQuotaGm')?.value) || 1, maxWaitresses: Number($('#managerQuotaWt')?.value) || 2 },
      }) });
      const data = result.data;
      state.lastCode = data;
      renderCodeOutput(data);
      notify('Code unique généré.');
      loadCodes().catch(() => {});
    } catch (error) {
      notify(error.message);
    } finally {
      const again = $('#managerGenerateCode');
      if (again) { again.disabled = false; again.textContent = 'Générer un code unique d’inscription'; }
    }
  }

  async function revokeCode(id) {
    const reason = window.prompt('Motif de la révocation ?', 'Retrait du code') ?? null;
    if (!reason) return;
    try {
      await api(`/api/manager/control/field-codes/${encodeURIComponent(id)}/revoke`, { method: 'POST', body: JSON.stringify({ reason }) });
      notify('Code révoqué : il est immédiatement inutilisable.');
      await loadCodes();
    } catch (error) { notify(error.message); }
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); notify('Copié.'); }
    catch (_) { window.prompt('Copiez cette valeur :', text); }
  }

  // ------------------------------------------------------------------ navigation
  function go(view) { if (typeof window.QRIAManagerView === 'function') window.QRIAManagerView(view); }

  function bind() {
    // Le bouton d'onglet déclenche le chargement de la bonne rubrique.
    document.addEventListener('click', (event) => {
      const nav = event.target.closest?.('[data-view="my-merchants"]');
      if (!nav) return;
      const view = nav.dataset.view;
      setTimeout(() => { if (view === 'my-merchants') loadMerchants(); }, 60);
    });
    $('#managerMyMerchantsRefresh')?.addEventListener('click', () => loadMerchants());
    const current = document.querySelector('.view:not([hidden])')?.id || '';
    if (current === 'view-my-merchants') loadMerchants();

  }

  document.addEventListener('DOMContentLoaded', bind);
  window.QRIAManagerMine = { loadMerchants, loadCodes };
})();
