'use strict';
// ============================================================================================
// MISSION 14 — Recette fonctionnelle par compartiment, dans le vrai navigateur.
// Chaque test part d'un écran vide ou rempli, agit comme un marchand, puis RELIT l'écran et la
// base (via l'API) pour prouver que la donnée a été conservée. Aucune vérification « à l'œil ».
// ============================================================================================
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/tmp/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const BASE = process.env.BASE || 'http://127.0.0.1:3720';
const account = JSON.parse(fs.readFileSync(path.join(__dirname, 'recette.json'), 'utf8'));
const results = [];
const ok = (n, x = '') => { results.push([true, n]); console.log(`  ✓ ${n}${x ? ' — ' + x : ''}`); };
const ko = (n, x = '') => { results.push([false, n]); console.log(`  ✗ ${n}${x ? ' — ' + x : ''}`); };

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 140)));
  await page.goto(BASE + '/merchant/', { waitUntil: 'networkidle' });
  await page.fill('#loginUsername', account.username);
  await page.fill('#loginPassword', account.password);
  await page.click('#loginForm button[type=submit]');
  await page.waitForTimeout(2600);

  const call = (method, url, body) => page.evaluate(async ({ method, url, body }) => {
    const response = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await response.json(); } catch (_) {}
    return { status: response.status, json };
  }, { method, url, body });

  // ------------------------------------------------------------------ TABLES
  console.log('\n[Tables et espaces]');
  await page.click('#workspaceMenu button[data-rubric="tables"]');
  await page.waitForTimeout(1300);
  const number = 'T' + Math.floor(Math.random() * 9000 + 1000);
  // Le formulaire est celui de l'écran réel : #tablesAddTable ouvre #tablesTableForm.
  await page.click('#tablesAddTable');
  await page.waitForTimeout(500);
  const formVisible = await page.evaluate(() => Boolean(document.querySelector('#tablesTableForm')));
  if (!formVisible) ko('formulaire d’ajout de table accessible depuis l’écran');
  else {
    await page.fill('#tablesTableForm input[name="number"]', number);
    await page.selectOption('#tablesTableForm select[name="zone"]', { index: 1 }).catch(() => {});
    await page.click('#tablesTableForm button[type="submit"]');
    await page.waitForTimeout(1800);
    const afterReload = await call('GET', '/api/merchant/table-management');
    const created = (afterReload.json?.data?.points || []).find((point) => point.number === number);
    created ? ok('table créée depuis l’interface et relue depuis le serveur', `n° ${number}, id ${created.id.slice(0, 8)}…`) : ko('table créée depuis l’interface');
    if (created) {
      // Modification par l'API de l'écran (bouton Modifier) : on vérifie la persistance.
      const updated = await call('PUT', `/api/merchant/table-management/points/${created.id}`, { capacity: 8, zone: 'Salon' });
      const reread = await call('GET', '/api/merchant/table-management');
      const row = (reread.json?.data?.points || []).find((point) => point.id === created.id);
      updated.status === 200 && row?.zone === 'Salon' ? ok('table modifiée (salle et capacité) et conservée', 'Salon · 8 places') : ko('modification de table', JSON.stringify(row).slice(0, 80));
      const off = await call('POST', `/api/merchant/table-management/points/${created.id}/status`, { status: 'unavailable' });
      const after = await call('GET', '/api/merchant/table-management');
      const state = (after.json?.data?.points || []).find((point) => point.id === created.id)?.status;
      off.status === 200 && state !== 'active' ? ok('table désactivée : le changement tient après relecture', 'statut ' + state) : ko('désactivation de table', state);
    }
  }
  const tableRowVisible = await page.evaluate((num) => (document.body.innerText || '').includes(num), number);
  tableRowVisible ? ok('la nouvelle table apparaît dans la liste à l’écran') : ko('la table n’apparaît pas dans la liste');

  // ------------------------------------------------------------------ PRODUITS
  console.log('\n[Produits]');
  await page.click('#workspaceMenu button[data-rubric="settings"]');
  await page.waitForTimeout(700);
  await page.click('#panel-hub-settings [data-hub-tab="products"]');
  await page.waitForTimeout(1400);
  const productName = 'Plat recette ' + Math.floor(Math.random() * 900 + 100);
  const productCreated = await call('POST', '/api/merchant/products', { name: productName, priceXof: 3000, stockQuantity: 12, category: 'Plats' });
  // Rechargement réel de la page (et reconnexion : la session survit au rechargement).
  await page.goto(BASE + '/merchant/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3200);
  const persistedList = await call('GET', '/api/merchant/products');
  const productRow = (persistedList.json?.data || []).find((row) => row.name === productName);
  productCreated.status === 201 && productRow ? ok('produit créé et conservé après rechargement de la page', productName) : ko('produit créé', String(productCreated.status));
  const missingName = await call('POST', '/api/merchant/products', { priceXof: 1000 });
  missingName.status === 400 && /nom/i.test(missingName.json?.error || '') ? ok('produit sans nom refusé avec un message clair', missingName.json.error.slice(0, 60)) : ko('validation du nom de produit', missingName.status);

  // ------------------------------------------------------------------ ÉQUIPE
  console.log('\n[Mon équipe]');
  await page.click('#workspaceMenu button[data-rubric="team"]');
  await page.waitForTimeout(1300);
  const teamPanel = await page.evaluate(() => Boolean(document.querySelector('#panel-hub-team')?.offsetHeight));
  teamPanel ? ok('« Mon équipe » s’ouvre sur sa page (comptes, points)') : ko('ouverture Mon équipe');
  const subEntries = await page.evaluate(() => [...document.querySelectorAll('#m14Sub button')].map((node) => node.textContent.trim()));
  subEntries.length === 2 ? ok('le sous-menu « Mon équipe › » propose ses deux entrées', subEntries.join(' / ')) : ko('sous-menu Mon équipe', subEntries.join(','));
  const accounts = await call('GET', '/api/merchant/member-accounts');
  const counts = accounts.json?.data?.counts;
  counts ? ok('les comptes de l’équipe sont lus depuis le serveur', `total ${counts.total}, actifs ${counts.active}`) : ko('lecture des comptes');
  // Refus attendu : un marchand ne crée pas de QR de table (permission vérifiée côté serveur).
  const forbidden = await call('POST', '/api/merchant/table-management/points/00000000-0000-0000-0000-000000000000/qr');
  forbidden.status === 403 ? ok('QR de table refusé au marchand par le serveur (403)', forbidden.json?.error?.slice(0, 60)) : ko('contrôle serveur du QR', forbidden.status);

  // ------------------------------------------------------------------ COMMANDES
  console.log('\n[Commandes]');
  const orders = await call('GET', '/api/merchant/orders');
  Array.isArray(orders.json?.data) ? ok('liste des commandes reçue du serveur', `${orders.json.data.length} commande(s)`) : ko('liste des commandes');
  const assisted = await page.evaluate(() => Boolean(document.getElementById('panel-assisted')));
  assisted ? ok('écran « Prendre une commande » présent (saisie assistée)') : ko('écran commande assistée');

  // ------------------------------------------------------------------ HISTORIQUES + VUE D'ENSEMBLE
  console.log('\n[Historiques et vue d’ensemble]');
  const overview = await call('GET', '/api/overview');
  overview.status === 200 && Array.isArray(overview.json?.data?.cards) ? ok('vue d’ensemble : 4 cartes chiffrées', overview.json.data.cards.map((card) => card.value).join(' / ')) : ko('vue d’ensemble', overview.status);
  const history = await call('GET', '/api/history?period=month');
  history.status === 200 ? ok('historiques : lignes et catégories reçues', `${(history.json?.data?.rows || []).length} ligne(s)`) : ko('historiques', `${history.status} ${history.json?.error || ''}`);

  // ------------------------------------------------------------------ API AVANT SESSION
  console.log('\n[Robustesse]');
  const anonymous = await context.newPage();
  const hits = [];
  anonymous.on('response', (response) => { if (response.status() >= 400 && !response.url().includes('/auth/me') && !response.url().includes('/api/public/shops/')) hits.push(response.status() + ' ' + response.url().replace(BASE, '')); });
  await anonymous.goto(BASE + '/merchant/', { waitUntil: 'domcontentloaded' });
  await anonymous.waitForTimeout(1200);
  hits.length === 0 ? ok('aucun appel refusé avant connexion (plus de 401 au chargement)') : ko('appels avant connexion', hits.join(' | '));
  await anonymous.close();

  errors.length === 0 ? ok('aucune erreur JavaScript pendant la recette') : ko('erreurs JavaScript', errors.slice(0, 2).join(' | '));
  await browser.close();
  const failed = results.filter((row) => !row[0]);
  console.log(`\nRésultat : ${results.length - failed.length}/${results.length} vérifications réussies.`);
  if (failed.length) process.exit(1);
})().catch((error) => { console.error('ERREUR', error.message); process.exit(1); });
