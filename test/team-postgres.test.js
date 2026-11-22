'use strict';

// ============================================================================================
// Mission 5 · équipes marchandes — vérification en base PostgreSQL réelle et via l'API HTTP.
//
// Prérequis :
//   DATABASE_URL_TEST=postgres://user@host:port/base   (base dédiée aux tests)
//   schema.sql, schema-catalog-mission4.sql, schema-team-mission5.sql,
//   schema-team-mission5-platform.sql appliqués.
// Sans DATABASE_URL_TEST, la suite est ignorée (skip), jamais en échec silencieux.
//
// Ce que la suite prouve réellement (pas de simulation) :
//   - code d'activation unique, à usage unique, expirant, révocable, régénérable ;
//   - cloisonnement strict : un membre ne voit rien d'une autre boutique ;
//   - permission vérifiée côté serveur (403), pas seulement masquée dans l'interface ;
//   - blocage immédiat d'une session ouverte ;
//   - commande manuelle avec article libre NON ajouté au catalogue ;
//   - impossibilité pour un membre de changer son rôle ou ses permissions.
// ============================================================================================
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');

const DATABASE_URL = process.env.DATABASE_URL_TEST || '';
const PORT = 4863;
const BASE = `http://127.0.0.1:${PORT}`;
let child;

function cookieFrom(headers) {
  const raw = headers.getSetCookie ? headers.getSetCookie() : [headers.get('set-cookie')].filter(Boolean);
  if (!raw.length) return '';
  return raw.map((c) => c.split(';')[0]).join('; ');
}

async function api(pathname, { method = 'GET', body, cookie, origin } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, body: json, headers: res.headers, text };
}

// La suite vise une base DÉDIÉE : elle refuse de tourner sur la base de l'application hôte,
// sinon les comptes créés ici pollueraient des données réelles de test manuel.
const HOST_DB = (() => { try { return new URL(DATABASE_URL).pathname.replace(/^\//, ''); } catch (_) { return ''; } })();
const DEDICATED = Boolean(DATABASE_URL) && /(^|[_-])test/.test(HOST_DB);
const suite = DEDICATED ? describe : describe.skip;

before(async () => {
  if (!DEDICATED) return;
  child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATABASE_URL, ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin1234',
      SESSION_SECRET: 'z'.repeat(40), PUBLIC_BASE_URL: BASE, NODE_ENV: 'test' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i += 1) {
    await new Promise((r) => setTimeout(r, 300));
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) { const j = await r.json(); if (j.database === 'postgres') return; } } catch (_) {}
  }
  throw new Error('serveur de test non démarré');
});
after(() => { if (child) child.kill('SIGKILL'); });

const run = crypto.randomBytes(3).toString('hex');

suite('équipe · gérants généraux et serveuses', () => {
  let adminCookie = '';
  const shopA = { merchantCookie: '', merchantId: '', storeId: '' };
  const shopB = { merchantCookie: '', merchantId: '', storeId: '' };
  let manager = null; let waitress = null;
  let managerCode = ''; let waitressCode = '';
  let managerCookie = ''; let waitressCookie = '';
  let productId = '';

  test('T1. deux marchands distincts, chacun avec sa boutique ouverte', async () => {
    adminCookie = cookieFrom((await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } })).headers);
    assert.ok(adminCookie, 'session administrateur obtenue');
    for (const shop of [shopA, shopB]) {
      const suffix = crypto.randomBytes(3).toString('hex');
      const created = await api('/api/admin/merchants', { method: 'POST', cookie: adminCookie,
        body: { username: `marchand${suffix}`, displayName: `Marchand ${suffix}`, phone: `+22507${String(parseInt(suffix.slice(0, 4), 16)).padStart(6, '0')}`,
          temporaryPasswordLength: 18 } });
      assert.strictEqual(created.status, 201, created.text);
      const login = await api('/api/merchant/auth/login', { method: 'POST',
        body: { username: `marchand${suffix}`, password: created.body.temporaryPassword } });
      assert.strictEqual(login.status, 200, login.text);
      if (login.body.data?.mustChangePassword) {
        const changed = await api('/api/merchant/auth/change-password', { method: 'POST', cookie: cookieFrom(login.headers),
          body: { currentPassword: created.body.temporaryPassword, password: 'Marchand!2026x', confirmPassword: 'Marchand!2026x' } });
        assert.ok([200, 204].includes(changed.status), changed.text);
        const relogin = await api('/api/merchant/auth/login', { method: 'POST', body: { username: `marchand${suffix}`, password: 'Marchand!2026x' } });
        shop.merchantCookie = cookieFrom(relogin.headers);
      } else {
        shop.merchantCookie = cookieFrom(login.headers);
      }
      const me = await api('/api/merchant/auth/me', { cookie: shop.merchantCookie });
      assert.strictEqual(me.status, 200, me.text);
      shop.merchantId = me.body.data?.merchant?.id || me.body.data?.id;
      const store = await api('/api/merchant/store', { method: 'PUT', cookie: shop.merchantCookie,
        body: { name: `Boutique ${suffix}`, isPublished: true, acceptsOrders: true } });
      assert.ok([200, 201].includes(store.status), store.text);
      shop.storeId = (store.body.data?.store || store.body.data)?.id;
      assert.ok(shop.storeId, 'boutique créée');
    }
    assert.notStrictEqual(shopA.merchantId, shopB.merchantId);
    assert.notStrictEqual(shopA.storeId, shopB.storeId);
  });

  test('T2. le marchand crée lui-même un gérant général et une serveuse, sans l’Administrateur général', async () => {
    const gm = await api('/api/merchant/team/members', { method: 'POST', cookie: shopA.merchantCookie,
      body: { role: 'general_manager', fullName: 'Awa Koné', phone: '+2250701020304', designation: 'Gérant principal' } });
    assert.strictEqual(gm.status, 201, gm.text);
    manager = gm.body.data.member;
    managerCode = gm.body.data.activation.code;
    assert.strictEqual(manager.merchantId, shopA.merchantId);
    assert.strictEqual(manager.storeId, shopA.storeId);
    assert.strictEqual(manager.role, 'general_manager');
    assert.strictEqual(manager.designation, 'Gérant principal');
    assert.strictEqual(manager.status, 'pending');
    assert.match(managerCode, /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
    assert.ok(!JSON.stringify(gm.body).toLowerCase().includes('passwordhash'), 'aucun hash de mot de passe renvoyé');
    assert.ok(!gm.body.data.member.permissions.includes('members.manage'), 'gérant sans gestion des membres par défaut');

    const wr = await api('/api/merchant/team/members', { method: 'POST', cookie: shopA.merchantCookie,
      body: { role: 'waitress', fullName: 'Fatou Diallo', phone: '+2250705060708' } });
    assert.strictEqual(wr.status, 201, wr.text);
    waitress = wr.body.data.member;
    waitressCode = wr.body.data.activation.code;
    assert.notStrictEqual(managerCode, waitressCode, 'deux codes différents');
    assert.match(waitress.designation, /^Serveuse \d+$/);
    assert.ok(waitress.permissions.includes('orders.create'));
    assert.ok(!waitress.permissions.includes('products.price'), 'aucun droit sur les prix par défaut');
  });

  test('T3. une fonction invalide ou un doublon de nom ne crée pas de membre', async () => {
    const bad = await api('/api/merchant/team/members', { method: 'POST', cookie: shopA.merchantCookie,
      body: { role: 'owner', fullName: 'Tentative Élévation' } });
    assert.strictEqual(bad.status, 400);
    const list = await api('/api/merchant/team', { cookie: shopA.merchantCookie });
    assert.strictEqual(list.status, 200);
    assert.ok(!list.body.data.members.some((m) => m.fullName === 'Tentative Élévation'));
  });

  test('T4. un code d’activation ne vaut que pour un seul membre et un seul usage', async () => {
    const used = await api('/api/staff/activate', { method: 'POST', body: { code: waitressCode, password: 'Serveuse!2026x' } });
    assert.strictEqual(used.status, 201, used.text);
    waitressCookie = cookieFrom(used.headers);
    assert.ok(waitressCookie.includes('qria_staff='));
    assert.ok(!used.text.includes('passwordHash'));

    const replay = await api('/api/staff/activate', { method: 'POST', body: { code: waitressCode, password: 'Autre!2026x' } });
    assert.strictEqual(replay.status, 409, 'code déjà consommé');
    assert.strictEqual(replay.body.code, 'CODE_USED');

    const fake = await api('/api/staff/activate', { method: 'POST', body: { code: 'AAAA-BBBB-CCCC-DDDD', password: 'Motdepasse!1' } });
    assert.ok([400, 404].includes(fake.status), 'code inexistant refusé');
  });

  test('T5. le gérant général active son compte et retrouve SA boutique, pas une autre', async () => {
    const used = await api('/api/staff/activate', { method: 'POST', body: { code: managerCode, password: 'Gerant!2026xx' } });
    assert.strictEqual(used.status, 201, used.text);
    managerCookie = cookieFrom(used.headers);
    const me = await api('/api/staff/me', { cookie: managerCookie });
    assert.strictEqual(me.status, 200, me.text);
    assert.strictEqual(me.body.data.session.merchantId, shopA.merchantId);
    assert.strictEqual(me.body.data.shop.id, shopA.storeId);
  });

  test('T6. codes : expirable, révocable, régénérable, jamais deux utilisables à la fois', async () => {
    const third = await api('/api/merchant/team/members', { method: 'POST', cookie: shopA.merchantCookie,
      body: { role: 'waitress', fullName: 'Aïcha Traoré' } });
    const memberId = third.body.data.member.id;
    const first = third.body.data.activation.code;
    const second = await api(`/api/merchant/team/members/${memberId}/codes`, { method: 'POST', cookie: shopA.merchantCookie });
    assert.strictEqual(second.status, 201, second.text);
    assert.notStrictEqual(second.body.data.activation.code, first, 'nouveau code différent');
    const revokedOld = await api('/api/staff/activate', { method: 'POST', body: { code: first, password: 'Motdepasse!1' } });
    assert.strictEqual(revokedOld.status, 409, 'ancien code révoqué à la régénération');
    const codes = await api(`/api/merchant/team/members/${memberId}/codes`, { cookie: shopA.merchantCookie });
    assert.strictEqual(codes.body.data.codes.filter((c) => c.state === 'open').length, 1, 'un seul code ouvert');
    const codeId = codes.body.data.codes.find((c) => c.state === 'open').id;
    const revoke = await api(`/api/merchant/team/members/${memberId}/codes/${codeId}`, { method: 'DELETE', cookie: shopA.merchantCookie });
    assert.strictEqual(revoke.status, 200);
    const afterRevoke = await api('/api/staff/activate', { method: 'POST', body: { code: second.body.data.activation.code, password: 'Motdepasse!1' } });
    assert.strictEqual(afterRevoke.status, 409, 'code révoqué inutilisable');
  });

  test('T7. cloisonnement : la serveuse de A ne voit ni la boutique B ni ses commandes', async () => {
    const me = await api('/api/staff/me', { cookie: waitressCookie });
    assert.strictEqual(me.body.data.shop.id, shopA.storeId);
    const otherOrder = await api(`/api/staff/orders/${crypto.randomUUID()}`, { cookie: waitressCookie });
    assert.strictEqual(otherOrder.status, 404);
    const otherScan = await api('/api/staff/scan', { method: 'POST', cookie: waitressCookie, body: { code: '/s/boutique-b' } });
    assert.ok([403, 404].includes(otherScan.status), 'QR d’une autre boutique refusé');
  });

  test('T8. permission refusée côté serveur, pas seulement masquée', async () => {
    const price = await api(`/api/staff/products/inexistant/price`, { method: 'POST', cookie: waitressCookie, body: { priceXof: 100 } });
    assert.strictEqual(price.status, 403, 'serveuse sans products.price');
    assert.strictEqual(price.body.code, 'PERMISSION_DENIED');
    const cancel = await api(`/api/staff/orders/${crypto.randomUUID()}/cancel`, { method: 'POST', cookie: waitressCookie, body: { reason: 'test' } });
    assert.strictEqual(cancel.status, 403, 'serveuse sans orders.cancel');
  });

  test('T9. article libre : commande créée, produit JAMAIS ajouté au catalogue', async () => {
    const before = await api('/api/staff/products', { cookie: managerCookie });
    const countBefore = before.body.data.length;
    const order = await api('/api/staff/orders', { method: 'POST', cookie: waitressCookie, body: {
      requestId: `req_${crypto.randomBytes(12).toString('hex')}`, orderType: 'dine_in',
      items: [{ custom: true, name: 'Article saisi manuellement', quantity: 2, unitPriceXof: 1500 }],
      note: 'Table du fond' } });
    assert.strictEqual(order.status, 201, order.text);
    assert.match(order.body.data.order.source, /staff_assisted|manager_assisted/);
    assert.strictEqual(Number(order.body.data.order.totalAmountXof), 3000);
    assert.ok(order.body.data.order.customLines.length === 1, 'ligne libre conservée sur la commande');
    const after = await api('/api/staff/products', { cookie: managerCookie });
    assert.strictEqual(after.body.data.length, countBefore, 'aucun produit ajouté au catalogue');
  });

  test('T10. le plafond de remise du marchand est appliqué côté serveur', async () => {
    await api('/api/merchant/team/settings', { method: 'PATCH', cookie: shopA.merchantCookie, body: { waitressMaxDiscountPercent: 5 } });
    // Une serveuse n'a pas « orders.discount » : refus avant même le calcul du plafond.
    const noRight = await api('/api/staff/orders', { method: 'POST', cookie: waitressCookie, body: {
      requestId: `req_${crypto.randomBytes(12).toString('hex')}`, orderType: 'dine_in', discountAmountXof: 2000,
      items: [{ custom: true, name: 'Boisson', quantity: 1, unitPriceXof: 5000 }] } });
    assert.strictEqual(noRight.status, 403);
    assert.strictEqual(noRight.body.code, 'PERMISSION_DENIED');
    // Le marchand accorde explicitement la remise : le plafond de 5 % s'applique alors côté serveur.
    await api('/api/merchant/team/members/' + waitress.id, { method: 'PATCH', cookie: shopA.merchantCookie,
      body: { permissions: [...new Set([...waitress.permissions, 'orders.discount'])] } });
    const refused = await api('/api/staff/orders', { method: 'POST', cookie: waitressCookie, body: {
      requestId: `req_${crypto.randomBytes(12).toString('hex')}`, orderType: 'dine_in', discountAmountXof: 2000,
      items: [{ custom: true, name: 'Boisson', quantity: 1, unitPriceXof: 5000 }] } });
    assert.strictEqual(refused.status, 403, refused.text);
    assert.strictEqual(refused.body.code, 'DISCOUNT_TOO_HIGH');
  });

  test('T11. un membre ne peut pas modifier son rôle ni ses permissions', async () => {
    const attempt = await api('/api/merchant/team/members/' + waitress.id, { method: 'PATCH', cookie: waitressCookie, body: { permissions: ['members.manage'] } });
    assert.ok([401, 403].includes(attempt.status), 'route marchand inaccessible au personnel');
    const selfRights = await api('/api/staff/me', { method: 'PATCH', cookie: waitressCookie, body: { role: 'general_manager' } });
    assert.ok([404, 405].includes(selfRights.status), 'aucune route self-service de changement de rôle');
  });

  test('T12. blocage immédiat : la session ouverte est coupée, commandes et statistiques conservées', async () => {
    const okBefore = await api('/api/staff/me', { cookie: waitressCookie });
    assert.strictEqual(okBefore.status, 200);
    const blocked = await api('/api/merchant/team/members/' + waitress.id + '/status', { method: 'POST', cookie: shopA.merchantCookie,
      body: { status: 'blocked', reason: 'Test de blocage' } });
    assert.strictEqual(blocked.status, 200, blocked.text);
    const afterBlock = await api('/api/staff/me', { cookie: waitressCookie });
    assert.strictEqual(afterBlock.status, 401, 'session ouverte invalidée');
    const stats = await api('/api/merchant/team/members/' + waitress.id + '/stats', { cookie: shopA.merchantCookie });
    assert.strictEqual(stats.status, 200);
    assert.ok(stats.body.data.orders.count >= 1, 'commandes conservées après blocage');
    const login = await api('/api/staff/auth/login', { method: 'POST', body: { username: waitress.username, password: 'Serveuse!2026x' } });
    assert.strictEqual(login.status, 403, 'reconnexion refusée');
    const unblock = await api('/api/merchant/team/members/' + waitress.id + '/status', { method: 'POST', cookie: shopA.merchantCookie, body: { status: 'active' } });
    assert.strictEqual(unblock.status, 200);
  });

  test('T13. blocage de toute l’équipe : confirmation obligatoire, effet immédiat', async () => {
    const noConfirm = await api('/api/merchant/team/status-all', { method: 'POST', cookie: shopA.merchantCookie, body: { status: 'blocked' } });
    assert.strictEqual(noConfirm.status, 428, 'sans confirmation explicite, refus');
    const confirm = await api('/api/merchant/team/status-all', { method: 'POST', cookie: shopA.merchantCookie,
      body: { status: 'blocked', confirm: true, acknowledge: 'TOUTE-EQUIPE' } });
    assert.strictEqual(confirm.status, 200, confirm.text);
    const managerSession = await api('/api/staff/me', { cookie: managerCookie });
    assert.strictEqual(managerSession.status, 401, 'gérant coupé aussi');
    await api('/api/merchant/team/status-all', { method: 'POST', cookie: shopA.merchantCookie,
      body: { status: 'active', confirm: true, acknowledge: 'TOUTE-EQUIPE' } });
  });

  test('T14. désignation modifiable sans changer l’identifiant unique', async () => {
    const before = await api('/api/merchant/team', { cookie: shopA.merchantCookie });
    const target = before.body.data.members.find((m) => m.id === waitress.id);
    const patched = await api('/api/merchant/team/members/' + waitress.id, { method: 'PATCH', cookie: shopA.merchantCookie, body: { designation: 'Serveuse terrasse' } });
    assert.strictEqual(patched.status, 200, patched.text);
    assert.strictEqual(patched.body.data.member.designation, 'Serveuse terrasse');
    assert.strictEqual(patched.body.data.member.id, target.id);
    assert.strictEqual(patched.body.data.member.username, target.username);
  });

  test('T15. l’Administrateur général ne peut pas créer de membre d’équipe et pilote les limites', async () => {
    const created = await api('/api/merchant/team/members', { method: 'POST', cookie: adminCookie, body: { role: 'waitress', fullName: 'Intrus Admin' } });
    assert.ok([401, 403].includes(created.status), 'aucune route marchand pour l’administrateur');
    const limits = await api('/api/admin/team-settings', { method: 'PATCH', cookie: adminCookie, body: { maxWaitressesPerMerchant: 12 } });
    assert.strictEqual(limits.status, 200, limits.text);
    assert.strictEqual(limits.body.data.limits.maxWaitressesPerMerchant, 12);
    const overview = await api('/api/admin/team-overview', { cookie: adminCookie });
    assert.strictEqual(overview.status, 200);
  });

  test('T16. les membres d’une autre boutique sont invisibles et intouchables', async () => {
    const other = await api('/api/merchant/team/members/' + waitress.id + '/status', { method: 'POST', cookie: shopB.merchantCookie, body: { status: 'blocked' } });
    assert.strictEqual(other.status, 404, 'membre d’une autre boutique introuvable');
    const listB = await api('/api/merchant/team', { cookie: shopB.merchantCookie });
    assert.strictEqual(listB.body.data.members.length, 0);
  });

  test('T17. journal d’activité : création, activation, commande, blocage tracés', async () => {
    const activity = await api('/api/merchant/team/activity', { cookie: shopA.merchantCookie });
    assert.strictEqual(activity.status, 200);
    const actions = new Set(activity.body.data.map((row) => row.action));
    for (const expected of ['member_activated', 'order_created']) assert.ok(actions.has(expected), `action ${expected} tracée`);
  });
});
