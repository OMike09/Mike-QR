'use strict';
const { chromium } = require('playwright');
// L'adresse du serveur à tester se règle par variable d'environnement (défaut : 4913).
const BASE = process.env.OPS_BASE_URL || 'http://127.0.0.1:4913';
function cookieFrom(res) { return (res.headers.getSetCookie ? res.headers.getSetCookie() : []).map((l) => l.split(';')[0]).filter((p) => !p.endsWith('=')).join('; '); }
async function call(method, path, body, as = '') {
  const res = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(as ? { cookie: as } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json, cookie: cookieFrom(res) };
}
function parseCookie(cookie) { const [pair] = cookie.split(';'); const i = pair.indexOf('='); return { name: pair.slice(0, i), value: pair.slice(i + 1) }; }

(async () => {
  const s = Date.now().toString(36).slice(-6);
  let r = await call('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' });
  const adminCookie = r.cookie;
  r = await call('POST', '/api/admin/merchants', { username: `uim${s}`, displayName: 'Chez Fatou', phone: `+22507${String(parseInt(s.slice(0,5),36)).padStart(6,'0')}`, temporaryPasswordLength: 18 }, adminCookie);
  const temp = r.json.temporaryPassword;
  r = await call('POST', '/api/merchant/auth/login', { username: `uim${s}`, password: temp });
  await call('POST', '/api/merchant/auth/change-password', { currentPassword: temp, password: 'Marchand!2026x', confirmPassword: 'Marchand!2026x' }, r.cookie);
  r = await call('POST', '/api/merchant/auth/login', { username: `uim${s}`, password: 'Marchand!2026x' });
  const merchantCookie = r.cookie;
  const store = await call('PUT', '/api/merchant/store', { name: `Chez Fatou Cocody ${s}`, isPublished: true, acceptsOrders: true }, merchantCookie);
  console.log('boutique', store.status, JSON.stringify(store.json).slice(0, 160));
  if (store.status !== 200) process.exit(1);
  // équipe
  const members = [];
  for (const [i, role] of [[1,'general_manager'],[2,'waitress'],[3,'waitress']]) {
    const created = await call('POST', '/api/merchant/team/members', { role, fullName: `${role==='waitress'?'Aya':'Koffi'} ${i}`, designation: `${role==='waitress'?'Serveuse':'Gérant'} ${i}` }, merchantCookie);
    if (!created.json || !created.json.data) { console.error('création membre échouée', role, created.status, JSON.stringify(created.json)); process.exit(1); }
    const act = await call('POST', '/api/staff/activate', { code: created.json.data.activation.code, password: 'Serveuse!2026x' });
    members.push({ role, id: created.json.data.member.id, username: created.json.data.member.username, cookie: act.cookie });
  }
  // table + affectation + scan + commande
  const table = await call('POST', '/api/merchant/service-points', { requestId: `ui_tbl_${s}_0000000001`, type: 'table', name: 'Table 7', zone: 'Terrasse' }, merchantCookie);
  const point = table.json && table.json.data;
  if (!point) { console.error('création table échouée', table.status, JSON.stringify(table.json)); process.exit(1); }
  const gm = members.find((m) => m.role === 'general_manager');
  const w1 = members.filter((m) => m.role === 'waitress')[0];
  await call('POST', `/api/staff/tables/${point.id}/assign`, { memberId: w1.id }, gm.cookie);
  const scan = await call('POST', '/api/staff/scan', { code: `/t/${point.publicCode}`, eventId: `ui_${s}_1` }, gm.cookie);
  await call('POST', '/api/staff/orders', { requestId: `ui_req_${s}_0000000001` , customerName: 'Client Terrasse', orderType: 'dine_in', servicePointId: point.id,
    scanEventId: scan.json.data.scanEventId, items: [{ custom: true, name: 'Poulet braisé', quantity: 2, unitPriceXof: 3500 }] }, gm.cookie);
  const msg = await call('POST', '/api/staff/messages', { subject: 'Il manque des serviettes', body: 'Bonjour, la table 7 n’a plus de serviettes.', category: 'material' }, w1.cookie);
  await call('POST', `/api/staff/messages/${msg.json.data.conversationId}/reply`, { body: 'J’en apporte tout de suite.' }, gm.cookie);
  console.log('setup ok', { merchant: `uim${s}`, gm: gm.username, w1: w1.username, conv: msg.json.data.conversationId });

  const browser = await chromium.launch();
  async function shot(name, path, cookie, after) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
    await context.addCookies([{ ...parseCookie(cookie), domain: '127.0.0.1', path: '/' }]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`); });
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    if (after) await after(page);
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: name, fullPage: false });
    const text = await page.innerText('body').catch(() => '');
    console.log(`--- ${name} (${path}) erreurs: ${errors.length}`, errors.slice(0, 4).join(' | '));
    console.log('   extrait:', text.replace(/\s+/g, ' ').slice(0, 220));
    await context.close();
  }

  await shot('/tmp/ui-merchant-overview.png', '/merchant/', merchantCookie, async (page) => {
    await page.waitForTimeout(400);
    await page.evaluate(() => { document.querySelector('button[data-tab="ops"]').click(); });
    await page.waitForTimeout(2200);
  });
  await shot('/tmp/ui-merchant-points.png', '/merchant/', merchantCookie, async (page) => {
    await page.evaluate(() => { document.querySelector('button[data-tab="ops"]').click(); });
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.MerchantOps.openView('points'));
    await page.waitForTimeout(2500);
  });
  await shot('/tmp/ui-merchant-tables.png', '/merchant/', merchantCookie, async (page) => {
    await page.evaluate(() => { document.querySelector('button[data-tab="ops"]').click(); });
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.MerchantOps.openView('tables'));
    await page.waitForTimeout(2200);
  });
  await shot('/tmp/ui-staff-points.png', '/equipe/', w1.cookie, async (page) => {
    await page.click('button[data-tab="mypoints"]').catch(() => {});
    await page.waitForTimeout(1500);
  });
  await shot('/tmp/ui-staff-manager.png', '/equipe/', gm.cookie, async (page) => {
    await page.click('button[data-tab="dashboard"]').catch(() => {});
    await page.waitForTimeout(1500);
  });
  await shot('/tmp/ui-staff-messages.png', '/equipe/', gm.cookie, async (page) => {
    await page.click('button[data-tab="messaging"]').catch(() => {});
    await page.waitForTimeout(1500);
  });
  await shot('/tmp/ui-admin-ops.png', '/admin/', adminCookie, async (page) => {
    await page.click('button[data-view="admin-ops"]');
    await page.waitForTimeout(2000);
  });
  await browser.close();
})().catch((e) => { console.error('ERREUR', e); process.exit(1); });
