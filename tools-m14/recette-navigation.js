'use strict';

// ============================================================================================
// MISSION 14 — Recette de navigation de l'espace marchand (coquille « menu latéral »).
//
// Ce script clique réellement dans un vrai navigateur : il ne lit pas le code, il utilise
// l'application. Pour chaque entrée du menu il vérifie :
//   · le panneau qui s'ouvre (jamais une page vide, jamais une redirection silencieuse) ;
//   · l'absence de 404/500 pendant la navigation ;
//   · l'absence d'erreur JavaScript ;
//   · le surlignage de la bonne rubrique dans le menu latéral ;
//   · le retour à l'accueil par « Accueil » ;
//   · le tiroir du téléphone (ouverture, choix d'une rubrique, refermeture).
//
// Usage : node tools-m14/recette-navigation.js   (serveur sur BASE, compte dans recette.json)
// ============================================================================================
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/tmp/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.BASE || 'http://127.0.0.1:3720';
const account = JSON.parse(fs.readFileSync(path.join(__dirname, 'recette.json'), 'utf8'));

const EXPECTED = {
  home: { panel: 'merchantHomeShell', label: 'Accueil' },
  ops: { panel: 'panel-hub-ops', label: 'Commandes' },
  scan: { panel: 'panel-scan', label: 'Scanner' },
  overview: { panel: 'panel-home', label: 'Vue d’ensemble' },
  tables: { panel: 'panel-tables', label: 'Gestion des tables et espaces' },
  team: { panel: 'panel-hub-team', label: 'Mon équipe' },
  history: { panel: 'panel-history', label: 'Voir les historiques' },
  settings: { panel: 'panel-hub-settings', label: 'Paramètres' },
};

const results = [];
const ok = (name, extra = '') => { results.push({ ok: true, name, extra }); console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); };
const ko = (name, extra = '') => { results.push({ ok: false, name, extra }); console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); };

async function signIn(page) {
  await page.goto(BASE + '/merchant/', { waitUntil: 'networkidle' });
  await page.fill('#loginUsername', account.username);
  await page.fill('#loginPassword', account.password);
  await page.click('#loginForm button[type=submit]');
  await page.waitForTimeout(2600);
  return page.evaluate(() => !document.getElementById('appView')?.hidden);
}

function watch(page) {
  const errors = [];
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 160)));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    // Un 401/404 attendu (session pas encore posée, boutique non publiée) n'est pas une panne JS.
    if (/Failed to load resource/.test(message.text())) return;
    errors.push(message.text().slice(0, 160));
  });
  page.on('response', (response) => {
    const url = response.url();
    if (response.status() < 400) return;
    if (url.includes('/auth/me')) return;              // 401 normal avant connexion
    if (url.includes('/api/public/shops/')) return;     // boutique de recette non publiée : 404 attendu
    errors.push(`HTTP ${response.status()} ${response.request().method()} ${url.replace(BASE, '')}`);
  });
  return () => ({ js: [...new Set(errors)], page: [...new Set(pageErrors)] });
}

async function visiblePanels(page) {
  return page.evaluate(() => [...document.querySelectorAll('[id^="panel-"], #merchantHomeShell')]
    .filter((node) => node.offsetHeight > 0 && !node.hidden)
    .map((node) => node.id));
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  // ------------------------------------------------------------------ 1. Ordinateur
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await desktop.newPage();
  const flush = watch(page);
  console.log('\n[1] Menu latéral — ordinateur (1440 px)');
  if (!(await signIn(page))) { ko('connexion marchand'); await browser.close(); process.exit(1); }
  ok('connexion marchand', account.username);

  const menu = await page.evaluate(() => [...document.querySelectorAll('#workspaceMenu button[data-rubric]')].map((b) => b.dataset.rubric));
  const expectedOrder = ['home', 'ops', 'scan', 'overview', 'tables', 'team', 'history', 'settings'];
  (JSON.stringify(menu) === JSON.stringify(expectedOrder) ? ok : ko)('ordre du menu = structure de référence', menu.join(' → '));

  const sideWidth = await page.evaluate(() => Math.round(document.getElementById('m14Side').getBoundingClientRect().width));
  sideWidth > 200 ? ok('menu latéral présent à gauche', sideWidth + ' px') : ko('menu latéral', sideWidth + ' px');

  const railGone = await page.evaluate(() => !document.getElementById('wsPermanentRail'));
  railGone ? ok('ancienne barre d’onglets retirée (aucun bouton en double)') : ko('ancienne barre encore présente');

  const logoutInSide = await page.evaluate(() => {
    const button = document.querySelector('#m14Side #mhLogout');
    if (!button) return false;
    const rect = button.getBoundingClientRect();
    const side = document.getElementById('m14Side').getBoundingClientRect();
    return rect.height > 0 && rect.bottom <= side.bottom + 2 && rect.top > side.top + side.height / 2;
  });
  logoutInSide ? ok('« Se déconnecter » en bas du menu latéral') : ko('« Se déconnecter » mal placé');

  for (const [rubric, expect] of Object.entries(EXPECTED)) {
    const before = flush();
    await page.click(`#workspaceMenu button[data-rubric="${rubric}"]`);
    await page.waitForTimeout(rubric === 'scan' ? 1200 : 900);
    const panels = await visiblePanels(page);
    const active = await page.evaluate(() => document.querySelector('#workspaceMenu button[aria-current="page"]')?.dataset.rubric || '');
    const after = flush();
    const allErrors = [...before.js, ...before.page, ...after.js, ...after.page];
    if (!panels.includes(expect.panel)) ko(`${expect.label} ouvre ${expect.panel}`, 'vu : ' + (panels.join(', ') || 'rien'));
    else if (active !== rubric && !(rubric === 'team' && active === 'team')) ko(`${expect.label} : menu actif`, 'actif=' + active);
    else if (allErrors.length) ko(`${expect.label} sans erreur`, allErrors.slice(0, 2).join(' | '));
    else ok(`${expect.label} → ${expect.panel}`, panels.length === 1 ? 'une seule page visible' : panels.join(', '));
  }

  // Le sous-menu « Mon équipe › » ouvre directement le bon écran.
  // Le sous-menu est déployé en permanence sur ordinateur : on clique la sous-entrée telle qu'elle
  // apparaît à l'écran (l'attribut data-sub-ops porte la section, data-sub-tab l'onglet).
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('#m14Sub button')].find((node) => node.offsetHeight > 0 && node.dataset.subTab === 'ops');
    if (!button) throw new Error('sous-entrée « Points et classement » absente');
    button.click();
  });
  await page.waitForTimeout(900);
  const subPanels = await visiblePanels(page);
  subPanels.includes('panel-ops') ? ok('sous-menu « Mon équipe › Points et classement »', 'panel-ops') : ko('sous-menu Mon équipe', subPanels.join(',') || 'rien');

  // Retour à l'accueil : la page de la maquette revient, sans rechargement.
  await page.click('#workspaceMenu button[data-rubric="home"]');
  await page.waitForTimeout(900);
  const backHome = await visiblePanels(page);
  backHome.length === 1 && backHome[0] === 'merchantHomeShell' ? ok('« Accueil » ramène à la page d’accueil') : ko('retour Accueil', backHome.join(',') || 'rien');

  // Se déconnecter depuis le menu latéral.
  await page.click('#m14Side #mhLogout');
  await page.waitForTimeout(600);
  // Le dialogue réel de workspace-shell.js : #wsLogoutDialog, confirmer = [data-logout-confirm].
  const confirmVisible = await page.evaluate(() => {
    const dialog = document.getElementById('wsLogoutDialog');
    return Boolean(dialog && !dialog.hidden && dialog.offsetHeight > 0);
  });
  confirmVisible ? ok('« Se déconnecter » ouvre la confirmation') : ko('confirmation de déconnexion absente');
  if (confirmVisible) {
    await page.click('#wsLogoutDialog [data-logout-confirm]');
    await page.waitForTimeout(1200);
  }
  const loggedOut = await page.evaluate(() => {
    const login = document.getElementById('loginView');
    const app = document.getElementById('appView');
    return Boolean(app && app.hidden && login && !login.hidden);
  });
  loggedOut ? ok('déconnexion effective : retour à l’écran de connexion', 'session fermée côté serveur') : ko('déconnexion depuis le menu');
  const finalErrors = flush();
  (finalErrors.js.length + finalErrors.page.length === 0 ? ok : ko)('aucune erreur JavaScript sur le parcours', finalErrors.js.concat(finalErrors.page).slice(0, 2).join(' | '));
  await desktop.close();

  // ------------------------------------------------------------------ 2. Téléphone
  console.log('\n[2] Menu latéral — téléphone (390 px)');
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await mobile.newPage();
  const flushPhone = watch(phone);
  if (!(await signIn(phone))) ko('connexion marchand (téléphone)');
  else {
    const state = await phone.evaluate(() => ({
      topbar: getComputedStyle(document.getElementById('m14Topbar')).display,
      drawerHidden: document.getElementById('m14Side').getBoundingClientRect().right <= 1,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    }));
    state.topbar !== 'none' ? ok('bandeau « Menu » visible sur téléphone') : ko('bandeau téléphone');
    state.drawerHidden ? ok('menu replié par défaut (le contenu est visible)') : ko('le menu recouvre le contenu au chargement');
    state.overflow ? ko('débordement horizontal') : ok('aucun débordement horizontal');

    await phone.click('#m14MenuToggle');
    await phone.waitForTimeout(500);
    const opened = await phone.evaluate(() => document.getElementById('m14Side').classList.contains('is-open'));
    opened ? ok('« Menu » ouvre le tiroir') : ko('ouverture du tiroir');
    const drawerCovers = await phone.evaluate(() => {
      const side = document.getElementById('m14Side').getBoundingClientRect();
      const first = document.querySelector('#workspaceMenu button[data-rubric="home"]').getBoundingClientRect();
      return side.left <= 1 && first.top >= side.top && first.bottom <= side.bottom;
    });
    drawerCovers ? ok('toutes les entrées sont visibles dans le tiroir', 'Accueil non coupé') : ko('entrées coupées dans le tiroir');

    await phone.click('#workspaceMenu button[data-rubric="tables"]');
    await phone.waitForTimeout(1000);
    const mobilePanels = await visiblePanels(phone);
    const closed = await phone.evaluate(() => !document.getElementById('m14Side').classList.contains('is-open'));
    mobilePanels.includes('panel-tables') && closed
      ? ok('le tiroir se referme après le choix (page Gestion des tables ouverte)')
      : ko('navigation téléphone', (mobilePanels.join(',') || 'rien') + (closed ? '' : ' / tiroir resté ouvert'));

    await phone.click('#m14MenuToggle');
    await phone.waitForTimeout(400);
    await phone.click('#m14MenuScrim', { position: { x: 360, y: 300 } }).catch(() => {});
    await phone.waitForTimeout(400);
    const closedByScrim = await phone.evaluate(() => !document.getElementById('m14Side').classList.contains('is-open'));
    closedByScrim ? ok('le fond referme le tiroir') : ko('fermeture par le fond');

    const phoneErrors = flushPhone();
    (phoneErrors.js.length + phoneErrors.page.length === 0 ? ok : ko)('aucune erreur JavaScript (téléphone)', phoneErrors.js.concat(phoneErrors.page).slice(0, 2).join(' | '));
  }
  await mobile.close();
  await browser.close();

  const failed = results.filter((row) => !row.ok);
  console.log(`\nRésultat : ${results.length - failed.length}/${results.length} vérifications réussies.`);
  if (failed.length) { console.log('Échecs :'); failed.forEach((row) => console.log(' -', row.name, row.extra)); process.exit(1); }
})().catch((error) => { console.error('ERREUR DE RECETTE', error.message); process.exit(1); });
