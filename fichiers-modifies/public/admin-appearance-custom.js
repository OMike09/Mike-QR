// Mission 15 — Écran PDG « Apparence des espaces ».
//
// Ce panneau est la seule interface de personnalisation globale : palette de 9 couleurs, 6 polices,
// taille de base 14-20 px, graisse, interligne et rayon des cartes. Rien n'est simulé en local :
//   · GET  /api/admin/control/interface-custom         → réglage courant, palette, polices, plages
//   · PUT  /api/admin/control/interface-custom         → enregistrement (refus 400 si un texte
//                                                        devient illisible : CONTRAST_TOO_LOW)
//   · POST /api/admin/control/interface-custom/reset   → retour aux valeurs d'origine
//
// L'aperçu est calculé avec les mêmes variables CSS que celles posées dans les espaces marchand,
// serveuse, gérant et gestionnaire : ce que le PDG voit ici est ce que verront les comptes.
(() => {
  'use strict';

  const API = '/api/admin/control/interface-custom';
  const FONT_STACKS = {
    system: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    inter: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
    georgia: 'Georgia, "Times New Roman", serif',
    trebuchet: '"Trebuchet MS", "Segoe UI", Tahoma, sans-serif',
    verdana: 'Verdana, Geneva, Tahoma, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  };
  const WEIGHTS = [300, 400, 500, 600, 700];
  const PAIRS = [
    ['Texte principal sur le fond', 'ink', 'bg'],
    ['Texte principal sur les cartes', 'ink', 'surface'],
    ['Texte secondaire sur les cartes', 'muted', 'surface'],
    ['Texte du menu sur le menu', 'sidebarText', 'sidebar'],
    ['Texte des boutons sur le bouton', 'accentText', 'accent'],
    // §9 : le prix doit rester lisible sur les cartes (rouge par défaut).
    ['Prix sur les cartes', 'price', 'surface'],
  ];
  const MIN_CONTRAST = 4.5;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const $ = (selector, root = document) => root.querySelector(selector);

  // Même calcul que le serveur : le PDG voit le ratio en direct, sans attendre l'enregistrement.
  function channel(raw) {
    const c = parseInt(raw, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
  function luminance(hex) {
    const value = String(hex || '').replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(value)) return 0;
    return 0.2126 * channel(value.slice(0, 2)) + 0.7152 * channel(value.slice(2, 4)) + 0.0722 * channel(value.slice(4, 6));
  }
  function contrast(a, b) {
    const l1 = luminance(a); const l2 = luminance(b);
    return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
  }

  const state = {
    custom: null, colors: [], fonts: [], ranges: { baseSize: [14, 20], weight: [300, 700], lineHeight: [1.3, 1.9], radius: [8, 24] },
    saving: false, loaded: false, notify: () => {},
  };

  function draft() {
    const values = {};
    state.colors.forEach(({ key }) => { values[key] = String($(`#aacColor-${key}`)?.value || state.custom.colors[key]).toLowerCase(); });
    const numbers = {
      baseSize: Number($('#aacBaseSize')?.value || state.custom.baseSize),
      weight: Number($('#aacWeight')?.value || state.custom.weight),
      lineHeight: Number($('#aacLineHeight')?.value || state.custom.lineHeight),
      radius: Number($('#aacRadius')?.value || state.custom.radius),
    };
    return {
      enabled: Boolean($('#aacEnabled')?.checked),
      mode: $('#aacModeImposed')?.checked ? 'imposed' : 'default',
      colors: values,
      font: $('#aacFont')?.value || state.custom.font,
      ...numbers,
    };
  }

  function variablesOf(value) {
    return {
      '--ui-bg': value.colors.bg, '--ui-surface': value.colors.surface, '--ui-ink': value.colors.ink,
      '--ui-text': value.colors.ink, '--ui-muted': value.colors.muted, '--ui-line': value.colors.line,
      '--ui-accent': value.colors.accent, '--ui-accent-text': value.colors.accentText,
      '--ui-price': value.colors.price || '#b3261e',
      '--m14-side-bg': value.colors.sidebar, '--aac-side': value.colors.sidebar,
      '--ui-radius': `${value.radius}px`, '--ui-font': FONT_STACKS[value.font] || FONT_STACKS.system,
      '--ui-base-size': `${value.baseSize}px`, '--ui-weight': String(value.weight),
      '--ui-line-height': String(value.lineHeight),
    };
  }

  function renderContrast(value) {
    const host = $('#aacContrast'); if (!host) return { ok: true, failing: [] };
    const rows = PAIRS.map(([label, fg, bg]) => {
      const ratio = contrast(value.colors[fg], value.colors[bg]);
      return { label, fg: value.colors[fg], bg: value.colors[bg], ratio, ok: ratio >= MIN_CONTRAST };
    });
    const failing = rows.filter((row) => !row.ok);
    host.innerHTML = `
      <div class="aac-contrast-head">
        <strong>Lisibilité ${failing.length ? 'insuffisante' : 'vérifiée'}</strong>
        <span class="aac-contrast-badge ${failing.length ? 'is-bad' : 'is-good'}">
          ${failing.length ? `${failing.length} texte${failing.length > 1 ? 's' : ''} à corriger` : 'Tous les textes sont lisibles'}
        </span>
      </div>
      <ul class="aac-contrast-list">
        ${rows.map((row) => `<li class="${row.ok ? 'is-good' : 'is-bad'}">
          <span class="aac-contrast-dot" style="background:${esc(row.bg)};border-color:${esc(row.fg)}"></span>
          <span class="aac-contrast-label">${esc(row.label)}</span>
          <span class="aac-contrast-ratio">${row.ratio}:1</span>
          <span class="aac-contrast-verdict">${row.ok ? 'lisible' : `minimum ${MIN_CONTRAST}:1`}</span>
        </li>`).join('')}
      </ul>
      <p class="hint">Un texte sous ${MIN_CONTRAST}:1 est refusé à l’enregistrement : personne ne peut rendre les espaces illisibles, même par erreur.</p>`;
    $('#aacSave')?.classList.toggle('is-blocked', failing.length > 0);
    if (failing.length && $('#aacSave')) $('#aacSave').setAttribute('title', 'Corrigez d’abord les contrastes insuffisants.');
    else $('#aacSave')?.removeAttribute('title');
    return { ok: !failing.length, failing };
  }

  function renderPreview(value) {
    const host = $('#aacPreview'); if (!host) return;
    const vars = variablesOf(value);
    Object.entries(vars).forEach(([name, val]) => host.style.setProperty(name, val));
    const dim = value.enabled ? '' : ' aac-preview--off';
    host.innerHTML = `
      <div class="aac-frame${dim}">
        <div class="aac-workspace">
          <aside class="aac-side">
            <span class="aac-logo">Oymike</span>
            <span class="aac-nav is-active">Commandes</span>
            <span class="aac-nav">Tables</span>
            <span class="aac-nav">Mon équipe</span>
            <span class="aac-nav">Paramètres</span>
          </aside>
          <main class="aac-main">
            <header class="aac-head"><h3>Commandes</h3><span class="aac-muted">Maquis Le Baobab</span></header>
            <section class="aac-card">
              <div class="aac-row"><strong>OY-1042</strong><span class="aac-pill">À confirmer</span></div>
              <p class="aac-muted">Awa Koné · Table 4 · 12:30</p>
              <p>Poulet braisé × 2</p>
              <p class="aac-muted">Bissap 50 cl × 3</p>
              <div class="aac-row"><strong class="aac-price">8 500 XOF</strong><button type="button" tabindex="-1" class="aac-btn">Confirmer</button></div>
            </section>
            <section class="aac-card aac-card--quiet">
              <div class="aac-row"><strong>Table 7</strong><span class="aac-muted">4 places</span></div>
              <button type="button" tabindex="-1" class="aac-btn aac-btn--ghost">Affecter une serveuse</button>
            </section>
          </main>
        </div>
      </div>
      <p class="hint">${value.enabled
        ? 'Aperçu réel : ces variables CSS sont celles appliquées aux espaces de travail.'
        : 'Aperçu sans effet : cochez « Appliquer cette apparence » pour la diffuser aux comptes.'}</p>`;
  }

  function refresh() {
    const value = draft();
    renderPreview(value);
    const check = renderContrast(value);
    $('#aacSummary').textContent = value.enabled
      ? `Apparence ${value.mode === 'imposed' ? 'imposée' : 'proposée'} · ${state.fonts.find((f) => f.id === value.font)?.label || value.font} ${value.baseSize} px`
      : 'Apparence personnalisée désactivée : chaque compte garde son thème.';
    return check;
  }

  function buildForm() {
    const root = $('#adminInterfaceRoot'); if (!root) return;
    const ranges = state.ranges;
    root.innerHTML = `
      <div class="aac-layout">
        <div class="aac-controls">
          <section class="card aac-block">
            <h2>Diffusion</h2>
            <label class="aac-check"><input type="checkbox" id="aacEnabled"> <span>Appliquer cette apparence à tous les espaces de travail</span></label>
            <div class="aac-radios">
              <label><input type="radio" name="aacMode" id="aacModeImposed" value="imposed"> Pris en compte partout, y compris chez les comptes qui ont choisi un thème</label>
              <label><input type="radio" name="aacMode" id="aacModeDefault" value="default"> Proposé : le compte garde son thème s’il en a choisi un</label>
            </div>
            <p class="hint" id="aacSummary">Chargement…</p>
          </section>

          <section class="card aac-block">
            <h2>Couleurs</h2>
            <p class="hint">Fond, cartes, menu, textes, boutons, bordures et <strong>prix</strong> (rouge italique par défaut). La lisibilité est contrôlée juste en dessous.</p>
            <div class="aac-colors">
              ${state.colors.map(({ key, label }) => `
                <div class="aac-color-row">
                  <label for="aacColor-${key}">${esc(label)}</label>
                  <input type="color" id="aacColorInput-${key}" value="${esc(state.custom.colors[key])}" aria-label="${esc(label)}" data-color-picker="${key}">
                  <input type="text" id="aacColor-${key}" value="${esc(state.custom.colors[key])}" maxlength="7" spellcheck="false" inputmode="text" pattern="#[0-9a-fA-F]{6}">
                </div>`).join('')}
            </div>
          </section>

          <section class="card aac-block">
            <h2>Écritures</h2>
            <div class="aac-field">
              <label for="aacFont">Police</label>
              <select id="aacFont">${state.fonts.map(({ id, label }) => `<option value="${esc(id)}"${id === state.custom.font ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>
            </div>
            <div class="aac-field aac-field--range">
              <label for="aacBaseSize">Taille de base <output id="aacBaseSizeOut">${state.custom.baseSize} px</output></label>
              <input type="range" id="aacBaseSize" min="${ranges.baseSize[0]}" max="${ranges.baseSize[1]}" step="1" value="${state.custom.baseSize}">
              <span class="aac-scale"><span>${ranges.baseSize[0]} px</span><span>${ranges.baseSize[1]} px</span></span>
            </div>
            <div class="aac-field">
              <label for="aacWeight">Graisse</label>
              <select id="aacWeight">${WEIGHTS.map((weight) => `<option value="${weight}"${weight === state.custom.weight ? ' selected' : ''}>${weight}${weight === 400 ? ' (normal)' : weight === 700 ? ' (gras)' : ''}</option>`).join('')}</select>
            </div>
            <div class="aac-field aac-field--range">
              <label for="aacLineHeight">Interligne <output id="aacLineHeightOut">${state.custom.lineHeight}</output></label>
              <input type="range" id="aacLineHeight" min="${ranges.lineHeight[0]}" max="${ranges.lineHeight[1]}" step="0.05" value="${state.custom.lineHeight}">
              <span class="aac-scale"><span>serré</span><span>aéré</span></span>
            </div>
            <div class="aac-field aac-field--range">
              <label for="aacRadius">Arrondi des cartes <output id="aacRadiusOut">${state.custom.radius} px</output></label>
              <input type="range" id="aacRadius" min="${ranges.radius[0]}" max="${ranges.radius[1]}" step="1" value="${state.custom.radius}">
              <span class="aac-scale"><span>carré</span><span>très arrondi</span></span>
            </div>
          </section>

          <section class="card aac-block" id="aacTableQrBlock">
            <h2>QR de table et numéro affiché</h2>
            <p class="hint">Le numéro vient toujours du serveur (il est propre à chaque table) : ces réglages décident seulement de son apparence sur l’affiche imprimée et de la taille du QR.</p>
            <div class="aac-field aac-field--range">
              <label for="tqaPoster">Taille de l’affiche <output id="tqaPosterOut">900 px</output></label>
              <input type="range" id="tqaPoster" min="480" max="1600" step="20" value="900">
            </div>
            <div class="aac-field aac-field--range">
              <label for="tqaQr">Taille du QR <output id="tqaQrOut">620 px</output></label>
              <input type="range" id="tqaQr" min="240" max="1400" step="20" value="620">
            </div>
            <div class="aac-field aac-field--range">
              <label for="tqaNumberSize">Taille du numéro <output id="tqaNumberSizeOut">120 px</output></label>
              <input type="range" id="tqaNumberSize" min="40" max="260" step="4" value="120">
            </div>
            <div class="aac-field">
              <label for="tqaNumberWeight">Épaisseur du numéro</label>
              <select id="tqaNumberWeight">
                <option value="400">Fin (400)</option><option value="600">Moyen (600)</option>
                <option value="700">Gras (700)</option><option value="800">Très gras (800)</option><option value="900">Maximum (900)</option>
              </select>
            </div>
            <div class="aac-colors">
              <div class="aac-color-row"><label for="tqaNumberColor">Couleur du numéro</label>
                <input type="color" id="tqaNumberColorPicker" value="#14251f" data-tqa-color="numberColor">
                <input type="text" id="tqaNumberColor" maxlength="7" value="#14251f" spellcheck="false"></div>
              <div class="aac-color-row"><label for="tqaBackground">Fond de l’affiche</label>
                <input type="color" id="tqaBackgroundPicker" value="#ffffff" data-tqa-color="background">
                <input type="text" id="tqaBackground" maxlength="7" value="#ffffff" spellcheck="false"></div>
            </div>
            <div class="aac-field">
              <label for="tqaAlign">Alignement du numéro</label>
              <select id="tqaAlign"><option value="left">À gauche</option><option value="center" selected>Centré</option><option value="right">À droite</option></select>
            </div>
            <div class="aac-field">
              <label for="tqaPosition">Position du numéro</label>
              <select id="tqaPosition"><option value="above">Au-dessus du QR</option><option value="below" selected>En dessous du QR</option></select>
            </div>
            <div class="aac-field">
              <label for="tqaCaption">Libellé au-dessus du numéro</label>
              <input type="text" id="tqaCaption" maxlength="40" value="Table" spellcheck="false">
            </div>
            <label class="aac-check"><input type="checkbox" id="tqaShowCaption" checked> <span>Afficher le libellé</span></label>
            <div class="tqa-preview" id="tqaPreview" aria-label="Aperçu du QR de table"></div>
            <p class="hint" id="tqaStatus" role="status" aria-live="polite"></p>
            <div class="aac-actions">
              <button type="button" class="button primary" id="tqaSave">Enregistrer l’apparence du QR</button>
              <button type="button" class="button outline" id="tqaReset">Valeurs d’origine</button>
            </div>
          </section>

          <section class="card aac-block">
            <h2>Lisibilité</h2>
            <div id="aacContrast"></div>
          </section>

          <div class="aac-actions">
            <button type="button" class="button primary" id="aacSave">Enregistrer l’apparence</button>
            <button type="button" class="button outline" id="aacReset">Revenir aux valeurs d’origine</button>
            <span class="aac-status" id="aacStatus" role="status" aria-live="polite"></span>
          </div>
        </div>

        <aside class="aac-preview-column">
          <div class="aac-preview-head"><h2>Aperçu direct</h2><span class="hint">Écran marchand</span></div>
          <div id="aacPreview" style="font-size:var(--ui-base-size,16px)"></div>
        </aside>
      </div>`;
    bind();
    refresh();
  }

  function setStatus(text, tone = '') {
    const node = $('#aacStatus'); if (!node) return;
    node.textContent = text;
    node.classList.toggle('is-error', tone === 'error');
    node.classList.toggle('is-ok', tone === 'ok');
  }

  function bind() {
    const root = $('#adminInterfaceRoot'); if (!root) return;
    // Saisie d'une couleur : la pipette et le code hexadécimal restent synchronisés, et seules les
    // valeurs complètes (#rrggbb) sont prises en compte pour l'aperçu.
    state.colors.forEach(({ key }) => {
      const picker = $(`#aacColorInput-${key}`, root);
      const text = $(`#aacColor-${key}`, root);
      picker?.addEventListener('input', () => { text.value = picker.value.toLowerCase(); refresh(); });
      text?.addEventListener('input', () => {
        const value = text.value.trim();
        if (/^#[0-9a-f]{6}$/i.test(value)) { picker.value = value.toLowerCase(); refresh(); }
      });
      text?.addEventListener('blur', () => {
        if (!/^#[0-9a-f]{6}$/i.test(text.value.trim())) { text.value = picker.value; refresh(); }
      });
    });
    ['#aacEnabled', '#aacFont', '#aacWeight', '#aacModeImposed', '#aacModeDefault'].forEach((selector) => {
      $(selector, root)?.addEventListener('change', refresh);
    });
    [['#aacBaseSize', '#aacBaseSizeOut', ' px'], ['#aacLineHeight', '#aacLineHeightOut', ''], ['#aacRadius', '#aacRadiusOut', ' px']]
      .forEach(([slider, output, suffix]) => {
        const input = $(slider, root);
        input?.addEventListener('input', () => { const node = $(output, root); if (node) node.textContent = `${input.value}${suffix}`; refresh(); });
      });
    $('#aacSave', root)?.addEventListener('click', save);
    $('#aacReset', root)?.addEventListener('click', reset);
    bindTableQr();
  }

  // ------------------------------------------------------------------ QR de table (§3.6)
  // Le PDG règle l'apparence, le SERVEUR fournit le numéro. L'aperçu utilise le numéro de la
  // première table réelle de l'établissement de démonstration ; à défaut, il affiche « 12 » pour
  // montrer la taille, sans jamais prétendre qu'il s'agit d'une table existante.
  const TQA_API = '/api/admin/table-qr-artwork';
  const tqaState = { value: null, number: '12' };
  const tqaEl = (id) => document.getElementById(id);

  function tqaRead() {
    return {
      posterSize: Number(tqaEl('tqaPoster')?.value) || 900,
      qrSize: Number(tqaEl('tqaQr')?.value) || 620,
      numberSize: Number(tqaEl('tqaNumberSize')?.value) || 120,
      numberWeight: Number(tqaEl('tqaNumberWeight')?.value) || 800,
      numberColor: (tqaEl('tqaNumberColor')?.value || '#14251f').toLowerCase(),
      background: (tqaEl('tqaBackground')?.value || '#ffffff').toLowerCase(),
      align: tqaEl('tqaAlign')?.value || 'center',
      position: tqaEl('tqaPosition')?.value || 'below',
      caption: tqaEl('tqaCaption')?.value || '',
      showCaption: tqaEl('tqaShowCaption')?.checked !== false,
    };
  }

  function tqaApply(value) {
    if (!value) return;
    tqaState.value = value;
    const set = (id, val) => { const node = tqaEl(id); if (node) node.value = val; };
    set('tqaPoster', value.posterSize); set('tqaQr', value.qrSize); set('tqaNumberSize', value.numberSize);
    set('tqaNumberWeight', value.numberWeight); set('tqaNumberColor', value.numberColor); set('tqaBackground', value.background);
    set('tqaAlign', value.align); set('tqaPosition', value.position); set('tqaCaption', value.caption);
    const pickers = { tqaNumberColorPicker: value.numberColor, tqaBackgroundPicker: value.background };
    for (const [id, color] of Object.entries(pickers)) { const node = tqaEl(id); if (node) node.value = color; }
    const caption = tqaEl('tqaShowCaption'); if (caption) caption.checked = value.showCaption !== false;
    tqaRefresh();
  }

  // Aperçu fidèle : un vrai QR (bibliothèque déjà utilisée par l'espace marchand) et le numéro
  // composé avec les réglages en cours, à l'échelle de l'affiche choisie.
  function tqaRefresh() {
    const value = tqaRead();
    const out = (id, text) => { const node = tqaEl(id); if (node) node.textContent = text; };
    out('tqaPosterOut', `${value.posterSize} px`); out('tqaQrOut', `${value.qrSize} px`); out('tqaNumberSizeOut', `${value.numberSize} px`);
    const host = tqaEl('tqaPreview'); if (!host) return;
    const scale = Math.min(280 / value.posterSize, 1);
    const caption = value.showCaption && value.caption ? `<span class="tqa-caption">${esc(value.caption)}</span>` : '';
    const number = `<strong class="tqa-number">${esc(tqaState.number || '12')}</strong>`;
    const block = `<div class="tqa-numberblock">${caption}${number}</div>`;
    host.innerHTML = `<button type="button" class="tqa-poster" style="width:${Math.round(value.posterSize * scale)}px;background:${esc(value.background)};text-align:${esc(value.align)}">
      ${value.position === 'above' ? block : ''}
      <canvas class="tqa-canvas" width="200" height="200" aria-label="Aperçu du QR"></canvas>
      ${value.position === 'below' ? block : ''}
    </button>`;
    host.querySelector('.tqa-poster').style.setProperty('--tqa-number-size', `${Math.max(12, Math.round(value.numberSize * scale))}px`);
    host.querySelector('.tqa-poster').style.setProperty('--tqa-number-weight', String(value.numberWeight));
    host.querySelector('.tqa-poster').style.setProperty('--tqa-number-color', value.numberColor);
    const canvas = host.querySelector('.tqa-canvas');
    const side = Math.round(value.qrSize * scale);
    canvas.style.width = `${side}px`; canvas.style.height = `${side}px`;
    try {
      if (typeof window.qrcode === 'function') {
        const qr = window.qrcode(0, 'M'); qr.addData(`${location.origin}/t/APERCU-REGLE-PDG`); qr.make();
        const count = qr.getModuleCount(); const cell = canvas.width / (count + 6);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#111111';
        for (let row = 0; row < count; row += 1) for (let col = 0; col < count; col += 1) {
          if (qr.isDark(row, col)) ctx.fillRect((col + 3) * cell, (row + 3) * cell, Math.ceil(cell), Math.ceil(cell));
        }
      }
    } catch (_) { /* un aperçu manquant ne doit jamais bloquer l'enregistrement */ }
    const status = tqaEl('tqaStatus');
    if (status && value.qrSize > value.posterSize - 40) { status.textContent = 'Le QR doit rester plus petit que l’affiche.'; status.classList.add('is-error'); }
    else if (status) { status.textContent = ''; status.classList.remove('is-error'); }
  }

  async function tqaLoad() {
    try {
      const response = await fetch(TQA_API, { credentials: 'same-origin', cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.data) { tqaApply(payload.data); return; }
    } catch (_) { /* repli silencieux : les valeurs par défaut restent affichées */ }
    tqaRefresh();
  }

  async function tqaSave() {
    const button = tqaEl('tqaSave'); if (button?.disabled) return;
    const status = tqaEl('tqaStatus');
    if (status) { status.textContent = 'Enregistrement…'; status.classList.remove('is-error'); }
    if (button) { button.disabled = true; button.textContent = 'Enregistrement…'; }
    try {
      const response = await fetch(TQA_API, { method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tqaRead()) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Erreur ${response.status}`);
      tqaApply(payload.data);
      if (status) { status.textContent = `Enregistré. Contraste du numéro : ${payload.data.contrast}:1.`; status.classList.add('is-ok'); }
    } catch (error) {
      if (status) { status.textContent = error.message; status.classList.add('is-error'); }
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Enregistrer l’apparence du QR'; }
    }
  }

  function bindTableQr() {
    const root = $('#adminInterfaceRoot'); if (!root || !tqaEl('tqaPoster')) return;
    ['#tqaPoster', '#tqaQr', '#tqaNumberSize', '#tqaNumberWeight', '#tqaAlign', '#tqaPosition', '#tqaCaption', '#tqaShowCaption']
      .forEach((selector) => tqaEl(selector.replace('#', ''))?.addEventListener('input', tqaRefresh));
    ['tqaNumberColorPicker', 'tqaBackgroundPicker'].forEach((id) => {
      tqaEl(id)?.addEventListener('input', () => {
        const text = tqaEl(id === 'tqaNumberColorPicker' ? 'tqaNumberColor' : 'tqaBackground');
        if (text) text.value = tqaEl(id).value.toLowerCase();
        tqaRefresh();
      });
    });
    ['tqaNumberColor', 'tqaBackground'].forEach((id) => {
      tqaEl(id)?.addEventListener('input', () => {
        const value = tqaEl(id).value.trim();
        if (/^#[0-9a-f]{6}$/i.test(value)) { const picker = tqaEl(id + 'Picker'); if (picker) picker.value = value.toLowerCase(); tqaRefresh(); }
      });
    });
    tqaEl('tqaSave')?.addEventListener('click', tqaSave);
    tqaEl('tqaReset')?.addEventListener('click', async () => {
      tqaApply({ posterSize: 900, qrSize: 620, numberSize: 120, numberWeight: 800, numberColor: '#14251f', background: '#ffffff', align: 'center', position: 'below', caption: 'Table', showCaption: true });
    });
    tqaLoad();
  }

  async function save() {
    if (state.saving) return;
    const value = draft();
    const check = renderContrast(value);
    if (!check.ok) {
      setStatus('Contraste insuffisant : corrigez les textes signalés avant d’enregistrer.', 'error');
      return;
    }
    state.saving = true;
    const button = $('#aacSave'); const label = button?.textContent;
    if (button) { button.disabled = true; button.textContent = 'Enregistrement…'; }
    setStatus('Enregistrement…');
    try {
      const response = await fetch(API, {
        method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Erreur ${response.status}`);
      state.custom = payload.data.custom;
      setStatus(`Apparence enregistrée. ${payload.data.describe || ''}`.trim(), 'ok');
      state.notify('Apparence des espaces enregistrée.');
    } catch (error) {
      setStatus(`Échec de l’enregistrement : ${error.message}`, 'error');
    } finally {
      state.saving = false;
      if (button) { button.disabled = false; button.textContent = label || 'Enregistrer l’apparence'; }
    }
  }

  async function reset() {
    if (state.saving) return;
    const agreed = window.confirm('Revenir aux valeurs d’origine ? Tous les comptes retrouveront le thème standard d’Oymike QR. Aucune donnée commerciale n’est touchée.');
    if (!agreed) return;
    state.saving = true;
    setStatus('Rétablissement…');
    try {
      const response = await fetch(`${API}/reset`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Erreur ${response.status}`);
      state.notify('Apparence remise aux valeurs d’origine.');
      await load();
      setStatus('Valeurs d’origine rétablies.', 'ok');
    } catch (error) {
      setStatus(`Échec du rétablissement : ${error.message}`, 'error');
    } finally { state.saving = false; }
  }

  async function load() {
    const root = $('#adminInterfaceRoot'); if (!root) return;
    root.innerHTML = '<p class="hint aac-loading">Chargement de l’apparence globale…</p>';
    try {
      const response = await fetch(API, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Erreur ${response.status}`);
      const data = payload.data || {};
      state.custom = data.custom;
      state.colors = data.colors || [];
      state.fonts = data.fonts || [];
      if (data.ranges) state.ranges = data.ranges;
      buildForm();
      const enabled = $('#aacEnabled'); if (enabled) enabled.checked = Boolean(state.custom.enabled);
      const imposed = $('#aacModeImposed'); const byDefault = $('#aacModeDefault');
      if (imposed) imposed.checked = state.custom.mode === 'imposed';
      if (byDefault) byDefault.checked = state.custom.mode !== 'imposed';
      refresh();
      state.loaded = true;
    } catch (error) {
      root.innerHTML = `<div class="card"><p class="aac-error">Impossible de charger l’apparence globale : ${esc(error.message)}</p>
        <button type="button" class="button outline" id="aacRetry">Réessayer</button></div>`;
      $('#aacRetry')?.addEventListener('click', load);
    }
  }

  window.QRIAAdminAppearance = {
    mount({ root, notify } = {}) {
      if (notify) state.notify = notify;
      if (root && root.dataset.mounted === '1' && state.loaded) return Promise.resolve();
      if (root) root.dataset.mounted = '1';
      return load();
    },
    reload: load,
  };
})();
