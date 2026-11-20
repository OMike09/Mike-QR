(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const token = (() => {
    // The token travels in the fragment so it never reaches server logs or the Referer header.
    const hash = String(location.hash || '').replace(/^#/, '');
    const value = new URLSearchParams(hash).get('token') || '';
    try { history.replaceState(null, '', location.pathname); } catch (_) {}
    return value;
  })();
  const stateNode = $('#tokenState');
  const message = $('#resetMessage');
  const show = (text, ok = false) => { message.textContent = text; message.className = `message${ok ? ' success' : ' error'}`; message.hidden = !text; };
  const valid = /^[A-Za-z0-9_-]{40,64}$/.test(token);
  stateNode.textContent = valid ? 'Lien reçu — choisissez votre nouveau mot de passe.' : 'Lien absent ou incomplet.';
  stateNode.className = `token-state ${valid ? 'ok' : 'bad'}`;
  if (!valid) { $('#resetForm').hidden = true; }
  for (const button of document.querySelectorAll('[data-toggle-password]')) button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.togglePassword); if (!input) return;
    const shown = input.type === 'password'; input.type = shown ? 'text' : 'password';
    button.textContent = shown ? 'Masquer' : 'Afficher';
  });
  $('#resetForm').addEventListener('submit', async (event) => {
    event.preventDefault(); show('');
    const password = $('#resetPassword').value; const confirmPassword = $('#resetConfirm').value;
    if (password.length < 12) return show('Le nouveau mot de passe doit contenir au moins 12 caractères.');
    if (password !== confirmPassword) return show('Les deux mots de passe ne correspondent pas.');
    const button = $('#resetSubmit'); button.disabled = true; button.textContent = 'Enregistrement…';
    try {
      const response = await fetch('/api/merchant/auth/reset-password', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password, confirmPassword }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `Erreur ${response.status}`);
      show(result.authenticated ? 'Mot de passe enregistré. Ouverture de votre espace marchand…' : 'Mot de passe enregistré. Vous pouvez vous connecter.', true);
      window.location.assign(result.authenticated ? '/merchant/' : '/merchant/');
    } catch (error) {
      show(error.message || 'La réinitialisation a échoué.');
      button.disabled = false; button.textContent = 'Enregistrer et me connecter';
    }
  });
})();
