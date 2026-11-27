'use strict';

// ============================================================================================
// MISSION 12 — Écran « Gestion des tables et espaces » (espace marchand).
//
// Une seule page, dans cet ordre : état des lieux (libres/occupées), ajout d'une table,
// ajout d'un salon, puis la liste complète par salon.
//
// Ce fichier ne calcule aucune permission et ne décide de rien : toutes les actions passent par
// /api/merchant/table-management, qui vérifie l'établissement du marchand connecté. Les QR
// affichés sont ceux qui existent DÉJÀ (ils ne sont jamais recréés) : un QR imprimé continue de
// fonctionner même si le numéro ou le nom d'une table change.
// ============================================================================================
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  // `form` mémorise le formulaire ouvert (table/salon) : un rechargement de la liste ne doit jamais
  // effacer une saisie en cours — cause réelle du « le bouton ne fait rien » constaté au test.
  const state = { data: null, busy: false, editingZone: '', filter: 'all', form: null };

  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(payload.error || `Erreur ${response.status}`); error.code = payload.code || ''; throw error; }
    return payload;
  }
  function toast(message) {
    if (typeof window.merchantToast === 'function') return window.merchantToast(message);
    const node = $('#toast'); if (!node) return;
    node.textContent = message; node.classList.add('visible');
    setTimeout(() => node.classList.remove('visible'), 3200);
  }
  const pointLabel = (point) => (point.type === 'table' ? `Table ${point.number || point.name.replace(/^Table\s*/i, '') || '—'}` : point.name);

  function root() { return $('#tablesRoot'); }
  function note(message, tone = '') {
    const node = $('#tablesNotice'); if (!node) return;
    node.hidden = !message; node.textContent = message || '';
    node.classList.toggle('is-error', tone === 'error'); node.classList.toggle('is-ok', tone === 'ok');
  }

  // ------------------------------------------------------------------ rendu
  function render() {
    const host = root(); if (!host || !state.data) return;
    const { points, summary, zones, store } = state.data;
    const active = points.filter((point) => point.status === 'active');
    const inactive = points.filter((point) => point.status !== 'active');
    const tables = active.filter((point) => point.type === 'table');
    const salons = active.filter((point) => point.type === 'salon' || point.type === 'location');
    const shown = state.filter === 'free' ? active.filter((point) => !point.occupied)
      : state.filter === 'occupied' ? active.filter((point) => point.occupied) : active;
    const zoneNames = [...new Set([...zones.map((zone) => zone.zone), ...tables.map((point) => point.zone).filter(Boolean)])];
    const groups = new Map();
    for (const point of shown) {
      const key = point.zone || (point.type === 'salon' ? 'Salon sans table' : 'Sans salon');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(point);
    }
    const sortedGroups = [...groups.entries()].sort(([a], [b]) => (a === 'Sans salon' ? 1 : b === 'Sans salon' ? -1 : a.localeCompare(b, 'fr')));

    host.innerHTML = `
      <div class="tables-head">
        <div><span class="eyebrow">TABLES ET ESPACES</span><h2>Vos tables, vos salons, vos QR</h2>
          <p>${esc(store.name)} · <strong>${summary.tables}</strong> table(s), <strong>${summary.salons + summary.locations}</strong> salon(s)/espace(s).
          Chaque table a son numéro, choisi par vous, et son QR — le même QR continue de fonctionner même si vous changez le numéro.</p></div>
        <div class="tables-head-actions">
          <button type="button" class="button primary" id="tablesAddTable">+ Ajouter une table</button>
          <button type="button" class="button outline" id="tablesAddSalon">+ Créer un salon</button>
          <button type="button" class="button quiet" id="tablesRefresh" aria-label="Actualiser">↻</button>
        </div>
      </div>

      <div class="tables-kpis">
        <div class="tables-kpi"><span>Tables</span><strong>${summary.tables}</strong><small>numérotées par vous</small></div>
        <div class="tables-kpi is-free"><span>Libres</span><strong>${summary.free}</strong><small>aucune commande en cours</small></div>
        <div class="tables-kpi is-busy"><span>Occupées</span><strong>${summary.occupied}</strong><small>commandes en cours</small></div>
        <div class="tables-kpi"><span>Salons / espaces</span><strong>${summary.salons + summary.locations}</strong><small>regroupent les tables</small></div>
      </div>

      <div class="tables-filters" role="group" aria-label="Filtrer les tables">
        <button type="button" data-tables-filter="all" aria-pressed="${state.filter === 'all'}">Toutes (${active.length})</button>
        <button type="button" data-tables-filter="free" aria-pressed="${state.filter === 'free'}">Libres (${summary.free})</button>
        <button type="button" data-tables-filter="occupied" aria-pressed="${state.filter === 'occupied'}">Occupées (${summary.occupied})</button>
      </div>

      <div id="tablesFormHost"></div>

      ${sortedGroups.length ? sortedGroups.map(([zone, rows]) => `
        <section class="tables-group">
          <header><h3>${esc(zone)}</h3><small>${rows.length} emplacement(s)</small>
            ${zone !== 'Sans salon' ? `<button type="button" class="link-button" data-zone-rename="${esc(zone)}">Renommer ce salon</button>` : ''}</header>
          <div class="tables-grid">
            ${rows.map((point) => tableCard(point, zoneNames)).join('')}
          </div>
        </section>`).join('') : `<p class="empty">${state.filter === 'all' ? 'Aucune table pour le moment : ajoutez votre première table ci-dessus.' : 'Aucune table dans ce filtre.'}</p>`}

      ${inactive.length ? `<details class="tables-inactive"><summary>Tables désactivées (${inactive.length}) — QR conservés</summary>
        <div class="tables-grid">${inactive.map((point) => tableCard(point, zoneNames, true)).join('')}</div></details>` : ''}

      <p class="tables-footnote">Un QR désactivé ou réactivé reste le même : aucune réimpression n’est nécessaire. Le code figure sous chaque QR (saisie manuelle possible).</p>`;
    bind();
    if (state.form) paintForm();
  }

  // Le formulaire est ré-affiché après chaque rendu : une réponse réseau tardive ne peut plus
  // faire disparaître ce que le marchand est en train de taper.
  function paintForm() {
    if (!state.form) return;
    if (state.form.type === 'salon') showSalonForm(state.form.zone || '', true);
    else showTableForm(true);
  }

  function tableCard(point, zoneNames, inactive = false) {
    const label = pointLabel(point);
    const zoneOptions = ['', ...zoneNames].map((zone) => `<option value="${esc(zone)}"${zone === (point.zone || '') ? ' selected' : ''}>${zone ? esc(zone) : 'Sans salon'}</option>`).join('');
    return `<article class="table-card${point.occupied ? ' is-occupied' : ''}${inactive ? ' is-inactive' : ''}" data-point="${esc(point.id)}">
      <header>
        <div class="table-card-title">
          <span class="table-card-number">${esc(point.type === 'table' ? (point.number || '—') : '◫')}</span>
          <div><strong>${esc(label)}</strong><small>${esc(point.zone || 'Sans salon')} · ${esc(point.type === 'salon' ? 'Salon' : point.type === 'location' ? 'Espace' : point.type === 'counter' ? 'Comptoir' : 'Table')}</small></div>
        </div>
        <span class="table-state ${point.occupied ? 'is-busy' : point.status === 'active' ? 'is-free' : 'is-off'}">
          ${point.occupied ? `Occupée${point.activeOrders > 1 ? ` (${point.activeOrders})` : ''}` : point.status === 'active' ? 'Libre' : 'Désactivée'}
        </span>
      </header>
      <div class="table-card-qr">
        ${point.publicCode ? `<canvas width="132" height="132" data-table-qr="${esc(point.publicCode)}" aria-label="QR de ${esc(label)}"></canvas>` : '<div class="table-qr-missing">QR non disponible</div>'}
        <div class="table-card-code">
          <code>${esc(point.publicCode || '—')}</code>
          <div class="table-card-qr-actions">
            <button type="button" data-qr-copy="${esc(point.publicCode)}">Copier le lien</button>
            <button type="button" data-qr-png="${esc(point.publicCode)}">Télécharger le QR</button>
          </div>
          <small>${Number(point.qrScanCount) || 0} scan(s)</small>
        </div>
      </div>
      <div class="table-card-meta">
        <span>${point.assignedTo ? `Servie par ${esc(point.assignedTo.designation || 'un membre')}` : 'Aucune serveuse affectée'}</span>
        ${point.occupied ? `<span>${point.activeOrders} commande(s) en cours</span>` : ''}
      </div>
      <div class="table-card-edit" hidden>
        <div class="table-edit-grid">
          ${point.type === 'table' ? `<label>Numéro<input data-edit-number value="${esc(point.number || '')}" maxlength="24" inputmode="text"></label>` : ''}
          <label>Nom affiché<input data-edit-name value="${esc(point.name)}" maxlength="80"></label>
          <label>Salon / espace<select data-edit-zone>${zoneOptions}</select></label>
        </div>
        <div class="table-edit-actions">
          <button type="button" class="button primary" data-save>Enregistrer</button>
          <button type="button" class="button quiet" data-cancel>Annuler</button>
        </div>
        <p class="table-edit-hint">Changer le numéro ou le nom ne change pas le QR : le lien imprimé reste valable.</p>
      </div>
      <div class="table-card-actions">
        <button type="button" class="button outline" data-toggle-edit>${point.type === 'table' ? 'Modifier le numéro' : 'Renommer'}</button>
        <button type="button" class="button outline" data-assign>Affecter</button>
        <button type="button" class="button outline${point.status === 'active' ? ' danger-outline' : ''}" data-toggle-status>${point.status === 'active' ? 'Désactiver' : 'Réactiver'}</button>
      </div>
    </article>`;
  }

  // ------------------------------------------------------------------ interactions
  function bind() {
    const host = root();
    $('#tablesRefresh', host)?.addEventListener('click', () => load({ quiet: true }));
    $('#tablesAddTable', host)?.addEventListener('click', () => showTableForm());
    $('#tablesAddSalon', host)?.addEventListener('click', () => showSalonForm());
    $$('[data-tables-filter]', host).forEach((button) => button.addEventListener('click', () => {
      state.filter = button.dataset.tablesFilter; render();
    }));
    $$('[data-zone-rename]', host).forEach((button) => button.addEventListener('click', () => showSalonForm(button.dataset.zoneRename)));

    $$('.table-card', host).forEach((card) => {
      const point = state.data.points.find((row) => row.id === card.dataset.point);
      if (!point) return;
      const edit = $('.table-card-edit', card);
      $('[data-toggle-edit]', card)?.addEventListener('click', () => { edit.hidden = !edit.hidden; });
      $('[data-cancel]', card)?.addEventListener('click', () => { edit.hidden = true; });
      $('[data-save]', card)?.addEventListener('click', () => savePoint(point, card));
      $('[data-toggle-status]', card)?.addEventListener('click', () => toggleStatus(point));
      $('[data-assign]', card)?.addEventListener('click', () => assignPoint(point));
      $('[data-qr-copy]', card)?.addEventListener('click', async () => {
        const url = `${location.origin}/t/${point.publicCode}`;
        try { await navigator.clipboard.writeText(url); toast('Lien du QR copié.'); } catch (_) { window.prompt('Copiez ce lien :', url); }
      });
      $('[data-qr-png]', card)?.addEventListener('click', () => downloadQr(point));
      const canvas = $('[data-table-qr]', card);
      if (canvas) drawQr(canvas, `${location.origin}/t/${point.publicCode}`);
    });
  }

  async function drawQr(canvas, url) {
    try {
      await window.ensureQrEncoder?.();
      if (typeof window.qrcode !== 'function') return;
      const qr = window.qrcode(0, 'M'); qr.addData(url); qr.make();
      const size = 132; const count = qr.getModuleCount(); const margin = 3; const cell = size / (count + margin * 2);
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff'; context.fillRect(0, 0, size, size); context.fillStyle = '#14251f';
      for (let row = 0; row < count; row += 1) for (let col = 0; col < count; col += 1) {
        if (qr.isDark(row, col)) context.fillRect((col + margin) * cell, (row + margin) * cell, Math.ceil(cell), Math.ceil(cell));
      }
    } catch (_) { canvas.hidden = true; }
  }

  async function downloadQr(point) {
    const url = `${location.origin}/t/${point.publicCode}`;
    if (!window.QRIAQRArtwork) {
      // Repli sans la bibliothèque d'impression : le PNG affiché est enregistré tel quel.
      const canvas = $(`[data-table-qr="${point.publicCode}"]`);
      if (!canvas) { toast('Le QR n’est pas encore affiché à l’écran.'); return; }
      const link = document.createElement('a'); link.href = canvas.toDataURL('image/png'); link.download = `qr-${point.number || point.name}.png`; link.click();
      return;
    }
    try { await window.QRIAQRArtwork.download(url, { foreground: '#14251f', background: '#FFFFFF', correction: 'M' }, `qr-${point.number || point.name}`, 'png'); }
    catch (error) { toast(error.message || 'Téléchargement impossible.'); }
  }

  // ------------------------------------------------------------------ formulaires
  function showTableForm(repaint = false) {
    const host = $('#tablesFormHost'); if (!host) return;
    if (!repaint) state.form = { type: 'table' };
    const zoneOptions = ['', ...state.data.zones.map((zone) => zone.zone)].map((zone) => `<option value="${esc(zone)}">${zone ? esc(zone) : 'Sans salon'}</option>`).join('');
    host.innerHTML = `<form class="tables-form" id="tablesTableForm">
      <h3>Ajouter une table</h3>
      <div class="tables-form-grid">
        <label>Numéro de la table *<input name="number" maxlength="24" required placeholder="1, A3, Terrasse 2" autofocus><small>Le numéro que vous choisissez. Il est unique dans votre établissement.</small></label>
        <label>Salon / espace<select name="zone"><option value="">Sans salon</option>${zoneOptions}</select></label>
      </div>
      <div class="tables-form-actions"><button class="button primary" type="submit">Créer la table et son QR</button><button class="button quiet" type="button" data-cancel>Annuler</button></div>
      <p class="message error" id="tablesFormError" role="alert" hidden></p>
    </form>`;
    const form = $('#tablesTableForm', host);
    $('[data-cancel]', form).addEventListener('click', () => { state.form = null; host.innerHTML = ''; });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const error = $('#tablesFormError', form);
      error.hidden = true;
      const submit = $('button[type="submit"]', form); submit.disabled = true;
      try {
        await api('/api/merchant/table-management/tables', { method: 'POST', body: JSON.stringify({
          number: form.number.value, zone: form.zone.value,
          requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` }) });
        state.form = null; host.innerHTML = '';
        note(`Table ${form.number.value.trim()} créée : son QR est prêt.`, 'ok');
        await load({ quiet: true });
      } catch (failure) { error.textContent = failure.message; error.hidden = false; }
      finally { submit.disabled = false; }
    });
    if (!repaint) form.number?.focus?.();
  }

  function showSalonForm(renameZone = '', repaint = false) {
    const host = $('#tablesFormHost'); if (!host) return;
    if (!repaint) state.form = { type: 'salon', zone: renameZone || '' };
    const salon = renameZone ? state.data.points.find((point) => (point.type === 'salon' || point.type === 'location') && (point.zone === renameZone || point.name === renameZone)) : null;
    host.innerHTML = `<form class="tables-form" id="tablesSalonForm">
      <h3>${renameZone ? 'Renommer un salon' : 'Créer un salon ou un espace'}</h3>
      <div class="tables-form-grid">
        <label>Nom du salon *<input name="name" maxlength="120" required value="${esc(renameZone)}" placeholder="Terrasse, Salle du haut, VIP…"><small>${renameZone ? 'Les tables de ce salon suivent le nouveau nom ; leurs QR ne changent pas.' : 'Un salon regroupe des tables. Un nom déjà utilisé dans votre établissement sera refusé.'}</small></label>
      </div>
      <div class="tables-form-actions"><button class="button primary" type="submit">${renameZone ? 'Renommer' : 'Créer le salon'}</button><button class="button quiet" type="button" data-cancel>Annuler</button></div>
      <p class="message error" id="tablesFormError" role="alert" hidden></p>
    </form>`;
    const form = $('#tablesSalonForm', host);
    $('[data-cancel]', form).addEventListener('click', () => { state.form = null; host.innerHTML = ''; });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const error = $('#tablesFormError', form);
      error.hidden = true;
      const submit = $('button[type="submit"]', form); submit.disabled = true;
      try {
        if (renameZone) {
          const target = salon || state.data.points.find((point) => point.type === 'salon' && point.name === renameZone);
          if (!target) throw new Error('Ce salon n’existe pas encore comme salon : renommez plutôt la table concernée.');
          await api(`/api/merchant/table-management/salons/${encodeURIComponent(target.id)}`, { method: 'PUT', body: JSON.stringify({ name: form.name.value }) });
          note('Salon renommé. Les tables et leurs QR sont conservés.', 'ok');
        } else {
          await api('/api/merchant/table-management/salons', { method: 'POST', body: JSON.stringify({ name: form.name.value,
            requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` }) });
          note(`Salon « ${form.name.value.trim()} » créé.`, 'ok');
        }
        state.form = null; host.innerHTML = '';
        await load({ quiet: true });
      } catch (failure) { error.textContent = failure.message; error.hidden = false; }
      finally { submit.disabled = false; }
    });
    if (!repaint) form.name?.focus?.();
  }

  async function savePoint(point, card) {
    const error = note;
    const number = $('[data-edit-number]', card)?.value ?? undefined;
    const name = $('[data-edit-name]', card).value;
    const zone = $('[data-edit-zone]', card).value;
    try {
      await api(`/api/merchant/table-management/points/${encodeURIComponent(point.id)}`, { method: 'PUT', body: JSON.stringify({ number, name, zone }) });
      note('Table mise à jour. Son QR est inchangé.', 'ok');
      await load({ quiet: true });
    } catch (failure) { note(failure.message, 'error'); }
  }

  async function toggleStatus(point) {
    const next = point.status === 'active' ? 'inactive' : 'active';
    if (next === 'inactive' && !window.confirm(`Désactiver « ${pointLabel(point)} » ?\nSon QR est conservé : vous pourrez la réactiver à tout moment.`)) return;
    try {
      await api(`/api/merchant/table-management/points/${encodeURIComponent(point.id)}/status`, { method: 'POST', body: JSON.stringify({ status: next }) });
      note(next === 'active' ? 'Table réactivée : son QR fonctionne de nouveau.' : 'Table désactivée. Son QR et son historique sont conservés.', 'ok');
      await load({ quiet: true });
    } catch (failure) { note(failure.message, 'error'); }
  }

  async function assignPoint(point) {
    const members = (state.data.members || []).filter((member) => member.status === 'active' || member.status === 'pending');
    if (!members.length) { note('Créez d’abord un compte dans « Mon équipe » pour affecter une table.', 'error'); return; }
    const options = members.map((member, index) => `${index + 1}. ${member.label} (${member.role === 'general_manager' ? 'gérant' : 'serveuse/serveur'})`).join('\n');
    const answer = window.prompt(`Affecter « ${pointLabel(point)} » à :\n\n${options}\n\n0. Aucune affectation\n\nTapez le numéro du membre :`, String(members.findIndex((member) => member.id === point.assignedTo?.memberId) + 1 || 0));
    if (answer === null) return;
    const choice = Number(answer);
    const memberId = choice >= 1 && choice <= members.length ? members[choice - 1].id : '';
    try {
      await api(`/api/merchant/table-management/points/${encodeURIComponent(point.id)}/assign`, { method: 'POST', body: JSON.stringify({ memberId }) });
      note(memberId ? 'Table affectée : les commandes de cette table suivront ce membre.' : 'Table libérée de toute affectation.', 'ok');
      await load({ quiet: true });
    } catch (failure) { note(failure.message, 'error'); }
  }

  // ------------------------------------------------------------------ chargement
  async function load({ quiet = false } = {}) {
    const host = root(); if (!host) return;
    if (!quiet) host.innerHTML = '<p class="muted">Chargement de vos tables et espaces…</p>';
    try {
      const payload = await api('/api/merchant/table-management');
      state.data = payload.data;
      render();
    } catch (failure) {
      host.innerHTML = `<div class="tables-error"><p>${esc(failure.message)}</p><button type="button" class="button outline" id="tablesRetry">Réessayer</button></div>`;
      $('#tablesRetry')?.addEventListener('click', () => load());
    }
  }

  // Ouvre l'écran (appelé par le menu et par merchant.js quand l'onglet « tables » est choisi).
  function open() { return load(); }
  window.MerchantTables = { open, load, get data() { return state.data; } };
  // Rechargement déclenché UNIQUEMENT par le bouton de menu (jamais par un clic à l'intérieur du
  // panneau, qui porte aussi `data-ws-rubric` : cela re-rendait l'écran et détachait le formulaire
  // en cours de saisie). La page est déjà chargée par merchant.js à l'ouverture de l'onglet.
  document.addEventListener('click', (event) => {
    if (event.target.closest?.('button[data-rubric="tables"], button[data-tab="tables"]')) load();
  });
})();
