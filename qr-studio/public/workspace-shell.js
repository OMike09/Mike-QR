// Mission 11 — Comportements communs des espaces de travail :
//   1. thème d'apparence (appliqué avant l'arrivée des données, conservé localement en secours) ;
//   2. « Se déconnecter » avec confirmation, placé en bas du menu ;
//   3. bouton « Retour » sur les pages secondaires, sans perte de saisie ;
//   4. historique de navigation (bouton retour du téléphone).
// Aucune permission, aucun rôle, aucune donnée métier n'est lu ni modifié ici.
(() => {
  'use strict';

  const THEME_KEY = 'oymike:interface-theme:v1';
  const THEME_IDS = ['green', 'black-gold', 'blue-white'];
  const root = document.documentElement;

  // ------------------------------------------------------------------ 1. Thème
  function localTheme() {
    try { const value = localStorage.getItem(THEME_KEY); return THEME_IDS.includes(value) ? value : ''; } catch (_) { return ''; }
  }
  function applyTheme(theme, { remember = true } = {}) {
    const safe = THEME_IDS.includes(theme) ? theme : 'green';
    root.setAttribute('data-interface-theme', safe);
    // La barre du navigateur/du téléphone suit l'ambiance choisie.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', safe === 'black-gold' ? '#111214' : (safe === 'blue-white' ? '#1f5fd0' : '#151515'));
    if (remember) { try { localStorage.setItem(THEME_KEY, safe); } catch (_) {} }
    return safe;
  }
  // Appliqué immédiatement, avant le rendu : pas de flash de couleur au chargement.
  applyTheme(localTheme() || 'green', { remember: false });

  // ------------------------------------------------------------------ 2. Déconnexion
  const ICON_LOGOUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3"/><path d="M10 8l-4 4 4 4M6 12h9"/></svg>';
  function ensureDialog() {
    let dialog = document.getElementById('wsLogoutDialog');
    if (dialog) return dialog;
    dialog = document.createElement('div');
    dialog.id = 'wsLogoutDialog';
    dialog.className = 'ws-dialog-backdrop';
    dialog.hidden = true;
    dialog.innerHTML = `
      <div class="ws-dialog" role="alertdialog" aria-modal="true" aria-labelledby="wsLogoutTitle" aria-describedby="wsLogoutText">
        <span class="ws-dialog-icon" aria-hidden="true">${ICON_LOGOUT}</span>
        <h2 id="wsLogoutTitle">Se déconnecter ?</h2>
        <p id="wsLogoutText">Votre session sera fermée sur cet appareil. Vos données, votre historique et vos commandes sont conservés.</p>
        <div class="ws-dialog-actions">
          <button type="button" class="button outline" data-logout-cancel>Rester connecté</button>
          <button type="button" class="button primary" data-logout-confirm>Se déconnecter</button>
        </div>
      </div>`;
    document.body.appendChild(dialog);
    return dialog;
  }

  // `onConfirm` fait le travail réel (appel serveur + retour à l'écran de connexion).
  async function confirmLogout(onConfirm) {
    const dialog = ensureDialog();
    dialog.hidden = false;
    const confirmButton = dialog.querySelector('[data-logout-confirm]');
    const cancelButton = dialog.querySelector('[data-logout-cancel]');
    cancelButton.focus();
    return new Promise((resolve) => {
      const close = (value) => {
        dialog.hidden = true;
        confirmButton.removeEventListener('click', onYes);
        cancelButton.removeEventListener('click', onNo);
        dialog.removeEventListener('keydown', onKey);
        dialog.removeEventListener('click', onBackdrop);
        resolve(value);
      };
      const onYes = async () => { confirmButton.disabled = true; try { await onConfirm(); } finally { confirmButton.disabled = false; close(true); } };
      const onNo = () => close(false);
      const onKey = (event) => { if (event.key === 'Escape') close(false); };
      const onBackdrop = (event) => { if (event.target === dialog) close(false); };
      confirmButton.addEventListener('click', onYes);
      cancelButton.addEventListener('click', onNo);
      dialog.addEventListener('keydown', onKey);
      dialog.addEventListener('click', onBackdrop);
    });
  }

  // Remplace le bouton historique s'il existe, et en ajoute un en bas du menu dans tous les cas.
  function installLogout(button, handler, { label = 'Se déconnecter' } = {}) {
    if (button) {
      button.innerHTML = `${ICON_LOGOUT}<span class="ws-logout-label">${label}</span>`;
      button.classList.add('ws-logout-button');
      button.setAttribute('title', label);
      button.addEventListener('click', (event) => { event.preventDefault(); confirmLogout(handler); });
    }
  }

  // ------------------------------------------------------------------ 3. Retour
  // Historique applicatif minimal : chaque ouverture d'onglet empile une entrée, le bouton
  // « Retour » (et le bouton natif du téléphone) revient à la précédente sans recharger.
  // Pile des vues DÉJÀ visitées, la plus récente en dernier. La vue affichée n'y figure pas :
  // « Retour » reprend la dernière vue de la pile et la retire (comme un vrai retour).
  const historyStack = [];
  let applyingHistory = false;
  function pushView(view) {
    if (applyingHistory || !view) return;
    if (historyStack[historyStack.length - 1] === view) return;
    historyStack.push(view);
    if (historyStack.length > 40) historyStack.shift();
    try { window.history.pushState({ oymikeView: view }, '', window.location.href); } catch (_) {}
    updateBackButton();
  }
  function backView() {
    const target = historyStack.length ? historyStack.pop() : 'home';
    applyingHistory = true;
    document.dispatchEvent(new CustomEvent('workspace:back', { detail: { view: target, empty: historyStack.length === 0 } }));
    applyingHistory = false;
    updateBackButton();
    return target;
  }

  // Ouvre une vue : c'est l'espace de travail qui décide comment l'afficher, mais l'historique
  // est tenu ici pour que le bouton « Retour » et le bouton du téléphone fassent la même chose.
  function go(view, { push = true } = {}) {
    if (!view) return;
    if (push) pushView(view);
    applyingHistory = true;
    document.dispatchEvent(new CustomEvent('workspace:go', { detail: { view } }));
    applyingHistory = false;
  }
  function updateBackButton() {
    document.querySelectorAll('[data-ws-back], [data-ws-back-home]').forEach((node) => {
      // À la racine, il n'y a rien derrière : le bouton est masqué, jamais trompeur.
      node.hidden = historyStack.length === 0;
      node.setAttribute('aria-disabled', historyStack.length === 0 ? 'true' : 'false');
    });
  }
  // Bouton du téléphone / du navigateur : on le capte pour ne pas quitter l'espace par erreur.
  window.addEventListener('popstate', (event) => {
    if (document.body.dataset.wsApp !== 'true') return;
    const target = event.state?.oymikeView;
    if (target) {
      applyingHistory = true;
      document.dispatchEvent(new CustomEvent('workspace:back', { detail: { view: target, fromPop: true } }));
      applyingHistory = false;
      updateBackButton();
      return;
    }
    // Aucune vue connue : on reste dans l'application plutôt que de sortir.
    const current = historyStack[historyStack.length - 1] || 'home';
    try { window.history.pushState({ oymikeView: current }, '', window.location.href); } catch (_) {}
  });

  function installBackButtons() {
    document.querySelectorAll('[data-ws-back], [data-ws-back-home]').forEach((node) => {
      if (node.dataset.wsBackBound === 'true') return;
      node.dataset.wsBackBound = 'true';
      node.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); backView(); });
    });
    updateBackButton();
  }

  // ------------------------------------------------------------------ 4. API
  window.WorkspaceShell = {
    applyTheme, localTheme,
    confirmLogout, installLogout,
    pushView, backView, go, installBackButtons,
    get history() { return [...historyStack]; },
    ICON_LOGOUT,
  };

  if (document.body) installBackButtons();
  document.addEventListener('DOMContentLoaded', installBackButtons, { once: true });
})();
