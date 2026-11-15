'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

let child; let base; let tempDir; let serverOutput = '';
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => {
      const port = server.address().port; server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}
async function waitForServer() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited ${child.exitCode}\n${serverOutput}`);
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch (_) { /* boot */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server startup timeout\n${serverOutput}`);
}
function cookieFrom(response, role, previous = '') {
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
  const values = cookies.map((value) => value.split(';')[0]).filter((value) => value.startsWith(`qria_${role}=`));
  return values.find((value) => value.slice(value.indexOf('=') + 1)) || values.at(-1) || previous;
}
async function call(url, { cookie = '', method = 'GET', body, redirect = 'manual' } = {}) {
  const headers = { Origin: base }; if (cookie) headers.Cookie = cookie; if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect });
  const type = response.headers.get('content-type') || ''; const data = type.includes('application/json') ? await response.json().catch(() => ({})) : {};
  const text = type.includes('application/json') ? '' : await response.text().catch(() => '');
  return { response, status: response.status, data, text };
}
async function startServer(reuseData = false, publicBaseUrl = '') {
  const port = await freePort(); base = `http://127.0.0.1:${port}`; if (!reuseData) tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oymike-merchant-test-'));
  const env = { ...process.env }; delete env.DATABASE_URL; delete env.WEB_PUSH_VAPID_PUBLIC_KEY; delete env.WEB_PUSH_VAPID_PRIVATE_KEY; delete env.WEB_PUSH_SUBJECT; delete env.PUBLIC_BASE_URL;
  Object.assign(env, { NODE_ENV: 'test', PORT: String(port), QRIA_STORE_FILE: path.join(tempDir, 'store.json'), ADMIN_USERNAME: 'merchant-ceo', ADMIN_PASSWORD: 'Merchant-CEO-Password-2026!', SESSION_SECRET: 'merchant-commerce-test-secret-long-enough-123456' });
  if (publicBaseUrl) env.PUBLIC_BASE_URL = publicBaseUrl;
  child = spawn(process.execPath, ['server.js'], { cwd: path.resolve(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); }); child.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });
  await waitForServer();
}
async function stopChild() {
  if (child && child.exitCode === null) { child.kill('SIGTERM'); await new Promise((resolve) => child.once('exit', resolve)); }
}
async function restartServer() { await stopChild(); await startServer(true); }
async function stopServer() { await stopChild(); if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }); }
async function login(role, endpoint, username, password) {
  const response = await call(endpoint, { method: 'POST', body: { username, password } });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  const cookie = cookieFrom(response.response, role);
  assert.ok(cookie && cookie.includes('='), `${role} session cookie expected`);
  return { ...response, cookie };
}

test('PUBLIC_BASE_URL : ouvre l’entrée marchande sur le domaine dédié et canonise ses pages', async (t) => {
  const merchantBase = 'https://www.march.oymiketech.com'; const canonicalHost = new URL(merchantBase).host;
  await startServer(false, merchantBase); t.after(stopServer);
  const request = (url, host) => fetch(`${base}${url}`, { headers: host ? { Host: host, 'X-Forwarded-Host': host } : {}, redirect: 'manual' });
  const root = await request('/', canonicalHost);
  assert.equal(root.status, 302); assert.equal(root.headers.get('location'), '/merchant/', 'the configured merchant-domain root opens the dedicated login route');
  const loginPage = await request('/merchant/', canonicalHost);
  const loginHtml = await loginPage.text();
  assert.equal(loginPage.status, 200); assert.match(loginHtml, /id="loginForm"/); assert.doesNotMatch(loginHtml, /id="controlRole"/, 'merchant sign-in contains no PDG/manager role selector');
  assert.match(loginPage.headers.get('content-type') || '', /text\/html/);
  for (const path of ['/admin','/admin/','/manager','/manager/','/merchant-control','/merchant-control/','/index.html','/manager.html','/merchant-control.html']) {
    const page = await request(path, canonicalHost); assert.equal(page.status, 302, `${path} is not an alternative PDG/manager entry on the merchant domain`); assert.equal(page.headers.get('location'), '/merchant/');
  }
  const managementPageOnMainHost = await request('/merchant-control', 'mike-qr.onrender.com');
  assert.equal(managementPageOnMainHost.status, 200); assert.match(await managementPageOnMainHost.text(), /id="controlRole"/, 'PDG/manager login remains available on the primary host');
  const canonicalizedPage = await request('/merchant/', 'mike-qr.onrender.com');
  assert.equal(canonicalizedPage.status, 302); assert.equal(canonicalizedPage.headers.get('location'), `${merchantBase}/merchant/`, 'a non-canonical entry redirects to the configured host');
  const canonicalizedShort = await request('/merchant', canonicalHost);
  assert.equal(canonicalizedShort.status, 308); assert.equal(canonicalizedShort.headers.get('location'), '/merchant/');
  const health = await request('/api/health', canonicalHost); assert.equal(health.status, 200);
  const healthData = await health.json(); assert.equal(healthData.publicBaseUrl, merchantBase, 'the configured public URL is retained exactly as the canonical host');
  const otherHostRoot = await request('/', 'mike-qr.onrender.com'); assert.equal(otherHostRoot.status, 200, 'non-canonical root keeps the existing primary application entry');
});

test('marchands : comptes temporaires, boutique publique, stock, idempotence, portées et QR interdits au marchand', async (t) => {
  await startServer(); t.after(stopServer);
  const merchantPage = await call('/merchant/'); assert.equal(merchantPage.status, 200, 'the dedicated merchant entry route must not redirect to itself'); assert.match(merchantPage.text, /qria-logo\.png/);
  const merchantShortUrl = await call('/merchant'); assert.equal(merchantShortUrl.status, 308); assert.equal(merchantShortUrl.response.headers.get('location'), '/merchant/');
  const merchantManifest = await call('/merchant/manifest.webmanifest'); assert.equal(merchantManifest.status, 200); assert.match(merchantManifest.response.headers.get('content-type') || '', /manifest\+json/);
  const merchantWorker = await call('/merchant/sw.js'); assert.equal(merchantWorker.status, 200); assert.match(merchantWorker.response.headers.get('content-type') || '', /javascript/);
  const controlPage = await call('/merchant-control');
  assert.equal(controlPage.status, 200); assert.match(controlPage.text, /vendor\/qrcode\.js/);
  const qrLibrary = await call('/vendor/qrcode.js');
  assert.equal(qrLibrary.status, 200); assert.match(qrLibrary.response.headers.get('content-type') || '', /javascript/); assert.match(qrLibrary.text, /qrcode/);
  const ceo = await login('admin', '/api/auth/login', 'merchant-ceo', 'Merchant-CEO-Password-2026!');
  const managerResult = await call('/api/admin/managers', { cookie: ceo.cookie, method: 'POST', body: {
    username: 'retail.manager', displayName: 'Gestionnaire Commerce', password: 'Manager-Password-2026!', canCreateCodes: true, canEditCodes: true, canManageMerchants: true,
  } });
  assert.equal(managerResult.status, 201, JSON.stringify(managerResult.data));
  const manager = managerResult.data.data;
  const otherManagerResult = await call('/api/admin/managers', { cookie: ceo.cookie, method: 'POST', body: {
    username: 'other.manager', displayName: 'Autre Gestionnaire', password: 'Other-Manager-Password-2026!', canCreateCodes: false, canEditCodes: false,
  } });
  assert.equal(otherManagerResult.status, 201, JSON.stringify(otherManagerResult.data));
  const otherManager = otherManagerResult.data.data;

  const create = await call('/api/admin/merchants', { cookie: ceo.cookie, method: 'POST', body: {
    username: 'awa-shop', displayName: 'Awa Boutique', phone: '+225 0700000000', managerId: manager.id,
  } });
  assert.equal(create.status, 201, JSON.stringify(create.data));
  const merchant = create.data.data; const temporaryPassword = create.data.temporaryPassword;
  assert.ok(temporaryPassword.length >= 12); assert.equal(merchant.mustChangePassword, true);
  assert.ok(!JSON.stringify(create.data).includes('passwordHash'));

  const managerLogin = await login('manager', '/api/manager/auth/login', 'retail.manager', 'Manager-Password-2026!');
  const ceoRejectedOnMerchantLogin = await call('/api/merchant/auth/login', { method: 'POST', body: { username: 'merchant-ceo', password: 'Merchant-CEO-Password-2026!' } });
  assert.equal(ceoRejectedOnMerchantLogin.status, 401, 'CEO credentials cannot create a merchant session');
  const managerRejectedOnMerchantLogin = await call('/api/merchant/auth/login', { method: 'POST', body: { username: 'retail.manager', password: 'Manager-Password-2026!' } });
  assert.equal(managerRejectedOnMerchantLogin.status, 401, 'manager credentials cannot create a merchant session');
  const merchantLogin = await login('merchant', '/api/merchant/auth/login', 'awa-shop', temporaryPassword);
  assert.equal(merchantLogin.data.data.mustChangePassword, true);
  const gated = await call('/api/merchant/store', { cookie: merchantLogin.cookie, method: 'PUT', body: { name: 'Private Shop' } });
  assert.equal(gated.status, 403); assert.equal(gated.data.code, 'PASSWORD_CHANGE_REQUIRED');
  const passwordChange = await call('/api/merchant/auth/change-password', { cookie: merchantLogin.cookie, method: 'POST', body: {
    password: 'Awa-New-Personal-Password-2026!', confirmPassword: 'Awa-New-Personal-Password-2026!',
  } });
  assert.equal(passwordChange.status, 200, JSON.stringify(passwordChange.data));
  const merchantCookie = cookieFrom(passwordChange.response, 'merchant', merchantLogin.cookie);
  assert.equal(passwordChange.data.data.mustChangePassword, false);
  const pushConfig = await call('/api/merchant/push/config', { cookie: merchantCookie }); assert.equal(pushConfig.data.enabled, false, 'unconfigured push is reported as unavailable rather than simulated');

  const forgedQr = await call('/api/merchant/qr', { cookie: merchantCookie, method: 'POST', body: {} });
  assert.equal(forgedQr.status, 403, 'a merchant cannot create a QR through a direct merchant API call');
  const forgedAdminQr = await call(`/api/admin/merchants/${merchant.id}/qr`, { cookie: merchantCookie, method: 'POST', body: {} });
  assert.equal(forgedAdminQr.status, 401, 'a merchant session is not an admin session');

  const png1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMH0AAAAASUVORK5CYII=';
  const uploadMedia = async (purpose) => { const uploaded = await call('/api/merchant/media', { cookie: merchantCookie, method: 'POST', body: { dataUrl: png1, purpose } }); assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data)); return uploaded.data.data; };
  let storeLogo = await uploadMedia('logo'); let storeCover = await uploadMedia('cover');
  const productPhotoOne = await uploadMedia('product'); const productPhotoTwo = await uploadMedia('product');
  const mediaPrivateRead = await call(`/api/merchant/media/${storeLogo.id}`, { cookie: merchantCookie }); assert.equal(mediaPrivateRead.status, 200);
  const managerMediaRead = await call(`/api/manager/merchants/${merchant.id}/media/${storeLogo.id}`, { cookie: managerLogin.cookie }); assert.equal(managerMediaRead.status, 200, 'a manager with the CEO-granted merchant scope may read merchant media');
  const adminMediaRead = await call(`/api/admin/merchants/${merchant.id}/media/${storeLogo.id}`, { cookie: ceo.cookie }); assert.equal(adminMediaRead.status, 200, 'the CEO retains full access to merchant media');
  const mediaCrossRead = await call(`/api/merchant/media/${storeLogo.id}`, { cookie: managerLogin.cookie }); assert.equal(mediaCrossRead.status, 401, 'a manager cookie cannot be used as a merchant media session');
  const storeResult = await call('/api/merchant/store', { cookie: merchantCookie, method: 'PUT', body: {
    name: 'Awa Créations', slug: 'awa-creations', description: 'Créations artisanales à Abidjan.', phone: '+225 0700000000',
    whatsapp: '+225 0700000000', address: 'Cocody, Abidjan', deliveryNote: 'Retrait en boutique ou livraison à convenir.',
    openingHours: 'Lun–Sam · 09:00–18:00', deliveryFeeXof: 1000, deliveryEnabled: true, pickupEnabled: true,
    logo: storeLogo.url, coverImageUrl: storeCover.url, isPublished: true, theme: { template: 'elegant', colors: { primary: '#205a49' }, sections: { description: true, categories: true, contact: true, hours: true }, sectionOrder: ['cover','intro','categories','products','contact'] },
  } });
  assert.equal(storeResult.status, 200, JSON.stringify(storeResult.data)); assert.equal(storeResult.data.data.isPublished, true);
  const storeId = storeResult.data.data.id;
  const productResult = await call('/api/merchant/products', { cookie: merchantCookie, method: 'POST', body: {
    name: 'Sac tissé', description: 'Sac artisanal.', priceXof: 2500, stockQuantity: 2, trackStock: true, status: 'active', sku: 'SAC-01', category: 'Accessoires',
    imageUrls: [productPhotoOne.url, productPhotoTwo.url], imageData: productPhotoOne.url, variants: [{ name: 'Couleur', values: ['Noir', 'Naturel'] }],
  } });
  assert.equal(productResult.status, 201, JSON.stringify(productResult.data)); const product = productResult.data.data;
  const catalog = await call('/api/public/shops/awa-creations');
  assert.equal(catalog.status, 200); assert.equal(catalog.data.data.store.name, 'Awa Créations'); assert.equal(catalog.data.data.products[0].priceXof, 2500);
  assert.equal(catalog.data.data.store.logo, storeLogo.url); assert.equal(catalog.data.data.store.coverImageUrl, storeCover.url);
  assert.equal(catalog.data.data.store.theme.colors.primary, '#205a49'); assert.equal(catalog.data.data.products[0].imageUrls.length, 2);
  assert.deepEqual(catalog.data.data.products[0].variants[0].values, ['Noir', 'Naturel']);
  const publicLogoRead = await call(storeLogo.url); assert.equal(publicLogoRead.status, 200); assert.match(publicLogoRead.response.headers.get('content-type') || '', /image\/png/);
  const originalStoreLogo = storeLogo; const originalStoreCover = storeCover;
  storeLogo = await uploadMedia('logo'); storeCover = await uploadMedia('cover');
  const replaceStoreMedia = await call('/api/merchant/store', { cookie: merchantCookie, method: 'PUT', body: { logo: storeLogo.url, coverImageUrl: storeCover.url } }); assert.equal(replaceStoreMedia.status, 200);
  assert.equal(replaceStoreMedia.data.data.logo, storeLogo.url); assert.equal(replaceStoreMedia.data.data.coverImageUrl, storeCover.url);
  assert.equal((await call(`/api/merchant/media/${originalStoreLogo.id}`, { cookie: merchantCookie, method: 'DELETE', body: {} })).status, 200, 'a replaced logo can be removed once unreferenced');
  assert.equal((await call(`/api/merchant/media/${originalStoreCover.id}`, { cookie: merchantCookie, method: 'DELETE', body: {} })).status, 200, 'a replaced cover can be removed once unreferenced');
  assert.equal((await call(originalStoreLogo.url)).status, 404); assert.equal((await call(originalStoreCover.url)).status, 404);
  await restartServer();
  const mediaPersistedReload = await call('/api/merchant/store', { cookie: merchantCookie });
  const productPersistedReload = await call('/api/merchant/products', { cookie: merchantCookie });
  assert.equal(mediaPersistedReload.data.data.logo, storeLogo.url, 'media references and the merchant session survive a JSON-store server restart');
  assert.deepEqual(productPersistedReload.data.data[0].imageUrls, [productPhotoOne.url, productPhotoTwo.url]);
  assert.equal((await call(`/api/merchant/media/${storeLogo.id}`, { cookie: merchantCookie })).status, 200, 'persisted bytes remain fetchable after restart');
  assert.equal((await call(storeLogo.url)).status, 200, 'published image remains publicly visible after restart');
  const publicCatalogAfterRestart = await call('/api/public/shops/awa-creations'); assert.equal(publicCatalogAfterRestart.data.data.store.theme.colors.primary, '#205a49');
  const productPhotoReplacement = await call(`/api/merchant/products/${product.id}`, { cookie: merchantCookie, method: 'PUT', body: { imageUrls: [productPhotoTwo.url], imageData: productPhotoTwo.url } });
  assert.equal(productPhotoReplacement.status, 200, JSON.stringify(productPhotoReplacement.data)); assert.deepEqual(productPhotoReplacement.data.data.imageUrls, [productPhotoTwo.url]);
  const deleteUnusedPhoto = await call(`/api/merchant/media/${productPhotoOne.id}`, { cookie: merchantCookie, method: 'DELETE', body: {} }); assert.equal(deleteUnusedPhoto.status, 200);
  const deletedPhotoRead = await call(`/api/merchant/media/${productPhotoOne.id}`, { cookie: merchantCookie }); assert.equal(deletedPhotoRead.status, 404);
  const deletePhotoInUse = await call(`/api/merchant/media/${productPhotoTwo.id}`, { cookie: merchantCookie, method: 'DELETE', body: {} }); assert.equal(deletePhotoInUse.status, 409);

  const sseController = new AbortController();
  const sseResponse = await fetch(`${base}/api/merchant/events`, { headers: { Cookie: merchantCookie }, signal: sseController.signal });
  assert.equal(sseResponse.status, 200); assert.match(sseResponse.headers.get('content-type') || '', /text\/event-stream/);
  const sseReader = sseResponse.body.getReader();
  const sseEvent = (async () => {
    let transcript = ''; const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const next = await sseReader.read(); if (next.done) break;
      transcript += new TextDecoder().decode(next.value);
      if (transcript.includes('event: commerce') && transcript.includes('new_order')) return transcript;
    }
    throw new Error(`SSE merchant alert not received: ${transcript}`);
  })();

  const orderBody = { clientRequestId: 'request_shop_order_2026_0001', customerName: 'Koffi Client', customerPhone: '+225 0500000000',
    customerEmail: '', deliveryAddress: 'Retrait à la boutique', note: 'Merci', items: [{ productId: product.id, quantity: 1 }] };
  const orderResult = await call('/api/public/shops/awa-creations/orders', { method: 'POST', body: orderBody });
  assert.equal(orderResult.status, 201, JSON.stringify(orderResult.data)); assert.equal(orderResult.data.data.order.totalAmountXof, 2500);
  const ssePayload = await sseEvent; assert.match(ssePayload, /new_order/); await sseReader.cancel().catch(() => {}); sseController.abort();
  const order = orderResult.data.data.order; const trackingToken = orderResult.data.data.trackingToken;
  assert.equal(order.status, 'pending'); assert.equal(order.currency, 'XOF'); assert.ok(trackingToken.length >= 32);
  await restartServer();
  const unreadCreated = await call('/api/merchant/notifications?limit=60', { cookie: merchantCookie });
  assert.equal(unreadCreated.data.unreadCount, 1, 'one durable unread notification exists for the new order');
  const notificationId = unreadCreated.data.data[0].id;
  const unreadAfterIdempotent = await call('/api/merchant/notifications?limit=60', { cookie: merchantCookie }); assert.equal(unreadAfterIdempotent.data.unreadCount, 1, 'idempotent retries do not duplicate notifications');
  const markRead = await call(`/api/merchant/notifications/${notificationId}/read`, { cookie: merchantCookie, method: 'POST', body: {} });
  assert.equal(markRead.status, 200); assert.equal(markRead.data.unreadCount, 0, 'the read counter is persisted and becomes zero');
  const markReadAgain = await call(`/api/merchant/notifications/${notificationId}/read`, { cookie: merchantCookie, method: 'POST', body: {} }); assert.equal(markReadAgain.data.unreadCount, 0, 'repeated reads do not decrement below zero');
  const commerceStats = await call('/api/merchant/stats', { cookie: merchantCookie }); assert.equal(commerceStats.data.data.orderValueXof, 2500); assert.equal(commerceStats.data.data.paymentConfirmedXof, 0, 'order value is never reported as a confirmed payment');
  const duplicateOrder = await call('/api/public/shops/awa-creations/orders', { method: 'POST', body: orderBody });
  assert.equal(duplicateOrder.status, 200); assert.equal(duplicateOrder.data.data.idempotent, true);
  assert.equal(duplicateOrder.data.data.order.reference, order.reference); assert.equal(duplicateOrder.data.data.trackingToken, trackingToken);
  const removeProductPhotos = await call(`/api/merchant/products/${product.id}`, { cookie: merchantCookie, method: 'PUT', body: { imageUrls: [], imageData: '' } }); assert.equal(removeProductPhotos.status, 200);
  const historyPhotoRetention = await call(`/api/merchant/media/${productPhotoTwo.id}`, { cookie: merchantCookie, method: 'DELETE', body: {} }); assert.equal(historyPhotoRetention.status, 409, 'media referenced by an order snapshot cannot be destructively removed');
  const invalidTracking = await call(`/api/public/shops/orders/${encodeURIComponent(order.reference)}?token=wrong`);
  assert.equal(invalidTracking.status, 404);
  const tracking = await call(`/api/public/shops/orders/${encodeURIComponent(order.reference)}?token=${encodeURIComponent(trackingToken)}`);
  assert.equal(tracking.status, 200); assert.equal(tracking.data.data.customerName, 'Koffi Client');
  const changedIntent = await call('/api/public/shops/awa-creations/orders', { method: 'POST', body: { ...orderBody, items: [{ productId: product.id, quantity: 2 }] } });
  assert.equal(changedIntent.status, 409, 'reusing an idempotency key with different data is refused');
  const overStock = await call('/api/public/shops/awa-creations/orders', { method: 'POST', body: { ...orderBody, clientRequestId: 'request_shop_order_2026_0002', items: [{ productId: product.id, quantity: 2 }] } });
  assert.equal(overStock.status, 400, 'the server rejects a cart quantity beyond live stock');

  const qrCreated = await call(`/api/manager/merchants/${merchant.id}/qr`, { cookie: managerLogin.cookie, method: 'POST', body: {} });
  assert.equal(qrCreated.status, 201, JSON.stringify(qrCreated.data));
  const qrCode = qrCreated.data.data.path.split('/').pop();
  const managerQrView = await call(`/api/manager/merchants/${merchant.id}/qr`, { cookie: managerLogin.cookie });
  assert.equal(managerQrView.status, 200); assert.equal(managerQrView.data.data.path, `/s/${qrCode}`);
  const adminQrView = await call(`/api/admin/merchants/${merchant.id}/qr`, { cookie: ceo.cookie });
  assert.equal(adminQrView.status, 200); assert.equal(adminQrView.data.data.path, `/s/${qrCode}`);
  const publicQr = await call(`/s/${qrCode}`);
  assert.equal(publicQr.status, 302); assert.equal(publicQr.response.headers.get('location'), '/shop/awa-creations');
  const statsAfterScan = await call('/api/merchant/stats', { cookie: merchantCookie });
  assert.equal(statsAfterScan.data.data.qrScans, 1);
  const updatedStore = await call('/api/merchant/store', { cookie: merchantCookie, method: 'PUT', body: {
    name: 'Awa Créations · Nouveau catalogue', slug: 'awa-creations', description: 'Mis à jour en direct.', phone: '+225 0700000000',
    whatsapp: '+225 0700000000', address: 'Cocody, Abidjan', deliveryNote: '', isPublished: true,
  } });
  assert.equal(updatedStore.status, 200);
  const currentCatalog = await call('/api/public/shops/awa-creations'); assert.equal(currentCatalog.data.data.store.name, 'Awa Créations · Nouveau catalogue');
  const merchantOrders = await call('/api/merchant/orders', { cookie: merchantCookie });
  const internalOrderId = merchantOrders.data.data.find((row) => row.reference === order.reference).id;
  const customerOrderStatus = await call(`/api/merchant/orders/${internalOrderId}/status`, { cookie: merchantCookie, method: 'POST', body: { status: 'confirmed' } });
  assert.equal(customerOrderStatus.status, 200); assert.equal(customerOrderStatus.data.data.status, 'confirmed');
  const invalidTransition = await call(`/api/merchant/orders/${internalOrderId}/status`, { cookie: merchantCookie, method: 'POST', body: { status: 'completed' } });
  assert.equal(invalidTransition.status, 400, 'order status changes follow the allowed workflow');
  const cancelOrder = await call('/api/public/shops/awa-creations/orders', { method: 'POST', body: { ...orderBody,
    clientRequestId: 'request_shop_order_2026_0003', items: [{ productId: product.id, quantity: 1 }] } });
  assert.equal(cancelOrder.status, 201);
  const currentOrders = await call('/api/merchant/orders', { cookie: merchantCookie });
  const cancelOrderId = currentOrders.data.data.find((row) => row.reference === cancelOrder.data.data.order.reference).id;
  const notificationsBeforeViewingOrders = await call('/api/merchant/notifications?limit=60', { cookie: merchantCookie }); assert.equal(notificationsBeforeViewingOrders.data.unreadCount, 1);
  const readThroughOrders = await call('/api/merchant/notifications/read-orders', { cookie: merchantCookie, method: 'POST', body: { orderIds: currentOrders.data.data.map((row) => row.id) } });
  assert.equal(readThroughOrders.data.unreadCount, 0, 'opening the associated order list marks its order notifications as read');
  const readThroughOrdersAgain = await call('/api/merchant/notifications/read-orders', { cookie: merchantCookie, method: 'POST', body: { orderIds: currentOrders.data.data.map((row) => row.id) } }); assert.equal(readThroughOrdersAgain.data.unreadCount, 0);
  const cancelled = await call(`/api/merchant/orders/${cancelOrderId}/status`, { cookie: merchantCookie, method: 'POST', body: { status: 'cancelled', reason: 'Le client demande l’annulation.' } });
  assert.equal(cancelled.status, 200); assert.equal(cancelled.data.data.status, 'cancelled');
  const restoredProducts = await call('/api/merchant/products', { cookie: merchantCookie });
  assert.equal(restoredProducts.data.data.find((row) => row.id === product.id).stockQuantity, 1, 'cancelling a reserved order restores tracked inventory');

  const secondMerchantResult = await call('/api/admin/merchants', { cookie: ceo.cookie, method: 'POST', body: {
    username: 'other-shop', displayName: 'Autre Boutique', managerId: otherManager.id,
  } });
  assert.equal(secondMerchantResult.status, 201); const secondMerchant = secondMerchantResult.data.data;
  const otherManagerLogin = await login('manager', '/api/manager/auth/login', 'other.manager', 'Other-Manager-Password-2026!');
  const deniedManagerMedia = await call(`/api/manager/merchants/${merchant.id}/media/${storeLogo.id}`, { cookie: otherManagerLogin.cookie });
  assert.equal(deniedManagerMedia.status, 403, 'manager media reads require an explicit store or product permission');
  const otherMerchantLogin = await login('merchant', '/api/merchant/auth/login', 'other-shop', secondMerchantResult.data.temporaryPassword);
  const otherPassword = await call('/api/merchant/auth/change-password', { cookie: otherMerchantLogin.cookie, method: 'POST', body: { password: 'Other-Shop-Personal-Password-2026!', confirmPassword: 'Other-Shop-Personal-Password-2026!' } });
  assert.equal(otherPassword.status, 200); const otherShopCookie = cookieFrom(otherPassword.response, 'merchant', otherMerchantLogin.cookie);
  const otherShopMedia = await call(`/api/merchant/media/${storeLogo.id}`, { cookie: otherShopCookie }); assert.equal(otherShopMedia.status, 404, "one merchant cannot fetch another merchant's private media");
  const isolatedList = await call('/api/manager/merchants', { cookie: managerLogin.cookie });
  assert.deepEqual(isolatedList.data.data.map((m) => m.id), [merchant.id]);
  const crossScope = await call(`/api/manager/merchants/${secondMerchant.id}/products`, { cookie: managerLogin.cookie });
  assert.equal(crossScope.status, 403);
  const assignment = await call(`/api/admin/merchants/${secondMerchant.id}/assignments`, { cookie: ceo.cookie, method: 'POST', body: {
    managerId: manager.id, canManageProducts: true, canViewAudit: true,
  } });
  assert.equal(assignment.status, 200);
  const assignedProducts = await call(`/api/manager/merchants/${secondMerchant.id}/products`, { cookie: managerLogin.cookie });
  assert.equal(assignedProducts.status, 200); assert.deepEqual(assignedProducts.data.data, []);
  const deniedOrders = await call(`/api/manager/merchants/${secondMerchant.id}/orders`, { cookie: managerLogin.cookie });
  assert.equal(deniedOrders.status, 403, 'product permission does not imply order permission');
  const assignedList = await call('/api/manager/merchants', { cookie: managerLogin.cookie });
  assert.equal(assignedList.data.data.length, 2);
  const secondStore = await call(`/api/admin/merchants/${secondMerchant.id}/store`, { cookie: ceo.cookie, method: 'PUT', body: {
    name: 'Autre Boutique', slug: 'autre-boutique', isPublished: true,
  } });
  assert.equal(secondStore.status, 200);
  await call(`/api/admin/merchants/${secondMerchant.id}/assignments`, { cookie: ceo.cookie, method: 'POST', body: {
    managerId: otherManager.id, canCreateStoreQr: true,
  } });
  const managerWithoutQrPermission = await call(`/api/manager/merchants/${secondMerchant.id}/qr`, { cookie: otherManagerLogin.cookie, method: 'POST', body: {} });
  assert.equal(managerWithoutQrPermission.status, 403, 'a store assignment cannot override the manager QR permission disabled by the CEO');
  const managerQrLookupDenied = await call(`/api/manager/merchants/${secondMerchant.id}/qr`, { cookie: otherManagerLogin.cookie });
  assert.equal(managerQrLookupDenied.status, 403);

  const audit = await call(`/api/admin/merchants/${merchant.id}/audit`, { cookie: ceo.cookie });
  assert.equal(audit.status, 200); assert.ok(audit.data.data.some((entry) => entry.action === 'order_received'));
  assert.ok(audit.data.data.some((entry) => entry.action === 'qr_created'));
  assert.ok(!JSON.stringify(audit.data).includes('Awa-New-Personal-Password-2026!'));

  const suspended = await call(`/api/admin/merchants/${merchant.id}/status`, { cookie: ceo.cookie, method: 'POST', body: { status: 'suspended', reason: 'Test' } });
  assert.equal(suspended.status, 200);
  const revoked = await call('/api/merchant/auth/me', { cookie: merchantCookie }); assert.equal(revoked.status, 401, 'suspension revokes merchant sessions');

  const storeState = JSON.parse(await fs.readFile(path.join(tempDir, 'store.json'), 'utf8'));
  assert.equal(storeState.merchantOrders.length, 2); assert.equal(storeState.qrCodes.length, 0, 'merchant store QR does not alter existing QR records');
  assert.equal(storeState.merchantStores[0].id, storeId);
});

test('schema commerce est additive et déclare les tables/index idempotents', async () => {
  const schema = await fs.readFile(path.resolve(__dirname, '..', 'schema.sql'), 'utf8');
  for (const table of ['merchant_accounts', 'merchant_stores', 'merchant_products', 'merchant_orders', 'merchant_order_items', 'merchant_order_events', 'merchant_manager_assignments', 'merchant_media', 'merchant_notifications', 'merchant_push_subscriptions']) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
  assert.match(schema, /ALTER TABLE managers ADD COLUMN IF NOT EXISTS can_manage_merchants/);
  assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS merchant_orders_store_request_idx/);
  assert.match(schema, /tracking_token_hash TEXT NOT NULL/);
  assert.match(schema, /stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK \(stock_quantity >= 0\)/);
});
