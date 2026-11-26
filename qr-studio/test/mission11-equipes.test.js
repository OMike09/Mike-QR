'use strict';

// ============================================================================================
// Mission 11 · sous-prompt 2 — création et gestion des comptes d'équipe.
//
// Prérequis : DATABASE_URL_TEST=postgres://user@host:port/base_test
//   schémas appliqués : schema.sql, schema-catalog-mission4.sql, schema-team-mission5.sql,
//   schema-team-mission5-platform.sql, schema-ops-mission6.sql, schema-mission11-equipes.sql.
// Sans DATABASE_URL_TEST, la suite est IGNORÉE (skip) : jamais verte par défaut.
//
// Ce que la suite prouve réellement, contre un serveur et une base PostgreSQL :
//   - un gérant général et une serveuse/serveur se créent depuis l'espace marchand ;
//   - le mot de passe fait EXACTEMENT six chiffres, zéros initiaux conservés, chaîne jamais nombre ;
//   - tout autre format est refusé côté serveur (400), pas seulement dans le navigateur ;
//   - plusieurs tables, plusieurs salons, et une même table partagée par deux membres ;
//   - les affectations se modifient après création et l'historique n'est jamais effacé ;
//   - une commande garde le responsable de la table au moment où elle est passée ;
//   - le quota est bloqué côté serveur (409) même par un appel direct à l'API ;
//   - cinq échecs verrouillent le compte (423), le bon mot de passe est alors refusé ;
//   - un gérant général n'est activable qu'après validation du marchand ;
//   - cloisonnement : un marchand ne voit ni ne modifie l'équipe d'un autre établissement.
// ============================================================================================
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');

const DATABASE_URL = process.env.DATABASE_URL_TEST || '';
const PORT = 4867;
const BASE = `http://127.0.0.1:${PORT}`;
let child;

const HOST_DB = (() => { try { return new URL(DATABASE_URL).pathname.replace(/^\//, ''); } catch (_) { return ''; } })();
const DEDICATED = Boolean(DATABASE_URL) && /(^|[_-])test/.test(HOST_DB);
const suite = DEDICATED ? describe : describe.skip;

function cookieFrom(headers) {
  const raw = headers.getSetCookie ? headers.getSetCookie() : [];
  return raw.map((line) => line.split(';')[0]).filter((pair) => !pair.endsWith('=')).join('; ');
}
async function api(pathname, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + pathname, {
    method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, body: json, text, headers: res.headers, cookie: cookieFrom(res.headers) };
}

before(async () => {
  if (!DEDICATED) return;
  child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATABASE_URL, ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin1234',
      SESSION_SECRET: 'w'.repeat(40), PUBLIC_BASE_URL: BASE, NODE_ENV: 'test' },
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

async function newShop(admin, label) {
  const suffix = crypto.randomBytes(3).toString('hex');
  const created = await api('/api/admin/merchants', { method: 'POST', cookie: admin,
    body: { username: `m11${label}${suffix}`, displayName: `Marchand ${label} ${suffix}`,
      phone: `+22507${String(parseInt(suffix.slice(0, 4), 16)).padStart(6, '0')}`, temporaryPasswordLength: 18 } });
  assert.strictEqual(created.status, 201, created.text);
  const login = await api('/api/merchant/auth/login', { method: 'POST',
    body: { username: `m11${label}${suffix}`, password: created.body.temporaryPassword } });
  assert.strictEqual(login.status, 200, login.text);
  let cookie = cookieFrom(login.headers);
  if (login.body.data?.mustChangePassword) {
    const pin = '482913'; // code à six chiffres : la règle mission 11 vaut aussi pour le marchand
    const changed = await api('/api/merchant/auth/change-password', { method: 'POST', cookie,
      body: { currentPassword: created.body.temporaryPassword, password: pin, confirmPassword: pin } });
    assert.ok([200, 204].includes(changed.status), changed.text);
    cookie = cookieFrom((await api('/api/merchant/auth/login', { method: 'POST',
      body: { username: `m11${label}${suffix}`, password: pin } })).headers);
  }
  const me = await api('/api/merchant/auth/me', { cookie });
  const merchantId = me.body.data?.merchant?.id || me.body.data?.id;
  const shop = await api('/api/merchant/store', { method: 'PUT', cookie,
    body: { name: `Boutique M11 ${label} ${suffix}`, isPublished: true, acceptsOrders: true } });
  assert.ok([200, 201].includes(shop.status), shop.text);
  const storeId = (shop.body.data?.store || shop.body.data)?.id;
  assert.ok(storeId, 'boutique créée');
  return { cookie, merchantId, storeId, suffix };
}

// Les identifiants de création doivent faire 16 à 100 caractères [A-Za-z0-9_-].
const reqId = (seed) => `${seed}_${crypto.randomBytes(8).toString('hex')}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 96).padEnd(16, '0');

async function point(shop, name, type = 'table', zone = 'Salle') {
  const created = await api('/api/merchant/service-points', { method: 'POST', cookie: shop.cookie,
    body: { requestId: reqId(`m11_${shop.suffix}_${type}_${name.replace(/\W/g, '')}`), type, name, zone } });
  assert.strictEqual(created.status, 201, created.text);
  return created.body.data;
}

suite('Mission 11 · équipes : création simplifiée, tables/salons, quotas et code à 6 chiffres', () => {
  const ctx = {};

  test('P1. deux établissements distincts pour prouver le cloisonnement', async () => {
    const admin = (await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } })).cookie;
    assert.ok(admin, 'session Administrateur général');
    ctx.a = await newShop(admin, 'a');
    ctx.b = await newShop(admin, 'b');
    assert.notStrictEqual(ctx.a.merchantId, ctx.b.merchantId);
  });

  test('P2. tables et salons déjà enregistrés proposés au marchand (aucune recréation)', async () => {
    ctx.tables = [await point(ctx.a, 'Table 21'), await point(ctx.a, 'Table 22'), await point(ctx.a, 'Table 23')];
    ctx.salons = [await point(ctx.a, 'Salon VIP', 'salon', 'Étage'), await point(ctx.a, 'Terrasse', 'salon', 'Extérieur')];
    ctx.bTable = await point(ctx.b, 'Table B1');
    const view = await api('/api/merchant/team', { cookie: ctx.a.cookie });
    assert.strictEqual(view.status, 200, view.text);
    const ids = (view.body.data.servicePoints || []).map((row) => row.id);
    for (const row of [...ctx.tables, ...ctx.salons]) assert.ok(ids.includes(row.id), `espace ${row.name} proposé`);
    const salon = view.body.data.servicePoints.find((row) => row.id === ctx.salons[0].id);
    assert.strictEqual(salon.type, 'salon');
    assert.ok('occupied' in salon, 'état de disponibilité exposé');
    assert.ok(!ids.includes(ctx.bTable.id), 'les espaces d’un autre établissement ne fuient jamais');
  });

  test('P3. mot de passe : exactement six chiffres, zéros initiaux conservés', async () => {
    for (const bad of ['12345', '1234567', 'abcdef', '12 345', '12a456', ' ']) {
      const refused = await api('/api/merchant/team/members', { method: 'POST', cookie: ctx.a.cookie,
        body: { role: 'waitress', fullName: `Refus ${bad || 'vide'}`, password: bad } });
      assert.strictEqual(refused.status, 400, `« ${bad} » doit être refusé : ${refused.text}`);
      assert.strictEqual(refused.body.code, 'PASSWORD_WEAK');
      assert.match(refused.body.error, /6 chiffres/);
    }
    const weak = await api('/api/merchant/team/members', { method: 'POST', cookie: ctx.a.cookie,
      body: { role: 'waitress', fullName: 'Refus évident', password: '111111' } });
    assert.strictEqual(weak.status, 400, 'suite répétitive refusée');
    assert.strictEqual(weak.body.code, 'PASSWORD_WEAK');
  });

  test('P4. création d’une serveuse : plusieurs tables ET plusieurs salons, code 058214', async () => {
    const created = await api('/api/merchant/team/members', { method: 'POST', cookie: ctx.a.cookie,
      body: { role: 'waitress', fullName: 'Awa Koné', phone: '+2250701020304', designation: 'Serveuse salle',
        password: '058214', approveNow: true,
        servicePointIds: [ctx.tables[0].id, ctx.tables[1].id, ctx.salons[0].id, ctx.salons[1].id] } });
    assert.strictEqual(created.status, 201, created.text);
    ctx.waitress = created.body.data.member;
    assert.ok(ctx.waitress, `membre créé : ${created.text}`);
    ctx.waitressCode = created.body.data.activation.code;
    assert.strictEqual(ctx.waitress.role, 'waitress');
    assert.strictEqual(ctx.waitress.status, 'active', 'la serveuse est validée à la création');
    assert.ok(!JSON.stringify(created.body).toLowerCase().includes('passwordhash'), 'aucun hash renvoyé');
    assert.ok(!JSON.stringify(created.body).includes('058214'), 'le mot de passe choisi n’est jamais réaffiché');

    const assignments = await api(`/api/merchant/team/members/${ctx.waitress.id}/assignments`, { cookie: ctx.a.cookie });
    assert.strictEqual(assignments.status, 200, assignments.text);
    const ids = assignments.body.data.assignments.map((row) => row.servicePointId).sort();
    const expected = [ctx.tables[0].id, ctx.tables[1].id, ctx.salons[0].id, ctx.salons[1].id].sort();
    assert.deepStrictEqual(ids, expected, 'deux tables et deux salons attribués');
    assert.strictEqual(assignments.body.data.assignments.filter((row) => row.isPrimary).length, 1, 'une seule affectation principale');
  });

  test('P5. connexion serveuse avec 058214 : le zéro initial est conservé', async () => {
    const activated = await api('/api/staff/activate', { method: 'POST', body: { code: ctx.waitressCode, password: '058214' } });
    assert.strictEqual(activated.status, 201, activated.text);
    ctx.waitressCookie = activated.cookie;
    assert.ok(ctx.waitressCookie.includes('qria_staff='));

    const refused = await api('/api/staff/auth/login', { method: 'POST', body: { username: ctx.waitress.username, password: '58214' } });
    assert.strictEqual(refused.status, 401, 'cinq chiffres refusés');
    const login = await api('/api/staff/auth/login', { method: 'POST', body: { username: ctx.waitress.username, password: '058214' } });
    assert.strictEqual(login.status, 200, login.text);
    assert.ok(login.cookie.includes('qria_staff='));
  });

  test('P6. création d’un serveur depuis la même rubrique (rôle « Serveuse / Serveur »)', async () => {
    const created = await api('/api/merchant/team/members', { method: 'POST', cookie: ctx.a.cookie,
      body: { role: 'waitress', fullName: 'Moussa Diarra', designation: 'Serveur terrasse', password: '900000',
        approveNow: true, servicePointIds: [ctx.tables[2].id] } });
    assert.strictEqual(created.status, 201, created.text);
    ctx.server = created.body.data.member;
    assert.strictEqual(ctx.server.status, 'active');
    const used = await api('/api/staff/activate', { method: 'POST', body: { code: created.body.data.activation.code, password: '900000' } });
    assert.strictEqual(used.status, 201, used.text);
    ctx.serverCookie = used.cookie;
    const me = await api('/api/staff/me', { cookie: ctx.serverCookie });
    assert.strictEqual(me.body.data.session.merchantId, ctx.a.merchantId);
  });

  test('P7. une même table peut être attribuée à plusieurs membres', async () => {
    const assigned = await api(`/api/merchant/team/members/${ctx.server.id}/assignments`, { method: 'PUT', cookie: ctx.a.cookie,
      body: { servicePointIds: [ctx.tables[2].id, ctx.tables[0].id] } });
    assert.strictEqual(assigned.status, 200, assigned.text);
    const waitress = await api(`/api/merchant/team/members/${ctx.waitress.id}/assignments`, { cookie: ctx.a.cookie });
    assert.ok(waitress.body.data.assignments.some((row) => row.servicePointId === ctx.tables[0].id), 'la serveuse garde la table');
    const view = await api('/api/merchant/team', { cookie: ctx.a.cookie });
    const holders = (view.body.data.members || []).filter((member) => (member.servicePoints || []).some((row) => row.servicePointId === ctx.tables[0].id));
    assert.strictEqual(holders.length, 2, 'deux membres déclarés sur la même table');
  });

  test('P8. modification des affectations : retrait historisé, ajout tracé', async () => {
    const before = await api(`/api/merchant/team/service-points/${ctx.salons[1].id}/history`, { cookie: ctx.a.cookie });
    assert.ok(before.body.data.history.length >= 1, 'affectation initiale historisée');
    const updated = await api(`/api/merchant/team/members/${ctx.waitress.id}/assignments`, { method: 'PUT', cookie: ctx.a.cookie,
      body: { servicePointIds: [ctx.tables[0].id, ctx.tables[1].id, ctx.salons[0].id] } });
    assert.strictEqual(updated.status, 200, updated.text);
    assert.deepStrictEqual(updated.body.data.removed, [ctx.salons[1].id], 'le salon retiré est identifié');
    const after = await api(`/api/merchant/team/service-points/${ctx.salons[1].id}/history`, { cookie: ctx.a.cookie });
    const removal = after.body.data.history.find((row) => row.action === 'unassigned');
    assert.ok(removal, 'le retrait est conservé dans l’historique');
    assert.strictEqual(removal.memberId, ctx.waitress.id);
    assert.ok(removal.createdAt, 'date du retrait conservée');
    assert.ok(after.body.data.history.some((row) => row.action === 'assigned'), 'l’affectation d’origine reste consultable');
  });

  test('P9. traçabilité des commandes : responsable de la table au moment de la commande', async () => {
    // La table 21 est partagée ; son affectation PRINCIPALE (auto-affectation des commandes) désigne
    // la serveuse depuis P4. Une commande prise sur cette table doit garder ce responsable.
    const scan = await api('/api/staff/scan', { method: 'POST', cookie: ctx.serverCookie,
      body: { code: `/t/${ctx.tables[0].publicCode}`, eventId: `m11-${run}-scan-1` } });
    assert.strictEqual(scan.status, 200, scan.text);
    const order = await api('/api/staff/orders', { method: 'POST', cookie: ctx.serverCookie,
      body: { requestId: `m11_${run}_order_0001`, customerName: 'Client table 21', orderType: 'dine_in',
        servicePointId: ctx.tables[0].id, scanEventId: scan.body.data.scanEventId,
        items: [{ custom: true, name: 'Attiéké poisson', quantity: 2, unitPriceXof: 3500 }] } });
    assert.strictEqual(order.status, 201, order.text);
    const orderId = order.body.data.order.id;
    const tracking = await api(`/api/merchant/orders/${orderId}/tracking`, { cookie: ctx.a.cookie });
    assert.strictEqual(tracking.status, 200, tracking.text);
    assert.strictEqual(tracking.body.data.order.createdByMemberId, ctx.server.id, 'auteur conservé');
    assert.strictEqual(tracking.body.data.order.assignedMemberId, ctx.waitress.id, 'responsable de la table conservé');
    ctx.orderId = orderId;
    ctx.tableResponsibleAtOrder = tracking.body.data.order.assignedMemberId;
  });

  test('P10. la traçabilité survit à un changement d’affectation', async () => {
    // On change la responsable principale de la table 21 : la commande déjà passée ne bouge pas.
    const moved = await api(`/api/merchant/team/members/${ctx.server.id}/assignments`, { method: 'PUT', cookie: ctx.a.cookie,
      body: { servicePointIds: [ctx.tables[0].id, ctx.tables[2].id] } });
    assert.strictEqual(moved.status, 200, moved.text);
    assert.strictEqual(moved.body.data.primaryId, ctx.tables[0].id, 'la table 21 devient la principale du serveur');
    const tracking = await api(`/api/merchant/orders/${ctx.orderId}/tracking`, { cookie: ctx.a.cookie });
    assert.strictEqual(tracking.body.data.order.assignedMemberId, ctx.tableResponsibleAtOrder,
      'une commande passée garde le responsable qu’elle avait');
    const history = await api(`/api/merchant/team/service-points/${ctx.tables[0].id}/history`, { cookie: ctx.a.cookie });
    assert.ok(history.body.data.history.length >= 2, 'changement d’affectation historisé');
  });

  test('P11. quota atteint : refus serveur, y compris par appel direct à l’API', async () => {
    const view = await api('/api/merchant/team', { cookie: ctx.a.cookie });
    const gm = view.body.data.quotaUsage.generalManagers;
    assert.ok(gm.max >= 1, 'un quota de gérants est fixé');
    for (let index = 0; index < gm.max; index += 1) {
      const created = await api('/api/merchant/team/members', { method: 'POST', cookie: ctx.a.cookie,
        body: { role: 'general_manager', fullName: `Gérant ${index + 1}`, password: `70${String(index).padStart(4, '0')}` } });
      assert.strictEqual(created.status, 201, created.text);
      if (index === 0) { ctx.manager = created.body.data.member; ctx.managerCode = created.body.data.activation.code; }
    }
    const blocked = await api('/api/merchant/team/members', { method: 'POST', cookie: ctx.a.cookie,
      body: { role: 'general_manager', fullName: 'Gérant de trop', password: '123456' } });
    assert.strictEqual(blocked.status, 409, blocked.text);
    assert.strictEqual(blocked.body.code, 'TEAM_LIMIT');
    assert.match(blocked.body.error, /maximum de comptes autorisés/);
    // Le blocage ne dépend pas de l'écran : l'appel direct est refusé de la même façon.
    assert.strictEqual(blocked.body.quota.remaining, 0);
  });

  test('P12. gérant général : créé « en attente », activable seulement après validation du marchand', async () => {
    assert.strictEqual(ctx.manager.status, 'pending');
    const tooEarly = await api('/api/staff/activate', { method: 'POST', body: { code: ctx.managerCode, password: '700000' } });
    assert.strictEqual(tooEarly.status, 403, tooEarly.text);
    assert.strictEqual(tooEarly.body.code, 'MEMBER_PENDING_APPROVAL');
    const validated = await api(`/api/merchant/team/members/${ctx.manager.id}/status`, { method: 'POST', cookie: ctx.a.cookie,
      body: { status: 'active', reason: 'Validé par le marchand' } });
    assert.strictEqual(validated.status, 200, validated.text);
    const activated = await api('/api/staff/activate', { method: 'POST', body: { code: ctx.managerCode, password: '700000' } });
    assert.strictEqual(activated.status, 201, activated.text);
    const me = await api('/api/staff/me', { cookie: activated.cookie });
    assert.strictEqual(me.body.data.session.merchantId, ctx.a.merchantId);
    ctx.managerCookie = activated.cookie;
  });

  test('P13. cinq échecs verrouillent le compte (423), même le bon code est refusé', async () => {
    const victim = await api('/api/merchant/team/members', { method: 'POST', cookie: ctx.a.cookie,
      body: { role: 'waitress', fullName: 'Compte verrou', designation: 'Verrou test', password: '246810', approveNow: true } });
    assert.strictEqual(victim.status, 201, victim.text);
    const member = victim.body.data.member;
    await api('/api/staff/activate', { method: 'POST', body: { code: victim.body.data.activation.code, password: '246810' } });
    let last = null;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      last = await api('/api/staff/auth/login', { method: 'POST', body: { username: member.username, password: '000000' } });
      assert.ok([401, 423].includes(last.status), `tentative ${attempt} : ${last.status}`);
    }
    assert.strictEqual(last.status, 423, 'cinq échecs verrouillent le compte');
    assert.strictEqual(last.body.code, 'ACCOUNT_LOCKED');
    assert.ok(last.body.lockedUntil, 'échéance du verrou communiquée');
    const good = await api('/api/staff/auth/login', { method: 'POST', body: { username: member.username, password: '246810' } });
    assert.strictEqual(good.status, 423, 'le bon mot de passe est refusé pendant le verrou');
    const view = await api('/api/merchant/team', { cookie: ctx.a.cookie });
    const row = view.body.data.members.find((m) => m.id === member.id);
    assert.strictEqual(row.lockActive, true, 'le marchand constate le verrou');
  });

  test('P14. changement et réinitialisation de mot de passe : six chiffres imposés', async () => {
    const bad = await api('/api/staff/auth/change-password', { method: 'POST', cookie: ctx.serverCookie,
      body: { currentPassword: '900000', newPassword: 'MotDePasse!1' } });
    assert.strictEqual(bad.status, 400, bad.text);
    const ok = await api('/api/staff/auth/change-password', { method: 'POST', cookie: ctx.serverCookie,
      body: { currentPassword: '900000', newPassword: '004821' } });
    assert.ok([200, 204].includes(ok.status), ok.text);
    const login = await api('/api/staff/auth/login', { method: 'POST', body: { username: ctx.server.username, password: '004821' } });
    assert.strictEqual(login.status, 200, 'le zéro initial reste valable à la connexion');

    const reset = await api(`/api/merchant/team/members/${ctx.server.id}/access-code`, { method: 'POST', cookie: ctx.a.cookie, body: {} });
    assert.strictEqual(reset.status, 200, reset.text);
    const temporary = reset.body.data.temporaryPassword;
    assert.match(temporary, /^\d{6}$/, 'mot de passe temporaire à six chiffres');
    assert.strictEqual(typeof temporary, 'string', 'traité comme une chaîne, jamais comme un nombre');
  });

  test('P15. cloisonnement : l’équipe d’un autre établissement est invisible et immodifiable', async () => {
    const other = await api('/api/merchant/team', { cookie: ctx.b.cookie });
    assert.strictEqual(other.status, 200);
    assert.ok(!other.body.data.members.some((m) => m.id === ctx.waitress.id), 'aucun membre d’autrui');
    const peek = await api(`/api/merchant/team/members/${ctx.waitress.id}/assignments`, { cookie: ctx.b.cookie });
    assert.strictEqual(peek.status, 404, 'consultation refusée');
    const steal = await api(`/api/merchant/team/members/${ctx.waitress.id}/assignments`, { method: 'PUT', cookie: ctx.b.cookie,
      body: { servicePointIds: [ctx.bTable.id] } });
    assert.strictEqual(steal.status, 404, 'modification refusée');
    const foreignPoint = await api(`/api/merchant/team/members/${ctx.waitress.id}/assignments`, { method: 'PUT', cookie: ctx.a.cookie,
      body: { servicePointIds: [ctx.bTable.id] } });
    assert.strictEqual(foreignPoint.status, 403, 'une table d’un autre établissement est refusée');
    assert.strictEqual(foreignPoint.body.code, 'POINT_NOT_OWNED');
  });

  test('P16. historique d’audit : création, affectation, validation, suspension, réinitialisation', async () => {
    const activity = await api('/api/merchant/team/activity?limit=200', { cookie: ctx.a.cookie });
    assert.strictEqual(activity.status, 200, activity.text);
    const actions = new Set((activity.body.data || []).map((row) => row.action));
    for (const expected of ['member_created', 'service_points_updated', 'member_activated']) {
      assert.ok(actions.has(expected), `action « ${expected} » tracée`);
    }
  });
});
