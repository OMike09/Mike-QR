'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const clone = (value) => JSON.parse(JSON.stringify(value));

class FakeEventSource {
  static instances = [];
  constructor(url) { this.url = url; this.listeners = new Map(); this.closed = false; FakeEventSource.instances.push(this); }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  close() { this.closed = true; }
  emit(name, data) { this.listeners.get(name)?.({ data: JSON.stringify(data) }); }
}

function jsonResponse(data, status = 200) { return { ok: status >= 200 && status < 300, status, async json() { return clone(data); } }; }

test('interface marchande simulée : connexion, thème persisté, produit et badge lu/non-lu', async (t) => {
  FakeEventSource.instances = [];
  const html = await fs.readFile(path.join(root, 'public/merchant.html'), 'utf8');
  const script = await fs.readFile(path.join(root, 'public/merchant.js'), 'utf8');
  const storeSlugPattern = html.match(/id="storeSlug"[^>]*pattern="([^"]+)"/)?.[1]; assert.ok(storeSlugPattern); assert.doesNotThrow(() => new RegExp(storeSlugPattern, 'v'), 'the public shop slug validation pattern must compile in modern browsers');
  const dom = new JSDOM(html, { url: 'https://merchant.example.test/merchant/', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close()); const w = dom.window;
  const theme = { template: 'modern', colors: { primary: '#0d725c', secondary: '#d4af37', background: '#f3f7f4', text: '#162622', button: '#0d725c', card: '#ffffff' }, font: 'Inter', textSize: 'normal', buttonShape: 'rounded', cardShape: 'rounded', menuStyle: 'pills', productLayout: 'grid', sections: { description: true, categories: true, contact: true, hours: true }, sectionOrder: ['cover','intro','categories','products','contact'] };
  let store = { id: 'shop-1', slug: 'demo-shop', name: 'Démo Marchande', description: 'Description', theme: clone(theme), isPublished: true, acceptsOrders: true, deliveryEnabled: true, pickupEnabled: true };
  let products = []; let notifications = [{ id: 'notification-1', title: 'Nouvelle commande reçue', message: 'Commande OY-DEMO', orderId: 'order-1', createdAt: new Date().toISOString(), readAt: null }];
  const calls = []; let mediaSequence = 0;
  w.fetch = async (url, options = {}) => {
    const path = String(url); const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : {};
    calls.push({ path, method, body });
    if (path.endsWith('/auth/me')) return jsonResponse({ data: { username: 'demo-shop', displayName: 'Démo Marchande', mustChangePassword: false } });
    if (path === '/api/merchant/media' && method === 'POST') { mediaSequence += 1; const id = `00000000-0000-4000-8000-${String(mediaSequence).padStart(12, '0')}`; return jsonResponse({ data: { id, url: `/media/merchant/${id}` } }, 201); }
    if (path.startsWith('/api/merchant/media/') && method === 'DELETE') return jsonResponse({ ok: true });
    if (path === '/api/merchant/store' && method === 'GET') return jsonResponse({ data: clone(store) });
    if (path === '/api/merchant/store' && method === 'PUT') { store = { ...store, ...clone(body) }; return jsonResponse({ data: clone(store) }); }
    if (path === '/api/merchant/qr') return jsonResponse({ data: null });
    if (path === '/api/merchant/products' && method === 'GET') return jsonResponse({ data: clone(products) });
    if (path === '/api/merchant/products' && method === 'POST') { const product = { ...clone(body), id: 'product-1', available: true, createdAt: new Date().toISOString() }; products = [product]; return jsonResponse({ data: product }, 201); }
    if (path === '/api/merchant/stats') return jsonResponse({ data: { products: products.length, orders: 0, pendingOrders: 0, orderValueXof: 0, qrScans: 0, availableProducts: products.length, outOfStock: 0, completedOrders: 0, cancelledOrders: 0, completedOrderValueXof: 0, topProducts: [], ordersByDay: [], recentOrders: [] } });
    if (path.startsWith('/api/merchant/notifications/') && path.endsWith('/read')) { const id = path.split('/').at(-2); const item = notifications.find((row) => row.id === id); if (item) item.readAt = new Date().toISOString(); return jsonResponse({ data: clone(notifications), unreadCount: notifications.filter((row) => !row.readAt).length }); }
    if (path.startsWith('/api/merchant/notifications/read-orders')) { return jsonResponse({ data: clone(notifications), unreadCount: notifications.filter((row) => !row.readAt).length }); }
    if (path.startsWith('/api/merchant/notifications')) return jsonResponse({ data: clone(notifications), unreadCount: notifications.filter((row) => !row.readAt).length });
    if (path.endsWith('/auth/logout')) return jsonResponse({ ok: true });
    return jsonResponse({ data: {} });
  };
  w.EventSource = FakeEventSource; w.setInterval = () => 1; Object.defineProperty(w.navigator, 'onLine', { value: true, configurable: true });
  w.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, set fillStyle(_value) {} });
  w.eval(script); await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(w.document.querySelector('#appView').hidden, false, 'a valid existing merchant session opens the dashboard');
  assert.equal(w.document.querySelector('#merchantName').textContent, 'Démo Marchande');
  assert.equal(w.document.querySelector('#notificationTabBadge').textContent, '1');

  const primary = w.document.querySelector('#themePrimary'); primary.value = '#123456'; primary.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(w.document.querySelector('#storeThemePreview').style.getPropertyValue('--shop-primary'), '#123456', 'the visual theme preview updates immediately');
  w.document.querySelector('#themeForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await tick(); await tick();
  assert.equal(store.theme.colors.primary, '#123456', 'theme edits are sent to the persistent store API');
  assert.ok(calls.some((call) => call.path === '/api/merchant/store' && call.method === 'PUT'));

  w.document.querySelector('[data-tab="products"]').click(); await tick();
  w.document.querySelector('#newProductButton').click();
  w.document.querySelector('#productName').value = 'Article de test'; w.document.querySelector('#productPrice').value = '2500';
  w.document.querySelector('#productForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(products.length, 1); assert.equal(products[0].name, 'Article de test');
  assert.match(w.document.querySelector('#productList').textContent, /Article de test/);

  let scrollCalls = 0; Object.defineProperty(w, 'scrollY', { configurable: true, get: () => 455 }); w.scrollTo = () => { scrollCalls += 1; };
  w.createImageBitmap = async () => ({ width: 16, height: 16, close() {} });
  w.HTMLCanvasElement.prototype.toBlob = function(callback) { callback(new w.Blob(['compressed-image'], { type: 'image/webp' })); };
  w.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, clearRect() {}, drawImage() {}, set fillStyle(_value) {} });
  const logoInput = w.document.querySelector('#storeLogoFile'); Object.defineProperty(logoInput, 'files', { configurable: true, value: [new w.File(['photo'], 'logo.png', { type: 'image/png' })] });
  logoInput.dispatchEvent(new w.Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(w.document.querySelector('#storeLogoData').value, '/media/merchant/00000000-0000-4000-8000-000000000001');
  assert.equal(w.scrollY, 455); assert.equal(scrollCalls, 0, 'choosing and uploading the logo does not adjust the page scroll');
  w.document.querySelector('#removeStoreLogo').click(); await tick();
  assert.equal(w.scrollY, 455); assert.equal(scrollCalls, 0, 'removing an image does not jump or compensate the scroll position');
  const coverInput = w.document.querySelector('#storeCoverFile'); Object.defineProperty(coverInput, 'files', { configurable: true, value: [new w.File(['cover'], 'cover.jpg', { type: 'image/jpeg' })] });
  coverInput.dispatchEvent(new w.Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 15));
  assert.match(w.document.querySelector('#storeCoverData').value, /media\/merchant/); assert.equal(w.scrollY, 455);
  w.document.querySelector('#removeStoreCover').click(); await tick(); assert.equal(w.scrollY, 455); assert.equal(scrollCalls, 0, 'cover selection and removal keep the viewport position');
  const productImagesInput = w.document.querySelector('#productImageFile'); Object.defineProperty(productImagesInput, 'files', { configurable: true, value: [new w.File(['one'], 'one.png', { type: 'image/png' }), new w.File(['two'], 'two.png', { type: 'image/png' })] });
  productImagesInput.dispatchEvent(new w.Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(w.document.querySelectorAll('#productImageGallery .product-image-item').length, 2);
  w.document.querySelector('[data-remove-product-image="0"]').click(); await tick();
  assert.equal(w.document.querySelectorAll('#productImageGallery .product-image-item').length, 1);
  assert.equal(w.scrollY, 455); assert.equal(scrollCalls, 0, 'photo selection and deletion leave the existing scroll position untouched');

  w.document.querySelector('[data-read-notification="notification-1"]').click(); await tick();
  assert.equal(w.document.querySelector('#notificationTabBadge').hidden, true, 'marking the event read removes the persistent unread badge');
  notifications.push({ id: 'notification-2', title: 'Nouvelle commande reçue', message: 'Commande OY-LIVE', orderId: 'order-2', createdAt: new Date().toISOString(), readAt: null });
  FakeEventSource.instances[0].emit('commerce', { type: 'new_order', orderId: 'order-2', reference: 'OY-LIVE' }); await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(w.document.querySelector('#notificationTabBadge').textContent, '1', 'live order refreshes the same server-backed unread counter');
  assert.match(w.document.querySelector('#toast').textContent, /Nouvelle commande reçue/);
  w.document.querySelector('#logoutButton').click(); await tick(); await tick();
  assert.equal(w.document.querySelector('#loginView').hidden, false, 'logout returns to the merchant login view');
  assert.equal(w.document.querySelector('#appView').hidden, true); assert.equal(w.location.pathname, '/merchant/', 'logout stays within the dedicated merchant entry');
  assert.equal(FakeEventSource.instances[0].closed, true, 'logout closes the merchant live-notification stream');
});

test('boutique publique simulée : personnalisation, ordre des sections, catégories et galerie photo', async (t) => {
  const html = await fs.readFile(path.join(root, 'public/shop.html'), 'utf8'); const script = await fs.readFile(path.join(root, 'public/shop.js'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://merchant.example.test/shop/demo-shop', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close()); const w = dom.window;
  const store = { slug: 'demo-shop', name: 'Awa Boutique', description: 'Créations à Abidjan', logo: '/media/merchant/logo.png', coverImageUrl: '/media/merchant/cover.png', phone: '+225 0700000000', whatsapp: '+225 0700000000', email: 'awa@example.test', address: 'Cocody', deliveryNote: 'Retrait possible', deliveryEnabled: true, pickupEnabled: true, deliveryFeeXof: 1500, openingHours: '09:00–18:00', acceptsOrders: true,
    theme: { template: 'elegant', colors: { primary: '#205a49', secondary: '#d4af37', background: '#faf7f0', text: '#162622', button: '#205a49', card: '#ffffff' }, font: 'Georgia', textSize: 'normal', buttonShape: 'pill', cardShape: 'soft', menuStyle: 'underline', productLayout: 'list', sections: { description: true, categories: true, contact: true, hours: true }, sectionOrder: ['products','cover','intro','categories','contact'] } };
  const products = [{ id: 'product-one', name: 'Sac tissé', category: 'Accessoires', description: 'Un sac artisanal', sku: 'SAC-1', priceXof: 2500, compareAtPriceXof: 3000, imageData: '/media/merchant/photo-a.png', imageUrls: ['/media/merchant/photo-a.png','/media/merchant/photo-b.png'], variants: [{ name: 'Couleur', values: ['Noir','Naturel'] }], available: true, status: 'active' }, { id: 'product-two', name: 'Pochette', category: 'Maison', description: '', sku: '', priceXof: 1000, imageUrls: [], available: true, status: 'active' }];
  w.fetch = async () => jsonResponse({ data: { store, products } }); w.eval(script); await tick(); await tick();
  const content = w.document.querySelector('#shopContent'); assert.equal(content.hidden, false);
  assert.equal(content.dataset.template, 'elegant'); assert.equal(content.dataset.layout, 'list'); assert.equal(content.style.getPropertyValue('--shop-primary'), '#205a49');
  assert.equal(w.document.querySelector('#shopSections').firstElementChild.id, 'shopSectionProducts', 'saved section order is applied to the public page');
  assert.equal(w.document.querySelector('#shopCover').getAttribute('src'), '/media/merchant/cover.png');
  assert.equal(w.document.querySelectorAll('#categoryFilters [data-category]').length, 3);
  assert.equal(w.document.querySelectorAll('.product-thumbnail').length, 2);
  const image = w.document.querySelector('.public-product-image img'); assert.match(image.getAttribute('src'), /photo-a\.png$/);
  w.document.querySelector('[data-photo-index="1"]').click();
  assert.match(w.document.querySelector('.public-product-image img').getAttribute('src'), /photo-b\.png$/);
  w.document.querySelector('[data-category="Accessoires"]').click(); assert.equal(w.document.querySelectorAll('.public-product').length, 1);
  assert.match(w.document.querySelector('#shopContact').textContent, /WhatsApp/);
  assert.match(w.document.querySelector('#shopDeliveryFee').textContent, /1\s?500/);
});
