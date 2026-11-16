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

test('PUBLIC_BASE_URL : met les connexions PDG, gestionnaire et marchand sur le même domaine avec des routes séparées', async (t) => {
  const merchantBase = 'https://qr.oymiketech.com'; const canonicalHost = new URL(merchantBase).host;
  await startServer(false, merchantBase); t.after(stopServer);
  const request = (url, host) => fetch(`${base}${url}`, { headers: host ? { Host: host, 'X-Forwarded-Host': host } : {}, redirect: 'manual' });
  const root = await request('/', canonicalHost);
  assert.equal(root.status, 302); assert.equal(root.headers.get('location'), '/merchant/', 'the shared-domain root opens the dedicated merchant login');
  const merchantPage = await request('/merchant/', canonicalHost);
  const merchantHtml = await merchantPage.text();
  assert.equal(merchantPage.status, 200); assert.match(merchantHtml, /id="loginForm"/); assert.doesNotMatch(merchantHtml, /id="controlRole"/, 'merchant sign-in contains no PDG/manager role selector');
  assert.match(merchantHtml, /href="\/fonts\.css"/); assert.match(merchantHtml,/Espace marchand/);
  const fontStyles=await request('/fonts.css',canonicalHost);assert.equal(fontStyles.status,200);assert.match(await fontStyles.text(),/font-family:'Source Sans 3'/);
  const localFont=await request('/fonts/source-sans-3-latin-ext.woff2',canonicalHost);assert.equal(localFont.status,200);assert.match(localFont.headers.get('content-type')||'',/font|octet-stream/);
  const pdgPage = await request('/admin/', canonicalHost); const pdgHtml = await pdgPage.text();
  assert.equal(pdgPage.status, 200); assert.match(pdgHtml, /Oymike QR — Gestion centralisée des codes QR/); assert.match(pdgHtml, /id="loginForm"/);
  const managerPage = await request('/manager/', canonicalHost); const managerHtml = await managerPage.text();
  assert.equal(managerPage.status, 200); assert.match(managerHtml, /Oymike QR — Espace gestionnaire/); assert.match(managerHtml, /id="managerLoginForm"/);
  const controlPage = await request('/merchant-control/', canonicalHost); const controlHtml = await controlPage.text();
  assert.equal(controlPage.status, 200); assert.match(controlHtml, /id="controlRole"/, 'the common PDG/manager sign-in is available on the same domain');
  for (const [file, route] of [['/index.html','/admin/'],['/manager.html','/manager/'],['/merchant-control.html','/merchant-control/']]) {
    const page = await request(file, canonicalHost); assert.equal(page.status, 308, `${file} should canonicalize to its role-specific login`); assert.equal(page.headers.get('location'), route);
  }
  const canonicalizedPage = await request('/merchant/', 'mike-qr1.onrender.com');
  assert.equal(canonicalizedPage.status, 302); assert.equal(canonicalizedPage.headers.get('location'), `${merchantBase}/merchant/`, 'a non-canonical merchant entry redirects to the configured shared domain');
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
  const defaultSettings = await call('/api/admin/settings', { cookie: ceo.cookie });
  assert.equal(defaultSettings.status, 200); assert.equal(defaultSettings.data.data.merchantOrderPolicy.trackingEnabled, true);
  const policySaved = await call('/api/admin/settings', { cookie: ceo.cookie, method: 'PUT', body: { merchantOrderPolicy: {
    ...defaultSettings.data.data.merchantOrderPolicy, cancellationRequestsPer24h: 2, clientBrowserNotifications: false,
  } } });
  assert.equal(policySaved.status, 200); assert.equal(policySaved.data.data.merchantOrderPolicy.cancellationRequestsPer24h, 2);
  assert.equal(policySaved.data.data.merchantOrderPolicy.clientBrowserNotifications, false);
  const policyRestored = await call('/api/admin/settings', { cookie: ceo.cookie, method: 'PUT', body: { merchantOrderPolicy: defaultSettings.data.data.merchantOrderPolicy } });
  assert.equal(policyRestored.status, 200); assert.equal(policyRestored.data.data.merchantOrderPolicy.clientBrowserNotifications, true, 'CEO order policy is persisted and can be restored explicitly');
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
    name: 'Awa Créations', slug: 'awa-creations', sector: 'restaurant', requireTablePhoto: true, description: 'Créations artisanales à Abidjan.', phone: '+225 0700000000',
    whatsapp: '+225 0700000000', address: 'Cocody, Abidjan', deliveryNote: 'Retrait en boutique ou livraison à convenir.',
    openingHours: 'Lun–Sam · 09:00–18:00', deliveryFeeXof: 1000, deliveryEnabled: true, pickupEnabled: true,
    logo: storeLogo.url, coverImageUrl: storeCover.url, isPublished: true, theme: { template: 'elegant', font:'Archivo', typography:{shopName:{size:30,weight:900,italic:true,decoration:'underline',lineHeight:1.8,letterSpacing:0.2,align:'center',transform:'uppercase',color:'#123456',opacity:0.85},product:{size:16,weight:400}}, colors: { primary: '#205a49' }, sections: { description: true, categories: true, contact: true, hours: true }, sectionOrder: ['cover','intro','categories','products','contact'] },
  } });
  assert.equal(storeResult.status, 200, JSON.stringify(storeResult.data)); assert.equal(storeResult.data.data.isPublished, true);
  const storeId = storeResult.data.data.id;
  const deniedTypoMerchant = await call(`/api/admin/merchants/${merchant.id}/typography`, { cookie: merchantCookie }); assert.equal(deniedTypoMerchant.status, 401, 'merchant session cannot call CEO typography controls');
  const deniedTypoManager = await call(`/api/admin/merchants/${merchant.id}/typography`, { cookie: managerLogin.cookie }); assert.equal(deniedTypoManager.status, 403, 'manager session cannot call CEO-only typography controls');
  const initialTypo = await call(`/api/admin/merchants/${merchant.id}/typography`, { cookie: ceo.cookie }); assert.equal(initialTypo.status, 200);
  assert.equal(initialTypo.data.data.theme.typography.other.size, 16, 'the other-important-text category defaults to the 16 px minimum');
  const savedTypo = await call(`/api/admin/merchants/${merchant.id}/typography`, { cookie: ceo.cookie, method: 'PUT', body: { typography: {
    ...initialTypo.data.data.theme.typography, product: { ...initialTypo.data.data.theme.typography.product, size: 20 }, price: { ...initialTypo.data.data.theme.typography.price, size: 30 }, other: { ...initialTypo.data.data.theme.typography.other, size: 22 },
  } } });
  assert.equal(savedTypo.status, 200, JSON.stringify(savedTypo.data)); assert.equal(savedTypo.data.data.theme.typography.product.size, 20); assert.equal(savedTypo.data.data.theme.typography.price.size, 30);
  assert.equal(savedTypo.data.data.theme.typography.other.size, 22); assert.equal(savedTypo.data.data.theme.colors.primary, '#205a49', 'typography save preserves the rest of the store theme');
  const productResult = await call('/api/merchant/products', { cookie: merchantCookie, method: 'POST', body: {
    name: 'Sac tissé', description: 'Sac artisanal.', priceXof: 2500, compareAtPriceXof: 3000, stockQuantity: 2, trackStock: true, status: 'active', sku: 'SAC-01', category: 'Accessoires', sortOrder: 4,
    imageUrls: [productPhotoOne.url, productPhotoTwo.url], imageData: productPhotoOne.url, variants: [{ name: 'Couleur', values: ['Noir', 'Naturel'] }],
  } });
  assert.equal(productResult.status, 201, JSON.stringify(productResult.data)); const product = productResult.data.data;
  const managerLegacyEdit = await call(`/api/manager/merchants/${merchant.id}/products/${product.id}`, { cookie: managerLogin.cookie, method: 'PUT', body: {
    name: product.name, description: product.description, sku: product.sku, priceXof: product.priceXof, stockQuantity: product.stockQuantity,
    trackStock: product.trackStock, status: product.status, imageData: product.imageData,
  } });
  assert.equal(managerLegacyEdit.status, 200, JSON.stringify(managerLegacyEdit.data));
  assert.equal(managerLegacyEdit.data.data.category, 'Accessoires', 'a manager edit without a category field must preserve the existing category');
  assert.equal(managerLegacyEdit.data.data.compareAtPriceXof, 3000, 'a manager edit must preserve the existing sale reference price');
  assert.equal(managerLegacyEdit.data.data.sortOrder, 4, 'a manager edit must preserve the existing catalogue position');
  assert.deepEqual(managerLegacyEdit.data.data.variants, [{ name: 'Couleur', values: ['Noir', 'Naturel'] }], 'a manager edit without variants must not erase existing variants');
  assert.deepEqual(managerLegacyEdit.data.data.imageUrls, [productPhotoOne.url, productPhotoTwo.url], 'a legacy single-image edit must preserve the other existing product photos');
  const catalog = await call('/api/public/shops/awa-creations');
  assert.equal(catalog.status, 200); assert.equal(catalog.data.data.store.name, 'Awa Créations'); assert.equal(catalog.data.data.products[0].priceXof, 2500);
  assert.equal(catalog.data.data.store.logo, storeLogo.url); assert.equal(catalog.data.data.store.coverImageUrl, storeCover.url);
  assert.equal(catalog.data.data.store.theme.colors.primary, '#205a49'); assert.equal(catalog.data.data.store.theme.font,'Archivo');
  assert.deepEqual(catalog.data.data.store.theme.typography.shopName,{size:30,weight:900,italic:true,decoration:'underline',lineHeight:1.8,letterSpacing:0.2,align:'center',transform:'uppercase',color:'#123456',opacity:0.85});
  assert.equal(catalog.data.data.store.requireTablePhoto,true); assert.equal(catalog.data.data.products[0].imageUrls.length, 2);
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
  assert.equal(publicCatalogAfterRestart.data.data.store.theme.typography.product.size, 20, 'CEO typography values persist after a server restart and are returned to the public shop');
  assert.equal(publicCatalogAfterRestart.data.data.store.theme.typography.price.size, 30); assert.equal(publicCatalogAfterRestart.data.data.store.theme.typography.other.size, 22);
  const resetTypo = await call(`/api/admin/merchants/${merchant.id}/typography`, { cookie: ceo.cookie, method: 'PUT', body: { reset: true } });
  assert.equal(resetTypo.status, 200); assert.equal(resetTypo.data.data.theme.typography.product.size, 16); assert.equal(resetTypo.data.data.theme.typography.price.size, 17);
  assert.equal(resetTypo.data.data.theme.colors.primary, '#205a49', 'reset only restores type styles; all other store-theme settings remain unchanged');
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

  const exifJpeg=Buffer.from([0xff,0xd8,0xff,0xe1,0x00,0x0a,0x45,0x78,0x69,0x66,0x00,0x00,0x31,0x32,0xff,0xda,0x00,0x02,0xff,0xd9]).toString('base64');
  const tablePhoto=`data:image/jpeg;base64,${exifJpeg}`;
  const orderBody = { clientRequestId: 'request_shop_order_2026_0001', customerName: 'John Sery Michael', customerPhone: '+225 0500000000',
    customerEmail: '', deliveryAddress: 'Retrait à la boutique', note: 'Merci', tablePhoto, items: [{ productId: product.id, quantity: 1 }] };
  const missingRequiredPhoto=await call('/api/public/shops/awa-creations/orders',{method:'POST',body:{...orderBody,clientRequestId:'request_missing_table_photo_01',tablePhoto:''}});
  assert.equal(missingRequiredPhoto.status,400,'a restaurant with its photo rule enabled refuses a missing camera photo');assert.match(missingRequiredPhoto.data.error,/caméra/i);
  const orderResult = await call('/api/public/shops/awa-creations/orders', { method: 'POST', body: orderBody });
  assert.equal(orderResult.status, 201, JSON.stringify(orderResult.data)); assert.equal(orderResult.data.data.order.totalAmountXof, 2500);
  const ssePayload = await sseEvent; assert.match(ssePayload, /new_order/); await sseReader.cancel().catch(() => {}); sseController.abort();
  const order = orderResult.data.data.order; const trackingToken = orderResult.data.data.trackingToken;
  assert.equal(order.status, 'pending'); assert.equal(order.currency, 'XOF'); assert.ok(trackingToken.length >= 32);
  const photoOrderRow=(await call('/api/merchant/orders',{cookie:merchantCookie})).data.data.find((row)=>row.reference===order.reference);
  assert.equal(photoOrderRow.hasTablePhoto,true);assert.equal(photoOrderRow.customerName,'John Sery Michael','the full example name and spaces survive server validation');
  const privateTablePhoto=await call(`/api/merchant/orders/${photoOrderRow.id}/table-photo`,{cookie:merchantCookie});assert.equal(privateTablePhoto.status,200);assert.match(privateTablePhoto.response.headers.get('content-type')||'',/image\/jpeg/);
  assert.ok(!privateTablePhoto.text.includes('Exif'),'server-side JPEG metadata stripping removes EXIF before storage');
  const wrongTenantPhoto=await call(`/api/merchant/orders/${photoOrderRow.id}/table-photo`,{cookie:'qria_merchant=invalid'});assert.equal(wrongTenantPhoto.status,401);
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
  assert.equal(tracking.status, 200); assert.equal(tracking.data.data.customerName, 'John Sery Michael'); assert.equal(tracking.data.data.deliveryFeeXof,1000);
  assert.equal(tracking.data.data.store.phone, '+225 0700000000', 'tracking contact uses only the store contact actually recorded on the server');
  const recoveredOrders = await call('/api/public/shops/awa-creations/orders/recover', { method: 'POST', body: { reference: order.reference, token: trackingToken, phone: orderBody.customerPhone } });
  assert.equal(recoveredOrders.status, 200, JSON.stringify(recoveredOrders.data)); assert.equal(recoveredOrders.data.data.length, 1);
  assert.equal(recoveredOrders.data.data[0].reference, order.reference); assert.equal(recoveredOrders.data.data[0].trackingCode, trackingToken);
  assert.equal(recoveredOrders.data.data[0].store.slug, 'awa-creations'); assert.equal(recoveredOrders.data.data[0].items[0].quantity, 1);
  const phoneOnlyRecovery = await call('/api/public/shops/awa-creations/orders/recover', { method: 'POST', body: { phone: orderBody.customerPhone } });
  assert.equal(phoneOnlyRecovery.status, 404, 'phone alone cannot recover or enumerate orders');
  const badSecretRecovery = await call('/api/public/shops/awa-creations/orders/recover', { method: 'POST', body: { reference: order.reference, token: 'x'.repeat(50), phone: orderBody.customerPhone } });
  assert.equal(badSecretRecovery.status, 404, 'wrong recovery secret does not reveal whether reference/phone exists');
  const wrongPhoneRecovery = await call('/api/public/shops/awa-creations/orders/recover', { method: 'POST', body: { reference: order.reference, token: trackingToken, phone: '+225 0500000001' } });
  assert.equal(wrongPhoneRecovery.status, 404, 'the secret must match the submitted phone as an additional check');
  const globalOrders = await call('/api/admin/merchant-orders?status=pending', { cookie: ceo.cookie });
  assert.equal(globalOrders.status, 200); assert.ok(globalOrders.data.data.some((row) => row.reference === order.reference && row.storeName === 'Awa Créations' && row.merchantName === 'Awa Boutique'));
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
  for(const next of ['preparing','ready','out_for_delivery','completed']){const changed=await call(`/api/merchant/orders/${internalOrderId}/status`,{cookie:merchantCookie,method:'POST',body:{status:next}});assert.equal(changed.status,200,JSON.stringify(changed.data));}
  const completedTracking=await call(`/api/public/shops/orders/${encodeURIComponent(order.reference)}?token=${encodeURIComponent(trackingToken)}`);assert.equal(completedTracking.status,404,'a completed order remains in merchant history but is no longer publicly trackable');
  assert.equal((await call(`/api/public/shops/orders/${encodeURIComponent(order.reference)}/cancellation?token=${encodeURIComponent(trackingToken)}`)).status,404,'no cancellation outcome endpoint reopens a completed order');
  const photoRemoved=await call(`/api/merchant/orders/${internalOrderId}/table-photo`,{cookie:merchantCookie,method:'DELETE'});assert.equal(photoRemoved.status,200);
  assert.equal((await call(`/api/merchant/orders/${internalOrderId}/table-photo`,{cookie:merchantCookie})).status,404,'merchant-initiated photo deletion takes effect immediately');
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

  const cancelBeforeConfirmation = await call('/api/public/shops/awa-creations/orders', { method: 'POST', body: { ...orderBody,
    clientRequestId: 'request_shop_order_2026_0004' } });
  assert.equal(cancelBeforeConfirmation.status, 201); const cancelBeforeOrder = cancelBeforeConfirmation.data.data.order;
  const cancelBeforeToken = cancelBeforeConfirmation.data.data.trackingToken;
  const badCancellationToken = await call(`/api/public/shops/orders/${encodeURIComponent(cancelBeforeOrder.reference)}/cancel?token=${encodeURIComponent('x'.repeat(40))}`, { method: 'POST', body: { requestId: 'cancel_before_confirmation_2026_0001' } });
  assert.equal(badCancellationToken.status, 404, 'phone or reference alone cannot authorize cancellation');
  const autoCancelRequestId = 'cancel_before_confirmation_2026_0001';
  const autoCancelled = await call(`/api/public/shops/orders/${encodeURIComponent(cancelBeforeOrder.reference)}/cancel?token=${encodeURIComponent(cancelBeforeToken)}`, { method: 'POST', body: { requestId: autoCancelRequestId, reason: 'Commande passée par erreur.' } });
  assert.equal(autoCancelled.status, 201); assert.equal(autoCancelled.data.data.request.status, 'accepted'); assert.equal(autoCancelled.data.data.autoAccepted, true);
  assert.equal(autoCancelled.data.data.order.status, 'cancelled'); assert.equal(autoCancelled.data.data.request.reason, 'Commande passée par erreur.');
  const duplicateAutoCancel = await call(`/api/public/shops/orders/${encodeURIComponent(cancelBeforeOrder.reference)}/cancel?token=${encodeURIComponent(cancelBeforeToken)}`, { method: 'POST', body: { requestId: autoCancelRequestId, reason: 'Commande passée par erreur.' } });
  assert.equal(duplicateAutoCancel.status, 200); assert.equal(duplicateAutoCancel.data.data.idempotent, true, 'retries reuse the same cancellation result without duplicate events');
  assert.equal((await call(`/api/public/shops/orders/${encodeURIComponent(cancelBeforeOrder.reference)}?token=${encodeURIComponent(cancelBeforeToken)}`)).status, 404, 'cancelled orders leave public active tracking');
  const autoCancelOutcome = await call(`/api/public/shops/orders/${encodeURIComponent(cancelBeforeOrder.reference)}/cancellation?token=${encodeURIComponent(cancelBeforeToken)}`);
  assert.equal(autoCancelOutcome.status, 200); assert.equal(autoCancelOutcome.data.data.request.status, 'accepted');
  assert.ok(!JSON.stringify(autoCancelOutcome.data).includes('John Sery Michael'), 'the closed cancellation-result endpoint does not expose order/customer details');
  const cancellationNotification = await call('/api/merchant/notifications?limit=60', { cookie: merchantCookie });
  assert.ok(cancellationNotification.data.data.some((row) => row.type === 'order_cancelled'), 'a client auto-cancellation is durably notified to the merchant');
  let cancellationOrders = await call('/api/merchant/orders?status=cancelled', { cookie: merchantCookie });
  assert.ok(cancellationOrders.data.data.some((row) => row.reference === cancelBeforeOrder.reference && row.cancellationRequests[0].status === 'accepted'), 'merchant cancellation history remains available after the client order disappears from public tracking');

  const cancelAfterConfirmation = await call('/api/public/shops/awa-creations/orders', { method: 'POST', body: { ...orderBody,
    clientRequestId: 'request_shop_order_2026_0005' } });
  assert.equal(cancelAfterConfirmation.status, 201); const afterOrder = cancelAfterConfirmation.data.data.order;
  const afterToken = cancelAfterConfirmation.data.data.trackingToken;
  let afterOrderId = (await call('/api/merchant/orders', { cookie: merchantCookie })).data.data.find((row) => row.reference === afterOrder.reference).id;
  assert.equal((await call(`/api/merchant/orders/${afterOrderId}/status`, { cookie: merchantCookie, method: 'POST', body: { status: 'confirmed' } })).status, 200);
  const afterCancelPath = `/api/public/shops/orders/${encodeURIComponent(afterOrder.reference)}/cancel?token=${encodeURIComponent(afterToken)}`;
  const cancelRequestId = 'cancel_after_accept_2026_0001';
  const pendingCancel = await call(afterCancelPath, { method: 'POST', body: { requestId: cancelRequestId } });
  assert.equal(pendingCancel.status, 201); assert.equal(pendingCancel.data.data.request.status, 'pending'); assert.equal(pendingCancel.data.data.order.status, 'confirmed');
  const concurrentDuplicate = await call(afterCancelPath, { method: 'POST', body: { requestId: cancelRequestId } });
  assert.equal(concurrentDuplicate.status, 200); assert.equal(concurrentDuplicate.data.data.idempotent, true, 'an ambiguous retry for the same request key is idempotent');
  const competingCancellation = await call(afterCancelPath, { method: 'POST', body: { requestId: 'cancel_after_accept_2026_0002' } });
  assert.equal(competingCancellation.status, 409, 'a second active cancellation request cannot be opened for the same order');
  const publicPendingCancellation = await call(`/api/public/shops/orders/${encodeURIComponent(afterOrder.reference)}?token=${encodeURIComponent(afterToken)}`);
  assert.equal(publicPendingCancellation.data.data.cancellationRequests[0].status, 'pending');
  const cancellationRecordId = pendingCancel.data.data.request.id;
  const deniedManagerCancellation = await call(`/api/manager/merchants/not-a-merchant/orders/${afterOrderId}/cancellations/${cancellationRecordId}`, { cookie: managerLogin.cookie, method: 'POST', body: { decision: 'rejected' } });
  assert.equal(deniedManagerCancellation.status, 403, 'a manager cannot decide cancellations outside the assigned merchant scope');
  const managerRejectedCancellation = await call(`/api/manager/merchants/${merchant.id}/orders/${afterOrderId}/cancellations/${cancellationRecordId}`, { cookie: managerLogin.cookie, method: 'POST', body: { decision: 'rejected', note: 'La préparation est déjà engagée.' } });
  assert.equal(managerRejectedCancellation.status, 200, JSON.stringify(managerRejectedCancellation.data)); assert.equal(managerRejectedCancellation.data.data.order.status, 'confirmed');
  assert.equal(managerRejectedCancellation.data.data.request.status, 'rejected');
  const publicRejectedCancellation = await call(`/api/public/shops/orders/${encodeURIComponent(afterOrder.reference)}?token=${encodeURIComponent(afterToken)}`);
  assert.equal(publicRejectedCancellation.data.data.cancellationRequests[0].status, 'rejected');
  assert.match(publicRejectedCancellation.data.data.cancellationRequests[0].decisionNote, /préparation/i);
  const retryAfterRejection = await call(afterCancelPath, { method: 'POST', body: { requestId: 'cancel_after_rejection_2026_0001' } });
  assert.equal(retryAfterRejection.status, 201); assert.equal(retryAfterRejection.data.data.request.status, 'pending', 'a legitimate retry after a refusal is not automatically blacklisted');
  const noAutomaticCustomerBlocks = await call('/api/merchant/customer-blocks?status=active', { cookie: merchantCookie });
  assert.equal(noAutomaticCustomerBlocks.status, 200); assert.equal(noAutomaticCustomerBlocks.data.data.length, 0, 'a legitimate cancellation request/retry never auto-blocks the customer');
  const acceptCancellation = await call(`/api/merchant/orders/${afterOrderId}/cancellations/${retryAfterRejection.data.data.request.id}`, { cookie: merchantCookie, method: 'POST', body: { decision: 'accepted', note: 'Annulation acceptée.' } });
  assert.equal(acceptCancellation.status, 200); assert.equal(acceptCancellation.data.data.order.status, 'cancelled');
  assert.equal((await call(`/api/public/shops/orders/${encodeURIComponent(afterOrder.reference)}?token=${encodeURIComponent(afterToken)}`)).status, 404);
  const acceptedCancellationOutcome = await call(`/api/public/shops/orders/${encodeURIComponent(afterOrder.reference)}/cancellation?token=${encodeURIComponent(afterToken)}`);
  assert.equal(acceptedCancellationOutcome.status, 200); assert.equal(acceptedCancellationOutcome.data.data.request.status, 'accepted');
  assert.ok(!('items' in acceptedCancellationOutcome.data.data), 'only the cancellation outcome is available after the order leaves public tracking');
  const acceptedAgain = await call(`/api/merchant/orders/${afterOrderId}/cancellations/${retryAfterRejection.data.data.request.id}`, { cookie: merchantCookie, method: 'POST', body: { decision: 'accepted' } });
  assert.equal(acceptedAgain.status, 200); assert.equal(acceptedAgain.data.data.idempotent, true, 'repeating a decision does not cancel or restore inventory twice');
  const afterDecisionHistory = await call('/api/merchant/orders?status=cancelled', { cookie: merchantCookie });
  const afterHistoryRow = afterDecisionHistory.data.data.find((row) => row.reference === afterOrder.reference);
  assert.equal(afterHistoryRow.cancellationRequests.length, 2); assert.equal(afterHistoryRow.cancellationRequests[0].status, 'rejected'); assert.equal(afterHistoryRow.cancellationRequests[1].status, 'accepted');

  const secondMerchantResult = await call('/api/admin/merchants', { cookie: ceo.cookie, method: 'POST', body: {
    username: 'other-shop', displayName: 'Autre Boutique', managerId: otherManager.id, temporaryPasswordLength: 6,
  } });
  assert.equal(secondMerchantResult.status, 201); const secondMerchant = secondMerchantResult.data.data;
  assert.equal(secondMerchantResult.data.temporaryPassword.length, 6, 'the PDG may request a six-character temporary password');
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

  const blockedPhone = '+225 0100000000';
  const badBlock = await call('/api/merchant/customer-blocks', { cookie: merchantCookie, method: 'POST', body: { phone: '123', reason: 'Spam' } });
  assert.equal(badBlock.status, 400, 'a malformed phone or too-short reason cannot create a restriction');
  const blockCreated = await call('/api/merchant/customer-blocks', { cookie: merchantCookie, method: 'POST', body: { phone: blockedPhone, reason: 'Commandes frauduleuses documentées' } });
  assert.equal(blockCreated.status, 201, JSON.stringify(blockCreated.data)); const customerBlock = blockCreated.data.data;
  assert.equal(customerBlock.status, 'active'); assert.equal(customerBlock.phoneLast4, '0000'); assert.equal(customerBlock.attemptCount, 0);
  assert.ok(!JSON.stringify(blockCreated.data).includes('225010000000'), 'block responses expose only a keyed fingerprint and the last four digits');
  const duplicateBlock = await call('/api/merchant/customer-blocks', { cookie: merchantCookie, method: 'POST', body: { phone: '225-0100000000', reason: 'Autre motif non appliqué' } });
  assert.equal(duplicateBlock.status, 200); assert.equal(duplicateBlock.data.idempotent, true, 'duplicate blocks do not create another history row');
  const managerOwnBlocks = await call(`/api/manager/merchants/${merchant.id}/customer-blocks?status=active`, { cookie: managerLogin.cookie });
  assert.equal(managerOwnBlocks.status, 200); assert.equal(managerOwnBlocks.data.data[0].id, customerBlock.id, 'an assigned primary manager with order scope can inspect this store list');
  const deniedManagerBlocks = await call(`/api/manager/merchants/${secondMerchant.id}/customer-blocks`, { cookie: otherManagerLogin.cookie });
  assert.equal(deniedManagerBlocks.status, 403, 'a QR-only manager assignment cannot inspect customer restrictions');
  const deniedManagerBlockWrite = await call(`/api/manager/merchants/${secondMerchant.id}/customer-blocks`, { cookie: otherManagerLogin.cookie, method: 'POST', body: { phone: blockedPhone, reason: 'Test non autorisé' } });
  assert.equal(deniedManagerBlockWrite.status, 403, 'a manager cannot mutate customer restrictions outside the order-management permission');
  const blockedOrderBody = { ...orderBody, customerPhone: blockedPhone, clientRequestId: 'blocked_customer_order_request_0001' };
  const blockedAttempt = await call('/api/public/shops/awa-creations/orders', { method: 'POST', body: blockedOrderBody });
  assert.equal(blockedAttempt.status, 409); assert.match(blockedAttempt.data.error, /difficulté/i); assert.doesNotMatch(blockedAttempt.data.error, /bloqu|liste noire/i, 'the public response is deliberately neutral');
  const blockedRetry = await call('/api/public/shops/awa-creations/orders', { method: 'POST', body: blockedOrderBody });
  assert.equal(blockedRetry.status, 409, 'the blocked attempt remains rejected on retry');
  const secondBlockedAttempt = await call('/api/public/shops/awa-creations/orders', { method: 'POST', body: { ...blockedOrderBody, clientRequestId: 'blocked_customer_order_request_0002' } });
  assert.equal(secondBlockedAttempt.status, 409);
  let blockedList = await call('/api/merchant/customer-blocks?status=active', { cookie: merchantCookie });
  assert.equal(blockedList.data.data[0].attemptCount, 2, 'two distinct blocked requests are counted while idempotent retries do not inflate the count');
  assert.equal(blockedList.data.data[0].history.length, 1, 'the manual block is part of its append-only history');
  const blockedNotifications = await call('/api/merchant/notifications?limit=60', { cookie: merchantCookie });
  assert.equal(blockedNotifications.data.data.filter((row) => row.type === 'customer_block_attempt').length, 1, 'repeated attempts are recorded while merchant alerts are deduplicated');
  const globalBlocks = await call('/api/admin/merchant-customer-blocks?status=active', { cookie: ceo.cookie });
  assert.equal(globalBlocks.status, 200); assert.ok(globalBlocks.data.data.some((row) => row.id === customerBlock.id), 'the PDG can supervise blocks across stores');
  assert.ok(!JSON.stringify(globalBlocks.data).includes('225010000000'));
  const deniedGlobalBlocks = await call('/api/admin/merchant-customer-blocks', { cookie: merchantCookie });
  assert.equal(deniedGlobalBlocks.status, 401, 'a merchant cannot access global PDG supervision');
  const blockedAudit = await call(`/api/admin/merchants/${merchant.id}/audit`, { cookie: ceo.cookie });
  assert.ok(blockedAudit.data.data.some((entry) => entry.action === 'customer_block_created'));
  assert.equal(blockedAudit.data.data.filter((entry) => entry.action === 'customer_blocked_order_attempt').length, 2, 'blocked attempts are audited once per unique request');
  assert.ok(!JSON.stringify(blockedAudit.data).includes('225010000000'), 'audits do not store the full blocked phone');

  const otherStoreProduct = await call('/api/merchant/products', { cookie: otherShopCookie, method: 'POST', body: {
    name: 'Produit autre boutique', priceXof: 1800, stockQuantity: 5, trackStock: true, status: 'active', sku: 'OTHER-01', category: 'Test',
  } });
  assert.equal(otherStoreProduct.status, 201, JSON.stringify(otherStoreProduct.data));
  const samePhoneOtherStore = await call('/api/public/shops/autre-boutique/orders', { method: 'POST', body: {
    clientRequestId: 'same_phone_different_store_0001', customerName: 'John Sery Michael', customerPhone: blockedPhone,
    deliveryAddress: 'Retrait à la boutique', items: [{ productId: otherStoreProduct.data.data.id, quantity: 1 }],
  } });
  assert.equal(samePhoneOtherStore.status, 201, 'a block is scoped to its own store; the same phone can order at another shop');
  const managerUnblock = await call(`/api/manager/merchants/${merchant.id}/customer-blocks/${customerBlock.id}/unblock`, { cookie: managerLogin.cookie, method: 'POST', body: { reason: 'Vérification terminée' } });
  assert.equal(managerUnblock.status, 200); assert.equal(managerUnblock.data.data.status, 'unblocked'); assert.equal(managerUnblock.data.data.history.length, 2);
  const pdgBlock = await call(`/api/admin/merchants/${merchant.id}/customer-blocks`, { cookie: ceo.cookie, method: 'POST', body: { phone: blockedPhone, reason: 'Supervision PDG et réexamen' } });
  assert.equal(pdgBlock.status, 201, 'a later re-block creates a new historical entry rather than overwriting the previous one');
  const pdgUnblock = await call(`/api/admin/merchant-customer-blocks/${pdgBlock.data.data.id}/unblock`, { cookie: ceo.cookie, method: 'POST', body: { reason: 'Mesure levée après revue' } });
  assert.equal(pdgUnblock.status, 200); assert.equal(pdgUnblock.data.data.status, 'unblocked', 'the CEO can lift a store restriction through global supervision');
  blockedList = await call('/api/merchant/customer-blocks?status=unblocked', { cookie: merchantCookie });
  assert.equal(blockedList.data.data.length, 2); assert.ok(blockedList.data.data.every((row) => row.history.length === 2 && row.attemptCount === (row.id === customerBlock.id ? 2 : 0)), 'block, unblock and attempt history remain separately preserved');
  const afterUnblockOrder = await call('/api/public/shops/awa-creations/orders', { method: 'POST', body: { ...blockedOrderBody, clientRequestId: 'blocked_customer_unblocked_order_0001' } });
  assert.equal(afterUnblockOrder.status, 201, 'after the block is lifted, a new order request is accepted');
  const durableStateForBlocks = JSON.parse(await fs.readFile(path.join(tempDir, 'store.json'), 'utf8'));
  assert.equal(durableStateForBlocks.merchantCustomerBlocks.length, 2); assert.equal(durableStateForBlocks.merchantCustomerBlockAttempts.length, 2);
  assert.ok(!JSON.stringify(durableStateForBlocks.merchantCustomerBlocks).includes('225010000000'), 'the JSON store retains only a keyed phone fingerprint and masked suffix');

  const assistedProductResult = await call('/api/merchant/products', { cookie: merchantCookie, method: 'POST', body: {
    name: 'Produit commande assistée', priceXof: 1400, stockQuantity: 3, trackStock: true, status: 'active', sku: 'ASSIST-01', category: 'Accessoires',
  } });
  assert.equal(assistedProductResult.status, 201, JSON.stringify(assistedProductResult.data)); const assistedProduct = assistedProductResult.data.data;
  const servicePointResult = await call('/api/merchant/service-points', { cookie: merchantCookie, method: 'POST', body: {
    requestId: 'assisted_table_create_request_01', type: 'table', name: 'Table assistée', zone: 'Salle',
  } });
  assert.equal(servicePointResult.status, 201, JSON.stringify(servicePointResult.data)); const assistedPoint = servicePointResult.data.data;
  const assistedContext = await call('/api/merchant/assisted-orders/context', { cookie: merchantCookie });
  assert.equal(assistedContext.status, 200); assert.ok(assistedContext.data.data.products.some((row) => row.id === assistedProduct.id));
  assert.equal(assistedContext.data.data.store.id, storeId); assert.equal(assistedContext.data.data.servicePoints.find((row) => row.id === assistedPoint.id).activeOrderCount, 0);
  const managerCannotUseMerchantAssistedRoute = await call('/api/merchant/assisted-orders/context', { cookie: managerLogin.cookie });
  assert.equal(managerCannotUseMerchantAssistedRoute.status, 401, 'manager credentials cannot be used as a merchant account for assisted-order access');
  const assistedBody = { requestId: 'assisted_order_creation_request_001', customerName: 'Client Commande Assistée', customerPhone: '+225 0700000042',
    customerEmail: 'client@example.ci', orderType: 'dine_in', servicePointId: assistedPoint.id, confirmOccupiedPoint: false,
    paymentMethod: 'mobile_money', discountAmountXof: 250, note: 'Commande prise avec le client.', items: [{ productId: assistedProduct.id, quantity: 1 }] };
  const assistedCreated = await call('/api/merchant/assisted-orders', { cookie: merchantCookie, method: 'POST', body: assistedBody });
  assert.equal(assistedCreated.status, 201, JSON.stringify(assistedCreated.data));
  assert.equal(assistedCreated.data.data.order.source, 'merchant_assisted'); assert.equal(assistedCreated.data.data.order.createdByType, 'merchant');
  assert.equal(assistedCreated.data.data.order.orderType, 'dine_in'); assert.equal(assistedCreated.data.data.order.servicePointName, 'Table assistée');
  assert.equal(assistedCreated.data.data.order.paymentMethod, 'mobile_money'); assert.equal(assistedCreated.data.data.order.paymentStatus, 'not_recorded');
  assert.equal(assistedCreated.data.data.order.totalAmountXof, 1400); assert.equal(assistedCreated.data.data.order.discountAmountXof, 250); assert.equal(assistedCreated.data.data.order.grandTotalXof, 1150);
  assert.match(assistedCreated.data.data.notice, /Aucun paiement n’a été vérifié/); assert.match(assistedCreated.data.data.trackingUrl, /\/order\//);
  const assistedAgain = await call('/api/merchant/assisted-orders', { cookie: merchantCookie, method: 'POST', body: assistedBody });
  assert.equal(assistedAgain.status, 200); assert.equal(assistedAgain.data.data.idempotent, true); assert.equal(assistedAgain.data.data.order.reference, assistedCreated.data.data.order.reference);
  const occupiedContext = await call('/api/merchant/assisted-orders/context', { cookie: merchantCookie });
  assert.equal(occupiedContext.data.data.servicePoints.find((row) => row.id === assistedPoint.id).activeOrderCount, 1, 'active occupancy is derived from real, unfinished orders');
  const unconfirmedOccupied = await call('/api/merchant/assisted-orders', { cookie: merchantCookie, method: 'POST', body: { ...assistedBody, requestId: 'assisted_order_creation_request_002' } });
  assert.equal(unconfirmedOccupied.status, 409); assert.equal(unconfirmedOccupied.data.code, 'OCCUPIED_SERVICE_POINT');
  const confirmedOccupied = await call('/api/merchant/assisted-orders', { cookie: merchantCookie, method: 'POST', body: { ...assistedBody, requestId: 'assisted_order_creation_request_002', confirmOccupiedPoint: true } });
  assert.equal(confirmedOccupied.status, 201, JSON.stringify(confirmedOccupied.data)); assert.equal(confirmedOccupied.data.data.order.source, 'merchant_assisted');
  const assistedHistory = await call('/api/merchant/orders', { cookie: merchantCookie });
  assert.equal(assistedHistory.data.data.filter((row) => row.source === 'merchant_assisted').length, 2, 'assisted sales appear in the existing merchant order history with a distinct origin');
  const assistedAudit = await call(`/api/admin/merchants/${merchant.id}/audit`, { cookie: ceo.cookie });
  assert.equal(assistedAudit.status, 200); assert.equal(assistedAudit.data.data.filter((row) => row.action === 'assisted_order_created').length, 2, 'each non-idempotent assisted order is audited once');
  const persistedAssistedState = JSON.parse(await fs.readFile(path.join(tempDir, 'store.json'), 'utf8'));
  assert.equal(persistedAssistedState.merchantOrders.filter((row) => row.source === 'merchant_assisted').length, 2);
  assert.equal(persistedAssistedState.merchantOrders.filter((row) => row.source === 'merchant_assisted' && row.paymentStatus !== 'not_recorded').length, 0, 'the declared payment method is never stored as a confirmed payment');

  const audit = await call(`/api/admin/merchants/${merchant.id}/audit`, { cookie: ceo.cookie });
  assert.equal(audit.status, 200); assert.ok(audit.data.data.some((entry) => entry.action === 'order_received'));
  assert.ok(audit.data.data.some((entry) => entry.action === 'qr_created'));
  for(const action of ['order_cancellation_auto_accepted','order_cancellation_requested','order_cancellation_rejected','order_cancellation_accepted'])assert.ok(audit.data.data.some((entry)=>entry.action===action),`sensitive cancellation action ${action} is audited`);
  assert.equal(audit.data.data.filter((entry)=>entry.action==='order_cancellation_requested').length,2,'idempotent retries do not create duplicate cancellation audit entries');
  assert.ok(!JSON.stringify(audit.data).includes('Awa-New-Personal-Password-2026!'));

  const suspended = await call(`/api/admin/merchants/${merchant.id}/status`, { cookie: ceo.cookie, method: 'POST', body: { status: 'suspended', reason: 'Test' } });
  assert.equal(suspended.status, 200);
  const revoked = await call('/api/merchant/auth/me', { cookie: merchantCookie }); assert.equal(revoked.status, 401, 'suspension revokes merchant sessions');

  const invalidPasswordReset = await call(`/api/admin/merchants/${secondMerchant.id}/reset-password`, { cookie: ceo.cookie, method: 'POST', body: { temporaryPasswordLength: 8 } });
  assert.equal(invalidPasswordReset.status, 400, 'temporary password lengths are restricted to the two supported choices');
  const passwordReset = await call(`/api/admin/merchants/${secondMerchant.id}/reset-password`, { cookie: ceo.cookie, method: 'POST', body: { temporaryPasswordLength: 6 } });
  assert.equal(passwordReset.status, 200); assert.equal(passwordReset.data.temporaryPassword.length, 6);
  const resetLogin = await login('merchant', '/api/merchant/auth/login', 'other-shop', passwordReset.data.temporaryPassword);
  assert.equal(resetLogin.data.data.mustChangePassword, true, 'password reset forces a replacement at the next sign-in');
  const resetChange = await call('/api/merchant/auth/change-password', { cookie: resetLogin.cookie, method: 'POST', body: {
    password: 'Other-Shop-Second-Personal-2026!', confirmPassword: 'Other-Shop-Second-Personal-2026!',
  } });
  assert.equal(resetChange.status, 200);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const rejected = await call('/api/merchant/auth/login', { method: 'POST', body: { username: 'other-shop', password: 'invalid-password' } });
    assert.equal(rejected.status, 401);
  }
  const throttled = await call('/api/merchant/auth/login', { method: 'POST', body: { username: 'other-shop', password: 'invalid-password' } });
  assert.equal(throttled.status, 429, 'merchant sign-in rate limiting rejects further attempts from the same IP during the window');

  const storeState = JSON.parse(await fs.readFile(path.join(tempDir, 'store.json'), 'utf8'));
  assert.equal(storeState.merchantOrders.filter((row) => row.merchantId === merchant.id).length, 7, 'completed, cancelled, refused, post-unblock and assisted merchant order history remains durable');
  assert.equal(storeState.merchantOrders.filter((row) => row.merchantId === secondMerchant.id).length, 1, 'the same phone may order from an independent store'); assert.equal(storeState.qrCodes.length, 0, 'merchant store QR does not alter existing QR records');
  assert.equal(storeState.merchantStores[0].id, storeId);
  assert.ok(!JSON.stringify(storeState).includes(secondMerchantResult.data.temporaryPassword), 'the creation-time temporary password is never written to the store or audit log');
  assert.ok(!JSON.stringify(storeState).includes(passwordReset.data.temporaryPassword), 'the reset-time temporary password is never written to the store or audit log');
  assert.ok(!JSON.stringify(storeState).includes('Other-Shop-Second-Personal-2026!'), 'the replacement password is stored only as a hash');
});

test('archivage et restauration marchand : comptes, sessions, boutique et QR conservés', async (t) => {
  await startServer(); t.after(stopServer);
  const ceo = await login('admin', '/api/auth/login', 'merchant-ceo', 'Merchant-CEO-Password-2026!');
  const create = (username, displayName) => call('/api/admin/merchants', { cookie: ceo.cookie, method: 'POST', body: { username, displayName } });
  const created = await create('archive.shop', 'Boutique à archiver');
  assert.equal(created.status, 201, JSON.stringify(created.data)); const merchant = created.data.data;
  const initialLogin = await login('merchant', '/api/merchant/auth/login', 'archive.shop', created.data.temporaryPassword);
  const changed = await call('/api/merchant/auth/change-password', { cookie: initialLogin.cookie, method: 'POST', body: {
    password: 'Archive-Shop-Personal-Password-2026!', confirmPassword: 'Archive-Shop-Personal-Password-2026!',
  } });
  assert.equal(changed.status, 200); const merchantCookie = cookieFrom(changed.response, 'merchant', initialLogin.cookie);
  const storeResponse = await call(`/api/admin/merchants/${merchant.id}/store`, { cookie: ceo.cookie, method: 'PUT', body: {
    name: 'Atelier Archive', slug: 'atelier-archive', isPublished: true,
  } });
  assert.equal(storeResponse.status, 200, JSON.stringify(storeResponse.data)); const storeId = storeResponse.data.data.id;
  const qr = await call(`/api/admin/merchants/${merchant.id}/qr`, { cookie: ceo.cookie, method: 'POST', body: {} });
  assert.equal(qr.status, 201); const qrPath = qr.data.data.path;
  assert.equal((await call('/api/public/shops/atelier-archive')).status, 200);
  assert.equal((await call(qrPath)).status, 302);
  const unauthorizedArchive = await call(`/api/admin/merchants/${merchant.id}/archive`, { cookie: ceo.cookie, method: 'POST', body: { confirmUsername: 'not-the-username' } });
  assert.equal(unauthorizedArchive.status, 400); assert.equal((await call('/api/merchant/auth/me', { cookie: merchantCookie })).status, 200);

  const archived = await call(`/api/admin/merchants/${merchant.id}/archive`, { cookie: ceo.cookie, method: 'POST', body: { confirmUsername: merchant.username, reason: 'Fermeture temporaire demandée.' } });
  assert.equal(archived.status, 200, JSON.stringify(archived.data)); assert.ok(archived.data.data.deletedAt); assert.equal(archived.data.data.status, 'blocked');
  assert.ok(!JSON.stringify(archived.data).includes('passwordHash'));
  assert.equal((await call('/api/merchant/auth/me', { cookie: merchantCookie })).status, 401, 'archiving revokes previously issued merchant sessions');
  assert.equal((await call('/api/public/shops/atelier-archive')).status, 404, 'archived accounts cannot receive public shop traffic');
  assert.equal((await call(qrPath)).status, 404, 'printed shop QR URL is not redirected to a different merchant while archived');
  const defaultList = await call('/api/admin/merchants', { cookie: ceo.cookie }); assert.equal(defaultList.status, 200);
  assert.ok(!defaultList.data.data.some((row) => row.id === merchant.id), 'archived merchants are excluded by default');
  const fullList = await call('/api/admin/merchants?includeDeleted=1', { cookie: ceo.cookie });
  assert.ok(fullList.data.data.some((row) => row.id === merchant.id && row.deletedAt), 'CEO can explicitly include archived accounts');
  const archivedDetail = await call(`/api/admin/merchants/${merchant.id}`, { cookie: ceo.cookie });
  assert.equal(archivedDetail.status, 200); assert.ok(archivedDetail.data.data.deletedAt);

  const replacement = await create('archive.shop', 'Nouveau compte même identifiant');
  assert.equal(replacement.status, 201, 'the archived username can be reused for a new active merchant');
  const conflictingRestore = await call(`/api/admin/merchants/${merchant.id}/restore`, { cookie: ceo.cookie, method: 'POST', body: { confirmUsername: merchant.username } });
  assert.equal(conflictingRestore.status, 409, 'restore refuses an active duplicate identifier without overwriting either account');
  assert.ok((await call(`/api/admin/merchants/${merchant.id}`, { cookie: ceo.cookie })).data.data.deletedAt);
  const archivedReplacement = await call(`/api/admin/merchants/${replacement.data.data.id}/archive`, { cookie: ceo.cookie, method: 'POST', body: { confirmUsername: merchant.username, reason: 'Test de conflit.' } });
  assert.equal(archivedReplacement.status, 200);
  const restored = await call(`/api/admin/merchants/${merchant.id}/restore`, { cookie: ceo.cookie, method: 'POST', body: { confirmUsername: merchant.username } });
  assert.equal(restored.status, 200, JSON.stringify(restored.data)); assert.equal(restored.data.data.deletedAt, null); assert.equal(restored.data.data.status, 'active');
  const restoredDetail = await call(`/api/admin/merchants/${merchant.id}`, { cookie: ceo.cookie });
  assert.equal(restoredDetail.data.data.store.id, storeId, 'restoration retains the original store record');
  assert.equal(restoredDetail.data.data.store.qrPublicCode, qrPath.split('/').pop(), 'the already printed QR code remains unchanged');
  assert.equal((await call('/api/public/shops/atelier-archive')).status, 200, 'the original public catalog is available again after restoration');
  assert.equal((await call(qrPath)).response.headers.get('location'), '/shop/atelier-archive');
  const restoredLogin = await login('merchant', '/api/merchant/auth/login', merchant.username, 'Archive-Shop-Personal-Password-2026!');
  assert.equal(restoredLogin.status, 200, 'the existing password still works after restoration');
  const audit = await call(`/api/admin/merchants/${merchant.id}/audit`, { cookie: ceo.cookie });
  assert.equal(audit.status, 200); assert.ok(audit.data.data.some((entry) => entry.action === 'account_archived'));
  assert.ok(audit.data.data.some((entry) => entry.action === 'account_restored'));

  const html = await call('/merchant-control/'); const script = await call('/merchant-control.js');
  assert.equal(html.status, 200); assert.match(html.text, /showArchivedMerchants/); assert.match(html.text, /globalOrderSupervision/);
  assert.equal(script.status, 200); assert.match(script.text, /data-control-action="archive-account"/); assert.match(script.text, /api\/admin\/merchant-orders/);
  assert.match(script.text, /data-control-action="restore-account"/); assert.match(script.text, /includeDeleted=1/);
});

test('schema commerce est additive et déclare les tables/index idempotents', async () => {
  const schema = await fs.readFile(path.resolve(__dirname, '..', 'schema.sql'), 'utf8');
  for (const table of ['merchant_accounts', 'merchant_stores', 'merchant_products', 'merchant_orders', 'merchant_order_items', 'merchant_order_events', 'merchant_order_photos', 'merchant_order_cancellation_requests', 'merchant_customer_blocks', 'merchant_customer_block_events', 'merchant_customer_block_attempts', 'merchant_manager_assignments', 'merchant_media', 'merchant_notifications', 'merchant_push_subscriptions', 'supplier_accounts', 'supplier_products', 'sourcing_requests', 'supplier_quotes', 'supply_orders', 'supply_order_events', 'supply_notifications', 'supply_order_messages']) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
  assert.match(schema, /ALTER TABLE managers ADD COLUMN IF NOT EXISTS can_manage_merchants/);
  assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS merchant_orders_store_request_idx/);
  assert.match(schema, /tracking_token_hash TEXT NOT NULL/);
  assert.match(schema, /merchant_orders_status_workflow_check/); assert.match(schema, /out_for_delivery/); assert.match(schema, /'rejected'/);
  assert.match(schema, /merchant_orders_tracking_token_store_active_idx/);
  assert.match(schema, /stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK \(stock_quantity >= 0\)/);
  assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS merchant_customer_blocks_active_phone_idx ON merchant_customer_blocks \(store_id,phone_hash\) WHERE status='active'/);
  assert.match(schema, /UNIQUE \(store_id,request_hash\)/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS merchant_customer_block_attempts/);
});
