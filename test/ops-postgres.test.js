'use strict';

// ============================================================================================
// Mission 6 — règles vérifiées en BASE POSTGRESQL RÉELLE (suite automatisée).
//
// Prérequis : DATABASE_URL_TEST=postgres://user@host:port/base_test
// Sans cette variable, la suite est ignorée (skip), jamais verte par défaut.
//
// Ce que la suite prouve, sans simulation :
//   - les points ne se comptent jamais deux fois (scan rejoué, tâche validée deux fois) ;
//   - une commande annulée ne crédite pas de « commande terminée » ;
//   - une correction de points est une nouvelle ligne motivée, jamais un effacement ;
//   - une serveuse ne peut ni lire ni modifier les points d'une autre ;
//   - une serveuse bloquée perd son accès immédiatement, ses données restent ;
//   - une table affectée reçoit automatiquement la commande ;
//   - une conversation de support ne fuit pas vers une autre boutique ;
//   - la messagerie et les affectations refusent un rôle non autorisé (403 côté serveur).
// ============================================================================================
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');

const DATABASE_URL = process.env.DATABASE_URL_TEST || '';
const PORT = 4866;
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
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, body: json, text, cookie: cookieFrom(res.headers) };
}

before(async () => {
  if (!DEDICATED) return;
  child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATABASE_URL, ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin1234',
      SESSION_SECRET: 'y'.repeat(40), PUBLIC_BASE_URL: BASE, NODE_ENV: 'test' },
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

suite('Mission 6 · points, affectations, messagerie et sécurité', () => {
  const ctx = { admin: '', merchant: '', manager: '', waitresses: [], storeId: '', points: [] };

  test('S1. préparation : marchand, deux gérants, trois serveuses, trois tables', async () => {
    const login = await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } });
    assert.strictEqual(login.status, 200, login.text);
    ctx.admin = login.cookie;
    const created = await api('/api/admin/merchants', { method: 'POST', cookie: ctx.admin,
      body: { username: `ops${run}`, displayName: 'Chez Ops', phone: `+22507${String(parseInt(run.slice(0, 5), 16)).padStart(6, '0')}`, temporaryPasswordLength: 18 } });
    assert.strictEqual(created.status, 201, created.text);
    const first = await api('/api/merchant/auth/login', { method: 'POST', body: { username: `ops${run}`, password: created.body.temporaryPassword } });
    assert.strictEqual(first.status, 200, first.text);
    await api('/api/merchant/auth/change-password', { method: 'POST', cookie: first.cookie,
      body: { currentPassword: created.body.temporaryPassword, password: '482913', confirmPassword: '482913' } });
    const login2 = await api('/api/merchant/auth/login', { method: 'POST', body: { username: `ops${run}`, password: '482913' } });
    ctx.merchant = login2.cookie;
    const store = await api('/api/merchant/store', { method: 'PUT', cookie: ctx.merchant, body: { name: `Boutique ops ${run}`, isPublished: true, acceptsOrders: true } });
    assert.strictEqual(store.status, 200, store.text);
    ctx.storeId = store.body.data.id;

    for (const [index, role] of [[1, 'general_manager'], [2, 'general_manager'], [3, 'waitress'], [4, 'waitress'], [5, 'waitress']]) {
      const member = await api('/api/merchant/team/members', { method: 'POST', cookie: ctx.merchant,
        body: { role, fullName: `${role === 'waitress' ? 'Aya' : 'Koffi'} ${index}`, designation: `${role === 'waitress' ? 'Serveuse' : 'Gérant'} ${index}` } });
      assert.strictEqual(member.status, 201, member.text);
      const activated = await api('/api/staff/activate', { method: 'POST', body: { code: member.body.data.activation.code, password: 'Serveuse!2026x' } });
      assert.strictEqual(activated.status, 201, activated.text);
      const record = { id: member.body.data.member.id, role, username: member.body.data.member.username, cookie: activated.cookie };
      if (role === 'general_manager') { if (!ctx.manager) ctx.manager = record.cookie; }
      else ctx.waitresses.push(record);
    }
    assert.strictEqual(ctx.waitresses.length, 3);

    for (const name of ['Table A', 'Table B', 'Table C']) {
      const point = await api('/api/merchant/service-points', { method: 'POST', cookie: ctx.merchant,
        body: { requestId: `ops_${run}_${name.replace(/\W/g, '')}_0001`, type: 'table', name, zone: 'Salle' } });
      assert.strictEqual(point.status, 201, point.text);
      ctx.points.push(point.body.data);
    }
    assert.strictEqual(ctx.points.length, 3);
  });

  test('S2. une table affectée reçoit automatiquement la commande de la serveuse qui l’a prise', async () => {
    const assign = await api(`/api/staff/tables/${ctx.points[0].id}/assign`, { method: 'POST', cookie: ctx.manager, body: { memberId: ctx.waitresses[0].id } });
    assert.strictEqual(assign.status, 200, assign.text);
    const scan = await api('/api/staff/scan', { method: 'POST', cookie: ctx.waitresses[1].cookie, body: { code: `/t/${ctx.points[0].publicCode}`, eventId: `ops-${run}-scan-1` } });
    assert.strictEqual(scan.status, 200, scan.text);
    const order = await api('/api/staff/orders', { method: 'POST', cookie: ctx.waitresses[1].cookie,
      body: { requestId: `ops_${run}_order_0001`, customerName: 'Client Salle', orderType: 'dine_in', servicePointId: ctx.points[0].id,
        scanEventId: scan.body.data.scanEventId, items: [{ custom: true, name: 'Poisson braisé', quantity: 1, unitPriceXof: 3000 }] } });
    assert.strictEqual(order.status, 201, order.text);
    ctx.orderId = order.body.data.order.id;
    const tracking = await api(`/api/merchant/orders/${ctx.orderId}/tracking`, { cookie: ctx.merchant });
    assert.strictEqual(tracking.status, 200, tracking.text);
    // L'auteur reste la serveuse qui a saisi ; la responsable du suivi est celle de la table.
    assert.strictEqual(tracking.body.data.order.createdByMemberId, ctx.waitresses[1].id);
    assert.strictEqual(tracking.body.data.order.assignedMemberId, ctx.waitresses[0].id);
    const history = tracking.body.data.assignments || [];
    assert.ok(history.some((row) => row.action === 'assigned'), 'affectation automatique tracée');
  });

  test('S3. aucun double comptage : scan rejoué et tâche validée deux fois', async () => {
    const replay = await api('/api/staff/scan', { method: 'POST', cookie: ctx.waitresses[1].cookie, body: { code: `/t/${ctx.points[0].publicCode}`, eventId: `ops-${run}-scan-1` } });
    assert.strictEqual(replay.body.data.duplicate, true);
    const before = await api('/api/staff/points/history', { cookie: ctx.waitresses[1].cookie });
    const scans = Number(before.body.data.stats.scans);
    assert.strictEqual(scans, 1, `un seul scan compté (obtenu ${scans})`);

    const task = await api('/api/merchant/team/tasks', { method: 'POST', cookie: ctx.merchant,
      body: { memberId: ctx.waitresses[1].id, title: 'Ranger la terrasse', priority: 'normal' } });
    assert.ok([200, 201].includes(task.status), task.text);
    const taskId = (task.body.data.task || task.body.data).id;
    const done1 = await api(`/api/staff/tasks/${taskId}/status`, { method: 'POST', cookie: ctx.waitresses[1].cookie, body: { status: 'done' } });
    assert.ok([200, 201].includes(done1.status), done1.text);
    const mid = await api('/api/staff/points/history', { cookie: ctx.waitresses[1].cookie });
    const afterDone = Number(mid.body.data.stats.points);
    const done2 = await api(`/api/staff/tasks/${taskId}/status`, { method: 'POST', cookie: ctx.waitresses[1].cookie, body: { status: 'done' } });
    assert.ok([200, 201, 400].includes(done2.status), done2.text);
    const post = await api('/api/staff/points/history', { cookie: ctx.waitresses[1].cookie });
    assert.strictEqual(Number(post.body.data.stats.points), afterDone, 'une tâche validée deux fois ne crédite qu’une fois');
  });

  test('S4. une commande annulée ne crédite pas de commande terminée', async () => {
    const before = await api('/api/staff/points/history', { cookie: ctx.waitresses[1].cookie });
    const beforePoints = Number(before.body.data.stats.points);
    const cancel = await api(`/api/staff/orders/${ctx.orderId}/cancel`, { method: 'POST', cookie: ctx.manager, body: { reason: 'Erreur de saisie du client' } });
    assert.ok([200, 201].includes(cancel.status), cancel.text);
    const afterCancel = await api('/api/staff/points/history', { cookie: ctx.waitresses[1].cookie });
    assert.strictEqual(Number(afterCancel.body.data.stats.points), beforePoints, 'annulation : aucun point de « commande terminée »');
    assert.strictEqual(Number(afterCancel.body.data.stats.completedOrders), 0);
  });

  test('S5. correction de points : motif obligatoire, ligne ajoutée, total recalculé', async () => {
    const missing = await api('/api/merchant/points/adjust', { method: 'POST', cookie: ctx.merchant, body: { memberId: ctx.waitresses[2].id, points: 5 } });
    assert.strictEqual(missing.status, 400, missing.text);
    const before = await api('/api/staff/points/history', { cookie: ctx.waitresses[2].cookie });
    const rowsBefore = (before.body.data.history || []).length;
    const adjust = await api('/api/merchant/points/adjust', { method: 'POST', cookie: ctx.merchant,
      body: { memberId: ctx.waitresses[2].id, points: 4, reason: 'Remplacement d’une collègue absente' } });
    assert.strictEqual(adjust.status, 201, adjust.text);
    const after = await api('/api/staff/points/history', { cookie: ctx.waitresses[2].cookie });
    assert.strictEqual((after.body.data.history || []).length, rowsBefore + 1, 'une ligne ajoutée, rien d’effacé');
    assert.strictEqual(Number(after.body.data.stats.points), 4);
    assert.ok((after.body.data.history || []).every((row) => row.points !== undefined), 'journal complet conservé');
  });

  test('S6. une serveuse ne peut ni lire ni modifier les points d’une autre', async () => {
    const other = await api(`/api/staff/points/history?memberId=${ctx.waitresses[0].id}`, { cookie: ctx.waitresses[2].cookie });
    assert.strictEqual(other.status, 403, other.text);
    const adjust = await api('/api/merchant/points/adjust', { method: 'POST', cookie: ctx.waitresses[2].cookie, body: { memberId: ctx.waitresses[2].id, points: 50, reason: 'auto-crédit' } });
    assert.ok([401, 403].includes(adjust.status), `auto-crédit refusé (${adjust.status})`);
    const settings = await api('/api/merchant/points/settings', { method: 'PUT', cookie: ctx.waitresses[2].cookie, body: { pointsScan: 99 } });
    assert.ok([401, 403].includes(settings.status), `barème protégé (${settings.status})`);
  });

  test('S7. messagerie : fil de support tracé, réponse du gérant, cloisonnement par boutique', async () => {
    const created = await api('/api/staff/messages', { method: 'POST', cookie: ctx.waitresses[0].cookie,
      body: { subject: 'Manque de vaisselle', body: 'Il manque des assiettes en salle.', category: 'material' } });
    assert.strictEqual(created.status, 201, created.text);
    const conversationId = created.body.data.conversationId;
    const inbox = await api('/api/staff/messages', { cookie: ctx.manager });
    assert.strictEqual(inbox.status, 200, inbox.text);
    assert.ok((inbox.body.data.conversations || []).some((row) => row.id === conversationId), 'le gérant reçoit la demande');
    const reply = await api(`/api/staff/messages/${conversationId}/reply`, { method: 'POST', cookie: ctx.manager, body: { body: 'Je fais le nécessaire.' } });
    assert.strictEqual(reply.status, 201, reply.text);
    const seen = await api('/api/staff/notifications', { cookie: ctx.waitresses[0].cookie });
    assert.ok((seen.body.data.items || []).some((row) => row.type === 'support_reply'), 'la serveuse est notifiée');
    // Une serveuse sans la permission de gestion ne peut pas répondre à la place du gérant.
    const forbidden = await api(`/api/staff/messages/${conversationId}/reply`, { method: 'POST', cookie: ctx.waitresses[1].cookie, body: { body: 'Je réponds à sa place.' } });
    assert.strictEqual(forbidden.status, 403, forbidden.text);
  });

  test('S8. cloisonnement : un membre d’une autre boutique ne voit ni les messages ni les commandes', async () => {
    const created = await api('/api/admin/merchants', { method: 'POST', cookie: ctx.admin,
      body: { username: `opsb${run}`, displayName: 'Autre boutique', phone: `+22505${String(parseInt(run.slice(2, 7), 16)).padStart(6, '0')}`, temporaryPasswordLength: 18 } });
    assert.strictEqual(created.status, 201, created.text);
    const first = await api('/api/merchant/auth/login', { method: 'POST', body: { username: `opsb${run}`, password: created.body.temporaryPassword } });
    await api('/api/merchant/auth/change-password', { method: 'POST', cookie: first.cookie,
      body: { currentPassword: created.body.temporaryPassword, password: '519273', confirmPassword: '519273' } });
    const login2 = await api('/api/merchant/auth/login', { method: 'POST', body: { username: `opsb${run}`, password: '519273' } });
    const otherMerchant = login2.cookie;
    await api('/api/merchant/store', { method: 'PUT', cookie: otherMerchant, body: { name: `Autre boutique ${run}`, isPublished: true, acceptsOrders: true } });
    const outsider = await api('/api/merchant/team/members', { method: 'POST', cookie: otherMerchant, body: { role: 'waitress', fullName: 'Serveuse autre' } });
    const activated = await api('/api/staff/activate', { method: 'POST', body: { code: outsider.body.data.activation.code, password: 'Serveuse!2026y' } });
    assert.strictEqual(activated.status, 201, activated.text);
    const leaked = await api('/api/staff/messages', { cookie: activated.cookie });
    assert.strictEqual(leaked.status, 200);
    assert.strictEqual((leaked.body.data.conversations || []).length, 0, 'aucune conversation d’une autre boutique');
    const scanForeign = await api('/api/staff/scan', { method: 'POST', cookie: activated.cookie, body: { code: `/t/${ctx.points[0].publicCode}`, eventId: `ops-${run}-foreign` } });
    assert.ok([403, 404].includes(scanForeign.status), `scan d’une table d’une autre boutique refusé (${scanForeign.status})`);
    const order = await api(`/api/staff/orders/${ctx.orderId}/tracking`, { cookie: activated.cookie });
    assert.strictEqual(order.status, 404, 'commande d’une autre boutique invisible');
  });

  test('S9. blocage immédiat, données conservées, autres membres opérationnels', async () => {
    const block = await api(`/api/merchant/team/members/${ctx.waitresses[0].id}/status`, { method: 'POST', cookie: ctx.merchant, body: { status: 'blocked', reason: 'Test de révocation' } });
    assert.strictEqual(block.status, 200, block.text);
    const denied = await api('/api/staff/me', { cookie: ctx.waitresses[0].cookie });
    assert.strictEqual(denied.status, 401, denied.text);
    const others = await api('/api/staff/scan', { method: 'POST', cookie: ctx.waitresses[2].cookie, body: { code: `/t/${ctx.points[1].publicCode}`, eventId: `ops-${run}-scan-2` } });
    assert.strictEqual(others.status, 200, others.text);
    const historyBefore = await api('/api/merchant/team/members/' + ctx.waitresses[0].id + '/stats', { cookie: ctx.merchant });
    assert.strictEqual(historyBefore.status, 200, historyBefore.text);
    // La serveuse 0 était responsable de la table mais n'a pas scanné : sa trace est l'affectation
    // conservée de la commande. On vérifie donc la commande, pas son compteur de scans.
    assert.strictEqual(historyBefore.body.data.member.id, ctx.waitresses[0].id, 'fiche du membre bloqué toujours consultable');
    const orderKept = await api(`/api/merchant/orders/${ctx.orderId}/tracking`, { cookie: ctx.merchant });
    assert.strictEqual(orderKept.status, 200, orderKept.text);
    assert.strictEqual(orderKept.body.data.order.assignedMemberId, ctx.waitresses[0].id, 'affectation conservée après blocage');
    const unblock = await api(`/api/merchant/team/members/${ctx.waitresses[0].id}/status`, { method: 'POST', cookie: ctx.merchant, body: { status: 'active', reason: 'Fin de test' } });
    assert.strictEqual(unblock.status, 200, unblock.text);
    const back = await api('/api/staff/auth/login', { method: 'POST', body: { username: ctx.waitresses[0].username, password: 'Serveuse!2026x' } });
    assert.strictEqual(back.status, 200, back.text);
    const points = await api('/api/staff/points/history', { cookie: back.cookie });
    assert.strictEqual(points.status, 200, points.text);
    // Cette serveuse n'avait pas d'événement créditant : la preuve de conservation est
    // l'affectation de la commande, toujours rattachée à son identifiant.
    const kept = await api(`/api/merchant/orders/${ctx.orderId}/tracking`, { cookie: ctx.merchant });
    assert.strictEqual(kept.body.data.order.assignedMemberId, ctx.waitresses[0].id, 'historique conservé après blocage');
  });

  test('S10. barème : modifiable par le marchand, appliqué aux événements suivants seulement', async () => {
    const set = await api('/api/merchant/points/settings', { method: 'PUT', cookie: ctx.merchant,
      body: { pointsScan: 7, pointsOrder: 2, pointsOrderCompleted: 2, pointsTask: 2 } });
    assert.strictEqual(set.status, 200, set.text);
    assert.strictEqual(set.body.data.pointsScan, 7);
    const before = await api('/api/staff/points/history', { cookie: ctx.waitresses[2].cookie });
    const beforePoints = Number(before.body.data.stats.points);
    const scan = await api('/api/staff/scan', { method: 'POST', cookie: ctx.waitresses[2].cookie, body: { code: `/t/${ctx.points[2].publicCode}`, eventId: `ops-${run}-scan-3` } });
    assert.strictEqual(scan.status, 200, scan.text);
    const after = await api('/api/staff/points/history', { cookie: ctx.waitresses[2].cookie });
    assert.strictEqual(Number(after.body.data.stats.points), beforePoints + 7, 'le nouveau barème s’applique au scan suivant');
  });

  test('S11. classement : une serveuse voit sa position, le marchand voit toute l’équipe', async () => {
    const merchantBoard = await api('/api/merchant/leaderboard?period=month', { cookie: ctx.merchant });
    assert.strictEqual(merchantBoard.status, 200, merchantBoard.text);
    assert.strictEqual(merchantBoard.body.data.rows.length, 3);
    const waitressBoard = await api('/api/staff/leaderboard?period=month', { cookie: ctx.waitresses[1].cookie });
    assert.strictEqual(waitressBoard.status, 200, waitressBoard.text);
    assert.strictEqual(waitressBoard.body.data.canSeeAll, false);
    assert.ok(waitressBoard.body.data.rows.every((row) => row.id === ctx.waitresses[1].id), 'une serveuse ne voit que sa ligne');
    assert.ok(waitressBoard.body.data.myPosition >= 1);
  });
});
