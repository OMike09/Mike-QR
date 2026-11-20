'use strict';

// Public QR storefront: large uncropped images, stable image nodes, quantity steppers,
// adaptive checkout (table / pickup / delivery) and the merchant-facing order fields.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '../public/shop.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../public/shop.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/shop.css'), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const jsonResponse = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

const products = [
  { id: 'p-photo', name: 'Sac tissé', description: 'Fait main à Abidjan', category: 'Sacs', priceXof: 2500, stockQuantity: 3, trackStock: true, available: true,
    imageUrls: ['/media/a.webp', '/media/b.webp', '/media/c.webp'] },
  { id: 'p-free', name: 'Boubou brodé', description: 'Pièce unique', category: 'Vêtements', priceXof: 12000, stockQuantity: 0, trackStock: false, available: true,
    imageUrls: ['/media/d.webp'] },
];

function buildStore(overrides = {}) {
  return { name: 'Awa Créations', description: '', theme: {}, acceptsOrders: true, deliveryEnabled: true, pickupEnabled: true,
    orderModes: { delivery: true, pickup: true, dineIn: false }, ...overrides };
}
function catalog(storeOverrides = {}, productList = products) {
  return { data: { store: buildStore(storeOverrides), products: productList, orderModes: buildStore(storeOverrides).orderModes } };
}
function createPage(fetchImpl, { seed = {}, url = 'https://shop.example.test/shop/awa-creations' } = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const { window } = dom;
  window.fetch = fetchImpl;
  for (const [key, value] of Object.entries(seed)) window.sessionStorage.setItem(key, value);
  window.eval(script);
  return dom;
}
async function waitForCatalogue(window) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (!window.document.querySelector('#shopContent').hidden) return;
    await tick();
  }
  throw new Error(`Catalogue did not load: ${window.document.querySelector('#shopErrorText').textContent}`);
}
const card = (window, id) => window.document.querySelector(`[data-product-card="${id}"]`);

test('photos : grande zone d’affichage non rognée, description limitée et texte compact', () => {
  assert.match(css, /\.public-product-image\{[^}]*aspect-ratio:1\/1/, 'the product photo keeps a large square frame');
  assert.match(css, /\.public-product-image img\{[^}]*object-fit:contain/, 'the main image is never cropped');
  assert.doesNotMatch(css.split('@media(max-width:480px)').at(-1).split('\n')[0], /grid-template-columns:104px/);
  assert.match(css, /\.product-description\{[^}]*-webkit-line-clamp:2/, 'descriptions are clamped so cards stay short');
  assert.match(css, /@media\(max-width:480px\)\{[^}]*\.public-products\{grid-template-columns:1fr/, 'phones use one large card per row');
});

test('quantités : sélecteur − / + par produit, limites de stock et total recalculé', async () => {
  const dom = createPage(async (url) => {
    if (String(url).startsWith('/api/public/shops/')) return jsonResponse(catalog());
    throw new Error(`Unexpected request: ${url}`);
  });
  const { window } = dom;
  try {
    await waitForCatalogue(window);
    const value = (id) => card(window, id).querySelector('[data-qty-value]').textContent;
    const plus = (id) => card(window, id).querySelector('[data-qty-plus]');
    const minus = (id) => card(window, id).querySelector('[data-qty-minus]');
    assert.equal(value('p-photo'), '1', 'the quantity starts at 1');
    assert.equal(minus('p-photo').disabled, true, 'the quantity can never go below 1');
    plus('p-photo').click(); plus('p-photo').click();
    assert.equal(value('p-photo'), '3');
    assert.equal(plus('p-photo').disabled, true, 'the stock limit (3) is enforced');
    plus('p-photo').click();
    assert.equal(value('p-photo'), '3', 'an extra click does not exceed the stock');
    minus('p-photo').click();
    assert.equal(value('p-photo'), '2');
    assert.match(card(window, 'p-photo').querySelector('.product-stock').textContent, /3 en stock/);
    assert.equal(plus('p-free').disabled, false, 'a product without stock tracking can be added freely');
    card(window, 'p-photo').querySelector('[data-add]').click();
    assert.equal(window.document.querySelector('#cartCount').textContent, '2', 'the selected quantity is stored in the cart');
    assert.equal(window.document.querySelector('#cartTotal').textContent, '5 000 XOF', 'the total is computed from the quantity');
    const cartPlus = window.document.querySelector('[data-plus="p-photo"]');
    cartPlus.click();
    assert.equal(window.document.querySelector('#cartTotal').textContent, '7 500 XOF', 'the cart total updates after a change');
    assert.equal(window.document.querySelector('[data-plus="p-photo"]').disabled, true, 'the cart also stops at the stock limit');
    window.document.querySelector('[data-minus="p-photo"]').click();
    assert.equal(window.document.querySelector('#cartTotal').textContent, '5 000 XOF');
    assert.equal(value('p-photo'), '1', 'adding to the cart resets the local selector to 1');
  } finally { window.close(); }
});

test('images : ajouter au panier et changer les quantités ne reconstruit ni ne recharge les photos', async () => {
  const dom = createPage(async (url) => {
    if (String(url).startsWith('/api/public/shops/')) return jsonResponse(catalog());
    throw new Error(`Unexpected request: ${url}`);
  });
  const { window } = dom;
  try {
    await waitForCatalogue(window);
    const grid = window.document.querySelector('#productsGrid');
    const image = card(window, 'p-photo').querySelector('.public-product-image img');
    const otherImage = card(window, 'p-free').querySelector('.public-product-image img');
    image.dataset.identity = 'kept';
    for (let click = 0; click < 4; click += 1) card(window, 'p-photo').querySelector('[data-add]').click();
    card(window, 'p-photo').querySelector('[data-qty-plus]').click();
    card(window, 'p-free').querySelector('[data-add]').click();
    window.document.querySelector('[data-plus="p-free"]').click();
    window.document.querySelector('#clearCart').click();
    card(window, 'p-free').querySelector('[data-add]').click();
    assert.equal(window.document.querySelector('#productsGrid'), grid, 'the catalogue container is never replaced');
    assert.equal(card(window, 'p-photo').querySelector('.public-product-image img'), image, 'the same <img> node is kept after cart clicks');
    assert.equal(card(window, 'p-free').querySelector('.public-product-image img'), otherImage);
    assert.equal(image.dataset.identity, 'kept');
    assert.equal(image.getAttribute('src'), '/media/a.webp', 'the image URL is never rewritten');
    assert.equal(window.document.querySelectorAll('.public-product-image img').length, 2, 'no photo is duplicated or recreated');
  } finally { window.close(); }
});

test('galerie : la première photo est l’image principale, le changement de photo ne touche que le média', async () => {
  const dom = createPage(async (url) => {
    if (String(url).startsWith('/api/public/shops/')) return jsonResponse(catalog());
    throw new Error(`Unexpected request: ${url}`);
  });
  const { window } = dom;
  try {
    await waitForCatalogue(window);
    assert.equal(card(window, 'p-photo').querySelector('.public-product-image img').getAttribute('src'), '/media/a.webp', 'the first stored photo is the main image');
    const thumbnails = card(window, 'p-photo').querySelectorAll('.product-thumbnail');
    assert.equal(thumbnails.length, 3, 'all other photos stay available in the gallery');
    card(window, 'p-photo').querySelector('[data-add]').click();
    card(window, 'p-photo').querySelectorAll('[data-photo-index]')[2].click();
    assert.equal(card(window, 'p-photo').querySelector('.public-product-image img').getAttribute('src'), '/media/c.webp');
    assert.equal(window.document.querySelector('#cartCount').textContent, '1', 'the cart is preserved while browsing photos');
  } finally { window.close(); }
});

test('formulaire : numéro de table uniquement si la table est proposée, message facultatif, récapitulatif complet', async () => {
  const dom = createPage(async (url) => {
    if (String(url).startsWith('/api/public/shops/')) return jsonResponse(catalog());
    throw new Error(`Unexpected request: ${url}`);
  });
  const { window } = dom;
  try {
    await waitForCatalogue(window);
    const doc = window.document;
    assert.equal(doc.querySelector('#tableFields').hidden, true, 'no table field when the merchant did not enable table service');
    assert.equal(doc.querySelector('#orderModeField').hidden, false, 'the checkout offers the enabled delivery modes');
    assert.equal([...doc.querySelectorAll('#orderModeOptions input')].map((node) => node.value).join(','), 'delivery,pickup');
    doc.querySelector('#orderModeOptions input[value="pickup"]').click();
    assert.equal(doc.querySelector('#addressField').hidden, false);
    assert.equal(doc.querySelector('#deliveryAddress').required, false, 'pickup does not force a delivery address');
    card(window, 'p-photo').querySelector('[data-add]').click();
    doc.querySelector('#customerName').value = 'Koffi Client';
    doc.querySelector('#customerName').dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.querySelector('#customerNote').value = 'Sans piment';
    doc.querySelector('#customerNote').dispatchEvent(new window.Event('input', { bubbles: true }));
    const summary = doc.querySelector('#orderSummaryBody').textContent;
    assert.match(summary, /Sac tissé/);
    assert.match(summary, /× 1/);
    assert.match(summary, /2\s?\u202f?500\s?XOF/);
    assert.match(summary, /Koffi Client/);
    assert.match(summary, /À emporter/);
    assert.match(summary, /Sans piment/);
    assert.doesNotMatch(doc.querySelector('#orderSummaryBody').textContent, /Table/);
    assert.equal(doc.querySelector('#customerNote').required, false, 'the message to the merchant is never mandatory');
    assert.equal(doc.querySelector('#placeOrder').textContent, 'Confirmer ma commande');
  } finally { window.close(); }
});

test('commande : mode, table et message sont envoyés, la confirmation suit l’enregistrement serveur', async () => {
  const pointCode = 'T-STABLE-0001';
  const point = { id: 'point-1', storeSlug: 'awa-creations', type: 'table', name: 'Table 4', zone: 'Terrasse', publicCode: pointCode };
  const posts = [];
  const dom = createPage(async (url, init = {}) => {
    if (String(url).includes('service-points/')) return jsonResponse({ data: point });
    if (String(url).startsWith('/api/public/shops/') && String(url).endsWith('/orders')) {
      posts.push(JSON.parse(init.body));
      return jsonResponse({ data: { order: { reference: 'OY-1', status: 'pending' }, trackingEnabled: true, trackingToken: 'x'.repeat(40), idempotent: false } }, 201);
    }
    if (String(url).startsWith('/api/public/shops/')) return jsonResponse(catalog({ orderModes: { delivery: true, pickup: true, dineIn: true } }));
    throw new Error(`Unexpected request: ${url}`);
  }, { url: `https://shop.example.test/shop/awa-creations?servicePoint=${pointCode}` });
  const { window } = dom;
  try {
    await waitForCatalogue(window);
    const doc = window.document;
    assert.equal(doc.querySelector('#tableFields').hidden, false, 'the scanned table QR enables the table fields');
    assert.equal(doc.querySelector('#tableNumber').value, '4');
    doc.querySelector('#tableNote').value = 'Près de la terrasse';
    doc.querySelector('#tableNote').dispatchEvent(new window.Event('input', { bubbles: true }));
    card(window, 'p-photo').querySelector('[data-qty-plus]').click();
    card(window, 'p-photo').querySelector('[data-add]').click();
    doc.querySelector('#customerName').value = 'Awa Client';
    doc.querySelector('#customerPhone').value = '+225 0500000000';
    doc.querySelector('#customerNote').value = 'Merci';
    doc.querySelector('#checkoutForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    for (let attempt = 0; attempt < 60 && !posts.length; attempt += 1) await tick();
    for (let attempt = 0; attempt < 10 && window.document.querySelector('#cartCount').textContent !== '0'; attempt += 1) await tick();
    assert.equal(posts.length, 1);
    assert.equal(posts[0].orderMode, 'dine_in');
    assert.equal(posts[0].tableNumber, '4');
    assert.equal(posts[0].tableNote, 'Près de la terrasse');
    assert.equal(posts[0].note, 'Merci');
    assert.equal(posts[0].items[0].quantity, 2, 'the selected quantity is confirmed');
    assert.equal(posts[0].servicePointCode, pointCode);
    assert.equal(posts[0].deliveryAddress, 'Table 4 · Près de la terrasse', 'a table order never sends a delivery address');
    assert.equal(doc.querySelector('#cartCount').textContent, '0', 'the cart is only cleared after the stored order was confirmed');
    assert.equal(window.sessionStorage.getItem('oymike-shop-order:awa-creations'), null, 'the retry draft is cleared after the confirmed record');
  } finally { window.close(); }
});

test('validation : livraison sans adresse et « sur place » sans table sont refusés avant envoi', async () => {
  const posts = [];
  const dom = createPage(async (url, init = {}) => {
    if (String(url).endsWith('/orders')) { posts.push(JSON.parse(init.body)); return jsonResponse({ error: 'x' }, 500); }
    if (String(url).startsWith('/api/public/shops/')) return jsonResponse(catalog({ orderModes: { delivery: true, pickup: true, dineIn: true } }));
    throw new Error(`Unexpected request: ${url}`);
  });
  const { window } = dom;
  try {
    await waitForCatalogue(window);
    const doc = window.document;
    card(window, 'p-free').querySelector('[data-add]').click();
    doc.querySelector('#customerName').value = 'Client Test';
    doc.querySelector('#customerPhone').value = '+225 0500000000';
    doc.querySelector('#checkoutForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await tick(); await tick();
    assert.equal(posts.length, 0, 'a delivery order without an address is not sent');
    assert.match(doc.querySelector('#checkoutError').textContent, /adresse de livraison/i);
    doc.querySelector('#orderModeOptions input[value="dine_in"]').click();
    assert.equal(doc.querySelector('#tableFields').hidden, false, 'the table fields appear when table service is enabled');
    assert.equal(doc.querySelector('#addressField').hidden, true, 'a table order never shows the delivery address');
    doc.querySelector('#checkoutForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await tick(); await tick();
    assert.equal(posts.length, 0, 'a table order without a table number is not sent');
    assert.match(doc.querySelector('#checkoutError').textContent, /numéro de table/i);
    doc.querySelector('#tableNumber').value = '7';
    doc.querySelector('#checkoutForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await tick(); await tick();
    assert.equal(posts.length, 1, 'the order is sent once the table number is provided');
    assert.equal(posts[0].orderMode, 'dine_in');
    assert.equal(posts[0].tableNumber, '7');
    assert.equal(posts[0].deliveryAddress, 'Table 7');
  } finally { window.close(); }
});
