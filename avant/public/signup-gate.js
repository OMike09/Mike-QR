// Fenêtre indépendante « Code d'autorisation d'inscription ».
// Aucun formulaire d'inscription n'est accessible avant la vérification du code.
// La vérification NE consomme PAS le code : elle pose une réservation de 15 minutes côté serveur.
(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const GATE = '#codeGate', FORM = '#signupForm', FORM_CARD = '#formCard';
  const TOKEN_KEY = 'oymike-signup-reservation';
  const CODE_KEY = 'oymike-signup-reserved-code';

  const state = { token: '', code: '', busy: false, verifiedAt: 0 };

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function status(message, tone = 'warn') {
    const node = $('#gateStatus');
    if (!node) return;
    node.className = `message ${tone}`;
    node.textContent = message || '';
    node.hidden = !message;
  }
  function fatal(message) {
    const node = $('#gateFatal');
    if (!node) return;
    node.textContent = message || '';
    node.hidden = !message;
    $('#gateFormRow').hidden = Boolean(message);
  }
  async function post(url, body) {
    const response = await fetch(url, { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || `Erreur ${response.status}`); error.code = data.code || ''; throw error; }
    return data;
  }

  function lockForm() {
    // Le formulaire reste dans le document (aucune perte de saisie) mais il n'est ni visible
    // ni soumissible tant que le code n'est pas vérifié.
    const card = $(FORM_CARD);
    if (card) { card.setAttribute('data-locked', 'true'); card.hidden = true; }
    const form = $(FORM);
    if (form) {
      form.querySelectorAll('input, select, textarea, button').forEach((node) => { node.disabled = true; });
    }
  }
  function unlockForm() {
    const card = $(FORM_CARD);
    if (card) { card.removeAttribute('data-locked'); card.hidden = false; }
    const form = $(FORM);
    if (form) form.querySelectorAll('input, select, textarea, button').forEach((node) => { node.disabled = false; });
    $('#codeGate').hidden = true;
    window.dispatchEvent(new CustomEvent('signup:unlocked'));
  }

  function reservationValid() {
    return Boolean(state.token) && Date.now() - state.verifiedAt < 14 * 60_000;
  }

  async function verify() {
    if (state.busy) return;
    const code = String($('#gateCode')?.value || '').trim().toUpperCase();
    if (!code) { status('Saisissez le code remis par votre gestionnaire.', 'error'); return; }
    state.busy = true;
    const button = $('#gateVerify');
    button.disabled = true; button.textContent = 'Vérification…';
    status('Vérification du code…', 'warn');
    try {
      const result = await post('/api/public/field-codes/reserve', { code });
      state.token = result.data.token;
      state.code = result.data.code || code;
      state.verifiedAt = Date.now();
      try {
        sessionStorage.setItem(TOKEN_KEY, state.token);
        sessionStorage.setItem(CODE_KEY, state.code);
      } catch (_) {}
      fatal('');
      const manager = result.data.managerLabel;
      status(`Code valide${manager ? ` — gestionnaire ${manager}` : ''}. Le formulaire s’ouvre : il ne sera consommé qu’à l’envoi de votre dossier.`, 'ok');
      const banner = $('#fieldBanner');
      if (banner) {
        banner.hidden = false;
        $('#fieldBannerText').innerHTML = `Inscription ouverte par <strong>${esc(manager || 'l’Administrateur général')}</strong>.`
          + ` Réservation valable ${result.data.reservedForMinutes || 15} minutes — vous pouvez revenir plus tard sans perdre votre saisie.`;
      }
      unlockForm();
    } catch (error) {
      state.token = '';
      status(error.message, 'error');
    } finally {
      state.busy = false;
      button.disabled = false; button.textContent = 'Vérifier le code';
    }
  }

  // Le formulaire transmet la réservation : c'est la preuve que la même personne consomme le code.
  window.QRIASignupGate = {
    get token() { return reservationValid() ? state.token : ''; },
    get code() { return state.code; },
    invalidate() {
      state.token = ''; state.code = ''; state.verifiedAt = 0;
      try { sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(CODE_KEY); } catch (_) {}
      lockForm();
      const gate = $(GATE);
      if (gate) gate.hidden = false;
      status('Ce code n’est plus utilisable. Saisissez un nouveau code pour continuer.', 'error');
    },
  };

  document.addEventListener('DOMContentLoaded', () => {
    if (!$(GATE)) return;
    // Reprise : si la personne revient sur la page pendant la réservation, elle retrouve sa place.
    let resumed = false;
    try {
      const token = sessionStorage.getItem(TOKEN_KEY) || '';
      const code = sessionStorage.getItem(CODE_KEY) || '';
      if (token && code) {
        state.token = token; state.code = code; state.verifiedAt = Date.now();
        const banner = $('#fieldBanner');
        if (banner) { banner.hidden = false; $('#fieldBannerText').innerHTML = 'Réservation active : vous pouvez compléter votre dossier. Il ne sera consommé qu’à l’envoi.'; }
        resumed = true;
      }
    } catch (_) {}
    // Par défaut, AUCUN formulaire : la fenêtre de code est affichée et le formulaire est verrouillé.
    if (resumed) unlockForm();
    else {
      $('#codeGate').hidden = false;
      lockForm();
    }
    $('#gateVerify')?.addEventListener('click', verify);
    // Lien transmis par le gestionnaire (/devenir-marchand?code=OY-XXXX-XXXX) : le code est
    // pré-rempli et vérifié immédiatement. S'il est invalide, la fenêtre reste ouverte avec le
    // message d'erreur — le formulaire n'est jamais déverrouillé par un simple paramètre d'URL.
    let shared = '';
    try { shared = String(new URLSearchParams(location.search).get('code') || '').trim().toUpperCase(); } catch (_) {}
    if (!resumed && /^OY-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(shared) && $('#gateCode')) {
      $('#gateCode').value = shared;
      verify();
    }
    $('#gateCode')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); verify(); } });
    $('#gateCode')?.addEventListener('input', (event) => {
      const input = event.target;
      const clean = input.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
      if (clean !== input.value) input.value = clean;
      fatal('');
    });
  });
})();
