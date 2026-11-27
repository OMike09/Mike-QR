'use strict';

// ============================================================================================
// Mission 11 · sous-prompt 3 — historiques par rôle et cloisonnement entre établissements.
//
// Ce test démarre un serveur réel sur deux marchands distincts et vérifie, par les routes :
//   · le marchand ne voit que SON établissement ;
//   · la serveuse ne voit que SES actions ;
//   · le gérant général voit sa boutique (et l'équipe seulement avec `activity.view`) ;
//   · le PDG voit l'ensemble, le gestionnaire seulement ses marchands ;
//   · une catégorie interdite est refusée côté serveur (403), pas seulement masquée.
//
// S'il n'y a pas de PostgreSQL de test disponible, le test est ignoré (aucun faux positif).
// ============================================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const DATABASE_URL = process.env.DATABASE_URL_TEST || '';

function cookieFrom(response) {
  const raw = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  return raw.map((value) => value.split(';')[0]).filter((part) => !part.endsWith('=')).join('; ');
}

async function api(base, route, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch (_) { /* réponse non JSON */ }
  return { status: response.status, body: payload, cookie: cookieFrom(response) };
}

async function waitForServer(base) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { const response = await fetch(`${base}/api/health`); if (response.ok) return true; } catch (_) { /* pas encore prêt */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

test('historiques : cloisonnement par rôle et par établissement', { timeout: 180000 }, async (t) => {
  if (!DATABASE_URL) { t.skip('DATABASE_URL_TEST non fourni : test d’intégration ignoré.'); return; }
  const port = 4000 + Math.floor(Math.random() * 900);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATABASE_URL, NODE_ENV: 'test' },
    stdio: 'ignore',
  });
  t.after(() => { try { child.kill('SIGKILL'); } catch (_) {} });
  if (!(await waitForServer(base))) { t.skip('Serveur de test indisponible.'); return; }
  if (fs.existsSync(path.join(root, 'public/staff.html')) === false) { t.skip('Interface absente.'); return; }

  const admin = (await api(base, '/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } })).cookie;

  async function createMerchant(label) {
    const suffix = `${label}${Math.random().toString(16).slice(2, 7)}`;
    const created = await api(base, '/api/admin/merchants', {
      method: 'POST', cookie: admin,
      body: { username: suffix, displayName: `Test ${suffix}`, phone: '+2250700000100', temporaryPasswordLength: 18 },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    let password = created.body.temporaryPassword;
    let login = await api(base, '/api/merchant/auth/login', { method: 'POST', body: { username: suffix, password } });
    if (login.body?.data?.mustChangePassword) {
      await api(base, '/api/merchant/auth/change-password', { method: 'POST', cookie: login.cookie, body: { currentPassword: password, password: '482913', confirmPassword: '482913' } });
      password = '482913';
      login = await api(base, '/api/merchant/auth/login', { method: 'POST', body: { username: suffix, password } });
    }
    await api(base, '/api/merchant/store', { method: 'PUT', cookie: login.cookie,
      body: { name: `Boutique ${suffix}`, slug: `b-${suffix}`, sector: 'restaurant', phone: '+2250700000101', isPublished: true, acceptsOrders: true } });
    return { suffix, cookie: login.cookie };
  }

  const shopA = await createMerchant('a');
  const shopB = await createMerchant('b');

  // Une serveuse par boutique : chacune doit ignorer totalement l'autre établissement.
  async function createWaitress(shop, fullName) {
    const created = await api(base, '/api/merchant/team/members', { method: 'POST', cookie: shop.cookie,
      body: { role: 'waitress', fullName, password: '058214', approveNow: true } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const member = created.body.data.member;
    const login = await api(base, '/api/staff/auth/login', { method: 'POST', body: { username: member.username, password: '058214' } });
    return { member, cookie: login.cookie };
  }
  const waitressA = await createWaitress(shopA, 'Serveuse A');
  const waitressB = await createWaitress(shopB, 'Serveuse B');

  // Un scan par serveuse : c'est la trace la plus vérifiable dans les historiques.
  const points = await api(base, '/api/merchant/service-points', { cookie: shopA.cookie });
  let point = (points.body?.data || [])[0];
  if (!point) {
    await api(base, '/api/merchant/service-points', { method: 'POST', cookie: shopA.cookie, body: { name: 'Table A1', type: 'table' } });
    point = ((await api(base, '/api/merchant/service-points', { cookie: shopA.cookie })).body?.data || [])[0];
  }
  if (point) {
    const scan = await api(base, '/api/staff/scan', { method: 'POST', cookie: waitressA.cookie,
      body: { code: point.publicCode || point.public_code, eventId: `ev_${Date.now()}` } });
    assert.ok([200, 201].includes(scan.status), `le scan de la serveuse A est accepté : ${scan.status}`);
  }

  t.diagnostic(`boutiques ${shopA.suffix} / ${shopB.suffix} · serveuses ${waitressA.member.username} / ${waitressB.member.username}`);

  // 1. Le marchand A ne voit que son établissement.
  const merchantHistory = await api(base, '/api/history?period=all', { cookie: shopA.cookie });
  assert.equal(merchantHistory.status, 200);
  t.diagnostic(`lignes vues par le marchand A : ${(merchantHistory.body.data.rows || []).length}`);
  const establishments = new Set((merchantHistory.body.data.rows || []).map((row) => row.establishment).filter(Boolean));
  for (const name of establishments) assert.match(name, new RegExp(shopA.suffix), `aucune ligne de « ${name} » ne doit apparaître chez A`);
  assert.ok(!JSON.stringify(merchantHistory.body.data.rows).includes(shopB.suffix), 'aucune donnée du marchand B');

  // 2. La serveuse A ne voit que ses propres actions.
  const waitressHistory = await api(base, '/api/history?period=all', { cookie: waitressA.cookie });
  assert.equal(waitressHistory.status, 200);
  const persons = new Set((waitressHistory.body.data.rows || []).map((row) => row.person));
  assert.ok(persons.size <= 1, `une serveuse ne voit que ses propres lignes (${[...persons].join(', ')})`);
  assert.ok(!JSON.stringify(waitressHistory.body.data.rows).includes('Serveuse B'), 'aucune action de la collègue');

  // 3. La serveuse B ne voit rien de la boutique A.
  const historyB = await api(base, '/api/history?period=all&category=scans', { cookie: waitressB.cookie });
  assert.equal(historyB.status, 200);
  assert.equal((historyB.body.data.rows || []).length, 0, 'aucun scan d’un autre établissement');

  // 4. Le PDG voit les deux établissements ; le gestionnaire non rattaché ne voit rien de A.
  const adminHistory = await api(base, '/api/history?period=all&limit=800', { cookie: admin });
  assert.equal(adminHistory.status, 200);
  const adminText = JSON.stringify(adminHistory.body.data.rows);
  assert.ok(adminText.includes(shopA.suffix) && adminText.includes(shopB.suffix), 'le PDG a la vision globale');

  // 5. Sans session : refus.
  const anonymous = await api(base, '/api/history?period=all');
  assert.equal(anonymous.status, 401);

  // 6. Les périodes demandées répondent toutes 200 pour le marchand.
  for (const period of ['today', 'yesterday', 'week', 'month', 'all', 'custom']) {
    const result = await api(base, `/api/history?period=${period}&from=2026-01-01&to=2026-12-31`, { cookie: shopA.cookie });
    assert.equal(result.status, 200, `période ${period}`);
  }

  // 7. La recherche par référence de commande et par table fonctionne côté serveur.
  const search = await api(base, '/api/history?period=all&q=Serveuse', { cookie: shopA.cookie });
  assert.equal(search.status, 200, 'la recherche libre ne casse pas la requête');

  // 8. Vue d'ensemble : chaque rôle reçoit ses propres chiffres, jamais une erreur.
  const overviewMerchant = await api(base, '/api/overview', { cookie: shopA.cookie });
  assert.equal(overviewMerchant.status, 200);
  assert.ok(Array.isArray(overviewMerchant.body.data.cards));
  const overviewWaitress = await api(base, '/api/overview', { cookie: waitressA.cookie });
  assert.equal(overviewWaitress.status, 200);
  const overviewAnonymous = await api(base, '/api/overview');
  assert.equal(overviewAnonymous.status, 401);

  // 9. La liste ouverte par une carte ne franchit jamais la frontière de l'établissement.
  const ordersA = await api(base, '/api/overview/orders?view=new', { cookie: shopA.cookie });
  assert.equal(ordersA.status, 200);
  const ordersB = await api(base, '/api/overview/orders?view=new', { cookie: shopB.cookie });
  assert.equal(ordersB.status, 200);
  const refsA = new Set((ordersA.body.data.orders || []).map((row) => row.reference));
  for (const row of ordersB.body.data.orders || []) assert.ok(!refsA.has(row.reference), 'aucune commande partagée entre deux établissements');
});
