'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
const json = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, async json() { return JSON.parse(JSON.stringify(data)); } });

test('récupération publique : boutique, référence, secret et téléphone obligatoires; liste d’ordres et liens exacts', async (t) => {
  const html = await fs.readFile(path.join(root, 'public/order-recovery.html'), 'utf8');
  const script = await fs.readFile(path.join(root, 'public/order-recovery.js'), 'utf8');
  const token = 'A-very-long-order-secret-token-for-browser-test-1234567890';
  const order = { reference: 'OY-RECOVER-1', status: 'out_for_delivery', trackingCode: token, customerPhone: '+225 0100000000',
    deliveryAddress: 'Livraison à Cocody', servicePointName: 'Résidence', totalAmountXof: 12000, deliveryFeeXof: 1000, discountAmountXof: 500,
    items: [{ name: 'Sac tissé', quantity: 2, unitPriceXof: 6000 }], events: [{ status: 'pending', createdAt: '2026-10-10T08:00:00Z' }, { status: 'out_for_delivery', note: 'Colis confié au livreur.', createdAt: '2026-10-10T09:00:00Z' }],
    store: { name: 'Awa Créations', slug: 'awa-creations', phoneContactUrl:'tel:+2250700000000', whatsappContactUrl:'https://wa.me/2250700000000' }, createdAt: '2026-10-10T08:00:00Z' };
  const requests = [];
  const dom = new JSDOM(html, { url: 'https://shop.example.test/order-recovery/?store=awa-creations', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close()); const w = dom.window;
  w.fetch = async (url, options = {}) => { requests.push({ url: String(url), method: options.method, body: options.body ? JSON.parse(options.body) : null }); return json({ data: [order] }); };
  w.eval(script);
  assert.equal(w.document.querySelector('#recoveryStore').value, 'awa-creations');
  w.document.querySelector('#recoveryReference').value = order.reference;
  w.document.querySelector('#recoveryToken').value = token;
  w.document.querySelector('#recoveryPhone').value = order.customerPhone;
  w.document.querySelector('#recoveryForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await tick(); await tick();
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/api\/public\/shops\/awa-creations\/orders\/recover$/);
  assert.equal(requests[0].body.reference, order.reference); assert.equal(requests[0].body.token, token); assert.equal(requests[0].body.phone, order.customerPhone);
  const result = w.document.querySelector('#recoveryResults');
  assert.equal(result.hidden, false); assert.match(result.textContent, /Awa Créations/); assert.match(result.textContent, /En livraison/);
  assert.match(result.textContent, /Sac tissé × 2/); assert.match(result.textContent, /Remise enregistrée/); assert.match(result.textContent, /Résidence/);
  assert.equal(result.querySelector('a[href="tel:+2250700000000"]') !== null, true, 'the call action uses the normalized international store phone');
  assert.equal(result.querySelector('a[href="https://wa.me/2250700000000"]') !== null,true,'the WhatsApp action uses the international link format');
  assert.doesNotMatch(result.textContent,/0700000000/,'contact buttons do not print the store phone number');
  assert.equal(result.querySelector('a[href^="/order/OY-RECOVER-1?token="]') !== null, true, 'each active order receives a secure tracking link');
  assert.match(w.document.body.textContent, /téléphone seul ne donne jamais accès/i);
});
