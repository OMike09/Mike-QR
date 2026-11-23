// Contrôle d'interface (Playwright) : onglet Consignation du portail marchand + application client.
const { chromium } = require('playwright');
const B = process.env.BASE || 'http://127.0.0.1:4931';
const ck = (r) => (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((l) => l.split(';')[0]).filter((p) => !p.endsWith('=')).join('; ');
const call = async (m, p, b, c) => {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(c ? { cookie: c } : {}) }, body: (b && m !== 'GET') ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { s: r.status, j, c: ck(r) };
};

(async () => {
  // préparation : marchand + boutique + type de bouteille + une consignation
  const admin = (await call('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' })).c;
  const tag = Date.now().toString(36).slice(-5);
  const phone = '+22507' + String(Math.floor(Math.random() * 90000000) + 10000000);
  await call('POST', '/api/admin/merchants', { username: 'ui' + tag, displayName: 'Maquis UI', phone: '+2250700' + String(Math.floor(Math.random() * 90000) + 10000), password: '481920' }, admin);
  let l = await call('POST', '/api/merchant/auth/login', { username: 'ui' + tag, password: '481920' });
  await call('POST', '/api/merchant/auth/change-password', { currentPassword: '481920', password: '735291', confirmPassword: '735291' }, l.c);
  l = await call('POST', '/api/merchant/auth/login', { username: 'ui' + tag, password: '735291' });
  const mck = l.c;
  await call('PUT', '/api/merchant/store', { name: 'Maquis UI ' + tag, isPublished: true, acceptsOrders: true }, mck);
  const type = await call('POST', '/api/merchant/consignment-settings/bottle-types', { label: 'Bouteille 33cl', reference: '33cl', unitValueXof: 100 }, mck);
  await call('POST', '/api/merchant/consignments', { kind: 'bottle', customerName: 'Awa Koffi', customerPhone: phone, bottleTypeId: type.j.data.id, quantity: 5, idempotencyKey: 'ui-' + tag }, mck);
  await call('POST', '/api/merchant/consignments', { kind: 'money', customerName: 'Ibrahim', customerPhone: phone, amountXof: 10000, reason: 'Avance', idempotencyKey: 'ui2-' + tag }, mck);

  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pair = mck.split(';')[0];
  const eq = pair.indexOf('=');
  await ctx.addCookies([{ name: pair.slice(0, eq), value: pair.slice(eq + 1), domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 160)); });
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url().replace(B, '')}`); });

  await page.goto(B + '/merchant/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  await page.evaluate(() => document.querySelector('button[data-tab="consignment"]').click());
  await page.waitForTimeout(2200);
  await page.screenshot({ path: '/tmp/ui-consign-list.png', fullPage: false });

  // ouvre la fiche d'une consignation
  const opened = await page.evaluate(async () => {
    const button = document.querySelector('[data-consign-open]');
    if (!button) return 'aucune ligne';
    button.click();
    await new Promise((r) => setTimeout(r, 1200));
    const modal = document.querySelector('#consignModal');
    return modal && !modal.hidden ? modal.innerText.slice(0, 120) : 'modale non ouverte';
  });
  await page.screenshot({ path: '/tmp/ui-consign-detail.png' });

  // ouvre le formulaire de dépôt
  await page.evaluate(() => document.querySelector('#consignModal')?.setAttribute('hidden', 'hidden'));
  await page.evaluate(() => document.querySelector('[data-consign-new="bottle"]').click());
  await page.waitForTimeout(900);
  await page.screenshot({ path: '/tmp/ui-consign-form.png' });
  const formText = await page.evaluate(() => document.querySelector('#consignModal')?.innerText.slice(0, 200) || '');

  // réalise un dépôt via l'interface
  const deposit = await page.evaluate(async () => {
    const card = document.querySelector('.consign-modal-card');
    if (!card) return 'pas de formulaire';
    const set = (sel, value) => { const node = card.querySelector(sel); if (node) { node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); } };
    set('#cName', 'Client Interface');
    set('#cQty', '3');
    const select = card.querySelector('#cType');
    if (select && select.options.length > 1) { select.selectedIndex = 1; select.dispatchEvent(new Event('change', { bubbles: true })); }
    card.querySelector('#consignDepositForm').requestSubmit();
    await new Promise((r) => setTimeout(r, 2200));
    const receipt = document.querySelector('#consignReceipt');
    if (receipt) return receipt.innerText.replace(/\s+/g, ' ').slice(0, 160);
    const toast = document.getElementById('consignToast');
    return 'reçu absent — toast: ' + (toast && !toast.hidden ? toast.textContent : 'aucun');
  });
  await page.screenshot({ path: '/tmp/ui-consign-receipt.png' });

  // application client (vue mobile)
  const clientCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const clientPage = await clientCtx.newPage();
  clientPage.on('pageerror', (e) => errors.push('CLIENT PAGEERROR ' + e.message));
  // Le 401 de `/api/client/auth/me` est le comportement ATTENDU d'un visiteur non connecté : le
  // navigateur le journalise comme une ressource en erreur, ce n'est ni un bug ni une fuite.
  clientPage.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/401/.test(text) && /client\/auth\/me/.test(text)) return;
    if (/status of 401/.test(text) && /^Failed to load resource/.test(text)) return;
    errors.push('CLIENT CONSOLE ' + text.slice(0, 160));
  });
  await clientPage.goto(B + '/app/', { waitUntil: 'domcontentloaded' });
  await clientPage.waitForTimeout(1200);
  await clientPage.screenshot({ path: '/tmp/ui-client-auth.png' });
  const manifest = await clientPage.evaluate(async () => {
    const link = document.querySelector('link[rel=manifest]');
    if (!link) return 'aucun manifeste';
    const response = await fetch(link.href);
    const data = await response.json();
    return `${data.name} | icônes ${data.icons.length} | start ${data.start_url} | display ${data.display}`;
  });
  const sw = await clientPage.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'pas de service worker';
    const reg = await navigator.serviceWorker.getRegistration('/app/');
    return reg ? 'service worker actif (portée ' + reg.scope + ')' : 'non enregistré';
  });


  // --- application client connectée (parcours complet dans le navigateur)
  const cPhone = '+22507' + String(Math.floor(Math.random() * 90000000) + 10000000);
  const otp = await call('POST', '/api/client/auth/request-code', { phone: cPhone });
  const verify = await call('POST', '/api/client/auth/verify-code', { phone: cPhone, code: otp.j?.data?.devCode });
  const clientPair = verify.c.split(';')[0];
  const eqc = clientPair.indexOf('=');
  await clientCtx.addCookies([{ name: clientPair.slice(0, eqc), value: clientPair.slice(eqc + 1), domain: '127.0.0.1', path: '/' }]);
  await clientPage.goto(B + '/app/', { waitUntil: 'domcontentloaded' });
  await clientPage.waitForTimeout(1600);
  await clientPage.screenshot({ path: '/tmp/ui-client-app.png' });
  const clientTabs = await clientPage.evaluate(() => Array.from(document.querySelectorAll('.tab')).map((t) => t.textContent.trim()));
  const clientPanel = await clientPage.evaluate(() => document.getElementById('panel-commandes')?.innerText.replace(/\s+/g, ' ').slice(0, 120) || '');

  console.log('onglets app client       :', clientTabs.join(' | '));
  console.log('panneau commandes        :', clientPanel);
  console.log('liste consignation       :', opened.replace(/\s+/g, ' ').slice(0, 110));
  console.log('formulaire de dépôt      :', formText.replace(/\s+/g, ' ').slice(0, 120));
  console.log('dépôt depuis l’interface :', String(deposit).replace(/\s+/g, ' ').slice(0, 140));
  console.log('manifeste client         :', manifest);
  console.log('service worker           :', sw);
  console.log('erreurs JS / HTTP ≥500   :', errors.length ? errors.join(' || ') : 'aucune');
  await browser.close();
})();
