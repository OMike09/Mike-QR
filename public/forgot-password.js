// ============================================================================================
// Mission 9 — « Mot de passe oublié ? » et connexion par code provisoire.
//
// Aucun numéro de téléphone n'est inventé : les coordonnées affichées viennent uniquement de la
// base (réglages du PDG). Si aucune coordonnée n'est enregistrée, l'interface le dit clairement.
// Le code provisoire est vérifié et consommé par le SERVEUR ; cette fenêtre ne décide rien.
// ============================================================================================
(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function dialog() { return $('#forgotDialog'); }
  function openDialog(view) {
    const node = dialog();
    if (!node) return;
    node.hidden = false;
    node.dataset.view = view || 'help';
    node.setAttribute('aria-hidden', 'false');
    render();
  }
  function closeDialog() {
    const node = dialog();
    if (!node) return;
    node.hidden = true;
    node.setAttribute('aria-hidden', 'true');
    const error = $('#forgotError'); if (error) { error.hidden = true; error.textContent = ''; }
  }

  async function contacts() {
    try {
      const response = await fetch('/api/public/support/contacts', { credentials: 'same-origin' });
      return (await response.json().catch(() => ({})))?.data || { contacts: [], message: '', notice: '' };
    } catch (_) { return { contacts: [], message: '', notice: '' }; }
  }

  async function render() {
    const node = dialog();
    if (!node) return;
    const body = $('#forgotBody');
    if (!body) return;
    const view = node.dataset.view || 'help';
    const accountLabel = node.dataset.account === 'manager' ? 'gestionnaire' : 'marchand';

    if (view === 'help') {
      const data = await contacts();
      const list = (data.contacts || []).map((contact) => `<li><a href="${esc(contact.href)}">${esc(contact.label)} : ${esc(contact.value)}</a></li>`).join('');
      body.innerHTML = `
        <h2 id="forgotTitle">Mot de passe oublié</h2>
        <p class="forgot-lead">Vous avez oublié votre mot de passe ? Pour réinitialiser votre accès, veuillez contacter le gestionnaire qui a créé votre compte ou l’Administrateur général.</p>
        <div class="forgot-block">
          <h3>Contacter le gestionnaire responsable du compte</h3>
          <p class="muted">Le gestionnaire qui a créé votre compte peut émettre un code provisoire, utilisable une seule fois.</p>
        </div>
        <div class="forgot-block">
          <h3>Contacter l’Administrateur général</h3>
          ${list ? `<ul class="forgot-contacts">${list}</ul>`
            : `<p class="message warn">${esc(data.notice || 'Les coordonnées n’ont pas encore été renseignées par l’Administrateur général.')}</p>`}
        </div>
        <p class="forgot-note">Pour des raisons de sécurité, aucun mot de passe ne peut être envoyé automatiquement, et personne ne vous demandera votre ancien mot de passe.</p>
        <div class="forgot-actions">
          <button class="button primary" type="button" id="forgotUseCode">J’ai un code provisoire</button>
          <button class="button outline" type="button" id="forgotClose">Fermer</button>
        </div>`;
      $('#forgotUseCode')?.addEventListener('click', () => { node.dataset.view = 'code'; render(); });
    } else {
      body.innerHTML = `
        <h2 id="forgotTitle">Connexion avec un code provisoire</h2>
        <p class="forgot-lead">Saisissez le code remis par le gestionnaire ou l’Administrateur général (exemple : CG-A2Z4TD), puis choisissez votre nouveau mot de passe à 6 chiffres.</p>
        <label for="forgotCode">Code provisoire</label>
        <input id="forgotCode" maxlength="12" autocomplete="one-time-code" placeholder="INITIALES-XXXXXX">
        <label for="forgotPassword">Nouveau mot de passe (6 chiffres)</label>
        <input id="forgotPassword" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" placeholder="••••••">
        <label for="forgotConfirm">Confirmer le mot de passe</label>
        <input id="forgotConfirm" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" placeholder="••••••">
        <p class="message error" id="forgotError" role="alert" hidden></p>
        <div class="forgot-actions">
          <button class="button primary" type="button" id="forgotSubmit">Valider le code</button>
          <button class="button outline" type="button" id="forgotBack">Retour</button>
          <button class="button quiet" type="button" id="forgotClose2">Fermer</button>
        </div>`;
      $('#forgotBack')?.addEventListener('click', () => { node.dataset.view = 'help'; render(); });
      $('#forgotClose2')?.addEventListener('click', closeDialog);
      $('#forgotSubmit')?.addEventListener('click', submitCode);
      $('#forgotCode')?.addEventListener('input', (event) => {
        const clean = event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
        if (clean !== event.target.value) event.target.value = clean;
      });
      ['#forgotPassword', '#forgotConfirm'].forEach((selector) => {
        $(selector)?.addEventListener('input', (event) => {
          const clean = event.target.value.replace(/\D/g, '').slice(0, 6);
          if (clean !== event.target.value) event.target.value = clean;
        });
      });
      $('#forgotCode')?.focus();
    }
  }

  async function submitCode() {
    const error = $('#forgotError');
    const button = $('#forgotSubmit');
    error.hidden = true;
    const code = String($('#forgotCode').value || '').trim().toUpperCase();
    const password = String($('#forgotPassword').value || '');
    const confirmPassword = String($('#forgotConfirm').value || '');
    if (!code) { error.textContent = 'Saisissez le code provisoire.'; error.hidden = false; return; }
    if (!/^\d{6}$/.test(password)) { error.textContent = 'Choisissez un mot de passe de 6 chiffres.'; error.hidden = false; return; }
    if (password !== confirmPassword) { error.textContent = 'Les deux mots de passe ne correspondent pas.'; error.hidden = false; return; }
    button.disabled = true; button.textContent = 'Vérification…';
    try {
      const response = await fetch('/api/public/access-reset/redeem', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, password, confirmPassword }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { const failure = new Error(data.error || `Erreur ${response.status}`); error.textContent = failure.message; error.hidden = false; return; }
      const body = $('#forgotBody');
      body.innerHTML = `<h2>Code accepté</h2>
        <p class="message ok">Votre accès est réinitialisé. Connectez-vous avec votre identifiant <strong>${esc(data.username || '')}</strong> et le mot de passe que vous venez de choisir.</p>
        <p class="muted">À cette connexion, le système vous demandera d’en choisir un nouveau, personnel : c’est la dernière étape.</p>
        <div class="forgot-actions"><a class="button primary" href="${esc(data.loginPath || '/merchant/')}">Aller à la connexion</a></div>`;
    } catch (_) {
      error.textContent = 'Connexion impossible. Vérifiez votre réseau puis réessayez.'; error.hidden = false;
    } finally {
      if (button.isConnected) { button.disabled = false; button.textContent = 'Valider le code'; }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('click', (event) => {
      const trigger = event.target.closest?.('[data-forgot-password]');
      if (trigger) { event.preventDefault(); openDialog(trigger.dataset.forgotPassword || 'help'); return; }
      if (event.target.closest?.('[data-forgot-close]') || event.target === dialog()) closeDialog();
    });
    document.addEventListener('click', (event) => {
      if (event.target.id === 'forgotClose') closeDialog();
    });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && dialog() && !dialog().hidden) closeDialog(); });
  });

  window.QRIAForgotPassword = { open: openDialog, close: closeDialog };
})();
