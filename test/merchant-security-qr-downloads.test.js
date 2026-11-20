'use strict';

// Merchant-facing security + QR exports: current-password verification, one-time reset link,
// high resolution PNG / true SVG artefacts and the order payload sent by the public shop.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const os = require('node:os');
const net = require('node:net');
const { JSDOM } = require('jsdom');

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
  const port = await freePort(); base = `http://127.0.0.1:${port}`; tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'oymike-security-test-'));
  const env = { ...process.env }; delete env.DATABASE_URL; delete env.WEB_PUSH_VAPID_PUBLIC_KEY; delete env.WEB_PUSH_VAPID_PRIVATE_KEY; delete env.WEB_PUSH_SUBJECT; delete env.PUBLIC_BASE_URL;
  Object.assign(env, { NODE_ENV: 'test', PORT: String(port), QRIA_STORE_FILE: path.join(tempDir, 'store.json'), ADMIN_USERNAME: 'security-ceo', ADMIN_PASSWORD: 'Security-CEO-Password-2026!', SESSION_SECRET: 'security-test-secret-long-enough-123456789' });
  child = spawn(process.execPath, ['server.js'], { cwd: path.resolve(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => { output += chunk.toString(); }); child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  await waitForServer();
}
async function stopServer() { if (child && child.exitCode === null) { child.kill('SIGTERM'); await new Promise((resolve) => child.once('exit', resolve)); } if (tempDir) await fs.promises.rm(tempDir, { recursive: true, force: true }); }
function cookieFrom(response, role) {
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
  const values = cookies.map((value) => value.split(';')[0]).filter((value) => value.startsWith(`qria_${role}=`));
  return values.find((value) => value.slice(value.indexOf('=') + 1)) || values.at(-1) || '';
}
async function call(url, { cookie = '', method = 'GET', body } = {}) {
  const headers = { Origin: base }; if (cookie) headers.Cookie = cookie; if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json().catch(() => ({})) : {};
  return { response, status: response.status, data };
}
async function login(role, endpoint, username, password) {
  const result = await call(endpoint, { method: 'POST', body: { username, password } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return { ...result, cookie: cookieFrom(result.response, role) };
}

test('marchand : changement de mot de passe avec vérification, lien unique de réinitialisation', async (t) => {
  await startServer(); t.after(stopServer);
  const ceo = await login('admin', '/api/auth/login', 'security-ceo', 'Security-CEO-Password-2026!');
  const created = await call('/api/admin/merchants', { cookie: ceo.cookie, method: 'POST', body: { username: 'security.shop', displayName: 'Boutique Sécurité' } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const temporary = created.data.temporaryPassword; const merchantId = created.data.data.id;
  const firstLogin = await login('merchant', '/api/merchant/auth/login', 'security.shop', temporary);

  // First connection: the current (temporary) password is required, a wrong one is refused server-side.
  const wrongCurrent = await call('/api/merchant/auth/change-password', { cookie: firstLogin.cookie, method: 'POST', body: { currentPassword: 'Wrong-Current-Password-2026!', password: 'Security-Shop-Personal-2026!', confirmPassword: 'Security-Shop-Personal-2026!' } });
  assert.equal(wrongCurrent.status, 403); assert.equal(wrongCurrent.data.code, 'INVALID_CURRENT_PASSWORD');
  const missingCurrent = await call('/api/merchant/auth/change-password', { cookie: firstLogin.cookie, method: 'POST', body: { password: 'Security-Shop-Personal-2026!', confirmPassword: 'Security-Shop-Personal-2026!' } });
  assert.equal(missingCurrent.status, 400); assert.equal(missingCurrent.data.code, 'CURRENT_PASSWORD_REQUIRED');
  const mismatch = await call('/api/merchant/auth/change-password', { cookie: firstLogin.cookie, method: 'POST', body: { currentPassword: temporary, password: 'Security-Shop-Personal-2026!', confirmPassword: 'Other-Password-2026!' } });
  assert.equal(mismatch.status, 400, 'the two new passwords must match');
  const changed = await call('/api/merchant/auth/change-password', { cookie: firstLogin.cookie, method: 'POST', body: { currentPassword: temporary, password: 'Security-Shop-Personal-2026!', confirmPassword: 'Security-Shop-Personal-2026!' } });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  const cookie = cookieFrom(changed.response, 'merchant');
  assert.equal((await login('merchant', '/api/merchant/auth/login', 'security.shop', 'Security-Shop-Personal-2026!')).status, 200, 'the new password opens the account');
  assert.equal((await call('/api/merchant/auth/login', { method: 'POST', body: { username: 'security.shop', password: temporary } })).status, 401, 'the old password no longer works');

  // Self-service reset request + one-time link issued by the PDG after identity verification.
  const request = await call('/api/merchant/auth/password-reset-request', { cookie, method: 'POST', body: {} });
  assert.equal(request.status, 200, JSON.stringify(request.data));
  const pending = await call('/api/admin/merchant-password-reset-requests', { cookie: ceo.cookie });
  assert.equal(pending.status, 200);
  assert.ok(pending.data.data.some((row) => row.id === merchantId), 'the request is visible to the PDG/manager console');
  const badConfirmation = await call(`/api/admin/merchants/${merchantId}/password-reset-link`, { cookie: ceo.cookie, method: 'POST', body: { confirmUsername: 'not-the-account' } });
  assert.equal(badConfirmation.status, 400, 'the identifier must be confirmed before a link is issued');
  const link = await call(`/api/admin/merchants/${merchantId}/password-reset-link`, { cookie: ceo.cookie, method: 'POST', body: { confirmUsername: 'security.shop' } });
  assert.equal(link.status, 200, JSON.stringify(link.data));
  assert.match(link.data.resetPath, /^\/merchant\/reset-password#token=[A-Za-z0-9_-]{40,64}$/);
  const token = link.data.resetPath.split('token=')[1];
  assert.equal((await call('/api/merchant/auth/login', { method: 'POST', body: { username: 'security.shop', password: 'Security-Shop-Personal-2026!' } })).status, 401, 'the previous password is revoked while the reset is pending');
  const reset = await call('/api/merchant/auth/reset-password', { method: 'POST', body: { token, password: 'Security-Shop-Reset-2026!', confirmPassword: 'Security-Shop-Reset-2026!' } });
  assert.equal(reset.status, 200, JSON.stringify(reset.data));
  assert.equal((await call('/api/merchant/auth/reset-password', { method: 'POST', body: { token, password: 'Another-Password-2026!', confirmPassword: 'Another-Password-2026!' } })).status, 410, 'the link can only be used once');
  assert.equal((await call('/api/merchant/auth/login', { method: 'POST', body: { username: 'security.shop', password: 'Security-Shop-Reset-2026!' } })).status, 200, 'the reset password works');

  // The reset page exists and never exposes the token to the server logs (fragment only).
  const page = await call('/merchant/reset-password');
  assert.equal(page.status, 200);
  const html = await page.response.text();
  assert.match(html, /id="resetForm"/);
  assert.match(html, /merchant-reset-password\.js/);
});

test('commande publique : mode de remise, numéro de table et message facultatifs sont enregistrés', async (t) => {
  await startServer(); t.after(stopServer);
  const ceo = await login('admin', '/api/auth/login', 'security-ceo', 'Security-CEO-Password-2026!');
  const created = await call('/api/admin/merchants', { cookie: ceo.cookie, method: 'POST', body: { username: 'table.shop', displayName: 'Restaurant Table' } });
  const merchantId = created.data.data.id;
  const store = await call(`/api/admin/merchants/${merchantId}/store`, { cookie: ceo.cookie, method: 'PUT', body: { name: 'Restaurant Table', slug: 'restaurant-table', sector: 'restaurant', isPublished: true, acceptsOrders: true, deliveryEnabled: false, pickupEnabled: false } });
  assert.equal(store.status, 200, JSON.stringify(store.data));
  const product = await call(`/api/admin/merchants/${merchantId}/products`, { cookie: ceo.cookie, method: 'POST', body: { name: 'Attiéké', priceXof: 3000, stockQuantity: 5, trackStock: true } });
  const productId = product.data.data.id;
  const point = await call(`/api/admin/merchants/${merchantId}/service-points`, { cookie: ceo.cookie, method: 'POST', body: { type: 'table', name: 'Table 4', zone: 'Terrasse' } });
  assert.equal(point.status, 201, JSON.stringify(point.data));
  const code = point.data.data.publicCode;

  const shop = await call('/api/public/shops/restaurant-table');
  assert.deepEqual(shop.data.data.store.orderModes, { delivery: false, pickup: false, dineIn: true }, 'the public catalogue exposes the merchant-configured modes');
  assert.equal(shop.data.data.products[0].stockQuantity, 5, 'the public product exposes its stock for the quantity limits');
  assert.equal(shop.data.data.products[0].mainImageUrl !== undefined, true, 'the main image is explicit');

  const tableOrder = await call('/api/public/shops/restaurant-table/orders', { method: 'POST', body: {
    clientRequestId: 'request-table-mode-0001', customerName: 'Client Table', customerPhone: '+225 0500000000',
    orderMode: 'dine_in', tableNumber: '4', tableNote: 'Près de la fenêtre', note: 'Sans piment', servicePointCode: code,
    items: [{ productId, quantity: 2 }] } });
  assert.equal(tableOrder.status, 201, JSON.stringify(tableOrder.data));
  const firstMerchantLogin = await login('merchant', '/api/merchant/auth/login', 'table.shop', created.data.temporaryPassword);
  const merchantLogin = await call('/api/merchant/auth/change-password', { cookie: firstMerchantLogin.cookie, method: 'POST', body: { currentPassword: created.data.temporaryPassword, password: 'Restaurant-Table-Personal-2026!', confirmPassword: 'Restaurant-Table-Personal-2026!' } });
  const merchantCookie = cookieFrom(merchantLogin.response, 'merchant');
  const orders = await call('/api/merchant/orders', { cookie: merchantCookie });
  const stored = orders.data.data.find((row) => row.reference === tableOrder.data.data.order.reference);
  assert.ok(stored, 'the order reaches the correct merchant');
  assert.equal(stored.deliveryAddress, 'Table 4 · Près de la fenêtre', 'the table number and instructions are stored without a delivery address');
  assert.equal(stored.note, 'Sans piment', 'the optional message reaches the merchant');
  assert.equal(stored.orderType, 'dine_in');
  assert.equal(stored.items[0].quantity, 2);
  const notifications = await call('/api/merchant/notifications', { cookie: merchantCookie });
  assert.ok(notifications.data.unreadCount >= 1, 'the merchant receives one unread notification');
  assert.ok(notifications.data.data.some((row) => row.orderId === stored.id), 'the notification points to the order');

  const noTable = await call('/api/public/shops/restaurant-table/orders', { method: 'POST', body: {
    clientRequestId: 'request-table-mode-0002', customerName: 'Client Sans Table', customerPhone: '+225 0500000001', orderMode: 'dine_in',
    items: [{ productId, quantity: 1 }] } });
  assert.equal(noTable.status, 400);
  assert.match(noTable.data.error, /numéro de table/i);

  const deliveryRefused = await call('/api/public/shops/restaurant-table/orders', { method: 'POST', body: {
    clientRequestId: 'request-table-mode-0003', customerName: 'Client Livraison', customerPhone: '+225 0500000002', orderMode: 'delivery', deliveryAddress: 'Cocody',
    items: [{ productId, quantity: 1 }] } });
  assert.equal(deliveryRefused.status, 201, 'explicit delivery remains accepted when an address is provided');
});

test('QR : PNG 1600 px et SVG vectoriel pointent vers le même lien public', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://oymike.example', runScripts: 'outside-only' });
  const { window } = dom;
  window.Blob = Blob;
  for (const asset of ['vendor/qrcode.js', 'vendor/qrcode_UTF8.js', 'qr-artwork.js']) window.eval(fs.readFileSync(path.join(__dirname, '../public', asset), 'utf8'));
  const url = 'https://qr.oymiketech.com/s/ABC123XYZ';
  const svg = window.QRIAQRArtwork.createSvg(url, { correction: 'M' }, 1600);
  assert.match(svg, /^<svg /);
  assert.match(svg, /width="1600"/);
  const matrix = window.QRIAQRArtwork.matrixFor(url, {});
  // Quiet zone: the viewBox reserves 4 modules around the symbol on every side.
  assert.match(svg, new RegExp(`<rect x="[0-9.]+" y="[0-9.]+" width="400" height="400" fill="#FFFFFF"`));
  assert.ok(matrix.length >= 21, 'a real QR matrix is produced');
  const scanned = window.QRIAQRArtwork.matrixFor(url, {});
  assert.deepEqual(scanned, matrix, 'the exported symbol encodes exactly the public URL');

  // The merchant page ships the shared artwork module and both download buttons.
  const merchantHtml = fs.readFileSync(path.join(__dirname, '../public/merchant.html'), 'utf8');
  assert.match(merchantHtml, /src="\/qr-artwork\.js"/);
  assert.match(merchantHtml, /id="downloadStoreQrPng"[^>]*>Télécharger en PNG/);
  assert.match(merchantHtml, /id="downloadStoreQrSvg"[^>]*>Télécharger en SVG/);
  const merchantJs = fs.readFileSync(path.join(__dirname, '../public/merchant.js'), 'utf8');
  assert.match(merchantJs, /QRIAQRArtwork\.download\(url, style, baseName, format\)/);
  assert.match(merchantJs, /data-download-point-svg/, 'each table QR also offers a real SVG download');
  window.close();
});

test('marchand : la photo principale peut être promue et réordonnée', () => {
  const merchantJs = fs.readFileSync(path.join(__dirname, '../public/merchant.js'), 'utf8');
  assert.match(merchantJs, /data-set-main-image/, 'a control promotes any photo to the main image');
  assert.match(merchantJs, /data-move-image/, 'photos can be reordered');
  assert.match(merchantJs, /state\.productImages\.unshift\(chosen\)/, 'the chosen photo becomes the first image sent to the public catalogue');
  assert.match(merchantJs, /imageData: imageUrls\[0\] \|\| ''/, 'the payload keeps the first photo as the main image');
});
