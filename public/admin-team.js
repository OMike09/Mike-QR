'use strict';

// ============================================================================================
// Supervision des équipes marchandes — Administration générale (lecture seule + limites).
//
// L'Administrateur général ne crée, ne modifie et ne bloque aucun membre d'équipe : ce pouvoir
// appartient au marchand. Il fixe uniquement les plafonds de la plateforme, qui bornent les
// réglages de chaque marchand.
// ============================================================================================
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const state = { loaded: false };

  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Erreur inattendue.');
    return payload;
  }
  function notify(message) {
    const node = $('#toast');
    if (!node) return;
    node.textContent = message; node.classList.add('visible');
    setTimeout(() => node.classList.remove('visible'), 3200);
  }

  async function load() {
    try {
      const [limits, overview] = await Promise.all([api('/api/admin/team-settings'), api('/api/admin/team-overview')]);
      const l = limits.data.limits || {};
      $('#limitMaxGm').value = l.maxGeneralManagersPerMerchant ?? 10;
      $('#limitMaxWaitress').value = l.maxWaitressesPerMerchant ?? 50;
      $('#limitCodeTtl').value = l.activationCodeTtlHours ?? 72;
      $('#limitTeamEnabled').checked = l.teamModuleEnabled !== false;
      const rows = overview.data.merchants || [];
      $('#teamOverviewTable').innerHTML = rows.length ? `<table class="admin-mini-table">
        <thead><tr><th>Marchand</th><th>Gérants</th><th>Serveuses</th><th>Actifs</th><th>Bloqués</th></tr></thead>
        <tbody>${rows.map((row) => `<tr><td>${esc(row.merchantName || row.merchantId)}</td><td>${row.generalManagers}</td><td>${row.waitresses}</td><td>${row.active}</td><td>${row.blocked}</td></tr>`).join('')}</tbody></table>`
        : '<p class="hint">Aucune équipe créée pour le moment.</p>';
      state.loaded = true;
    } catch (error) {
      $('#teamOverviewTable').innerHTML = `<p class="message error">${esc(error.message)}</p>`;
    }
  }

  function bind() {
    if (!$('#view-team-overview')) return;
    $('#teamOverviewRefresh').addEventListener('click', () => load());
    window.addEventListener('qria:team-overview', () => load());
    $('#teamLimitsForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api('/api/admin/team-settings', { method: 'PATCH', body: JSON.stringify({
          maxGeneralManagersPerMerchant: Number($('#limitMaxGm').value), maxWaitressesPerMerchant: Number($('#limitMaxWaitress').value),
          activationCodeTtlHours: Number($('#limitCodeTtl').value), teamModuleEnabled: $('#limitTeamEnabled').checked }) });
        $('#teamLimitsStatus').textContent = 'Limites enregistrées.';
        notify('Limites de la plateforme enregistrées.');
        await load();
      } catch (error) { $('#teamLimitsStatus').textContent = error.message; }
    });
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (!$('#appView')?.hidden) { clearInterval(timer); load(); }
      if (tries > 120) clearInterval(timer);
    }, 500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})();
