// Mission 11 (sous-prompt 3) — Vue d'ensemble allégée, commune aux espaces marchand et équipe.
//
// Quatre cartes maximum, un chiffre chacune, toutes CLIQUABLES :
//   nouvelles commandes → liste filtrée · en cours → liste · terminées → liste · tables → occupation
// Plus : les scans des dernières 24 h (→ historiques) et l'activité du personnel AUTORISÉE.
// Aucun long texte, aucune statistique décorative. Les chiffres viennent de /api/overview, qui
// applique le périmètre de la session (le navigateur ne décide jamais de ce qu'il peut voir).
(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = { data: null, loading: false, error: '', lastAt: 0, timer: 0, requestId: 0 };

  function host() { return document.getElementById('homeOverview'); }

  function clock(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function skeleton() {
    return `<div class="ov-cards">${['Nouvelles commandes', 'En cours', 'Terminées aujourd’hui', 'Tables occupées']
      .map((label) => `<article class="ov-card is-loading"><span class="ov-label">${label}</span><strong class="ov-value">—</strong></article>`).join('')}</div>`;
  }

  function render() {
    const root = host(); if (!root) return;
    if (state.error) {
      root.innerHTML = `<div class="ov-error" role="alert"><p>${esc(state.error)}</p><button type="button" id="ovRetry">Réessayer</button></div>`;
      $('#ovRetry')?.addEventListener('click', () => load(true));
      return;
    }
    const data = state.data;
    if (!data) { root.innerHTML = skeleton(); return; }
    const staff = Array.isArray(data.staff) ? data.staff : null;
    root.innerHTML = `
      <div class="ov-head">
        <h2>Vue d’ensemble</h2>
        <button type="button" class="ov-refresh" id="ovRefresh" aria-label="Actualiser la vue d’ensemble" title="Actualiser">↻</button>
      </div>
      <div class="ov-cards">
        ${data.cards.map((card) => `<button type="button" class="ov-card is-${esc(card.id)}" data-ov-card="${esc(card.id)}" data-ov-target="${esc(card.target || '')}"${card.orderView ? ` data-ov-view="${esc(card.orderView)}"` : ''}>
          <span class="ov-label">${esc(card.label)}</span>
          <strong class="ov-value">${Number(card.value) || 0}</strong>
          ${card.hint ? `<small>${esc(card.hint)}</small>` : '<small>Voir la liste</small>'}
        </button>`).join('')}
        <button type="button" class="ov-card is-scans" data-ov-scans="true">
          <span class="ov-label">Scans (24 h)</span>
          <strong class="ov-value">${Number(data.scans?.last24h) || 0}</strong>
          <small>Voir les historiques</small>
        </button>
      </div>
      ${staff && staff.length ? `<section class="ov-staff">
        <h3>Activité du personnel</h3>
        <ul>${staff.map((row) => `<li><span>${esc(row.person)}</span><small>${esc(row.action)}${row.at ? ` · ${esc(clock(row.at))}` : ''}</small></li>`).join('')}</ul>
      </section>` : ''}`;
    bindCards();
  }

  function bindCards() {
    $('#ovRefresh')?.addEventListener('click', () => load(true));
    $$('[data-ov-card]').forEach((button) => button.addEventListener('click', () => {
      const view = button.dataset.ovView;
      const target = button.dataset.ovTarget;
      // Cartes de commandes : la liste correspondante s'ouvre directement, déjà filtrée.
      if (view) {
        if (window.WorkspaceUI?.openTab) window.WorkspaceUI.openTab('orders', true, { label: 'Commandes', overviewView: view });
        else if (window.StaffWorkspace?.openTab) window.StaffWorkspace.openTab('orders', { overviewView: view });
        document.dispatchEvent(new CustomEvent('overview:orders', { detail: { view } }));
        return;
      }
      // Tables : la vue d'occupation existante, jamais dupliquée.
      if (target === 'tables') {
        document.dispatchEvent(new CustomEvent('overview:tables'));
        if (window.StaffWorkspace?.openTab) window.StaffWorkspace.openTab('tables');
        if (window.WorkspaceUI?.openTab) window.WorkspaceUI.openTab('ops', true, { opsTab: 'tables', label: 'Tables et salons' });
        return;
      }
    }));
    $('[data-ov-scans]')?.addEventListener('click', () => {
      if (window.WorkspaceUI?.openTab) window.WorkspaceUI.openTab('history', true, { label: 'Voir les historiques' });
      else if (window.StaffWorkspace) window.StaffWorkspace.openRubric?.('history');
    });
  }

  async function load(announce = false) {
    const root = host(); if (!root) return;
    if (!state.data) root.innerHTML = skeleton();
    const id = ++state.requestId;
    state.loading = true;
    if (announce) state.error = '';
    try {
      const response = await fetch('/api/overview', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => ({}));
      if (id !== state.requestId) return;
      if (!response.ok) throw new Error(payload.error || `Erreur ${response.status}`);
      state.data = payload.data;
      state.error = '';
      state.lastAt = Date.now();
      render();
      // La version réduite des historiques suit la même actualisation, sans requête supplémentaire
      // tant que son panneau n'est pas visible.
      if (window.HistoryView?.active) window.HistoryView.refresh?.();
    } catch (error) {
      if (id !== state.requestId) return;
      state.error = `${error.message} Vérifiez la connexion puis réessayez.`;
      render();
    } finally {
      if (id === state.requestId) state.loading = false;
    }
  }

  // Actualisation automatique douce : uniquement quand la vue d'ensemble est réellement affichée,
  // et jamais pendant une saisie. Les commandes restent donc toujours à jour sans recharger la page.
  function schedule() {
    clearInterval(state.timer);
    state.timer = setInterval(() => {
      const root = host();
      if (!root || !root.offsetParent || document.hidden) return;
      if (Date.now() - state.lastAt < 25000) return;
      load(false);
    }, 30000);
  }

  function open() {
    if (!host()) return;
    load(true);
    schedule();
  }

  window.OverviewView = { open, refresh: () => load(true), render, get data() { return state.data; } };

  function watch() {
    const root = host();
    if (!root) return;
    // La vue d'ensemble est le contenu du panneau d'accueil : elle se charge dès que ce panneau
    // est affiché, sans dépendre du moment exact où la session s'ouvre.
    const panel = root.closest('.panel') || root;
    const observer = new MutationObserver(() => {
      if (!panel.hidden) open(); else { clearInterval(state.timer); state.timer = 0; }
    });
    observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    if (!panel.hidden) open();
  }
  if (document.body) watch(); else document.addEventListener('DOMContentLoaded', watch, { once: true });
})();
