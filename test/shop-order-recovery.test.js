'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '../public/shop.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../public/shop.js'), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const catalog = { data: { store: { name: 'Awa Créations', description: '', phone: '', whatsapp: '', address: '', deliveryNote: '' }, products: [
  { id: 'product-sac', name: 'Sac tissé', description: 'Artisanal', sku: 'SAC-01', priceXof: 2500, available: true },
] } };
function jsonResponse(data, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => data }; }
function createPage(fetch, seed = {}, pageUrl = 'https://shop.example.test/shop/awa-creations') {
  const dom = new JSDOM(html, { url: pageUrl, runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = fetch;
      for (const [key, value] of Object.entries(seed)) window.sessionStorage.setItem(key, value);
    },
  });
  dom.window.eval(script);
  return dom;
}
async function waitForCatalogue(window) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!window.document.querySelector('#shopContent').hidden) return;
    await tick();
  }
  throw new Error('Catalogue did not load in the DOM test.');
}
function fillCheckout(window) {
  window.document.querySelector('#customerName').value = 'Koffi Client';
  window.document.querySelector('#customerPhone').value = '+225 0500000000';
  window.document.querySelector('#customerEmail').value = 'koffi@example.test';
  window.document.querySelector('#deliveryAddress').value = 'Retrait à Cocody';
  window.document.querySelector('#customerNote').value = 'Appeler avant le retrait';
}
async function submit(window) {
  window.document.querySelector('#checkoutForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick(); await tick();
}

test('commande boutique : après une coupure réseau, panier et corps idempotent survivent à la reprise/recharge', async () => {
  const firstPosts = [];
  const firstPage = createPage(async (url, init = {}) => {
    if (String(url).startsWith('/api/public/shops/') && !String(url).endsWith('/orders')) return jsonResponse(catalog);
    if (String(url).endsWith('/orders')) { firstPosts.push(JSON.parse(init.body)); throw new TypeError('Failed to fetch'); }
    throw new Error(`Unexpected request: ${url}`);
  });
  try {
    const { window } = firstPage; await waitForCatalogue(window); fillCheckout(window);
    window.document.querySelector('[data-add="product-sac"]').click();
    await submit(window);
    assert.equal(firstPosts.length, 1);
    assert.match(window.document.querySelector('#checkoutError').textContent, /peut-être déjà été reçue/i);
    assert.equal(window.document.querySelector('#placeOrder').disabled, false);
    assert.match(window.document.querySelector('#placeOrder').textContent, /Réessayer/i);
    assert.equal(window.document.querySelector('#customerName').disabled, true, 'the submitted intent is locked while delivery is uncertain');
    assert.ok(window.sessionStorage.getItem('oymike-shop-cart:awa-creations'));
    const persistedDraft = window.sessionStorage.getItem('oymike-shop-order:awa-creations');
    assert.ok(persistedDraft, 'request ID and exact intent are saved before sending');
    const firstPayload = firstPosts[0];
    assert.equal(firstPayload.clientRequestId, JSON.parse(persistedDraft).requestId);

    const secondPosts = [];
    const secondPage = createPage(async (url, init = {}) => {
      if (String(url).startsWith('/api/public/shops/') && !String(url).endsWith('/orders')) return jsonResponse(catalog);
      if (String(url).endsWith('/orders')) { secondPosts.push(JSON.parse(init.body)); return jsonResponse({ error: 'Temporary upstream timeout' }, 504); }
      throw new Error(`Unexpected request: ${url}`);
    }, {
      'oymike-shop-cart:awa-creations': window.sessionStorage.getItem('oymike-shop-cart:awa-creations'),
      'oymike-shop-order:awa-creations': persistedDraft,
    });
    try {
      const resumed = secondPage.window; await waitForCatalogue(resumed);
      assert.equal(resumed.document.querySelector('#customerName').value, 'Koffi Client');
      assert.equal(resumed.document.querySelector('#deliveryAddress').value, 'Retrait à Cocody');
      assert.equal(resumed.document.querySelector('#cartCount').textContent, '1');
      assert.equal(resumed.document.querySelector('#customerPhone').disabled, true);
      await submit(resumed);
      assert.equal(secondPosts.length, 1);
      assert.equal(secondPosts[0].clientRequestId, firstPayload.clientRequestId, 'retry after reload keeps the same idempotency key');
      assert.deepEqual(secondPosts[0], firstPayload, 'the exact customer/order intent is resent');
      assert.ok(resumed.sessionStorage.getItem('oymike-shop-order:awa-creations'), 'ambiguous gateway response preserves the resumable draft');
    } finally { secondPage.window.close(); }
  } finally { firstPage.window.close(); }
});

test('QR de table : emplacement affiché, transmis dans la commande et conservé après une coupure réseau', async () => {
  const pointCode='T-STABLE-QR-0001';const point={id:'point-1',storeSlug:'awa-creations',type:'table',name:'Table 4',zone:'Terrasse',instructions:'Scanner avant de commander',publicCode:pointCode};
  const firstPosts=[];
  const first=createPage(async(url,init={})=>{
    if(String(url)==='/api/public/shops/awa-creations')return jsonResponse(catalog);
    if(String(url)===`/api/public/service-points/${pointCode}`)return jsonResponse({data:point});
    if(String(url).endsWith('/orders')){firstPosts.push(JSON.parse(init.body));throw new TypeError('Failed to fetch');}
    throw new Error(`Unexpected request: ${url}`);
  },{},`https://shop.example.test/shop/awa-creations?servicePoint=${pointCode}`);
  try{
    const w=first.window;await waitForCatalogue(w);
    assert.equal(w.document.querySelector('#shopServicePoint').hidden,false);assert.match(w.document.querySelector('#shopServicePoint').textContent,/Table 4 · Terrasse · Scanner avant de commander/);
    assert.equal(w.document.querySelector('#deliveryAddress').value,'Table 4','the scanned QR supplies the default table in the handoff field');
    w.document.querySelector('#customerName').value='Client Table';w.document.querySelector('#customerPhone').value='+225 0500000000';w.document.querySelector('#customerEmail').value='';w.document.querySelector('#customerNote').value='';
    w.document.querySelector('[data-add="product-sac"]').click();await submit(w);
    assert.equal(firstPosts.length,1);assert.equal(firstPosts[0].servicePointCode,pointCode,'the stable QR code is submitted with the order');
    assert.match(w.document.querySelector('#checkoutError').textContent,/conservées/);
    const persistedDraft=w.sessionStorage.getItem('oymike-shop-order:awa-creations');assert.ok(persistedDraft);
    const secondPosts=[];
    const resumed=createPage(async(url,init={})=>{
      if(String(url)==='/api/public/shops/awa-creations')return jsonResponse(catalog);
      if(String(url)===`/api/public/service-points/${pointCode}`)return jsonResponse(point);
      if(String(url).endsWith('/orders')){secondPosts.push(JSON.parse(init.body));return jsonResponse({error:'Temporary upstream timeout'},504);}
      throw new Error(`Unexpected request: ${url}`);
    },{'oymike-shop-cart:awa-creations':w.sessionStorage.getItem('oymike-shop-cart:awa-creations'),'oymike-shop-order:awa-creations':persistedDraft},`https://shop.example.test/shop/awa-creations?servicePoint=${pointCode}`);
    try{
      const w2=resumed.window;await waitForCatalogue(w2);assert.equal(w2.document.querySelector('#deliveryAddress').value,'Table 4');await submit(w2);
      assert.equal(secondPosts.length,1);assert.equal(secondPosts[0].servicePointCode,pointCode);assert.equal(secondPosts[0].clientRequestId,firstPosts[0].clientRequestId,'retry retains the same order key');assert.deepEqual(secondPosts[0],firstPosts[0]);
    }finally{resumed.window.close();}
  }finally{first.window.close();}
});
