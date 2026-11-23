'use strict';

// ============================================================================================
// Mission 7 — tests d'interface de la CONSIGNATION côté équipe et côté Administrateur général.
//
// Ce que ce script vérifie, sur un vrai navigateur (Playwright) et un vrai serveur :
//   1. le gérant général voit la consignation, enregistre un dépôt, reçoit le code secret,
//      retrouve la fiche par son code et enregistre un retour ;
//   2. la serveuse ne peut ni rendre ni rembourser (permission `consignment.return` absente par
//      défaut) : les boutons ne sont pas affichés et le serveur refuse de toute façon ;
//   3. l'Administrateur général supervise les consignations sans pouvoir les modifier ;
//   4. aucun code secret n'apparaît en clair dans les listes.
//
// Lancement : NODE_PATH=/tmp/node_modules BASE=http://127.0.0.1:4931 node tools-test/t-ui-m7.js
// ============================================================================================
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:4931';
const setup = require('./lib-equipe');

let ko = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'OK  ' : 'KO  '} ${label} — ${detail}`);
  if (!ok) ko += 1;
}

async function attach(browser, cookie, viewport) {
  const context = await browser.newContext(viewport ? { viewport, isMobile: true, hasTouch: true } : {});
  const [pair] = cookie.split(';');
  const index = pair.indexOf('=');
  await context.addCookies([{ name: pair.slice(0, index), value: pair.slice(index + 1), domain: '127.0.0.1', path: '/' }]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return { context, page, errors };
}

(async () => {
  const s = await setup();
  const dep = await s.j('POST', '/api/staff/consignments', {
    kind: 'bottle', bottleTypeId: s.type.id, quantity: 6, customerName: 'Client Gérant', idempotencyKey: 'ui-m7-dep',
  }, s.managerCookie);
  check('dépôt initial enregistré', dep.s === 201, `${dep.j?.data?.consignment?.reference || dep.j?.error}`);
  const secret = dep.j.data.code;
  const reference = dep.j.data.consignment.reference;

  const browser = await chromium.launch();

  // ------------------------------------------------------------------ gérant général
  const gerant = await attach(browser, s.managerCookie);
  await gerant.page.goto(`${BASE}/equipe/`, { waitUntil: 'domcontentloaded' });
  await gerant.page.waitForTimeout(1800);
  const tabVisible = await gerant.page.evaluate(() => { const t = document.querySelector('[data-tab="consignment"]'); return !!t && !t.hidden; });
  check('onglet Consignation visible pour le gérant', tabVisible, tabVisible ? 'affiché' : 'masqué');
  await gerant.page.evaluate(() => document.querySelector('[data-tab="consignment"]').click());
  await gerant.page.waitForTimeout(1800);

  const heroText = await gerant.page.evaluate(() => document.getElementById('staffConsignRoot').innerText.replace(/\s+/g, ' '));
  check('statistiques réelles affichées', heroText.includes('RESTANT À RENDRE') && heroText.includes('6'), heroText.slice(0, 90));
  check('aucun code secret dans la liste', !heroText.includes(secret), `code ${secret} absent de l'écran`);

  await gerant.page.evaluate(() => document.querySelector('[data-staff-consign-new="bottle"]').click());
  await gerant.page.waitForTimeout(500);
  await gerant.page.fill('#sName', 'Client Interface');
  await gerant.page.selectOption('#sType', s.type.id);
  await gerant.page.fill('#sQty', '2');
  await gerant.page.evaluate(() => document.querySelector('#staffDeposit').requestSubmit());
  await gerant.page.waitForTimeout(2000);
  const codeScreen = await gerant.page.evaluate(() => {
    const block = document.querySelector('.consign-code-block code');
    return block ? block.textContent.trim() : 'aucun code affiché';
  });
  check('le code secret est affiché une fois après le dépôt', /^[A-Z0-9]{6}$/.test(codeScreen), `code affiché : ${codeScreen}`);
  await gerant.page.screenshot({ path: '/tmp/ui-m7-code-equipe.png' });

  // Retrouver par code puis rendre 1 bouteille
  await gerant.page.evaluate(() => { document.querySelector('[data-staff-close]')?.click(); document.querySelector('[data-staff-consign-lookup]').click(); });
  await gerant.page.waitForTimeout(400);
  await gerant.page.fill('#sCode', secret);
  await gerant.page.evaluate(() => document.querySelector('#staffLookup').requestSubmit());
  await gerant.page.waitForTimeout(1200);
  const foundText = await gerant.page.evaluate(() => document.getElementById('staffLookupResult').innerText.replace(/\s+/g, ' '));
  check('recherche par code dans l’espace équipe', foundText.includes(reference), foundText.slice(0, 90));

  await gerant.page.evaluate(() => document.querySelector('#staffLookupResult [data-consign-return]')?.click());
  await gerant.page.waitForTimeout(500);
  await gerant.page.fill('#sValue', '1');
  await gerant.page.fill('#sWhy', 'Retour comptoir');
  await gerant.page.evaluate(() => document.querySelector('#staffMove').requestSubmit());
  await gerant.page.waitForTimeout(1800);
  const afterReturn = await gerant.page.evaluate(() => document.getElementById('staffConsignRoot').innerText.replace(/\s+/g, ' '));
  check('retour enregistré depuis l’interface', afterReturn.includes('1 rendue') || afterReturn.includes('RENDUES 1'), afterReturn.slice(0, 120));
  check('aucune erreur JavaScript (gérant)', gerant.errors.length === 0, gerant.errors.join(' | ') || 'aucune');

  // ------------------------------------------------------------------ serveuse
  const serveuse = await attach(browser, s.waitressCookie);
  await serveuse.page.goto(`${BASE}/equipe/`, { waitUntil: 'domcontentloaded' });
  await serveuse.page.waitForTimeout(1800);
  const waitressTab = await serveuse.page.evaluate(() => { const t = document.querySelector('[data-tab="consignment"]'); return !!t && !t.hidden; });
  check('onglet Consignation visible pour la serveuse (consulter + déposer)', waitressTab, waitressTab ? 'affiché' : 'masqué');
  await serveuse.page.evaluate(() => document.querySelector('[data-tab="consignment"]').click());
  await serveuse.page.waitForTimeout(1800);
  const waitressButtons = await serveuse.page.evaluate(() => Array.from(document.querySelectorAll('#staffConsignRoot .consign-row-actions button')).map((b) => b.textContent.trim()));
  check('aucun bouton de retour/remboursement pour la serveuse', waitressButtons.length === 0, waitressButtons.join(',') || 'aucun bouton');
  // Le serveur refuse même si l'interface était contournée.
  const forced = await s.j('POST', `/api/staff/consignments/${dep.j.data.consignment.id}/return`, { quantity: 1, reason: 'contournement', idempotencyKey: 'force-ui-1' }, s.waitressCookie);
  check('serveur refuse le retour d’une serveuse', forced.s === 403, `HTTP ${forced.s} ${forced.j?.code || ''}`);
  check('aucune erreur JavaScript (serveuse)', serveuse.errors.length === 0, serveuse.errors.join(' | ') || 'aucune');

  // ------------------------------------------------------------------ administrateur général
  const admin = await attach(browser, s.adminCookie);
  await admin.page.goto(`${BASE}/admin/`, { waitUntil: 'domcontentloaded' });
  await admin.page.waitForTimeout(1800);
  await admin.page.evaluate(() => document.querySelector('[data-view="admin-consign"]').click());
  await admin.page.waitForTimeout(2200);
  const adminText = await admin.page.evaluate(() => document.getElementById('adminConsignRoot').innerText.replace(/\s+/g, ' '));
  check('supervision des consignations chargée', adminText.includes('Bouteilles et crédits des clients') && adminText.includes('Par boutique'), adminText.slice(0, 90));
  check('aucun code secret dans la supervision', !adminText.includes(secret), 'codes absents');
  const adminButtons = await admin.page.evaluate(() => Array.from(document.querySelectorAll('#adminConsignRoot button')).map((b) => b.textContent.trim()));
  check('supervision en lecture seule', adminButtons.every((label) => /Actualiser|^$/.test(label)), adminButtons.join(',') || 'aucun bouton d’action');
  check('aucune erreur JavaScript (administrateur)', admin.errors.length === 0, admin.errors.join(' | ') || 'aucune');
  await admin.page.screenshot({ path: '/tmp/ui-m7-admin.png' });

  await browser.close();
  console.log(ko === 0 ? '\nTESTS UI M7 : tout est conforme' : `\n${ko} contrôle(s) en échec`);
  if (ko > 0) process.exitCode = 1;
})();
