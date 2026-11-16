'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
const clone = (value) => JSON.parse(JSON.stringify(value));
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, async json() { return clone(data); } });

test('suivi public : demande d’annulation confirmée, reprises réseau idempotentes et résultat sans données de suivi actives', async (t) => {
  const html = await fs.readFile(path.join(root, 'public/order-tracking.html'), 'utf8');
  const script = await fs.readFile(path.join(root, 'public/order-tracking.js'), 'utf8');
  const token = 'secure-tracking-token-with-at-least-32-characters';
  const dom = new JSDOM(html, { url: `https://shop.example.test/order/OY-UI-123?token=${encodeURIComponent(token)}`, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close()); const w = dom.window;
  const activeOrder = { reference: 'OY-UI-123', status: 'pending', customerName: 'John Sery Michael', customerPhone: '+225 0700000000',
    deliveryAddress: 'Retrait boutique', servicePointName: 'Table 4', items: [{ name: 'Plat', quantity: 2, unitPriceXof: 1000 }],
    totalAmountXof: 2000, deliveryFeeXof: 0, discountAmountXof: 0, currency: 'XOF', events: [{ status: 'pending', createdAt: new Date().toISOString() }],
    store: { name: 'Boutique test', slug: 'boutique-test', phone: '+225 0700000000', whatsapp: '+225 0700000000' },
    orderPolicy: { clientCancellationEnabled: true, clientBrowserNotifications: false },
    cancellationRequests: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const calls = []; let cancelAttempts = 0;
  w.fetch = async (url, options = {}) => {
    const target = String(url); const method = options.method || 'GET';
    calls.push({ target, method, body: options.body ? JSON.parse(options.body) : {} });
    if (method === 'POST' && target.includes('/cancel?')) {
      cancelAttempts += 1;
      if (cancelAttempts === 1) throw new Error('connection lost after sending');
      const body = JSON.parse(options.body);
      const cancelled = { ...clone(activeOrder), status: 'cancelled', updatedAt: new Date().toISOString(),
        events: [...activeOrder.events, { status: 'cancelled', note: 'Commande annulée par le client avant confirmation.', createdAt: new Date().toISOString() }],
        cancellationRequests: [{ id: 'cancellation-row-1', reason: body.reason, status: 'accepted', decisionNote: 'Annulation demandée avant confirmation; prise en compte automatiquement.', requestedAt: new Date().toISOString(), decidedAt: new Date().toISOString() }] };
      return response({ data: { request: cancelled.cancellationRequests[0], autoAccepted: true, idempotent: false, order: cancelled } }, 201);
    }
    return response({ data: clone(activeOrder) });
  };
  w.confirm = () => true; w.setInterval = () => 1; w.clearInterval = () => {};
  w.eval(script); await tick();
  assert.equal(w.document.querySelector('#trackingContent').hidden, false);
  assert.equal(w.document.querySelector('#trackingServicePoint').textContent, 'Emplacement : Table 4');
  assert.equal(w.document.querySelectorAll('#trackingSteps li').length, 1, 'the public timeline lists only status events actually returned by the server');
  assert.equal(w.document.querySelector('#trackingSteps').textContent.includes('En préparation'), false, 'the UI does not infer acceptance or preparation from a later/current status');
  assert.equal(w.document.querySelector('#trackingContact a[href^="tel:"]').getAttribute('href'), 'tel:+225 0700000000', 'contact link uses the recorded store phone');
  assert.equal(w.document.querySelector('#trackingRecoverMore').hidden, false);
  assert.equal(w.document.querySelector('#enableTrackingNotifications').hidden, true, 'client browser notifications follow the actual policy');
  assert.equal(w.document.querySelector('#trackingCancellationForm').hidden, false);

  const form = w.document.querySelector('#trackingCancellationForm'); const button = w.document.querySelector('#trackingCancellationButton');
  w.document.querySelector('#trackingCancellationReason').value = 'Commande passée par erreur.';
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(button.disabled, true, 'the submit control is locked immediately against repeated clicks');
  await tick();
  assert.equal(w.document.querySelector('#trackingCancellationError').hidden, false, 'a network ambiguity is explained without losing the form');
  const firstRequest = calls.find((call) => call.method === 'POST');
  assert.ok(firstRequest); assert.match(firstRequest.body.requestId, /^[A-Za-z0-9_-]{16,100}$/);
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1, 'a rapid second submit is ignored');

  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await tick();
  const postCalls = calls.filter((call) => call.method === 'POST');
  assert.equal(postCalls.length, 2); assert.equal(postCalls[1].body.requestId, firstRequest.body.requestId, 'a retry after an ambiguous network failure reuses the same idempotency key');
  assert.equal(postCalls[1].body.reason, 'Commande passée par erreur.');
  assert.equal(w.document.querySelector('#trackingCancellationState').textContent, 'Annulation prise en compte. Cette commande n’est plus active dans le suivi public.');
  assert.equal(w.document.querySelector('#trackingCancellationForm').hidden, true);
  assert.match(w.document.querySelector('#trackingStatus').textContent, /Annulée/);
});
