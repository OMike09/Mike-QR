'use strict';

// ============================================================================================
// MISSION 15 — BOUTON « ACTUALISER » (marchand, gérant, serveuse/serveur)
//
// Ce module ne recharge JAMAIS la page : il redemande au serveur les données utiles et laisse
// chaque écran se redessiner. Conséquences voulues :
//   · pas de retour forcé en haut (aucune navigation, aucun scrollTo) ;
//   · pas de perte du formulaire en cours (le DOM des formulaires n'est pas reconstruit) ;
//   · pas de déconnexion (aucun appel d'authentification) ;
//   · pas de duplication (aucune écriture : uniquement des GET).
//
// Chaque module livre ses fonctions de rafraîchissement dans `window.__wsRefreshHandlers`
// ({ label, run() }). Un écran absent ou en erreur ne bloque pas les autres.
// ============================================================================================

(() => {
  'use strict';

  const handlers = new Map();
  let busy = false;
  let lastRun = 0;

  function register(key, label, run) {
    if (typeof run !== 'function') return;
    handlers.set(key, { label, run });
  }

  function buttons() {
    return [...document.querySelectorAll('[data-ws-refresh]')];
  }

  /** Position du curseur de défilement, pour la restaurer si un écran la déplace. */
  function scrollState() {
    return { x: window.scrollX, y: window.scrollY };
  }

  function setBusy(value, message) {
    busy = value;
    buttons().forEach((button) => {
      button.disabled = value;
      button.classList.toggle('is-busy', value);
      button.setAttribute('aria-busy', value ? 'true' : 'false');
      const label = button.querySelector('[data-ws-refresh-label]');
      if (label) label.textContent = value ? 'Actualisation…' : 'Actualiser';
      const icon = button.querySelector('[data-ws-refresh-icon]');
      if (icon) icon.classList.toggle('is-spinning', value);
    });
    const status = document.querySelector('[data-ws-refresh-status]');
    if (status) {
      if (message) { status.textContent = message; status.hidden = false; status.dataset.tone = message.tone || ''; }
      else if (!value) { /* le message reste affiché quelques secondes, voir plus bas */ }
    }
  }

  function announce(message, tone = '') {
    const status = document.querySelector('[data-ws-refresh-status]');
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
    status.hidden = false;
    window.clearTimeout(announce.timer);
    announce.timer = window.setTimeout(() => { status.hidden = true; }, 4000);
  }

  async function refresh({ silent = false } = {}) {
    if (busy) return { ok: false, reason: 'busy' };
    // Anti-rebond : deux clics rapprochés ne déclenchent qu'une passe.
    if (Date.now() - lastRun < 400) return { ok: false, reason: 'throttled' };
    lastRun = Date.now();
    const before = scrollState();
    const jobs = [...handlers.entries()];
    setBusy(true);
    let failures = 0;
    // En parallèle : le temps perçu reste court même si un écran est lent.
    await Promise.all(jobs.map(async ([key, handler]) => {
      try { await handler.run(); }
      catch (error) { failures += 1; console.warn('Actualisation — échec de', key, error?.message || error); }
    }));
    setBusy(false);
    // On remet le défilement là où il était (un écran qui se redessine peut le décaler).
    if (window.scrollX !== before.x || window.scrollY !== before.y) window.scrollTo(before.x, before.y);
    window.dispatchEvent(new CustomEvent('workspace:refreshed', { detail: { failures, at: Date.now() } }));
    if (!silent) {
      if (failures) announce('Actualisation partielle : certaines données n’ont pas pu être rechargées.', 'error');
      else announce('Données à jour.', 'ok');
    }
    return { ok: failures === 0, failures };
  }

  function bind() {
    if (bind.done) return;
    bind.done = true;
    document.addEventListener('click', (event) => {
      const button = event.target.closest?.('[data-ws-refresh]');
      if (!button) return;
      event.preventDefault();
      refresh().catch(() => announce('Actualisation impossible pour le moment.', 'error'));
    });
    // Raccourci clavier discret, utile sur ordinateur.
    document.addEventListener('keydown', (event) => {
      if (event.key === 'F5' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r')) return; // laisser le navigateur
      if (event.key.toLowerCase() === 'r' && event.altKey) { event.preventDefault(); refresh(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();

  window.WorkspaceRefresh = { register, refresh, announce, isBusy: () => busy, handlers };
})();
