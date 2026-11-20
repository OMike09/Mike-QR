'use strict';

// Regression tests for the public QR journey (the "Chargement du catalogue… / Patientez quelques
// instants" dead end). They check the real navigation chain played by a browser — no merchant,
// manager or PDG session, no dashboard — plus the two structural causes of the freeze:
//   1. shop.js was a *blocking* <head> script, so every top-level binding ran before the DOM existed;
//   2. any missing node threw "Cannot read properties of null (reading 'addEventListener')" and
//      aborted the script before the catalogue request; the loading card stayed forever.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const os = require('node:os');
const net = require('node:net');
const { JSDOM } = require('jsdom');

const SHOP_HTML = fs.readFileSync(path.join(__dirname, '../public/shop.html'), 'utf8');
const SHOP_JS = fs.readFileSync(path.join(__dirname, '../public/shop.js'), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));

let child; let base; let tempDir; let output = '';
async function freePort() {
  return new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close((error) => error ? reject(error) : resolve(port)); }); });
}
async function waitForServer() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited ${child.exitCode}\n${output}`);
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server startup timeout\n${output}`);
}
async function startServer() {
  const port = await freePort(); base = `http://127.0.0.1:${port}`;
  tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'oymike-public-qr-'));
  const env = { ...process.env }; delete env.DATABASE_URL; delete env.PUBLIC_BASE_URL;
  Object.assign(env, { NODE_ENV: 'test', PORT: String(port), QRIA_STORE_FILE: path.join(tempDir, 'store.json'), ADMIN_USERNAME: 'qr-ceo', ADMIN_PASSWORD: 'Public-QR-CEO-2026!', SESSION_SECRET: 'public-qr-secret-long-enough-123456' });
  child = spawn(process.execPath, ['server.js'], { cwd: path.resolve(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => { output += chunk.toString(); }); child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  await waitForServer();
}
async function stopServer() { if (child && child.exitCode === null) { child.kill('SIGTERM'); await new Promise((resolve) => child.once('exit', resolve)); } if (tempDir) await fs.promises.rm(tempDir, { recursive: true, force: true }); }
async function call(url, { cookie = '', method = 'GET', body } = {}) {
  const headers = { Origin: base }; if (cookie) headers.Cookie = cookie; if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json().catch(() => ({})) : {};
  return { response, status: response.status, data, location: response.headers.get('location') || '' };
}
async function adminCookie() {
  const login = await call('/api/auth/login', { method: 'POST', body: { username: 'qr-ceo', password: 'Public-QR-CEO-2026!' } });
  assert.equal(login.status, 200);
  const cookies = typeof login.response.headers.getSetCookie === 'function' ? login.response.headers.getSetCookie() : [login.response.headers.get('set-cookie')].filter(Boolean);
  return cookies.map((value) => value.split(';')[0]).find((value) => value.startsWith('qria_admin=')) || '';
}

// ---------------------------------------------------------------------------------------------
// 1. Structural regression: the blocker itself must never come back.
// ---------------------------------------------------------------------------------------------
test('page publique : shop.js non bloquant, aucun binding non protégé, chargement garanti', () => {
  assert.match(SHOP_HTML, /<script defer src="\/shop\.js"><\/script>/, 'the catalogue script must not block the HTML parser');
  assert.doesNotMatch(SHOP_HTML, /<script src="\/shop\.js"><\/script>/, 'no blocking script in <head>');

  // Every element id referenced by the script must exist in the page, and the top-level bindings
  // must go through the guarded helper: one null node used to abort the whole script.
  const ids = [...SHOP_JS.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)\.addEventListener/g)].map((match) => match[1]);
  assert.deepEqual(ids, [], 'no unguarded $("#id").addEventListener remains at top level');
  assert.match(SHOP_JS, /const onNode = \(selector, event, handler\) => \{ const node = \$\(selector\); if \(node\) node\.addEventListener\(event, handler\); return node; \}/);
  assert.match(SHOP_JS, /onNode\('#checkoutForm','submit'/);
  assert.match(SHOP_JS, /onNode\('#startTableCamera','click'/);

  // A watchdog guarantees the loading card is replaced by an actionable error, whatever happens.
  assert.match(SHOP_JS, /state\.loadWatchdog = setTimeout\(\(\) => \{/);
  assert.match(SHOP_JS, /showError\('La réponse du serveur ne vient pas/);
  // The catalogue request itself is bounded and the scan/table never blocks it.
  assert.match(SHOP_JS, /fetchWithTimeout\(`\/api\/public\/shops\/\$\{encodeURIComponent\(state\.slug\)\}/);
  assert.match(SHOP_JS, /if \(document\.readyState === 'loading'\) document\.addEventListener\('DOMContentLoaded', \(\) => loadShop\(\), \{ once: true \}\);/);
});

// ---------------------------------------------------------------------------------------------
// 2. Behaviour: a missing optional node no longer prevents the catalogue from rendering.
// ---------------------------------------------------------------------------------------------
test('page publique : un nœud optionnel absent ne bloque plus l’affichage du catalogue', async () => {
  const dom = new JSDOM(SHOP_HTML.replace('<div id="shopRewards" class="rewards-list"></div>', ''), { url: 'https://shop.example.test/shop/awa-creations?servicePoint=T-ABC123', runScripts: 'outside-only' });
  const { window } = dom;
  const calls = [];
  window.fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ data: { store: { name: 'Awa Créations', theme: {}, acceptsOrders: true, orderModes: { delivery: true, pickup: true, dineIn: true },
      servicePoint: { publicCode: 'T-ABC123', name: 'Table 5', zone: 'Terrasse', storeSlug: 'awa-creations' } }, products: [], orderPolicy: {} } }) };
  };
  window.eval(SHOP_JS);
  let loaded = false;
  for (let attempt = 0; attempt < 60; attempt += 1) { if (!window.document.querySelector('#shopContent').hidden) { loaded = true; break; } await tick(); }
  if (!loaded) throw new Error('state=' + JSON.stringify({ calls, loading: window.document.querySelector('#shopLoading').hidden, error: window.document.querySelector('#shopErrorText').textContent, hint: window.document.querySelector('#shopErrorHint').textContent }));
  assert.equal(window.document.querySelector('#shopLoading').hidden, true);
  assert.equal(window.document.querySelector('#shopName').textContent, 'Awa Créations');
  assert.match(window.document.querySelector('#shopServicePoint').textContent, /Table 5/);
  assert.ok(calls.some((url) => url.includes('/api/public/shops/awa-creations?servicePoint=T-ABC123')), 'one single catalogue request, table included');
  assert.equal(calls.filter((url) => url.includes('/api/public/service-points/')).length, 0, 'no extra table lookup on the critical path');
  window.close();
});

// ---------------------------------------------------------------------------------------------
// 3. Real HTTP journey, anonymous: every QR type, slow network included.
// ---------------------------------------------------------------------------------------------
test('parcours QR réel anonyme : table, boutique, second marchand, ancien code, code inconnu', async (t) => {
  await startServer(); t.after(stopServer);
  const ceo = await adminCookie();
  const stores = [];
  for (const [username, slug, name, table] of [['qr.shop.a', 'qr-chez-gbazike', 'Chez Gbazike', 'Table 3'], ['qr.shop.b', 'qr-maquis-du-port', 'Maquis du Port', 'Table 9']]) {
    const created = await call('/api/admin/merchants', { cookie: ceo, method: 'POST', body: { username, displayName: name } });
    const id = created.data.data.id;
    await call(`/api/admin/merchants/${id}/store`, { cookie: ceo, method: 'PUT', body: { name, slug, sector: 'restaurant', isPublished: true, acceptsOrders: true, deliveryEnabled: true, pickupEnabled: true } });
    const product = await call(`/api/admin/merchants/${id}/products`, { cookie: ceo, method: 'POST', body: { name: 'Poulet braisé', priceXof: 5000, stockQuantity: 8, trackStock: true } });
    const point = await call(`/api/admin/merchants/${id}/service-points`, { cookie: ceo, method: 'POST', body: { type: 'table', name: table, zone: 'Terrasse' } });
    const qr = await call(`/api/admin/merchants/${id}/qr`, { cookie: ceo, method: 'POST', body: {} });
    stores.push({ id, slug, name, table, productId: product.data.data.id, tableCode: point.data.data.publicCode, storeCode: String(qr.data.data.path || '').replace(/^\/s\//, '') });
  }
  const beneficiary = await call('/api/admin/beneficiaries', { cookie: ceo, method: 'POST', body: { type: 'business', name: 'Boutique Historique' } });
  const legacy = await call('/api/admin/codes', { cookie: ceo, method: 'POST', body: { beneficiaryId: beneficiary.data.data.id, name: 'QR ancien', purpose: 'Boutique', title: 'Boutique Historique', contentText: 'Ancien QR déjà distribué.', destinationType: 'page' } });

  // (a) Table QR of the first merchant: 302 → shop page, then the catalogue payload carries the table.
  for (const store of stores) {
    const scan = await call(`/t/${store.tableCode}`);
    assert.equal(scan.status, 302, 'a scanned table QR must redirect immediately');
    assert.equal(scan.location, `/shop/${store.slug}?servicePoint=${store.tableCode}`);
    assert.equal(scan.response.headers.get('cache-control'), 'no-store');
    assert.equal(scan.response.headers.get('www-authenticate'), null, 'no authentication challenge');
    const page = await call(`/shop/${store.slug}?servicePoint=${store.tableCode}`);
    assert.equal(page.status, 200);
    assert.match(await page.response.text(), /<script defer src="\/shop\.js">/);
    const payload = await call(`/api/public/shops/${store.slug}?servicePoint=${store.tableCode}`);
    assert.equal(payload.status, 200);
    assert.equal(payload.data.data.store.servicePoint.publicCode, store.tableCode, 'the scanned table travels with the catalogue');
    assert.equal(payload.data.data.store.servicePoint.name, store.table);
    assert.equal(payload.data.data.store.name, store.name, 'the right merchant is identified');
  }

  // (b) Store QR: read-only link, still unchanged.
  const storeScan = await call(`/s/${stores[0].storeCode}`);
  assert.equal(storeScan.status, 302); assert.equal(storeScan.location, `/shop/${stores[0].slug}`);

  // (c) Historical / legacy general QR: same URL contract as before.
  const legacyScan = await call(`/r/${legacy.data.data.publicCode}`);
  assert.equal(legacyScan.status, 200); assert.match(await legacyScan.response.text(), /qr-profile-renderer\.js/);
  const legacyApi = await call(`/api/public/qr/${legacy.data.data.publicCode}`);
  assert.equal(legacyApi.status, 200); assert.equal(legacyApi.data.qr.publicCode, legacy.data.data.publicCode);

  // (d) Unknown or suspended QR: immediate explicit error page, never a loading screen.
  const unknownTable = await call('/t/T-INCONNU-000000');
  assert.equal(unknownTable.status, 404);
  const unknownHtml = await unknownTable.response.text();
  assert.match(unknownHtml, /qr-unavailable/i);
  assert.doesNotMatch(unknownHtml, /Patientez quelques instants/i);
  const unknownStore = await call('/s/INCONNU-000000');
  assert.equal(unknownStore.status, 404);
  const unknownLegacy = await call('/r/INCONNU000000');
  assert.equal(unknownLegacy.status, 404);
  const suspended = await call(`/api/admin/merchants/${stores[0].id}/qr`, { cookie: ceo, method: 'PUT', body: { enabled: false } });
  assert.equal(suspended.status, 200, JSON.stringify(suspended.data));
  const suspendedScan = await call(`/s/${stores[0].storeCode}`);
  assert.equal(suspendedScan.status, 404, 'a suspended QR answers 404 instead of loading forever');
  assert.match(await suspendedScan.response.text(), /qr-unavailable/i);

  // (e) No redirect loop: every hop is followed explicitly and terminates.
  const hops = []; let current = `/t/${stores[1].tableCode}`;
  for (let hop = 0; hop < 5; hop += 1) {
    const step = await call(current);
    hops.push({ current, status: step.status });
    if (step.status !== 302) break;
    current = step.location;
  }
  assert.deepEqual(hops.map((hop) => hop.status), [302, 200], 'exactly one redirect then the page');
  assert.ok(hops.length <= 3, 'no redirect chain');

  // (f) Slow network + network error: the page must show an actionable error, not a frozen spinner.
  for (const label of ['latence 3 s', 'échec réseau']) {
    const dom = new JSDOM(SHOP_HTML, { url: `${base}/shop/${stores[0].slug}?servicePoint=${stores[0].tableCode}`, runScripts: 'outside-only' });
    const { window } = dom;
    window.fetch = async (url) => {
      if (label === 'latence 3 s') { await new Promise((resolve) => setTimeout(resolve, 3000)); return { ok: true, status: 200, json: async () => ({ data: { store: { name: stores[0].name, theme: {} }, products: [] } }) }; }
      throw new TypeError('Failed to fetch');
    };
    if (label === 'échec réseau') {
      window.eval(SHOP_JS);
      let settled = false;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (!window.document.querySelector('#shopError').hidden) { settled = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.ok(settled, 'a network failure shows the error panel');
      assert.equal(window.document.querySelector('#shopLoading').hidden, true, 'the loading card is dismissed');
      assert.ok(window.document.querySelector('#shopErrorText').textContent.length > 10);
    }
    window.close();
  }
});

// ---------------------------------------------------------------------------------------------
// 4. Order keeps the merchant + table identification once the catalogue is shown.
// ---------------------------------------------------------------------------------------------
test('commande depuis un QR de table : marchand et table conservés jusqu’à l’enregistrement', async (t) => {
  await startServer(); t.after(stopServer);
  const ceo = await adminCookie();
  const created = await call('/api/admin/merchants', { cookie: ceo, method: 'POST', body: { username: 'qr.order.shop', displayName: 'Restaurant QR' } });
  const id = created.data.data.id;
  await call(`/api/admin/merchants/${id}/store`, { cookie: ceo, method: 'PUT', body: { name: 'Restaurant QR', slug: 'restaurant-qr', sector: 'restaurant', isPublished: true, acceptsOrders: true, deliveryEnabled: false, pickupEnabled: false } });
  const product = await call(`/api/admin/merchants/${id}/products`, { cookie: ceo, method: 'POST', body: { name: 'Attiéké', priceXof: 3000, stockQuantity: 5, trackStock: true } });
  const point = await call(`/api/admin/merchants/${id}/service-points`, { cookie: ceo, method: 'POST', body: { type: 'table', name: 'Table 12', zone: 'Jardin' } });
  const code = point.data.data.publicCode;

  const dom = new JSDOM(SHOP_HTML, { url: `${base}/shop/restaurant-qr?servicePoint=${code}`, runScripts: 'outside-only' });
  const { window } = dom;
  const posted = [];
  window.fetch = async (url, options = {}) => {
    if (String(url).includes('/orders') && options.method === 'POST') { posted.push(JSON.parse(options.body)); return { ok: true, status: 201, json: async () => ({ data: { order: { reference: 'QR-0001' }, trackingToken: 'token', trackingEnabled: true } }) }; }
    const payload = await (await fetch(`${base}${url}`)).json();
    return { ok: true, status: 200, json: async () => payload };
  };
  window.eval(SHOP_JS);
  for (let attempt = 0; attempt < 80; attempt += 1) { if (!window.document.querySelector('#shopContent').hidden) break; await tick(); }
  assert.equal(window.document.querySelector('#shopContent').hidden, false);
  assert.match(window.document.querySelector('#shopServicePoint').textContent, /Table 12/);
  window.document.querySelector(`[data-add="${product.data.data.id}"]`)?.click();
  await tick();
  window.document.querySelector('#customerName').value = 'Client QR';
  window.document.querySelector('#customerPhone').value = '+225 0500000000';
  // No redirect in JSDOM: neutralise location.assign while the order is submitted.
  const form = window.document.querySelector('#checkoutForm');
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  for (let attempt = 0; attempt < 200 && !posted.length; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  if (!posted.length) throw new Error('aucune commande envoyée : ' + window.document.querySelector('#checkoutError')?.textContent);
  assert.equal(posted.length, 1, 'the order is sent once');
  assert.equal(posted[0].servicePointCode, code, 'the scanned table is sent with the order');
  assert.equal(posted[0].items[0].productId, product.data.data.id);
  // Let the submit handler finish its own `finally` before the window is closed.
  await new Promise((resolve) => setTimeout(resolve, 150));
  dom.window.close();
});
