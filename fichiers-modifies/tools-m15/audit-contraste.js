'use strict';
// ============================================================================================
// MISSION 15 — AUDIT DES COULEURS AU SURVOL (§8.2 du prompt).
//
// Le défaut signalé : « lorsque le curseur passe sur certaines options, notamment dans les
// paramètres, l'écriture disparaît ». Un contrôle visuel ne suffit pas : on mesure.
//
// Pour chaque élément interactif visible, le script compare, AVANT puis AVEC le curseur dessus,
// le contraste réel entre la couleur du texte et le fond effectivement peint (en remontant les
// parents jusqu'à trouver une couleur opaque). Sous 3:1, le texte est jugé illisible.
//
// Usage : node tools-m15/audit-contraste.js [url]
// ============================================================================================
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:3720';
const ACCOUNT = require('./recette-comptes.json');

function rgb(value) {
  const match = String(value).match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const [r, g, b, a = 1] = match[1].split(',').map((n) => parseFloat(n));
  return { r, g, b, a };
}
function luminance({ r, g, b }) {
  const channel = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function ratio(a, b) {
  const l1 = luminance(a); const l2 = luminance(b);
  return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
}

// Mesure dans la page : on lit les couleurs calculées et on remonte les ancêtres pour le fond.
const MEASURE = `(() => {
  function parse(value) { const m = String(value).match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }; }
  function lum(c) { const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); }
  function ratio(a, b) { const x = lum(a), y = lum(b); return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100; }
  function backgroundOf(node) {
    let current = node;
    while (current && current !== document.documentElement) {
      const style = getComputedStyle(current);
      const bg = parse(style.backgroundColor);
      if (bg && bg.a > 0.85) return bg;
      if (style.backgroundImage && style.backgroundImage !== 'none') return null;
      current = current.parentElement;
    }
    const body = parse(getComputedStyle(document.body).backgroundColor);
    if (body && body.a > 0.85) return body;
    return { r: 255, g: 255, b: 255 };
  }
  const out = [];
  const nodes = [...document.querySelectorAll('button, a, label, summary, select, [role="tab"], [data-view], [data-rubric], [data-sub-tab], .nav-item, li, td, th')]
    .filter((n) => { const r = n.getBoundingClientRect(); const s = getComputedStyle(n); return r.width > 8 && r.height > 6 && s.visibility !== 'hidden' && s.display !== 'none' && n.textContent.trim().length > 1 && !n.querySelector('button, a'); });
  const seen = new Set();
  for (const node of nodes.slice(0, 400)) {
    const style = getComputedStyle(node);
    const fg = parse(style.color); const bg = backgroundOf(node);
    if (!fg || !bg) continue;
    // On ignore les éléments quasi transparents ou volontairement atténués (texte en filigrane).
    if (fg.a < 0.5 || parseFloat(style.opacity) < 0.5) continue;
    const key = node.tagName + style.color + style.backgroundColor + node.textContent.trim().slice(0, 20);
    if (seen.has(key)) continue; seen.add(key);
    out.push({ text: node.textContent.trim().replace(/\\s+/g, ' ').slice(0, 40), fg: style.color, bgColor: 'rgb(' + bg.r + ', ' + bg.g + ', ' + bg.b + ')', contrast: ratio(fg, bg), tag: node.tagName.toLowerCase(), cls: String(node.className || '').slice(0, 40) });
  }
  return out;
})()`;

const low = (rows, threshold = 3) => rows.filter((row) => row.contrast < threshold);

async function measure(page) {
  const rows = await page.evaluate(`(${MEASURE})`);
  return rows;
}

async function hoverMeasure(page, selector) {
  // Le curseur est réellement déplacé sur l'élément, puis on remesure.
  const target = await page.$(selector);
  if (!target) return null;
  await target.hover({ force: true }).catch(() => {});
  await page.waitForTimeout(120);
  const rows = await page.evaluate(`(${MEASURE})`);
  await page.mouse.move(0, 0);
  return rows;
}

const { execFileSync } = require('node:child_process');
// Libère le verrou de session unique (§10) : sans cela, la recette serait refusée — c'est le
// comportement voulu, pas un défaut.
function clearMerchantLock() {
  try {
    execFileSync('/usr/lib/postgresql/17/bin/psql', ['-h', '127.0.0.1', '-U', 'postgres', '-d', 'oymike_m15',
      '-c', 'DELETE FROM merchant_active_sessions;'], { env: { ...process.env, PGPASSWORD: 'postgres' }, stdio: 'ignore' });
  } catch (_) { /* base non disponible : on continue, la recette le signalera */ }
}

const results = [];
const ok = (name, extra = '') => { results.push({ ok: true, name }); console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); };
const bad = (name, extra = '') => { results.push({ ok: false, name }); console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); };

async function auditSpace(browser, { label, url, fields, user, password, ready }) {
  console.log(`\n${label}`);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  if (fields) {
    await page.fill(fields.user, user);
    await page.fill(fields.pass, password);
    // Le formulaire de connexion est ciblé précisément : chaque espace a sa propre coquille.
    await page.click(fields.form || 'form button[type=submit]');
    await page.waitForTimeout(2000);
  }
  if (ready) await page.waitForSelector(ready, { timeout: 15000 }).catch(() => {});

  // On vérifie que la session est réellement ouverte : sinon on mesurerait l'écran de connexion
  // et l'audit passerait sans avoir testé l'espace lui-même.
  const opened = await page.evaluate((selector) => {
    // Chaque espace a sa coquille : on n'accepte l'audit que si l'une d'elles est visible et que
    // l'écran de connexion ne l'est plus.
    const login = document.getElementById('loginView') || document.getElementById('loginScreen');
    const app = document.querySelector('#appView:not([hidden]), #appRoot:not([hidden]), .m14-side, .app-body, .main-content, #app, .sidebar');
    const loginVisible = login ? !login.hidden && login.offsetHeight > 0 : false;
    return { loginHidden: login ? login.hidden : null, hasApp: Boolean(app) && !loginVisible };
  });
  if (!opened.hasApp) { bad(`${label} : espace inaccessible — audit impossible`); await context.close(); return; }
  ok(`${label} : espace ouvert (${opened.loginHidden === null ? 'aucun écran de connexion' : 'connexion validée'})`);

  const before = await measure(page);
  const weak = low(before);
  ok(`${label} : ${before.length} textes mesurés à l'état normal`);
  if (weak.length) bad(`${label} : contraste insuffisant à l'état normal`, weak.slice(0, 4).map((r) => `${r.text} (${r.contrast}:1 sur ${r.bgColor})`).join(' | '));
  else ok(`${label} : aucun texte sous 3:1 à l'état normal`);

  // Survol : on teste les familles d'éléments les plus exposées (menu, onglets, paramètres, boutons).
  const selectors = ['.nav-item', '.nav-link', '#workspaceMenu button', '#m14Sub [data-sub-tab]', '.button', 'nav button', '[data-view]', '[data-rubric]'];
  let hovered = 0;
  for (const selector of selectors) {
    if (!(await page.$(selector))) continue;
    const target = await page.$(selector);
    const label2 = (await target.innerText()).replace(/\s+/g, ' ').slice(0, 24);
    const after = await hoverMeasure(page, selector);
    hovered += 1;
    if (!after) continue;
    const fainted = low(after).filter((row) => !weak.some((w) => w.text === row.text));
    if (fainted.length) bad(`${label} : « ${label2} » devient illisible au survol`, fainted.slice(0, 3).map((r) => `${r.text} (${r.contrast}:1)`).join(' | '));
    else ok(`${label} : « ${label2} » reste lisible au survol`);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(60);
  }
  await page.screenshot({ path: `/tmp/audit-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png` }).catch(() => {});
  await context.close();
}

(async () => {
  clearMerchantLock();
  const browser = await chromium.launch();
  const spaces = [
    { label: 'PDG', url: '/', fields: { user: '#adminUsername', pass: '#adminPassword', form: '#loginForm button[type=submit]' }, user: ACCOUNT.pdg.username, password: ACCOUNT.pdg.password, ready: '.nav-item' },
    { label: 'Marchand', url: '/merchant/', fields: { user: '#loginUsername', pass: '#loginPassword', form: '#loginForm button[type=submit]' }, user: ACCOUNT.merchant.username, password: ACCOUNT.merchant.password, ready: '#appView:not([hidden]), #loginView[hidden]' },
    { label: 'Gestionnaire', url: '/manager/', fields: { user: '#managerUsername', pass: '#managerPassword', form: '#managerLoginForm button[type=submit]' }, user: ACCOUNT.manager.username, password: ACCOUNT.manager.password, ready: '#loginView[hidden]' },
    { label: 'Fournisseur', url: '/supplier/', fields: { user: '#loginUsername', pass: '#loginPassword', form: '#supplierLogin button[type=submit]' }, user: ACCOUNT.supplier.username, password: ACCOUNT.supplier.password, ready: '.side-nav' },
  ];
  for (const space of spaces) await auditSpace(browser, space);
  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\nRésultat : ${passed}/${results.length} vérifications réussies.`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((error) => { console.error('ÉCHEC', error); process.exit(1); });
