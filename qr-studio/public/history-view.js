// Mission 11 (sous-prompt 3) — « Voir les historiques », commun aux espaces marchand et équipe.
//
// · Une seule rubrique, une seule page : les historiques ne sont plus déversés sur les accueils.
// · Filtres : Aujourd'hui, Hier, Cette semaine, Ce mois, période personnalisée, tout l'historique.
// · Recherche par nom, n° de commande, table, membre du personnel, type d'opération.
// · Chaque ligne : action, date, heure, personne, statut (+ établissement pour les rôles qui
//   surveillent plusieurs boutiques).
// · Les catégories affichées sont celles renvoyées par le serveur : le filtre n'est jamais une
//   simple décoration, le serveur refuse une catégorie non autorisée (403 explicite).
// · Aucune donnée n'est écrite ici : la page est en lecture seule.
(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const PERIODS = [
    { id: 'today', label: 'Aujourd’hui' },
    { id: 'yesterday', label: 'Hier' },
    { id: 'week', label: 'Cette semaine' },
    { id: 'month', label: 'Ce mois' },
    { id: 'custom', label: 'Période personnalisée' },
    { id: 'all', label: 'Tout l’historique' },
  ];

  const CATEGORY_ICONS = {
    orders: 'M6 3h12l2 4v14H4V7zM9 11h6M9 15h6',
    scans: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16',
    connections: 'M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3M10 8l-4 4 4 4M6 12h9',
    operations: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3H9.8l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4.4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.06-.4.1-.8.1-1.2z',
    staff: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2M17 11a3 3 0 1 0 0-6M22 20v-2a4 4 0 0 0-3-3.8',
    consignments: 'M3 7h18v10H3zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  };

  const state = {
    // Un conteneur « homeOverview » = version réduite affichée sous la vue d'ensemble.
    compact: false,
    period: 'month', category: '', query: '', from: '', to: '', lastOpenAt: 0,
    rows: [], categories: [], loading: false, loaded: false, error: '', requestId: 0,
    actor: null, lastAt: 0, timer: 0, renderedCategories: '',
  };

  function host() { return document.getElementById('historyRoot') || document.getElementById('homeOverview'); }

  function dateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return { date: '—', time: '' };
    return {
      date: new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date),
      time: new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(date),
    };
  }

  function statusTone(status) {
    const value = String(status || '').toLowerCase();
    if (['success', 'completed', 'settled', 'ready', 'confirmed', 'lu'].includes(value)) return 'ok';
    if (['failure', 'denied', 'cancelled', 'rejected', 'refusé'].includes(value)) return 'danger';
    if (['pending', 'preparing', 'open', 'en cours'].includes(value)) return 'warn';
    return '';
  }

  function statusLabel(row) {
    const map = {
      pending: 'À confirmer', confirmed: 'Confirmée', preparing: 'En préparation', ready: 'Prête',
      out_for_delivery: 'En livraison', completed: 'Terminée', cancelled: 'Annulée', rejected: 'Refusée',
      open: 'En cours', settled: 'Réglée', success: 'Succès', failure: 'Échec', denied: 'Refusé',
    };
    return map[row.statusLabel] || map[row.status] || row.statusLabel || row.status || '—';
  }

  function renderFilters(data) {
    return `
      <div class="history-toolbar">
        <div class="history-periods" role="group" aria-label="Période de l’historique">
          ${PERIODS.map((row) => `<button type="button" data-history-period="${row.id}" aria-pressed="${state.period === row.id}">${esc(row.label)}</button>`).join('')}
        </div>
        <div class="history-custom" id="historyCustomRange" ${state.period === 'custom' ? '' : 'hidden'}>
          <label for="historyFrom">Du</label><input type="date" id="historyFrom" value="${esc(state.from)}">
          <label for="historyTo">Au</label><input type="date" id="historyTo" value="${esc(state.to)}">
          <button type="button" class="history-apply" id="historyApplyRange">Appliquer</button>
        </div>
        <div class="history-search">
          <label class="sr-only" for="historySearch">Rechercher</label>
          <input type="search" id="historySearch" value="${esc(state.query)}" placeholder="Nom, n° de commande, table, membre, type d’opération" autocomplete="off">
          <button type="button" id="historyRefresh" aria-label="Actualiser les historiques" title="Actualiser">↻</button>
        </div>
        <div class="history-categories" role="group" aria-label="Catégories d’historique">
          <button type="button" data-history-category="" aria-pressed="${state.category === ''}">Tout</button>
          ${(data.categories || []).map((row) => `<button type="button" data-history-category="${esc(row.id)}" aria-pressed="${state.category === row.id}">
            <span class="history-cat-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${CATEGORY_ICONS[row.id] || CATEGORY_ICONS.operations}"/></svg></span>${esc(row.label)}
          </button>`).join('')}
        </div>
      </div>`;
  }

  function rowDetail(row) {
    const meta = row.metadata || {};
    const steps = Array.isArray(meta.events) ? meta.events : [];
    const stepLabels = { pending: 'Créée', confirmed: 'Confirmée', preparing: 'En préparation', ready: 'Prête', out_for_delivery: 'En livraison', completed: 'Terminée', cancelled: 'Annulée', rejected: 'Refusée' };
    const facts = [];
    if (meta.reference) facts.push(`<span><strong>Commande</strong> ${esc(meta.reference)}</span>`);
    if (meta.tableName) facts.push(`<span><strong>Table / salon</strong> ${esc(meta.tableName)}</span>`);
    if (meta.qrCode) facts.push(`<span><strong>QR lu</strong> ${esc(meta.qrCode)}</span>`);
    if (meta.assignee) facts.push(`<span><strong>Membre responsable</strong> ${esc(meta.assignee)}</span>`);
    if (meta.place) facts.push(`<span><strong>Emplacement</strong> ${esc(meta.place)}</span>`);
    if (row.establishment) facts.push(`<span><strong>Établissement</strong> ${esc(row.establishment)}</span>`);
    // Traçabilité d'une commande : établissement, table, QR, membre responsable et heures de
    // chaque étape sont toujours rappelés, même quand un seul de ces éléments existe.
    if (row.category === 'orders') {
      if (!meta.tableName) facts.push('<span><strong>Table / salon</strong> non précisée</span>');
      if (!meta.assignee) facts.push('<span><strong>Membre responsable</strong> non affecté</span>');
      if (row.person) facts.push(`<span><strong>Saisie par</strong> ${esc(row.person)}</span>`);
    }
    // Historique des affectations : quand une table change de responsable, les précédents
    // restent visibles (qui, quand, par qui, et pourquoi).
    const assignments = Array.isArray(meta.assignments) ? meta.assignments : [];
    if (assignments.length) {
      facts.push(`<span><strong>Affectations</strong> ${assignments.length} changement${assignments.length > 1 ? 's' : ''}</span>`);
    }
    // Aucune ligne n'est vide : quand aucun autre détail n'existe, on affiche la catégorie et le
    // statut réellement enregistrés (jamais un détail inventé).
    if (!facts.length && !steps.length) {
      const label = (state.categories.find((cat) => cat.id === row.category) || {}).label || row.category || '—';
      facts.push(`<span><strong>Catégorie</strong> ${esc(label)}</span>`);
      facts.push(`<span><strong>Statut</strong> ${esc(statusLabel(row))}</span>`);
    }
    return `<div class="history-detail" hidden>
      ${facts.length ? `<p class="history-facts">${facts.join('')}</p>` : ''}
      ${steps.length ? `<ol class="history-steps">${steps.map((step) => {
        const when = dateTime(step.at);
        return `<li><span class="history-step-dot" aria-hidden="true"></span><span><strong>${esc(stepLabels[step.status] || step.status)}</strong>
          <small>${esc(when.date)} · ${esc(when.time)}${step.actorType ? ` · ${esc(step.actorType)}` : ''}</small></span></li>`;
      }).join('')}</ol>` : ''}
      ${assignments.length ? `<ul class="history-steps history-assignments">${assignments.map((item) => {
        const when = dateTime(item.at);
        const label = item.action === 'transferred' ? 'Transférée' : item.action === 'unassigned' ? 'Retirée' : 'Affectée';
        const who = item.memberLabel || 'non affecté';
        const from = item.fromMemberLabel ? ` (auparavant ${esc(item.fromMemberLabel)})` : '';
        return `<li><span class="history-step-dot" aria-hidden="true"></span><span><strong>${esc(label)} · ${esc(who)}</strong>${from}
          <small>${esc(when.date)} · ${esc(when.time)}${item.actorLabel ? ` · par ${esc(item.actorLabel)}` : ''}${item.reason ? ` · ${esc(item.reason)}` : ''}</small></span></li>`;
      }).join('')}</ul>` : ''}
    </div>`;
  }

  function renderRows() {
    const node = $('#historyResults'); if (!node) return;
    if (state.loading && !state.loaded) { node.innerHTML = '<p class="empty">Chargement des historiques…</p>'; return; }
    if (state.error) {
      node.innerHTML = `<div class="history-error" role="alert"><p>${esc(state.error)}</p><button type="button" id="historyRetry">Réessayer</button></div>`;
      $('#historyRetry')?.addEventListener('click', () => load(true));
      return;
    }
    if (!state.rows.length) {
      node.innerHTML = '<p class="empty">Aucune ligne pour ces filtres. Essayez une autre période ou effacez la recherche.</p>';
      return;
    }
    node.innerHTML = `<p class="history-count">${state.rows.length} ligne${state.rows.length > 1 ? 's' : ''}${state.actor ? ` · ${esc(state.actor)}` : ''}</p>
      <ul class="history-list">
        ${state.rows.map((row) => {
          const when = dateTime(row.at);
          const detail = rowDetail(row);
          // Un libellé lisible est garanti côté interface aussi : un code interne (« order_created »)
          // n'apparaît jamais tel quel, même si le serveur en renvoyait un.
          const label = row.actionLabel || String(row.action || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
          return `<li class="history-row" data-history-row="${esc(row.id)}">
            <button type="button" class="history-row-main" ${detail ? `aria-expanded="false"` : 'disabled'}>
              <span class="history-row-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${CATEGORY_ICONS[row.category] || CATEGORY_ICONS.operations}"/></svg></span>
              <span class="history-row-body">
                <strong>${esc(label)}</strong>
                <small>${esc(row.detail || '')}</small>
                <span class="history-row-meta"><span>${esc(when.date)}</span><span>${esc(when.time)}</span><span>${esc(row.person || '—')}</span>${row.establishment ? `<span>${esc(row.establishment)}</span>` : ''}</span>
              </span>
              <span class="history-status ${statusTone(row.status)}">${esc(statusLabel(row))}</span>
            </button>
            ${detail}
          </li>`;
        }).join('')}
      </ul>`;
    $$('[data-history-row]').forEach((item) => {
      const button = $('.history-row-main', item);
      const detail = $('.history-detail', item);
      if (!button || !detail) return;
      button.addEventListener('click', () => {
        const open = detail.hidden;
        detail.hidden = !open;
        button.setAttribute('aria-expanded', String(open));
      });
    });
  }

  function render() {
    const root = host(); if (!root) return;
    const data = { categories: state.categories };
    const compact = state.compact;
    root.innerHTML = `${compact ? '' : `
      <div class="panel-head history-head">
        <div><span class="eyebrow">HISTORIQUES</span><h2>Voir les historiques</h2>
          <p>Filtrez par période et recherchez par nom, n° de commande, table, membre du personnel ou type d’opération. Vous ne voyez que ce que votre rôle autorise.</p></div>
      </div>`}
      ${renderFilters(data)}
      <div id="historyResults" class="history-results" aria-live="polite"></div>`;
    bindFilters();
    renderRows();
  }

  function bindFilters() {
    $$('[data-history-period]').forEach((button) => button.addEventListener('click', () => {
      state.period = button.dataset.historyPeriod;
      $$('[data-history-period]').forEach((node) => node.setAttribute('aria-pressed', String(node.dataset.historyPeriod === state.period)));
      const range = $('#historyCustomRange');
      if (range) range.hidden = state.period !== 'custom';
      load(true);
    }));
    $$('[data-history-category]').forEach((button) => button.addEventListener('click', () => {
      state.category = button.dataset.historyCategory;
      $$('[data-history-category]').forEach((node) => node.setAttribute('aria-pressed', String(node.dataset.historyCategory === state.category)));
      load(true);
    }));
    $('#historyApplyRange')?.addEventListener('click', () => {
      state.from = $('#historyFrom')?.value || '';
      state.to = $('#historyTo')?.value || '';
      if (!state.from || !state.to) { state.error = 'Choisissez une date de début et une date de fin.'; renderRows(); return; }
      load(true);
    });
    $('#historyRefresh')?.addEventListener('click', () => load(true));
    let timer = 0;
    $('#historySearch')?.addEventListener('input', (event) => {
      clearTimeout(timer);
      timer = setTimeout(() => { state.query = event.target.value.trim(); load(true); }, 320);
    });
  }

  async function load(announce = false) {
    const id = ++state.requestId;
    state.loading = true;
    state.error = '';
    if (announce) renderRows();
    const params = new URLSearchParams({ period: state.period, limit: '300' });
    if (state.category) params.set('category', state.category);
    if (state.query) params.set('q', state.query);
    if (state.period === 'custom') { if (state.from) params.set('from', state.from); if (state.to) params.set('to', state.to); }
    try {
      const response = await fetch(`/api/history?${params.toString()}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => ({}));
      if (id !== state.requestId) return; // une réponse plus ancienne n'écrase jamais une plus récente
      if (response.status === 401) { state.error = 'Votre session a expiré. Rechargez la page pour vous reconnecter : vos données restent enregistrées.'; state.loading = false; renderRows(); return; }
      if (!response.ok) throw new Error(payload.error || `Erreur ${response.status}`);
      state.loading = false;
      state.rows = payload.data?.rows || [];
      state.categories = payload.data?.categories || [];
      state.actor = payload.data?.scope?.label || '';
      state.lastAt = Date.now();
      state.loaded = true;
      // Les catégories viennent du serveur : la barre n'est reconstruite que si leur liste a
      // réellement changé, pour ne jamais perdre le focus pendant une frappe.
      const signature = (payload.data?.categories || []).map((row) => row.id).join(',');
      if (signature !== state.renderedCategories) { state.renderedCategories = signature; render(); }
      else renderRows();
    } catch (error) {
      if (id !== state.requestId) return;
      state.error = `${error.message} Vérifiez la connexion puis réessayez.`;
      renderRows();
    } finally {
      if (id === state.requestId) state.loading = false;
    }
  }

  // Rafraîchissement discret : uniquement quand la page est réellement visible, jamais pendant
  // la saisie d'une recherche, et sans vider la liste déjà affichée.
  function schedule() {
    clearInterval(state.timer);
    state.timer = setInterval(() => {
      const panel = document.getElementById('panel-history');
      if (!panel || panel.hidden || document.hidden) return;
      if (Date.now() - state.lastAt < 20000) return;
      load(false);
    }, 45000);
  }

  function open() {
    const root = host();
    if (!root) return;
    state.compact = root.id === 'homeOverview';
    // Changer de conteneur (page complète ↔ version réduite) impose un nouveau rendu complet.
    if (state.compact !== state.lastCompact) { state.lastCompact = state.compact; state.renderedCategories = ''; state.loaded = false; }
    if (!state.loaded) render();
    // Plusieurs chemins peuvent demander l'ouverture (menu, lien direct, restauration de vue) :
    // une seule requête est lancée par ouverture, jamais trois en parallèle.
    if (!state.loading && Date.now() - state.lastOpenAt > 800) { state.lastOpenAt = Date.now(); load(true); }
    schedule();
  }
  function reset() { state.loaded = false; state.rows = []; state.error = ''; }

  // Le panneau s'ouvre par le menu ou par un lien direct : on observe son affichage réel plutôt
  // que de dépendre d'un seul chemin de navigation.
  function watch() {
    const panel = document.getElementById('panel-history');
    if (!panel) return;
    const observer = new MutationObserver(() => { if (!panel.hidden) open(); else { clearInterval(state.timer); state.timer = 0; } });
    observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    if (!panel.hidden) open();
  }

  window.HistoryView = { open, reset, refresh: () => load(true), render, get active() { return !document.getElementById('panel-history')?.hidden; } };
  if (document.body) watch(); else document.addEventListener('DOMContentLoaded', watch, { once: true });
})();
