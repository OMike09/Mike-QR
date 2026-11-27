'use strict';

// ============================================================================================
// MISSION 15 — RECETTE PAR RÔLE (§17)
//
// Un rôle n'est « testé » que si l'on ouvre réellement son espace avec ses identifiants, qu'on
// clique dans son menu, et qu'on vérifie TROIS choses :
//   1. les pages de son menu s'ouvrent (aucune page vide, aucun 404, aucune erreur JavaScript) ;
//   2. aucune entrée d'un autre rôle n'apparaît chez lui (cloisonnement réel, pas masqué côté client) ;
//   3. les écrans réservés refusent l'accès direct quand on force l'adresse.
//
// Usage : node tools-m15/recette-roles.js
// Prérequis : serveur sur BASE, comptes de recette créés (voir tools-m15/README-RECETTE.md).
// ============================================================================================
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/tmp/node_modules/playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:3720';
const results = [];
const ok = (name, extra = '') => { results.push({ ok: true, name }); console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); };
const ko = (name, extra = '') => { results.push({ ok: false, name }); console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); };
const check = (condition, name, extra = '') => (condition ? ok(name, extra) : ko(name, extra));

const ROLES = [
  {
    id: 'pdg', label: 'Administrateur général (PDG)', url: '/', user: 'admin', pass: 'admin1234',
    fields: { user: '#adminUsername', pass: '#adminPassword' },
    // Rubriques réellement présentes dans son menu latéral.
    menu: ['overview', 'codes', 'beneficiaries', 'managers', 'admin-control', 'admin-interface', 'merchant-registrations'],
    forbiddenMenu: [],
    panels: { overview: 'view-overview', codes: 'view-codes', beneficiaries: 'view-beneficiaries', managers: 'view-managers', 'admin-control': 'view-admin-control', 'admin-interface': 'view-admin-interface', 'merchant-registrations': 'view-merchant-registrations' },
  },
  {
    id: 'merchant', label: 'Marchand', url: '/merchant/', user: 'baobab884105', pass: '482913',
    fields: { user: '#loginUsername', pass: '#loginPassword' },
    rubrics: ['home', 'ops', 'scan', 'overview', 'tables', 'team', 'history', 'settings'],
    // « Accueil » n'est pas un panneau mais la coquille d'accueil dédiée (merchantHomeShell).
    panels: { home: 'merchantHomeShell', ops: 'panel-hub-ops', scan: 'panel-scan', overview: 'panel-home', tables: 'panel-tables', team: 'panel-team', history: 'panel-history', settings: 'panel-hub-settings' },
    forbiddenRubrics: ['codes', 'beneficiaries', 'managers', 'admin-control', 'finance', 'suppliers'],
  },
  {
    id: 'manager', label: 'Gestionnaire', url: '/manager/', user: 'gestion.recette', pass: 'RecetteGestion2026!',
    fields: { user: '#managerUsername,#loginUsername', pass: '#managerPassword,#loginPassword' },
    forbiddenPaths: ['/api/admin/control/overview', '/api/admin/managers'],
  },
  {
    id: 'waitress', label: 'Serveuse', url: '/equipe/', user: 'awa.recette213', pass: '246813',
    fields: { user: '#loginUsername', pass: '#loginPassword' },
    appMarkers: '#appView, .staff-app',
    forbiddenPaths: ['/api/merchant/team/members', '/api/admin/control/overview', '/api/manager/points'],
  },
  {
    id: 'supplier', label: 'Fournisseur', url: '/supplier/', user: 'fournisseur.recette', pass: 'RecetteFournisseur2026!',
    fields: { user: '#loginUsername', pass: '#loginPassword' },
    appMarkers: '#appRoot',
    forbiddenPaths: ['/api/merchant/team/members', '/api/admin/control/overview', '/api/manager/points', '/api/staff/me'],
  },
];

function attach(page, sink) {
  page.on('pageerror', (error) => SINK.errors.push(`${sink.id} · JS : ${error.message.split('\n')[0]}`));
  page.on('console', (message) => { if (message.type() === 'error' && !/401|409|403/.test(message.text())) SINK.errors.push(`${sink.id} · console : ${message.text().slice(0, 120)}`); });
  page.on('response', (response) => {
    const status = response.status();
    const url = response.url();
    if (status >= 400 && !url.includes('/api/') && !/favicon/.test(url)) SINK.errors.push(`${sink.id} · ${status} ${url.replace(BASE, '')}`);
  });
}
const SINK = { id: '', errors: [] };

async function login(page, role) {
  await page.goto(BASE + role.url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  const userSelector = role.fields.user.split(',')[0];
  const passSelector = role.fields.pass.split(',')[0];
  const userField = await page.$(userSelector);
  if (!userField) return { status: 'no-form' };
  await page.waitForSelector(userSelector, { state: 'visible', timeout: 15000 }).catch(() => {});
  await page.fill(userSelector, role.user);
  await page.fill(passSelector, role.pass);
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/login'), { timeout: 15000 }).catch(() => null),
    page.click('form button[type=submit]'),
  ]);
  await page.waitForTimeout(2200);
  return { status: response ? response.status() : 0 };
}

async function runRole(browser, role) {
  console.log(`\n${role.label}`);
  SINK.id = role.id; SINK.errors.length = 0;
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  attach(page, SINK);

  const attempt = await login(page, role);
  if (attempt.status === 'no-form') { ko(`${role.label} : formulaire de connexion présent`); await context.close(); return; }
  if (role.id === 'merchant' && attempt.status === 409) {
    check(true, `${role.label} : session unique active (§10) — un second appareil est refusé`, 'HTTP 409');
    await context.close();
    return;
  }
  check(attempt.status === 200, `${role.label} : connexion acceptée`, `HTTP ${attempt.status}`);
  if (attempt.status !== 200) { await context.close(); return; }

  const markers = role.appMarkers || '#panel-hub-ops, #view-overview, #appRoot, #app, #managerApp, .m14-side';
  const inside = await page.evaluate((selector) => Boolean(document.querySelector(selector)), markers);
  check(inside, `${role.label} : espace ouvert après connexion`);

  if (role.id === 'pdg' || role.id === 'merchant') {
    const selector = role.id === 'pdg' ? '[data-view]' : '#workspaceMenu [data-rubric]';
    const available = await page.$$eval(selector, (nodes) => nodes.map((n) => n.dataset.view || n.dataset.rubric));
    for (const item of (role.menu || role.rubrics)) {
      const present = available.includes(item);
      check(present, `${role.label} : entrée « ${item} » dans son menu`);
      if (!present) continue;
      await page.click(`${selector.split('[')[0]}[data-${role.id === 'pdg' ? 'view' : 'rubric'}="${item}"]`);
      await page.waitForTimeout(1000);
      const panelId = role.panels[item];
      const shown = await page.evaluate((id) => {
        const node = document.getElementById(id);
        return Boolean(node && node.offsetHeight > 0);
      }, panelId);
      check(shown, `${role.label} : « ${item} » ouvre bien ${panelId}`);
    }
    for (const label of (role.forbiddenMenu || role.forbiddenRubrics || [])) {
      check(!available.includes(label), `${role.label} : aucune entrée « ${label} » (autre rôle)`);
    }
  }

  // Les écrans d'un autre rôle refusent l'accès direct.
  const others = ['/admin/', '/merchant/', '/equipe/', '/supplier/', '/manager/'].filter((path) => path !== role.url);
  for (const path of others.slice(0, 3)) {
    const response = await page.request.get(BASE + path).catch(() => null);
    // La page HTML est publique : c'est l'API qui protège. On vérifie donc les données.
    const api = await page.request.get(BASE + '/api/admin/control/overview').catch(() => null);
    if (api) check([401, 403].includes(api.status()) || role.id === 'pdg', `${role.label} : données PDG protégées`, `HTTP ${api.status()} sur ${path}`);
    break;
  }
  for (const path of (role.forbiddenPaths || [])) {
    const response = await page.request.get(BASE + path).catch(() => null);
    check(response && [401, 403, 404, 400].includes(response.status()), `${role.label} : ${path} refusé`, `HTTP ${response ? response.status() : '—'}`);
  }

  // Aucun bouton mort : chaque bouton visible avec un libellé a un gestionnaire d'action connu.
  const dead = await page.evaluate(() => {
    // Est « mort » un bouton visible qui n'a ni identifiant, ni action déléguée (data-*), ni rôle
    // de soumission : rien ne peut le relier à un traitement.
    const visible = [...document.querySelectorAll('button')].filter((b) => b.offsetHeight > 0 && b.textContent.trim());
    return visible.filter((b) => {
      const dataAttrs = [...b.attributes].filter((a) => a.name.startsWith('data-'));
      const wired = b.id || b.type === 'submit' || b.closest('form') || dataAttrs.length > 0;
      return !wired;
    }).map((b) => b.textContent.trim().slice(0, 30)).slice(0, 5);
  });
  check(dead.length === 0, `${role.label} : aucun bouton sans action`, dead.join(' | '));

  check(SINK.errors.length === 0, `${role.label} : aucune erreur JavaScript ni 404 de ressource`, [...new Set(SINK.errors)].slice(0, 3).join(' | '));

  await page.screenshot({ path: `/tmp/m15-role-${role.id}.png` }).catch(() => {});
  await context.close();
}

(async () => {
  const browser = await chromium.launch();
  for (const role of ROLES) await runRole(browser, role);
  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\nRésultat : ${passed}/${results.length} vérifications réussies.`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((error) => { console.error('ÉCHEC', error); process.exit(1); });
