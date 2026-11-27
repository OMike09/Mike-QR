// Mission 11 (sous-prompt 3) — « Voir les historiques » pour l'Administrateur général et le
// Gestionnaire. Le même écran que dans les espaces marchand et équipe (history-view.js), placé
// dans une page dédiée, sans rien retirer aux écrans existants.
//
// Périmètre : décidé par le serveur (/api/history), jamais par cette page.
//   · PDG        → toutes les boutiques
//   · Gestionnaire → uniquement les marchands qui lui sont rattachés
(() => {
  'use strict';

  function ensureHost() {
    let host = document.getElementById('historyRoot');
    if (host) return host;
    const main = document.querySelector('main.main-content') || document.querySelector('.main-column main') || document.querySelector('main');
    if (!main) return null;
    const section = document.createElement('section');
    section.className = 'view-panel';
    section.id = 'view-historiques';
    section.hidden = true;
    section.innerHTML = '<div id="historyRoot" class="ws-history-page"></div>';
    main.appendChild(section);
    host = document.getElementById('historyRoot');
    return host;
  }

  // Ouvre la page d'historiques : tous les autres panneaux sont masqués, sans être supprimés.
  // `quiet` = l'administration a déjà posé l'état de navigation (évite deux écritures concurrentes).
  function open({ quiet = false } = {}) {
    const host = ensureHost();
    if (!host) return false;
    const section = host.closest('.view-panel');
    document.querySelectorAll('.view-panel').forEach((panel) => { panel.hidden = panel !== section; });
    section.hidden = false;
    if (!quiet) {
      // Le titre de la barre supérieure suit la page affichée.
      const crumb = document.getElementById('breadcrumbTitle');
      if (crumb) crumb.textContent = 'Historiques';
      document.querySelectorAll('.nav-item, .nav-link').forEach((button) => {
        button.classList.toggle('is-active', button.dataset.view === 'historiques' || button.dataset.historiques === 'true');
        if (button.dataset.historiques === 'true') button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      });
    }
    if (typeof window.HistoryView === 'undefined') return false;
    window.HistoryView.open();
    try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (_) {}
    return true;
  }

  function bind() {
    // Bouton ajouté dans la navigation existante (aucune entrée retirée).
    const nav = document.querySelector('.side-nav');
    if (nav && !nav.querySelector('[data-historiques]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nav-item';
      button.dataset.historiques = 'true';
      button.innerHTML = `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.5"/><path d="M10 5.6v4.8l3.2 1.9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Voir les historiques</span>`;
      button.addEventListener('click', (event) => {
        event.preventDefault(); event.stopPropagation();
        // L'administration gère elle-même l'affichage : on lui demande la vue plutôt que de la
        // forcer, sinon son prochain rendu réafficherait l'écran précédent. Un second passage
        // « quiet » garantit l'état final (titres et navigation) une fois ce rendu terminé.
        if (typeof window.__openHistoriques === 'function') window.__openHistoriques();
        else open();
        setTimeout(() => open({ quiet: false }), 90);
      });
      // Placée juste après « Vue d'ensemble » : sur un long menu, l'entrée reste atteignable sans
      // faire défiler toute la barre latérale.
      const first = nav.querySelector('[data-view]');
      if (first && first.nextSibling) nav.insertBefore(button, first.nextSibling);
      else nav.appendChild(button);
      // La barre latérale défile d'elle-même : toutes les rubriques restent accessibles sur un
      // écran de portable, sans masquer le contenu de la page.
      try { nav.style.maxHeight = 'calc(100vh - 24px)'; nav.style.overflowY = 'auto'; } catch (_) {}
    }
    // Les autres entrées de navigation ferment la page d'historiques comme avant (aucun conflit).
    // `[data-historiques]` n'est pas une entrée `[data-view]` : le garde-fou ci-dessous ne peut
    // pas refermer la page qu'on vient d'ouvrir.
    document.addEventListener('click', (event) => {
      const target = event.target.closest?.('[data-view]');
      if (target && !target.hasAttribute('data-historiques')) {
        const section = document.getElementById('view-historiques');
        if (section) section.hidden = true;
      }
    }, true);
    if (location.hash === '#historiques') setTimeout(open, 300);
  }

  window.HistoriquePDG = { open };
  // Passerelle unique : la vue est toujours posée ici (panneau, titre, navigation), puis les
  // historiques sont chargés. Appelée par la navigation et par la restauration de vue du PDG.
  window.__openHistoriques = () => open();
  if (document.body) bind(); else document.addEventListener('DOMContentLoaded', bind, { once: true });
})();
